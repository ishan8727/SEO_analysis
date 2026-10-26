#!/bin/bash
set -euo pipefail

if [ "${#MOLI_TOKEN}" -lt 16 ]; then
  echo "MOLI_TOKEN must be at least 16 characters" >&2
  exit 1
fi
# Basic auth for WebDriver clients: http://moli:<token>@host/
export MOLI_BASIC
MOLI_BASIC=$(printf 'moli:%s' "$MOLI_TOKEN" | base64 -w0)

# Moli has no auth of its own, so it only listens on loopback; Caddy checks the token.
# --block-private-networks: pages can't reach private IPs or the cloud metadata server.
# shellcheck disable=SC2086
moli serve --host 127.0.0.1 --port 9223 --block-private-networks $MOLI_ARGS &
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
wait -n
exit 1
