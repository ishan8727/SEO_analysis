#!/bin/bash
# Bootstraps the shared apps VM: runbook.md section 1, steps A8 (host) and B8 (per app).
# Run on the VM, not in Cloud Shell: bash vm-bootstrap.sh <app> [<app> ...]. setup.sh copies and runs it.
# Idempotent: safe to rerun; existing pieces are kept or rewritten with the same content.
set -eo pipefail

APPS="$*"
export DEBIAN_FRONTEND=noninteractive
step() { echo; echo "== VM: $*"; }

if [ "$(hostname)" != "tsi-apps-1" ]; then
  echo "This runs on the VM tsi-apps-1, but this machine is $(hostname). Nothing was changed."
  exit 1
fi
[ -n "$APPS" ] || { echo "Usage: bash vm-bootstrap.sh <app> [<app> ...]"; exit 1; }

step "Docker Engine + compose plugin"
# json-file logs (rotated) that the Ops Agent ships to Cloud Logging as structured entries (see below).
# gcplogs isn't used: it sends each line as an unparsed string, so app severities are lost.
DAEMON_JSON='{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3", "labels": "com.docker.compose.project,com.docker.compose.service" },
  "live-restore": true
}'
sudo mkdir -p /etc/docker
DAEMON_CHANGED=no
if [ "$(sudo cat /etc/docker/daemon.json 2>/dev/null)" != "$DAEMON_JSON" ]; then
  echo "$DAEMON_JSON" | sudo tee /etc/docker/daemon.json >/dev/null
  DAEMON_CHANGED=yes
fi
if ! command -v docker >/dev/null; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq ca-certificates curl unattended-upgrades >/dev/null
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
  echo "   installed"
else
  echo "   already installed"
  if [ "$DAEMON_CHANGED" = yes ]; then
    # live-restore keeps containers running; they pick up the new log driver when recreated.
    sudo systemctl restart docker
    echo "   log settings changed: docker restarted"
  fi
fi
sudo usermod -aG docker "$USER"

step "Block containers from the metadata server"
sudo tee /etc/systemd/system/block-container-metadata.service >/dev/null <<'UNIT'
[Unit]
Description=Block containers from the GCE metadata server
After=docker.service
PartOf=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'iptables -C DOCKER-USER -d 169.254.169.254/32 -j REJECT 2>/dev/null || iptables -I DOCKER-USER -d 169.254.169.254/32 -j REJECT'
ExecStop=/bin/sh -c 'iptables -D DOCKER-USER -d 169.254.169.254/32 -j REJECT || true'

[Install]
WantedBy=docker.service
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now block-container-metadata >/dev/null
echo "   enabled"

step "2 GB swap"
if [ ! -f /swapfile ]; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
echo "   ok"

step "Ops Agent (memory/disk metrics)"
if ! dpkg -s google-cloud-ops-agent >/dev/null 2>&1; then
  curl -sSO https://dl.google.com/cloudagents/add-google-cloud-ops-agent-repo.sh
  sudo bash add-google-cloud-ops-agent-repo.sh --also-install >/dev/null
  rm -f add-google-cloud-ops-agent-repo.sh
  echo "   installed"
else
  echo "   already installed"
