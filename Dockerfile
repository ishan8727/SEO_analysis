# One image for both processes: web (`next start`) and worker (`node dist-worker/index.mjs`).
# Not using Next's standalone output: the worker needs the full production node_modules
# (bullmq, playwright-core, prisma CLI for migrations), so web uses it too.

FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl && corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM base AS deps
RUN pnpm install --frozen-lockfile

FROM base AS prod-deps
RUN pnpm install --prod --frozen-lockfile

FROM base AS build
# Inlined into the static landing page / client bundle at build time.
# Railway passes service variables with these names as build args.
ARG NEXT_PUBLIC_GOOGLE_BROWSER_KEY=""
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=""
ARG DEFAULT_COUNTRY=IN
ARG ONLINE_MODE=on
ENV NEXT_PUBLIC_GOOGLE_BROWSER_KEY=$NEXT_PUBLIC_GOOGLE_BROWSER_KEY
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY
ENV DEFAULT_COUNTRY=$DEFAULT_COUNTRY
ENV ONLINE_MODE=$ONLINE_MODE
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate && pnpm build && pnpm build:worker

FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl && addgroup -S app && adduser -S app -G app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/next.config.ts /app/prisma.config.ts ./
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/config ./config
COPY --from=build /app/dist-worker ./dist-worker
USER app
EXPOSE 3000
CMD ["node_modules/.bin/next", "start"]
