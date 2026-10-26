# Runbook — production on Google Cloud

Production is one shared Compute Engine VM (`tsi-apps-1`, `asia-south1`) in GCP project `tsi-project-cd47e`. It is built to
host several apps (decided 2026-10-26; see `phases/phase-6.md`). Local development is in `setup.md`.

How the VM is laid out:

- **Edge** (`/opt/edge`): one shared Caddy container, the only thing that publishes ports (80/443). It gets HTTPS certs and
  routes each domain to its app. Each app has a site file in `/opt/edge/sites/<app>.caddy`.
- **Apps** (`/opt/apps/<app>`): each app is its own compose project with its own Postgres, Redis, `.env` and memory limits.
  Its web container joins one private network shared only with Caddy (`edge-<app>`, alias `<app>-web`). Databases and
  internal services never join it, so apps can't reach each other.
- **Containers can't reach the metadata server** (`169.254.169.254`), so a compromised app can't borrow the VM's Google
  credentials. Only the host (Docker logging, the deploy script, backup cron) talks to Google.
- **Per-app Google resources**, all named after the app and labelled `app=<app>`: registry repo, backup bucket, secrets
  (`<app>-NAME`), server API key. The VM's service account gets access to each item one at a time, never project-wide.

Limit: apps on one VM share its kernel and its service account. Root on the VM sees every app. That's fine for our own
apps. Put an untrusted or client-owned app on its own VM (repeat Part A with new names).

Sections 2–6 (deploy, rollback, key rotation, restore, ops) arrive with the Phase 6 code.

## 1. One-time GCP setup

Run everything in **Cloud Shell** (console.cloud.google.com → project `tsi-project-cd47e` → `>_` at the top right). It has
`gcloud` and bash built in. Sign in as an Owner of the project. **Part A** is once per VM. **Part B** is once per app; do it
now for `seo-audit` and repeat it for each new app.

### Part A — shared host (once)

#### A1. Variables

Paste again whenever Cloud Shell restarts.

```bash
gcloud config set project tsi-project-cd47e
PROJECT=tsi-project-cd47e
REGION=asia-south1
ZONE=asia-south1-a
VM=tsi-apps-1
TAG=tsi-apps
SA=tsi-apps-vm@$PROJECT.iam.gserviceaccount.com
```

#### A2. APIs

```bash
gcloud services enable compute.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com \
  secretmanager.googleapis.com logging.googleapis.com monitoring.googleapis.com iap.googleapis.com \
  storage.googleapis.com apikeys.googleapis.com
```

#### A3. VM service account

It gets only log and metric writing project-wide. Registry, secret and bucket access is granted per app in Part B.

```bash
gcloud iam service-accounts create tsi-apps-vm --display-name="Shared apps VM"
for ROLE in roles/logging.logWriter roles/monitoring.metricWriter; do
  gcloud projects add-iam-policy-binding $PROJECT --member="serviceAccount:$SA" --role=$ROLE --condition=None --quiet >/dev/null
done
```

#### A4. Static IP

```bash
gcloud compute addresses create tsi-apps-ip --region=$REGION
IP=$(gcloud compute addresses describe tsi-apps-ip --region=$REGION --format='value(address)'); echo $IP
```

Write the IP down. Every app's DNS record points at it.

#### A5. Firewall: web open, SSH only through IAP

```bash
gcloud compute firewall-rules create tsi-apps-allow-web --network=default --direction=INGRESS \
  --action=ALLOW --rules=tcp:80,tcp:443,udp:443 --source-ranges=0.0.0.0/0 --target-tags=$TAG
gcloud compute firewall-rules create tsi-apps-allow-iap-ssh --network=default --direction=INGRESS \
  --action=ALLOW --rules=tcp:22 --source-ranges=35.235.240.0/20 --target-tags=$TAG
# Google's default rules open SSH/RDP to the whole internet. Remove them (ignore "not found"):
gcloud compute firewall-rules delete default-allow-ssh default-allow-rdp --quiet
```

If network `default` doesn't exist: `gcloud compute networks create default --subnet-mode=auto`, then repeat. Any port an
app publishes by mistake stays closed, because the VPC firewall only lets 80/443 in.

#### A6. VM

`e2-medium` (2 shared vCPU, 4 GB) fits one app. Resize when you add the second (A10). The 50 GB disk holds several apps'
images and databases.

```bash
gcloud compute instances create $VM --zone=$ZONE --machine-type=e2-medium \
  --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=50GB --boot-disk-type=pd-balanced \
  --address=tsi-apps-ip --tags=$TAG \
  --service-account=$SA --scopes=cloud-platform \
  --shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring \
  --metadata=enable-oslogin=TRUE
```

#### A7. Daily disk snapshots, kept 7 days

21:00 UTC = 02:30 IST.

