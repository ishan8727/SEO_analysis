#!/bin/bash
# Build and deploy seo-audit to the shared VM tsi-apps-1 (runbook.md section 2). Run from Git Bash or
# Cloud Shell with gcloud signed in as a project Owner.
#   bash scripts/deploy.sh          build the current commit in Cloud Build, then deploy it
#   bash scripts/deploy.sh <tag>    deploy an image that's already built (rollback); tags are commit SHAs
# Needs .env.deploy (gitignored) with the public build values; see runbook.md section 2.
set -eo pipefail

PROJECT=tsi-project-cd47e
REGION=asia-south1
ZONE=asia-south1-a
VM=tsi-apps-1
APP=seo-audit
REGISTRY=$REGION-docker.pkg.dev/$PROJECT/$APP
BUILD_SA=projects/$PROJECT/serviceAccounts/$APP-build@$PROJECT.iam.gserviceaccount.com
BUILD_KEYS="NEXT_PUBLIC_GOOGLE_BROWSER_KEY NEXT_PUBLIC_TURNSTILE_SITE_KEY NEXT_PUBLIC_FIREBASE_API_KEY
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN NEXT_PUBLIC_FIREBASE_PROJECT_ID NEXT_PUBLIC_PHONE_COUNTRIES ONLINE_MODE"
step() { echo; echo "== $*"; }

cd "$(dirname "$0")/.."
TAG=$1

if [ -z "$TAG" ]; then
  if [ -n "$(git status --porcelain)" ]; then
    echo "Commit (or stash) your changes first: the image is tagged with the commit it was built from."
    exit 1
  fi
  TAG=$(git rev-parse --short=12 HEAD)
  [ -f .env.deploy ] || { echo "Missing .env.deploy (public build values; see runbook.md section 2)."; exit 1; }

  # gcloud's ^@^ prefix makes @ the separator, because NEXT_PUBLIC_PHONE_COUNTRIES contains commas.
  SUBS="_TAG=$TAG@_REGISTRY=$REGISTRY"
  for KEY in $BUILD_KEYS; do
    VAL=$( (grep -E "^$KEY=" .env.deploy || true) | tail -n 1 | cut -d= -f2- | tr -d '\r')
    VAL=${VAL#\"}; VAL=${VAL%\"}
    if [ -z "$VAL" ]; then echo "$KEY is missing or empty in .env.deploy"; exit 1; fi
    case "$VAL" in *@*) echo "$KEY contains @, which the substitution list can't carry"; exit 1 ;; esac
    SUBS="$SUBS@_$KEY=$VAL"
  done
  case "$SUBS" in
    *_NEXT_PUBLIC_TURNSTILE_SITE_KEY=[123]x0000*)
      echo "NEXT_PUBLIC_TURNSTILE_SITE_KEY in .env.deploy is a Cloudflare test key; production needs the real one."
      exit 1 ;;
  esac

  step "Building $TAG in Cloud Build (about 10 minutes)"
  gcloud builds submit --project=$PROJECT --region=$REGION --config=cloudbuild.yaml \
    --service-account="$BUILD_SA" --gcs-source-staging-dir="gs://$PROJECT-$APP-build/source" \
    "--substitutions=^@^$SUBS" .
else
  step "Using the existing image $TAG"
  gcloud artifacts docker images describe "$REGISTRY/app:$TAG" --project=$PROJECT >/dev/null
  gcloud artifacts docker images describe "$REGISTRY/moli:$TAG" --project=$PROJECT >/dev/null
  echo "   found app:$TAG and moli:$TAG"
fi

# </dev/null: on Windows gcloud uses PuTTY, which would otherwise wait on a host-key prompt.
SSH=(gcloud compute ssh $VM --project=$PROJECT --zone=$ZONE --tunnel-through-iap --quiet --strict-host-key-checking=no)

step "Copying deploy files to $VM"
"${SSH[@]}" --command="rm -rf $APP-deploy && mkdir -p $APP-deploy" </dev/null
gcloud compute scp docker-compose.yml docker-compose.prod.yml deploy/seo-audit.caddy deploy/seo-audit.env \
  deploy/vm-deploy.sh deploy/backup.sh "$VM:$APP-deploy/" \
  --project=$PROJECT --zone=$ZONE --tunnel-through-iap --quiet --strict-host-key-checking=no </dev/null

step "Deploying $TAG on $VM"
"${SSH[@]}" --command="sudo bash $APP-deploy/vm-deploy.sh $TAG" </dev/null

echo
echo "Live: https://audit.thesalesinc.com (roll back with: bash scripts/deploy.sh <previous tag>)"
