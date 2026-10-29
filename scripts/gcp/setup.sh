#!/bin/bash
# One-shot Google Cloud setup: the shared apps VM (runbook.md Part A) and the seo-audit app (Part B).
# Run in Cloud Shell with vm-bootstrap.sh next to it:
#   GCP_PROJECT=<project id> APP_DOMAIN=<site domain> bash setup.sh
# Idempotent: anything that already exists is kept, so it is safe to rerun after a failure.
# Left by hand: the DNS record (printed at the end) and a budget alert.
set -eo pipefail

PROJECT=${GCP_PROJECT:?Set GCP_PROJECT to your Google Cloud project id}
REGION=asia-south1
ZONE=asia-south1-a
VM=shared-apps-1
TAG=shared-apps
SA_NAME=shared-apps-vm
SA=$SA_NAME@$PROJECT.iam.gserviceaccount.com
APP=seo-audit
DOMAIN=${APP_DOMAIN:?Set APP_DOMAIN to the site's domain, e.g. audit.example.com}
BUCKET=gs://$PROJECT-$APP-backups
BOOTSTRAP="$(cd "$(dirname "$0")" && pwd)/vm-bootstrap.sh"

step() { echo; echo "== $*"; }
have() { "$@" >/dev/null 2>&1; }   # true when a describe/list command succeeds
# New service accounts take a few seconds to be usable in IAM bindings
retry() {
  local n=1
  until "$@"; do
    if [ $n -ge 6 ]; then return 1; fi
    echo "   retrying in 10 s ($n/5)..." >&2; n=$((n + 1)); sleep 10
  done
}

if [ ! -f "$BOOTSTRAP" ]; then echo "Missing $BOOTSTRAP (it must sit next to setup.sh)"; exit 1; fi
gcloud config set project $PROJECT >/dev/null 2>&1

step "APIs"
gcloud services enable compute.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com \
  secretmanager.googleapis.com logging.googleapis.com monitoring.googleapis.com iap.googleapis.com \
  storage.googleapis.com apikeys.googleapis.com places.googleapis.com pagespeedonline.googleapis.com

step "Keys to paste (asked only if not stored yet; input is hidden)"
ask() {
  if have gcloud secrets describe "$APP-$1"; then echo "   $APP-$1: already stored"; return; fi
  # Without a terminal (e.g. run by a tool) skip it; rerunning setup.sh in a terminal asks again
  if [ ! -t 0 ]; then echo "   $APP-$1: skipped (no terminal to ask in); rerun setup.sh in a terminal to add it"; return; fi
  local v=""
  while [ -z "$v" ]; do read -rsp "   Paste $1: " v; echo; done
  printf -v "VAL_$1" '%s' "$v"
}
ask TURNSTILE_SECRET
ask GEMINI_API_KEY
echo "   The rest runs unattended (about 10 minutes)."

step "VM service account"
if ! have gcloud iam service-accounts describe $SA; then
  gcloud iam service-accounts create $SA_NAME --display-name="Shared apps VM"
fi
for ROLE in roles/logging.logWriter roles/monitoring.metricWriter; do
  retry gcloud projects add-iam-policy-binding $PROJECT --member="serviceAccount:$SA" --role=$ROLE \
    --condition=None --quiet >/dev/null
done
echo "   ok"

step "Static IP"
if ! have gcloud compute addresses describe shared-apps-ip --region=$REGION; then
  gcloud compute addresses create shared-apps-ip --region=$REGION
fi
IP=$(gcloud compute addresses describe shared-apps-ip --region=$REGION --format='value(address)')
echo "   $IP"

step "Firewall (80/443 open, SSH only through IAP)"
if ! have gcloud compute networks describe default; then
  gcloud compute networks create default --subnet-mode=auto
fi
if ! have gcloud compute firewall-rules describe shared-apps-allow-web; then
  gcloud compute firewall-rules create shared-apps-allow-web --network=default --direction=INGRESS \
    --action=ALLOW --rules=tcp:80,tcp:443,udp:443 --source-ranges=0.0.0.0/0 --target-tags=$TAG
fi
if ! have gcloud compute firewall-rules describe shared-apps-allow-iap-ssh; then
  gcloud compute firewall-rules create shared-apps-allow-iap-ssh --network=default --direction=INGRESS \
    --action=ALLOW --rules=tcp:22 --source-ranges=35.235.240.0/20 --target-tags=$TAG
fi
# Google's default rules open SSH/RDP to the whole internet
for RULE in default-allow-ssh default-allow-rdp; do
  if have gcloud compute firewall-rules describe $RULE; then gcloud compute firewall-rules delete $RULE --quiet; fi
done
echo "   ok"

step "VM $VM"
if ! have gcloud compute instances describe $VM --zone=$ZONE; then
  gcloud compute instances create $VM --zone=$ZONE --machine-type=e2-medium \
    --image-family=debian-12 --image-project=debian-cloud \
    --boot-disk-size=50GB --boot-disk-type=pd-balanced \
    --address=shared-apps-ip --tags=$TAG \
    --service-account=$SA --scopes=cloud-platform \
    --shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring \
    --metadata=enable-oslogin=TRUE
else
  echo "   already exists"
fi

step "Daily disk snapshots (02:30 IST, kept 7 days)"
if ! have gcloud compute resource-policies describe shared-apps-daily --region=$REGION; then
  gcloud compute resource-policies create snapshot-schedule shared-apps-daily --region=$REGION \
    --daily-schedule --start-time=21:00 --max-retention-days=7 --on-source-disk-delete=keep-auto-snapshots
fi
POLICIES=$(gcloud compute disks describe $VM --zone=$ZONE --format='value(resourcePolicies)')
if [[ "$POLICIES" != *shared-apps-daily* ]]; then
  gcloud compute disks add-resource-policies $VM --zone=$ZONE --resource-policies=shared-apps-daily
fi
echo "   ok"

step "Image registry $APP (the VM can pull this repo only)"
if ! have gcloud artifacts repositories describe $APP --location=$REGION; then
  gcloud artifacts repositories create $APP --repository-format=docker --location=$REGION \
    --description="$APP images" --labels=app=$APP
fi
retry gcloud artifacts repositories add-iam-policy-binding $APP --location=$REGION \
  --member="serviceAccount:$SA" --role=roles/artifactregistry.reader --quiet >/dev/null
echo "   ok"

step "Cloud Build for $APP: build-only service account and a source bucket (scripts/deploy.sh)"
BUILD_SA=$APP-build@$PROJECT.iam.gserviceaccount.com
BUILD_BUCKET=gs://$PROJECT-$APP-build
if ! have gcloud iam service-accounts describe $BUILD_SA; then
  gcloud iam service-accounts create $APP-build --display-name="$APP Cloud Build"
fi
retry gcloud projects add-iam-policy-binding $PROJECT --member="serviceAccount:$BUILD_SA" \
  --role=roles/logging.logWriter --condition=None --quiet >/dev/null
retry gcloud artifacts repositories add-iam-policy-binding $APP --location=$REGION \
  --member="serviceAccount:$BUILD_SA" --role=roles/artifactregistry.writer --quiet >/dev/null
if ! have gcloud storage buckets describe $BUILD_BUCKET; then
  gcloud storage buckets create $BUILD_BUCKET --location=$REGION --uniform-bucket-level-access --public-access-prevention
fi
# Relative path: works in Cloud Shell and in Git Bash on Windows
LIFECYCLE=lifecycle-$$.json
echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":7}}]}' > "$LIFECYCLE"
gcloud storage buckets update $BUILD_BUCKET --update-labels=app=$APP --lifecycle-file="$LIFECYCLE" >/dev/null
rm -f "$LIFECYCLE"
retry gcloud storage buckets add-iam-policy-binding $BUILD_BUCKET --member="serviceAccount:$BUILD_SA" \
  --role=roles/storage.objectViewer >/dev/null
echo "   ok"

step "Backup bucket $BUCKET (the VM can add, not read or delete; deleted after 30 days)"
if ! have gcloud storage buckets describe $BUCKET; then
  gcloud storage buckets create $BUCKET --location=$REGION --uniform-bucket-level-access --public-access-prevention
fi
# Relative path: works in Cloud Shell and in Git Bash on Windows
LIFECYCLE=lifecycle-$$.json
echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":30}}]}' > "$LIFECYCLE"
gcloud storage buckets update $BUCKET --update-labels=app=$APP --lifecycle-file="$LIFECYCLE" >/dev/null
rm -f "$LIFECYCLE"
retry gcloud storage buckets add-iam-policy-binding $BUCKET --member="serviceAccount:$SA" \
  --role=roles/storage.objectCreator >/dev/null
echo "   ok"

step "Secrets ($APP-*)"
# store NAME VALUE: create the secret if missing (VALUE ignored otherwise), then let the VM read it
store() {
  local id="$APP-$1"
  if have gcloud secrets describe "$id"; then
    echo "   $id: already stored"
  elif [ -z "$2" ]; then
    echo "   $id: TO DO, no value given (rerun setup.sh in a terminal)"
    return
  else
    printf '%s' "$2" | gcloud secrets create "$id" --replication-policy=user-managed --locations=$REGION \
      --labels=app=$APP --data-file=- >/dev/null
    echo "   $id: created"
  fi
  retry gcloud secrets add-iam-policy-binding "$id" --member="serviceAccount:$SA" \
    --role=roles/secretmanager.secretAccessor --quiet >/dev/null
}
for NAME in HASH_SALT COOKIE_SECRET INTERNAL_TOKEN MOLI_TOKEN POSTGRES_PASSWORD; do
  store $NAME "$(openssl rand -hex 24)"
done
store TURNSTILE_SECRET "$VAL_TURNSTILE_SECRET"
store GEMINI_API_KEY "$VAL_GEMINI_API_KEY"

step "Production server key, locked to $IP (Places + PageSpeed)"
key_name() { gcloud services api-keys list --filter="displayName=$APP-server-prod" --limit=1 --format='value(name)'; }
KEY_NAME=$(key_name)
if [ -z "$KEY_NAME" ]; then
  gcloud services api-keys create --display-name="$APP-server-prod" \
    --api-target=service=places.googleapis.com --api-target=service=pagespeedonline.googleapis.com \
    --allowed-ips=$IP >/dev/null
  KEY_NAME=$(key_name)
else
  gcloud services api-keys update "$KEY_NAME" --allowed-ips=$IP \
    --api-target=service=places.googleapis.com --api-target=service=pagespeedonline.googleapis.com >/dev/null
fi
store GOOGLE_SERVER_KEY "$(gcloud services api-keys get-key-string "$KEY_NAME" --format='value(keyString)')"

step "Waiting for SSH to $VM (a new VM needs a minute or two)"
SSH=(gcloud compute ssh $VM --zone=$ZONE --tunnel-through-iap --quiet --strict-host-key-checking=no)
TRIES=0
until "${SSH[@]}" --command=true </dev/null >/dev/null 2>&1; do
  TRIES=$((TRIES + 1))
  if [ $TRIES -ge 20 ]; then
    echo "   SSH still fails after 5 minutes. Run this and send the output:"
    echo "   gcloud compute ssh $VM --zone=$ZONE --tunnel-through-iap --troubleshoot"
    exit 1
  fi
  echo "   not ready yet, retrying in 15 s ($TRIES/20)..."
  sleep 15
done
echo "   connected"

step "VM bootstrap (Docker, edge Caddy, metadata block, swap, Ops Agent, $APP folder)"
# </dev/null: on Windows, gcloud uses PuTTY, which would otherwise wait on a host-key prompt
gcloud compute scp "$BOOTSTRAP" $VM:vm-bootstrap.sh --zone=$ZONE --tunnel-through-iap --quiet \
  --strict-host-key-checking=no </dev/null
"${SSH[@]}" --command="bash vm-bootstrap.sh $APP" </dev/null

step "DNS"
# dig in Cloud Shell; nslookup in Git Bash on Windows (its last "Address" line is the answer)
RESOLVED=$( (dig +short $DOMAIN 2>/dev/null || nslookup $DOMAIN 2>/dev/null | awk '/^Address/ {a = $2} END {print a}') \
  | tail -n 1 || true)
if [ "$RESOLVED" = "$IP" ]; then
  echo "   $DOMAIN -> $IP (ok)"
else
  echo "   TO DO: at your DNS host add an A record: $DOMAIN -> $IP, TTL 300."
  echo "   On Cloudflare set it to 'DNS only' (grey cloud). It resolves to '${RESOLVED:-nothing}' right now."
fi

step "Summary"
gcloud compute instances list --filter="name=$VM" --format='table(name,status,networkInterfaces[0].accessConfigs[0].natIP:label=IP)'
echo "Secrets:"
gcloud secrets list --filter="labels.app=$APP" --format='value(name)' | sed 's/^/   /'
echo
echo "Setup done. Still by hand: the DNS record (if marked TO DO above) and a budget alert"
echo "(console: Billing -> Budgets & alerts -> Create budget, alerts at 50/90/100 %)."
