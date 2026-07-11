export type DockerComposeOptions = {
  serverUrl: string;
  port?: number;
};

export type RelayDockerComposeOptions = {
  port?: number;
};

export function buildDockerComposeYaml(options: DockerComposeOptions): string {
  const port = options.port ?? 8787;
  const serverUrl = options.serverUrl.trim();
  if (!serverUrl) {
    throw new Error("Expected --server-url for Docker Compose output.");
  }

  return `services:
  healthlink:
    image: node:22-bookworm-slim
    restart: unless-stopped
    working_dir: /app
    ports:
      - "${port}:${port}"
    volumes:
      - ./healthlink-data:/data
    environment:
      HEALTHLINK_HOST: 0.0.0.0
      HEALTHLINK_PORT: "${port}"
      HEALTHLINK_DB: /data/healthlink.sqlite
      HEALTHLINK_TRANSPORT: lan
      HEALTHLINK_SERVER_URL: ${quoteYaml(serverUrl)}
    command:
      - sh
      - -c
      - >
        npx -y healthlink-local daemon
        --host "$$HEALTHLINK_HOST"
        --port "$$HEALTHLINK_PORT"
        --db "$$HEALTHLINK_DB"
        --transport "$$HEALTHLINK_TRANSPORT"
        --server-url "$$HEALTHLINK_SERVER_URL"
`;
}

export function buildRelayDockerComposeYaml(options: RelayDockerComposeOptions = {}): string {
  const port = options.port ?? 8790;
  return `services:
  healthlink-relay:
    image: node:22-bookworm-slim
    restart: unless-stopped
    working_dir: /app
    ports:
      - "${port}:${port}"
    volumes:
      - ./healthlink-relay-data:/data
    environment:
      HEALTHLINK_RELAY_HOST: 0.0.0.0
      HEALTHLINK_RELAY_PORT: "${port}"
      HEALTHLINK_RELAY_DB: /data/relay.sqlite
      HEALTHLINK_RELAY_RETENTION_DAYS: "30"
      HEALTHLINK_RELAY_MAX_ENVELOPE_BYTES: "524288"
      HEALTHLINK_RELAY_MAX_UPLOADS_PER_MINUTE: "120"
      HEALTHLINK_RELAY_MAX_QUEUED_ENVELOPES_PER_USER: "1000"
      HEALTHLINK_RELAY_MAX_DEVICES_PER_USER: "5"
      HEALTHLINK_RELAY_TRUST_PROXY: "false"
      HEALTHLINK_RELAY_API_TOKEN: ""
      HEALTHLINK_RELAY_METRICS_TOKEN: ""
    command:
      - sh
      - -c
      - >
        npx -y healthlink-local relay serve
        --host "$$HEALTHLINK_RELAY_HOST"
        --port "$$HEALTHLINK_RELAY_PORT"
        --db "$$HEALTHLINK_RELAY_DB"
`;
}

function quoteYaml(value: string): string {
  return JSON.stringify(value);
}
