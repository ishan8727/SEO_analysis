# Runbook — production on Google Cloud

Production is one Compute Engine VM in `asia-south1` running the compose stack behind Caddy, in GCP project
`tsi-project-cd47e` (decided 2026-10-24; see `phases/phase-6.md`). Local development is in `setup.md`.

Sections 2–6 (deploy, rollback, key rotation, restore, ops) arrive with the Phase 6 code.

## 1. One-time GCP setup

Run everything in **Cloud Shell** (console.cloud.google.com → project `tsi-project-cd47e` → `>_` at the top right). It has
`gcloud` and bash built in. Sign in as an Owner of the project.

This creates the VM, network, registry, secrets and backups. The app itself goes live with the Phase 6 deploy
(`docker-compose.prod.yml`, `Caddyfile`, `cloudbuild.yaml`, deploy script).

### 1.1 Project and variables

Paste again whenever Cloud Shell restarts.

```bash
gcloud config set project tsi-project-cd47e
PROJECT=tsi-project-cd47e
REGION=asia-south1
ZONE=asia-south1-a
VM=seo-audit
SA=seo-audit-vm@$PROJECT.iam.gserviceaccount.com
BUCKET=gs://$PROJECT-seo-audit-backups
```

### 1.2 APIs

```bash
gcloud services enable compute.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com \
  secretmanager.googleapis.com logging.googleapis.com monitoring.googleapis.com iap.googleapis.com \
  storage.googleapis.com apikeys.googleapis.com places.googleapis.com pagespeedonline.googleapis.com
```

`places.googleapis.com` is **Places API (New)**, the one the app calls. Without it, Places answers `403 PERMISSION_DENIED`.

### 1.3 Image registry

```bash
gcloud artifacts repositories create seo-audit --repository-format=docker --location=$REGION \
  --description="SEO audit app + moli images"
```

### 1.4 VM service account (least privilege)

```bash
gcloud iam service-accounts create seo-audit-vm --display-name="SEO audit VM"
for ROLE in roles/artifactregistry.reader roles/logging.logWriter roles/monitoring.metricWriter; do
  gcloud projects add-iam-policy-binding $PROJECT --member="serviceAccount:$SA" --role=$ROLE --condition=None --quiet >/dev/null
done
```

Secret and bucket access are granted per item (1.9, 1.10), not project-wide.

### 1.5 Static IP

```bash
gcloud compute addresses create seo-audit-ip --region=$REGION
IP=$(gcloud compute addresses describe seo-audit-ip --region=$REGION --format='value(address)'); echo $IP
```

Note the IP: DNS (1.12) points at it.

### 1.6 Firewall: web open, SSH only through IAP

```bash
gcloud compute firewall-rules create seo-audit-allow-web --network=default --direction=INGRESS \
  --action=ALLOW --rules=tcp:80,tcp:443 --source-ranges=0.0.0.0/0 --target-tags=seo-audit
gcloud compute firewall-rules create seo-audit-allow-iap-ssh --network=default --direction=INGRESS \
  --action=ALLOW --rules=tcp:22 --source-ranges=35.235.240.0/20 --target-tags=seo-audit
# Google's default rules open SSH/RDP to the whole internet. Remove them (ignore "not found"):
gcloud compute firewall-rules delete default-allow-ssh default-allow-rdp --quiet
```

If network `default` doesn't exist: `gcloud compute networks create default --subnet-mode=auto`, then repeat.

### 1.7 VM

```bash
gcloud compute instances create $VM --zone=$ZONE --machine-type=e2-medium \
  --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=30GB --boot-disk-type=pd-balanced \
  --address=seo-audit-ip --tags=seo-audit \
  --service-account=$SA --scopes=cloud-platform \
  --shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring \
  --metadata=enable-oslogin=TRUE
```

### 1.8 Daily disk snapshots, kept 7 days

21:00 UTC = 02:30 IST.

```bash
gcloud compute resource-policies create snapshot-schedule seo-audit-daily --region=$REGION \
  --daily-schedule --start-time=21:00 --max-retention-days=7 --on-source-disk-delete=keep-auto-snapshots
gcloud compute disks add-resource-policies $VM --zone=$ZONE --resource-policies=seo-audit-daily
```

### 1.9 Backup bucket (objects deleted after 30 days)

```bash
gcloud storage buckets create $BUCKET --location=$REGION --uniform-bucket-level-access --public-access-prevention
echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":30}}]}' > lifecycle.json
gcloud storage buckets update $BUCKET --lifecycle-file=lifecycle.json
gcloud storage buckets add-iam-policy-binding $BUCKET --member="serviceAccount:$SA" --role=roles/storage.objectCreator
```

