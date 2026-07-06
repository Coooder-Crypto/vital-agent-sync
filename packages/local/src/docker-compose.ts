export type DockerComposeOptions = {
  serverUrl: string;
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

function quoteYaml(value: string): string {
  return JSON.stringify(value);
}
