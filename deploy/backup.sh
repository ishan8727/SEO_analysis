#!/bin/bash
# Nightly pg_dump of seo-audit to Cloud Storage, run by the systemd timer seo-audit-backup (vm-deploy.sh installs it).
# The VM may only add objects to the bucket, which deletes them after 30 days. Restore: runbook.md section 4.
# Run by hand: sudo systemctl start seo-audit-backup; journalctl -u seo-audit-backup
set -eo pipefail

APP=seo-audit
DIR=/opt/apps/$APP
PROJECT=$(curl -fsS -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/project/project-id)
OBJECT=gs://$PROJECT-$APP-backups/postgres/$APP-$(date -u +%Y%m%d-%H%M%S).dump

docker compose -p "$APP" --project-directory "$DIR" -f "$DIR/docker-compose.yml" -f "$DIR/docker-compose.prod.yml" \
  exec -T postgres pg_dump -U app -d seoaudit --format=custom \
  | gcloud storage cp - "$OBJECT"
echo "backup written: $OBJECT"
