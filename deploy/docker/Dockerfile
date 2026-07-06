FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY packages/local/package*.json packages/local/
RUN npm ci --workspace healthlink-local --include-workspace-root

COPY packages/local packages/local
RUN npm run build --workspace healthlink-local

FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV HEALTHLINK_HOST=0.0.0.0
ENV HEALTHLINK_PORT=8787
ENV HEALTHLINK_DB=/data/healthlink.sqlite
ENV HEALTHLINK_TRANSPORT=lan

COPY package*.json ./
COPY packages/local/package*.json packages/local/
RUN npm ci --omit=dev --workspace healthlink-local --include-workspace-root \
  && npm cache clean --force

COPY --from=build /app/packages/local/dist packages/local/dist

EXPOSE 8787

CMD ["sh", "-c", "node packages/local/dist/cli.js daemon --host ${HEALTHLINK_HOST:-0.0.0.0} --port ${HEALTHLINK_PORT:-8787} --db ${HEALTHLINK_DB:-/data/healthlink.sqlite} --transport ${HEALTHLINK_TRANSPORT:-lan} --server-url ${HEALTHLINK_SERVER_URL:?Set HEALTHLINK_SERVER_URL to an iPhone-reachable URL, for example http://192.168.31.53:8787}"]
