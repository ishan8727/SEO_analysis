#!/bin/bash
# Runs on the VM as root; scripts/deploy.sh copies it here with the files next to it and calls it:
#   sudo bash vm-deploy.sh <image-tag>
# Writes /opt/apps/seo-audit/.env (config + Secret Manager values), pulls the images for <image-tag>,
# restarts the app, installs the nightly backup timer, updates the edge Caddy and waits for /api/health.
set -eo pipefail

TAG=$1
APP=seo-audit
SRC=$(cd "$(dirname "$0")" && pwd)
DIR=/opt/apps/$APP
SECRETS="HASH_SALT COOKIE_SECRET INTERNAL_TOKEN MOLI_TOKEN POSTGRES_PASSWORD TURNSTILE_SECRET GEMINI_API_KEY GOOGLE_SERVER_KEY"
step() { echo; echo "== VM: $*"; }

[ -n "$TAG" ] || { echo "Usage: sudo bash vm-deploy.sh <image-tag>"; exit 1; }
[ "$(id -u)" = 0 ] || { echo "Run with sudo"; exit 1; }
PROJECT=$(curl -fsS -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/project/project-id)
REGISTRY=asia-south1-docker.pkg.dev/$PROJECT/$APP
COMPOSE=(docker compose -p "$APP" --project-directory "$DIR" -f "$DIR/docker-compose.yml" -f "$DIR/docker-compose.prod.yml")

step "Files in $DIR"
install -d -m 700 "$DIR"
install -m 644 "$SRC/docker-compose.yml" "$SRC/docker-compose.prod.yml" "$DIR/"
install -m 700 "$SRC/backup.sh" "$DIR/backup.sh"

step ".env from Secret Manager"
umask 077
{
  echo "# Written by vm-deploy.sh $(date -u +%FT%TZ). Don't edit: change deploy/seo-audit.env or Secret Manager, then redeploy."
  grep -vE '^[[:space:]]*(#|$)' "$SRC/seo-audit.env"
  echo "REGISTRY=$REGISTRY"
  echo "IMAGE_TAG=$TAG"
  for NAME in $SECRETS; do
    VAL=$(gcloud secrets versions access latest --secret="$APP-$NAME" --project="$PROJECT")
    # Single-quoted so compose takes the value literally; refuse values that would break that.
    case "$VAL" in
      "" | *"'"* | *$'\n'*) echo "Secret $APP-$NAME is empty or has a quote or newline" >&2; exit 1 ;;
    esac
    echo "$NAME='$VAL'"
    if [ "$NAME" = GOOGLE_SERVER_KEY ]; then echo "PSI_API_KEY='$VAL'"; fi
  done
} > "$DIR/.env.new"
mv "$DIR/.env.new" "$DIR/.env"
echo "   ok ($(grep -c '=' "$DIR/.env") settings)"

step "Pull $TAG"
gcloud auth configure-docker asia-south1-docker.pkg.dev --quiet >/dev/null 2>&1
"${COMPOSE[@]}" pull --quiet
echo "   ok"

step "Start"
"${COMPOSE[@]}" up -d --remove-orphans

step "Edge site"
install -m 644 "$SRC/seo-audit.caddy" /opt/edge/sites/seo-audit.caddy
/opt/edge/up.sh

step "Nightly backup timer (02:00 IST)"
cat > /etc/systemd/system/$APP-backup.service <<UNIT
[Unit]
Description=$APP: pg_dump to Cloud Storage

[Service]
Type=oneshot
ExecStart=$DIR/backup.sh
UNIT
cat > /etc/systemd/system/$APP-backup.timer <<UNIT
[Unit]
Description=$APP nightly backup

[Timer]
OnCalendar=*-*-* 20:30:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now "$APP-backup.timer" >/dev/null
echo "   next run: $(systemctl show "$APP-backup.timer" -p NextElapseUSecRealtime --value)"

step "Health"
for i in $(seq 1 40); do
  if BODY=$(docker run --rm --network "edge-$APP" curlimages/curl -fsS -m 5 "http://$APP-web:3000/api/health" 2>/dev/null); then
    echo "   $BODY"
    break
  fi
  if [ "$i" = 40 ]; then
    echo "   /api/health is still failing after 200 s. Recent logs:"
    "${COMPOSE[@]}" ps
    "${COMPOSE[@]}" logs --tail=30 web worker moli
    exit 1
  fi
  sleep 5
done

# Old layers only; tagged images stay for a quick rollback.
docker image prune -f >/dev/null
echo
echo "Deployed $TAG."