```bash
gcloud compute resource-policies create snapshot-schedule tsi-apps-daily --region=$REGION \
  --daily-schedule --start-time=21:00 --max-retention-days=7 --on-source-disk-delete=keep-auto-snapshots
gcloud compute disks add-resource-policies $VM --zone=$ZONE --resource-policies=tsi-apps-daily
```

#### A8. VM bootstrap

Wait about a minute after A6 so the VM has booted, then connect:

```bash
gcloud compute ssh $VM --zone=$ZONE --tunnel-through-iap
```

**Check the prompt before pasting anything: it must end in `@tsi-apps-1:~$`.** If it still says `cloudshell`, the connection
failed. `failed to connect to backend` usually means the VM is still booting: wait and retry, or add `--troubleshoot`.
These blocks run in Cloud Shell by mistake fail harmlessly (Cloud Shell → ⋮ → Restart undoes them).

Then on the VM, paste each block in order.

Docker Engine + compose plugin; logs from every container go to Cloud Logging:

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl unattended-upgrades
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo mkdir -p /etc/docker
echo '{ "log-driver": "gcplogs", "live-restore": true }' | sudo tee /etc/docker/daemon.json
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
```

Block containers from the metadata server (the host keeps access; the rule comes back after every reboot and Docker restart):

```bash
sudo tee /etc/systemd/system/block-container-metadata.service >/dev/null <<'EOF'
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
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now block-container-metadata
```

2 GB swap, Ops Agent (memory/disk metrics), registry login, folders:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
curl -sSO https://dl.google.com/cloudagents/add-google-cloud-ops-agent-repo.sh && sudo bash add-google-cloud-ops-agent-repo.sh --also-install
gcloud auth configure-docker asia-south1-docker.pkg.dev --quiet
sudo mkdir -p /opt/apps /opt/edge/sites /opt/edge/apps && sudo chown -R $USER: /opt/apps /opt/edge
```

The shared Caddy (edge). `apps/<app>.yml` attaches Caddy to each app's network, and `up.sh` starts it with all of them:

```bash
cat > /opt/edge/docker-compose.yml <<'EOF'
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
EOF
cat > /opt/edge/Caddyfile <<'EOF'
{
	email grow@thesalesinc.com
}
import sites/*.caddy
EOF
cat > /opt/edge/up.sh <<'EOF'
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
EOF
chmod +x /opt/edge/up.sh
exit
```

Reconnect (the docker group needs a fresh login), start the edge and check everything:

```bash
gcloud compute ssh $VM --zone=$ZONE --tunnel-through-iap --command='
/opt/edge/up.sh &&
docker run --rm hello-world | head -2 &&
docker compose version && free -h &&
docker info --format "log driver: {{.LoggingDriver}}" &&
(docker run --rm curlimages/curl -s -m 5 http://169.254.169.254/ >/dev/null && echo "METADATA REACHABLE - FIX" || echo "metadata blocked for containers: ok") &&
curl -s -m 5 -H "Metadata-Flavor: Google" http://169.254.169.254/computeMetadata/v1/instance/name; echo " <- host still reaches metadata"'
```

Expected: "Hello from Docker!", a compose version, about 2 GB swap, `log driver: gcplogs`, "metadata blocked for containers:
ok", and `tsi-apps-1 <- host still reaches metadata`.

#### A9. Budget alert

Console → **Billing → Budgets & alerts → Create budget**: scope project `tsi-project-cd47e`, a monthly amount (e.g. ₹5,000),
alerts at 50 %, 90 % and 100 %.

#### A10. Later: resize when adding an app

Each app's memory limits are in its `docker-compose.prod.yml` (`seo-audit` ≈ 2.4 GB). Keep the total under about 75 % of RAM.
`e2-standard-2` (8 GB) fits two to three apps like this one. A resize means about 2 minutes of downtime for every app; the IP stays.

```bash
gcloud compute instances stop $VM --zone=$ZONE
gcloud compute instances set-machine-type $VM --zone=$ZONE --machine-type=e2-standard-2
gcloud compute instances start $VM --zone=$ZONE
```

### Part B — per app (now: `seo-audit`)

#### B1. Variables

Paste after A1 whenever Cloud Shell restarts. For another app, change `APP` (lowercase letters, digits, `-`) and `DOMAIN`.

```bash
APP=seo-audit
DOMAIN=audit.thesalesinc.com
BUCKET=gs://$PROJECT-$APP-backups
IP=$(gcloud compute addresses describe tsi-apps-ip --region=$REGION --format='value(address)'); echo $IP
```

#### B2. APIs this app calls

```bash
gcloud services enable places.googleapis.com pagespeedonline.googleapis.com
```

`places.googleapis.com` is **Places API (New)**, the one the app calls. Without it, Places answers `403 PERMISSION_DENIED`.

#### B3. Image registry (VM can pull this repo only)

```bash
gcloud artifacts repositories create $APP --repository-format=docker --location=$REGION \
  --description="$APP images" --labels=app=$APP
gcloud artifacts repositories add-iam-policy-binding $APP --location=$REGION \
  --member="serviceAccount:$SA" --role=roles/artifactregistry.reader --quiet >/dev/null
```

