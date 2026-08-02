const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const siteUrl = configuredSiteUrl.replace(/\/+$/, "");

export const githubUrl = "https://github.com/Coooder-Crypto/vital-agent-sync";
export const skillHubUrl = "https://skillhub.cn/skills/vital-agent-sync";
export const npmUrl = "https://www.npmjs.com/package/vitalmcp";

export const productSummary =
  "Vital Agent Sync gives authorized AI agents fresh, scoped Apple Health context through an iPhone app, a user-controlled local receiver, and standard MCP tools.";

export const productPrinciples = [
  "Users choose which personal data sources to connect.",
  "Each authorized agent receives only the context needed for the current task.",
  "Returned context includes source and freshness information.",
  "Users can inspect, revoke, and replace connections.",
];
