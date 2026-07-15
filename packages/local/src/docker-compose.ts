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
  vital-agent-sync:
    image: node:22-bookworm-slim
    restart: unless-stopped
    working_dir: /app
    ports:
      - "${port}:${port}"
    volumes:
      - ./vital-agent-sync-data:/data
    environment:
      VITALMCP_HOST: 0.0.0.0
      VITALMCP_PORT: "${port}"
      VITALMCP_DB: /data/vital-agent.sqlite
      VITALMCP_TRANSPORT: lan
      VITALMCP_SERVER_URL: ${quoteYaml(serverUrl)}
    command:
      - sh
      - -c
      - >
        npx -y vitalmcp daemon
        --host "$$VITALMCP_HOST"
        --port "$$VITALMCP_PORT"
        --db "$$VITALMCP_DB"
        --transport "$$VITALMCP_TRANSPORT"
        --server-url "$$VITALMCP_SERVER_URL"
`;
}

export function buildRelayDockerComposeYaml(options: RelayDockerComposeOptions = {}): string {
  const port = options.port ?? 8790;
  return `services:
  vital-agent-sync-relay:
    image: node:22-bookworm-slim
    restart: unless-stopped
    working_dir: /app
    ports:
      - "${port}:${port}"
    volumes:
      - ./vital-agent-sync-relay-data:/data
    environment:
      VITALMCP_RELAY_HOST: 0.0.0.0
      VITALMCP_RELAY_PORT: "${port}"
      VITALMCP_RELAY_DB: /data/relay.sqlite
      VITALMCP_RELAY_RETENTION_DAYS: "30"
      VITALMCP_RELAY_MAX_ENVELOPE_BYTES: "524288"
      VITALMCP_RELAY_MAX_UPLOADS_PER_MINUTE: "120"
      VITALMCP_RELAY_MAX_QUEUED_ENVELOPES_PER_USER: "1000"
      VITALMCP_RELAY_MAX_DEVICES_PER_USER: "5"
      VITALMCP_RELAY_TRUST_PROXY: "false"
      VITALMCP_RELAY_API_TOKEN: ""
      VITALMCP_RELAY_METRICS_TOKEN: ""
    command:
      - sh
      - -c
      - >
        npx -y vitalmcp relay serve
        --host "$$VITALMCP_RELAY_HOST"
        --port "$$VITALMCP_RELAY_PORT"
        --db "$$VITALMCP_RELAY_DB"
`;
}

function quoteYaml(value: string): string {
  return JSON.stringify(value);
}