#### B4. Backup bucket (objects deleted after 30 days)

The VM can only add backups, not read or delete them, so a compromised VM can't wipe them.

```bash
gcloud storage buckets create $BUCKET --location=$REGION --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update $BUCKET --update-labels=app=$APP
echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":30}}]}' > lifecycle.json
gcloud storage buckets update $BUCKET --lifecycle-file=lifecycle.json
gcloud storage buckets add-iam-policy-binding $BUCKET --member="serviceAccount:$SA" --role=roles/storage.objectCreator
```

#### B5. Secrets (named `<app>-NAME`)

Helpers: `add_secret` prompts for a value (hidden, kept out of shell history); `gen_secret` stores a fresh random one. The
deploy script strips the `$APP-` prefix when it writes the app's `.env`.

```bash
add_secret() { read -rsp "Paste value for $APP-$1: " V; echo
  printf '%s' "$V" | gcloud secrets create "$APP-$1" --replication-policy=user-managed --locations=$REGION --labels=app=$APP --data-file=-
  gcloud secrets add-iam-policy-binding "$APP-$1" --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor --quiet >/dev/null; unset V; }
gen_secret() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 48 | \
  gcloud secrets create "$APP-$1" --replication-policy=user-managed --locations=$REGION --labels=app=$APP --data-file=-
  gcloud secrets add-iam-policy-binding "$APP-$1" --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor --quiet >/dev/null; }
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

#### B6. Production server key, locked to the VM's IP

A separate key, so the local dev key keeps working. `PSI_API_KEY` reuses it.

```bash
gcloud services api-keys create --display-name="$APP-server-prod" \
  --api-target=service=places.googleapis.com --api-target=service=pagespeedonline.googleapis.com \
  --allowed-ips=$IP
KEY_NAME=$(gcloud services api-keys list --filter="displayName=$APP-server-prod" --format='value(name)')
gcloud services api-keys get-key-string $KEY_NAME --format='value(keyString)' | \
  gcloud secrets create $APP-GOOGLE_SERVER_KEY --replication-policy=user-managed --locations=$REGION --labels=app=$APP --data-file=-
gcloud secrets add-iam-policy-binding $APP-GOOGLE_SERVER_KEY --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor --quiet >/dev/null
```

#### B7. DNS

At the DNS host for the domain: **A record** for `$DOMAIN` (for seo-audit: name `audit` on thesalesinc.com) → the IP from A4,
TTL 300. **On Cloudflare, set it to "DNS only" (grey cloud)**: proxied mode changes the client IP the app sees (phase-6.md
task 8). Check:

```bash
dig +short $DOMAIN    # prints the IP
```

#### B8. App folder and private edge network on the VM

```bash
gcloud compute ssh $VM --zone=$ZONE --tunnel-through-iap --command="
mkdir -p /opt/apps/$APP && chmod 700 /opt/apps/$APP &&
docker network create edge-$APP &&
printf 'services:\n  caddy:\n    networks: [default, edge-$APP]\nnetworks:\n  edge-$APP:\n    external: true\n' > /opt/edge/apps/$APP.yml &&
/opt/edge/up.sh && docker network inspect edge-$APP --format '{{range .Containers}}{{.Name}} {{end}}'"
```

Expected: the last line prints `edge-caddy-1`. The app's Caddy site file (`/opt/edge/sites/$APP.caddy`, proxying to
`$APP-web:3000`) and its `.env` arrive with the app's first deploy (Phase 6).

#### B9. Done when

- `gcloud compute instances list` shows `tsi-apps-1` RUNNING with the static IP.
- `dig +short audit.thesalesinc.com` returns that IP.
- `gcloud secrets list --filter=labels.app=seo-audit` shows 8 secrets: `seo-audit-` + HASH_SALT, COOKIE_SECRET,
  INTERNAL_TOKEN, MOLI_TOKEN, POSTGRES_PASSWORD, TURNSTILE_SECRET, GEMINI_API_KEY, GOOGLE_SERVER_KEY.
- `curl -I http://<IP>` from outside is refused (Caddy has no sites until the Phase 6 deploy). Port 22 from outside times out.

### Adding another app later

1. Check memory (A10) and resize if the new app's limits don't fit.
2. Paste A1, then B1 with the new `APP` and `DOMAIN`, and run B2–B8, skipping what the app doesn't use (B2 and B6 are
   seo-audit's Google APIs; B5's secret names are the new app's own).
3. Its prod compose: no published ports, memory limits on every service, web on the external network `edge-<app>` with
   alias `<app>-web`, nothing else on that network.

## 2. Deploy, roll back (Phase 6)

## 3. Rotate keys (Phase 6)

## 4. Back up and restore (Phase 6)

## 5. Purge data, replay a failed scan (Phase 6)

## 6. Logs, metrics, resizing the VM (Phase 6)