### 1.10 Secrets in Secret Manager

Helpers: `add_secret` prompts for a value (hidden, kept out of shell history); `gen_secret` stores a fresh random one.

```bash
add_secret() { read -rsp "Paste value for $1: " V; echo
  printf '%s' "$V" | gcloud secrets create "$1" --replication-policy=user-managed --locations=$REGION --data-file=-
  gcloud secrets add-iam-policy-binding "$1" --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor --quiet >/dev/null; unset V; }
gen_secret() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 48 | \
  gcloud secrets create "$1" --replication-policy=user-managed --locations=$REGION --data-file=-
  gcloud secrets add-iam-policy-binding "$1" --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor --quiet >/dev/null; }
```

Production gets its own random values, never the local ones:

```bash
gen_secret HASH_SALT; gen_secret COOKIE_SECRET; gen_secret INTERNAL_TOKEN; gen_secret MOLI_TOKEN; gen_secret POSTGRES_PASSWORD
```

Real values (`TURNSTILE_SECRET` is in `.env.railway`, to be renamed `.env.production`; `GEMINI_API_KEY` is the current key):

```bash
add_secret TURNSTILE_SECRET
add_secret GEMINI_API_KEY
```

### 1.11 Production server key, locked to the VM's IP

A separate key, so the local dev key keeps working. `PSI_API_KEY` reuses it.

```bash
gcloud services api-keys create --display-name="seo-audit-server-prod" \
  --api-target=service=places.googleapis.com --api-target=service=pagespeedonline.googleapis.com \
  --allowed-ips=$IP
KEY_NAME=$(gcloud services api-keys list --filter='displayName=seo-audit-server-prod' --format='value(name)')
gcloud services api-keys get-key-string $KEY_NAME --format='value(keyString)' | \
  gcloud secrets create GOOGLE_SERVER_KEY --replication-policy=user-managed --locations=$REGION --data-file=-
gcloud secrets add-iam-policy-binding GOOGLE_SERVER_KEY --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor --quiet >/dev/null
```

### 1.12 DNS

At the DNS host for thesalesinc.com: **A record** `audit` → the IP from 1.5, TTL 300. **On Cloudflare, set it to "DNS only"
(grey cloud)**: proxied mode changes the client IP the app sees (phase-6.md task 8). Check:

```bash
dig +short audit.thesalesinc.com    # prints the IP
```

### 1.13 VM bootstrap

```bash
gcloud compute ssh $VM --zone=$ZONE --tunnel-through-iap
```

Then on the VM:

```bash
# Docker Engine + compose plugin
sudo apt-get update && sudo apt-get install -y ca-certificates curl unattended-upgrades
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER

# 2 GB swap
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Ops Agent (memory/disk metrics + system logs)
curl -sSO https://dl.google.com/cloudagents/add-google-cloud-ops-agent-repo.sh && sudo bash add-google-cloud-ops-agent-repo.sh --also-install

# Docker pulls from Artifact Registry; app folder
gcloud auth configure-docker asia-south1-docker.pkg.dev --quiet
sudo mkdir -p /opt/seo-audit && sudo chown $USER: /opt/seo-audit
exit
```

Reconnect (the docker group needs a fresh login) and check:

```bash
gcloud compute ssh $VM --zone=$ZONE --tunnel-through-iap --command='docker run --rm hello-world && docker compose version && free -h'
```

### 1.14 Budget alert

Console → **Billing → Budgets & alerts → Create budget**: scope project `tsi-project-cd47e`, a monthly amount (e.g. ₹5,000),
alerts at 50 %, 90 % and 100 %.

### 1.15 Done when

- `gcloud compute instances list` shows `seo-audit` RUNNING with the static IP.
- `dig +short audit.thesalesinc.com` returns that IP.
- `gcloud secrets list` shows 8 secrets: HASH_SALT, COOKIE_SECRET, INTERNAL_TOKEN, MOLI_TOKEN, POSTGRES_PASSWORD,
  TURNSTILE_SECRET, GEMINI_API_KEY, GOOGLE_SERVER_KEY.
- `curl http://<IP>` from outside is refused (nothing listens until the Phase 6 deploy starts Caddy).

## 2. Deploy, roll back (Phase 6)

## 3. Rotate keys (Phase 6)

## 4. Back up and restore (Phase 6)

## 5. Purge data, replay a failed scan (Phase 6)

## 6. Logs, metrics, resizing the VM (Phase 6)
