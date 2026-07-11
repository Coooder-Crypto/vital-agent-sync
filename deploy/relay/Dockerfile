FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN apt-get -o Acquire::Retries=3 update \
  && apt-get -o Acquire::Retries=3 install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY packages/local/package*.json packages/local/
RUN npm ci --workspace healthlink-local --include-workspace-root

COPY tsconfig.base.json ./
COPY packages/local packages/local
RUN npm run build --workspace healthlink-local \
  && npm prune --omit=dev --workspace healthlink-local --include-workspace-root \
  && npm cache clean --force

FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV HEALTHLINK_RELAY_HOST=0.0.0.0
ENV HEALTHLINK_RELAY_PORT=8790
ENV HEALTHLINK_RELAY_DB=/data/relay.sqlite
ENV HEALTHLINK_RELAY_RETENTION_DAYS=30
ENV HEALTHLINK_RELAY_MAX_ENVELOPE_BYTES=524288
ENV HEALTHLINK_RELAY_MAX_UPLOADS_PER_MINUTE=120
ENV HEALTHLINK_RELAY_MAX_QUEUED_ENVELOPES_PER_USER=1000
ENV HEALTHLINK_RELAY_MAX_DEVICES_PER_USER=5
ENV HEALTHLINK_RELAY_TRUST_PROXY=false

COPY package*.json ./
COPY packages/local/package*.json packages/local/
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/local/dist packages/local/dist

RUN mkdir -p /data \
  && chown node:node /data

USER node

EXPOSE 8790

CMD ["node", "packages/local/dist/cli.js", "relay", "serve"]
