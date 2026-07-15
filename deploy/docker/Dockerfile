FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY packages/local/package*.json packages/local/
RUN npm ci --workspace vitalmcp --include-workspace-root

COPY packages/local packages/local
RUN npm run build --workspace vitalmcp

FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV VITALMCP_HOST=0.0.0.0
ENV VITALMCP_PORT=8787
ENV VITALMCP_DB=/data/vital-agent.sqlite
ENV VITALMCP_TRANSPORT=lan

COPY package*.json ./
COPY packages/local/package*.json packages/local/
RUN npm ci --omit=dev --workspace vitalmcp --include-workspace-root \
  && npm cache clean --force

COPY --from=build /app/packages/local/dist packages/local/dist

EXPOSE 8787

CMD ["sh", "-c", "node packages/local/dist/cli.js daemon --host ${VITALMCP_HOST:-0.0.0.0} --port ${VITALMCP_PORT:-8787} --db ${VITALMCP_DB:-/data/vital-agent.sqlite} --transport ${VITALMCP_TRANSPORT:-lan} --server-url ${VITALMCP_SERVER_URL:?Set VITALMCP_SERVER_URL to an iPhone-reachable URL, for example http://192.168.31.53:8787}"]
