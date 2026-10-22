# Moli headless browser (https://github.com/lexmount/moli) behind a Caddy token gate.
# There is no official Moli image: this downloads the release binary, modelled on
# the Railway template (https://github.com/two-workspaces/moli).
FROM caddy:2.10.2 AS caddy

FROM debian:trixie-slim
ARG MOLI_VERSION=v1.1.19
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl libfontconfig1 fonts-dejavu-core fonts-liberation \
 && curl -fsSL "https://github.com/lexmount/moli/releases/download/${MOLI_VERSION}/moli-x86_64-unknown-linux-gnu.tar.gz" | tar xz -C /tmp \
 && mv /tmp/moli-*/moli /usr/local/bin/moli && rm -rf /tmp/moli-* \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY --from=caddy /usr/bin/caddy /usr/local/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
COPY start.sh /usr/local/bin/moli-start
RUN chmod +x /usr/local/bin/moli-start && useradd --create-home --shell /usr/sbin/nologin moli
USER moli
# Caddy (token gate) listens here; Moli itself only on 127.0.0.1:9223.
ENV PORT=9222 MOLI_ARGS=--layout
EXPOSE 9222
CMD ["/usr/local/bin/moli-start"]
