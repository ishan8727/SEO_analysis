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

**Automated:** `scripts/gcp/setup.sh` runs Parts A and B for `seo-audit` in one go and `scripts/gcp/vm-bootstrap.sh` does the
VM side (setup.sh copies it over). Put both in one folder in Cloud Shell and run `bash setup.sh`. It asks for
TURNSTILE_SECRET and GEMINI_API_KEY first, skips anything that already exists (safe to rerun after a failure), waits
for SSH, and ends with the DNS record to add. DNS and the budget alert stay manual. The steps below are the same thing
by hand.

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
echo '{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3", "labels": "com.docker.compose.project,com.docker.compose.service" }, "live-restore": true }' | sudo tee /etc/docker/daemon.json
# The Ops Agent pipeline that ships these logs with severity: see OPS_CONFIG in scripts/gcp/vm-bootstrap.sh.
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

Expected: "Hello from Docker!", a compose version, about 2 GB swap, `log driver: json-file`, "metadata blocked for containers:
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

Real values (`TURNSTILE_SECRET` is in `.env.railway`; `GEMINI_API_KEY` is the current key):

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

## 2. Deploy, roll back

Everything runs from **Git Bash in the project folder** (or Cloud Shell with the repo), signed in to gcloud as a
project Owner. On the VM, this shortcut saves typing (paste it after `gcloud compute ssh tsi-apps-1
--zone=asia-south1-a --tunnel-through-iap`):

```bash
dc() { sudo docker compose -p seo-audit --project-directory /opt/apps/seo-audit \
  -f /opt/apps/seo-audit/docker-compose.yml -f /opt/apps/seo-audit/docker-compose.prod.yml "$@"; }
```

### Once: `.env.deploy`

The public build values the client bundle needs, in `.env.deploy` at the repo root (gitignored; not `.env.production`,
which Next would load into every local build): `NEXT_PUBLIC_GOOGLE_BROWSER_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (the
real one, not a `1x0000…` test key), `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`,
`NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_PHONE_COUNTRIES`, `ONLINE_MODE`. The deploy script refuses to build if one is
missing.

### Deploy a change

1. Commit it (the image is tagged with the commit; the script refuses uncommitted changes). Push to GitHub if you want CI.
2. `bash scripts/deploy.sh`
   - Cloud Build builds `app` and `moli` (about 10 minutes) and pushes them to Artifact Registry as `<commit>` and `latest`.
   - The VM writes `/opt/apps/seo-audit/.env` from `deploy/seo-audit.env` + the `seo-audit-*` secrets, pulls, restarts
     (migrations run when web starts), reloads the edge Caddy, installs the backup timer and waits for `/api/health`.
3. Check: `curl https://audit.thesalesinc.com/api/health` → `{"db":"ok","redis":"ok","moli":"ok"}`.

Settings: non-secret ones live in `deploy/seo-audit.env` (commit + deploy), build values in `.env.deploy` (deploy rebuilds),
secrets in Secret Manager (section 3).

### Roll back

```bash
gcloud artifacts docker tags list asia-south1-docker.pkg.dev/tsi-project-cd47e/seo-audit/app --sort-by=~UPDATE_TIME --limit=10
bash scripts/deploy.sh <tag>      # no rebuild: deploys the images already built for that commit
```

Migrations only go forward. Rolling back across one leaves the newer schema in place; that's fine for additive
migrations, otherwise restore the backup from before the deploy (section 4).

### See what's running

```bash
gcloud compute ssh tsi-apps-1 --zone=asia-south1-a --tunnel-through-iap --command="sudo docker ps --format '{{.Names}}  {{.Status}}'; sudo grep IMAGE_TAG /opt/apps/seo-audit/.env"
```

## 3. Secrets and keys

Secrets live only in Secret Manager as `seo-audit-<NAME>`. To change one, add a version, then redeploy the current tag
(no rebuild):

```bash
read -rsp "New value: " V; echo; printf '%s' "$V" | gcloud secrets versions add seo-audit-<NAME> --data-file=-; unset V
bash scripts/deploy.sh <current tag>      # current tag: "See what's running" above
```

Side effects:
- `COOKIE_SECRET`: every unlocked visitor has to verify again.
- `HASH_SALT`: rate-limit windows start over.
- `POSTGRES_PASSWORD`: Postgres only reads it when the volume is created. Change it in the database first
  (`dc exec postgres psql -U app -d seoaudit -c "ALTER USER app PASSWORD '<new>'"`), then add the version and redeploy.
