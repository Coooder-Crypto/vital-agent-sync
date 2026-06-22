export type DatabaseConfig = {
  path: string;
};

export function getDefaultDatabasePath(): string {
  return "~/.healthlink/healthlink.sqlite";
}