fi
# Container logs: Docker's json-file lines wrap each app line; parse both layers and lift the app's
# `severity` (src/lib/log.ts) onto the entry. Lines that aren't JSON (postgres, moli) stay plain text.
OPS_CONFIG='logging:
  receivers:
    docker:
      type: files
      include_paths: [/var/lib/docker/containers/*/*-json.log]
  processors:
    docker_line:
      type: parse_json
    app_line:
      type: parse_json
      field: log
    app_severity:
      type: modify_fields
      fields:
        severity:
          move_from: jsonPayload.severity
  service:
    pipelines:
      docker:
        receivers: [docker]
        processors: [docker_line, app_line, app_severity]'
if [ "$(sudo cat /etc/google-cloud-ops-agent/config.yaml 2>/dev/null)" != "$OPS_CONFIG" ]; then
  echo "$OPS_CONFIG" | sudo tee /etc/google-cloud-ops-agent/config.yaml >/dev/null
  sudo systemctl restart google-cloud-ops-agent
  echo "   container log pipeline configured"
fi

step "Registry login and folders"
gcloud auth configure-docker asia-south1-docker.pkg.dev --quiet >/dev/null
sudo mkdir -p /opt/apps /opt/edge/sites /opt/edge/apps
sudo chown -R "$USER": /opt/apps /opt/edge
echo "   ok"

step "Shared edge Caddy (/opt/edge)"
cat > /opt/edge/docker-compose.yml <<'COMPOSE'
name: edge
services:
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./sites:/etc/caddy/sites:ro
      - caddy_data:/data
      - caddy_config:/config
    mem_limit: 192m
volumes:
  caddy_data:
  caddy_config:
COMPOSE
cat > /opt/edge/Caddyfile <<'CADDY'
{
	email grow@thesalesinc.com
}
import sites/*.caddy
CADDY
cat > /opt/edge/up.sh <<'UPSH'
#!/bin/sh
# Start or update the shared Caddy, attached to every app's edge network (apps/*.yml), then reload its sites.
set -e
cd /opt/edge
set -- -f docker-compose.yml
for f in apps/*.yml; do [ -e "$f" ] && set -- "$@" -f "$f"; done
docker compose "$@" up -d
# Caddy may still be starting; retry the reload for up to 10 s
for i in 1 2 3 4 5; do
  docker compose "$@" exec caddy caddy reload --config /etc/caddy/Caddyfile && exit 0
  sleep 2
done
exit 1
UPSH
chmod +x /opt/edge/up.sh
echo "   ok"

for APP in $APPS; do
  step "App $APP: folder and private network to Caddy"
  mkdir -p "/opt/apps/$APP" && chmod 700 "/opt/apps/$APP"
  sudo docker network inspect "edge-$APP" >/dev/null 2>&1 || sudo docker network create "edge-$APP" >/dev/null
  printf 'services:\n  caddy:\n    networks: [default, edge-%s]\nnetworks:\n  edge-%s:\n    external: true\n' "$APP" "$APP" \
    > "/opt/edge/apps/$APP.yml"
  echo "   ok"
done

step "Start the edge"
# A running Caddy keeps its old log driver until it's recreated.
if [ "$DAEMON_CHANGED" = yes ]; then sudo docker rm -f edge-caddy-1 >/dev/null 2>&1 || true; fi
sudo /opt/edge/up.sh

step "Checks"
sudo docker run --rm hello-world | grep "Hello from Docker"
echo "compose: $(sudo docker compose version --short)"
echo "swap:    $(free -h | awk '/Swap/ {print $2}')"
echo "logs:    $(sudo docker info --format '{{.LoggingDriver}}') -> Ops Agent ($(systemctl is-active google-cloud-ops-agent))"
# curl exit 7 = connection refused by our REJECT rule; anything else means the block isn't working
set +e
sudo docker run --rm curlimages/curl -s -m 5 http://169.254.169.254/ >/dev/null 2>&1
RC=$?
set -e
if [ "$RC" -eq 7 ]; then
  echo "metadata: blocked for containers (ok)"
else
  echo "metadata: NOT blocked for containers (curl exit $RC). Stop and report this."
  exit 1
fi
echo "host metadata: $(curl -s -m 5 -H 'Metadata-Flavor: Google' http://169.254.169.254/computeMetadata/v1/instance/name) (host keeps access, ok)"
for APP in $APPS; do
  echo "edge-$APP members: $(sudo docker network inspect "edge-$APP" --format '{{range .Containers}}{{.Name}} {{end}}')"
done
echo
echo "VM bootstrap done."