- `GOOGLE_SERVER_KEY`: create a new key locked to the VM's IP (`scripts/gcp/setup.sh` step "Production server key" does this
  for a missing key), store it, redeploy, then delete the old key in APIs & Services → Credentials.

**Make.com lead webhook** (secret created 2026-10-26; without it the feature is off and leads stay in Postgres). Sent only
after the phone is confirmed by OTP, once per lead; payload in `src/worker/jobs/lead-webhook.ts`. Send a sample marked
`"test": true`: `pnpm lead:test <webhook-url>`. To set or replace the URL:

```bash
read -rsp "Make.com webhook URL: " V; echo
printf '%s' "$V" | gcloud secrets create seo-audit-LEAD_WEBHOOK_URL --replication-policy=user-managed \
  --locations=asia-south1 --labels=app=seo-audit --data-file=-; unset V
gcloud secrets add-iam-policy-binding seo-audit-LEAD_WEBHOOK_URL --role=roles/secretmanager.secretAccessor \
  --member=serviceAccount:tsi-apps-vm@tsi-project-cd47e.iam.gserviceaccount.com
bash scripts/deploy.sh <current tag>
```

**CI secret-value check** (`.github/workflows/ci.yml`) reads the same values from GitHub Actions secrets. To copy them
without printing them (needs the GitHub CLI, `gh auth login`):

```bash
for N in GOOGLE_SERVER_KEY GEMINI_API_KEY TURNSTILE_SECRET COOKIE_SECRET HASH_SALT INTERNAL_TOKEN MOLI_TOKEN; do
  gcloud secrets versions access latest --secret=seo-audit-$N | gh secret set $N
done
```

## 4. Back up and restore

- **Nightly** at 02:00 IST: `pg_dump` (custom format) to `gs://tsi-project-cd47e-seo-audit-backups/postgres/`, kept 30 days.
  Run one now on the VM: `sudo systemctl start seo-audit-backup && journalctl -u seo-audit-backup -n 5`.
- **Disk snapshots**: daily at 02:30 IST, kept 7 days (Compute Engine → Snapshots).
- List backups (from your PC; the VM itself can't read the bucket):
  `gcloud storage ls -l gs://tsi-project-cd47e-seo-audit-backups/postgres/`

**Restore** (replaces the current data):

```bash
# On your PC: fetch the dump and copy it to the VM
gcloud storage cp gs://tsi-project-cd47e-seo-audit-backups/postgres/<file>.dump restore.dump
gcloud compute scp restore.dump tsi-apps-1:restore.dump --zone=asia-south1-a --tunnel-through-iap
# On the VM (with dc() from section 2)
dc stop web worker
dc exec -T postgres pg_restore -U app -d seoaudit --clean --if-exists --no-owner < restore.dump
dc start web worker && rm restore.dump
```

Into a fresh VM: run `scripts/gcp/setup.sh`, deploy once (creates an empty database), then restore as above.

## 5. Purge data, retry a failed scan

On the VM: `dc exec postgres psql -U app -d seoaudit`, then:

```sql
-- One business and everything about it (screenshots and PDFs go with their scans)
SELECT id, name, "websiteUrl" FROM "Business" WHERE name ILIKE '%<name>%';
BEGIN;
DELETE FROM "Lead" WHERE "scanId" IN (SELECT id FROM "Scan" WHERE "businessId" = '<id>');
DELETE FROM "Scan" WHERE "businessId" = '<id>';
DELETE FROM "Business" WHERE id = '<id>';
COMMIT;
-- One person's leads
DELETE FROM "Lead" WHERE "phoneE164" = '+<country code><number>';
```

A failed scan isn't reused: searching for the same business again starts a fresh scan. Google data in `placeSnapshot`
and screenshots are cleared by the nightly retention job (21:30 UTC) without help.

## 6. Logs, metrics, resizing

- **Logs Explorer** (console → Logging), app logs carry `severity`:
  `logName="projects/tsi-project-cd47e/logs/docker" jsonPayload.service="worker" severity>=WARNING`
  From your PC: `gcloud logging read 'logName="projects/tsi-project-cd47e/logs/docker" AND severity>=ERROR' --freshness=1d --limit=20`
- **Live on the VM**: `dc logs -f --tail=100 web worker`; memory per container: `sudo docker stats --no-stream`.
- **Metrics**: Compute Engine → `tsi-apps-1` → Observability (CPU, memory and disk come from the Ops Agent).
- **Uptime check** on `https://audit.thesalesinc.com/api/health` with an email alert: Monitoring → Uptime checks.
- **Resize**: section A10. Memory limits per service are in `docker-compose.prod.yml` (about 2.4 GB in total for seo-audit).
