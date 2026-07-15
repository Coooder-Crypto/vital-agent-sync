import { spawnSync } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = process.cwd();
const tempDir = mkdtempSync(join(tmpdir(), "vital-agent-sync-agent-adapter-audit-"));
const hermesHome = join(tempDir, ".hermes");
const hermesConfigPath = join(hermesHome, "config.yaml");
const hermesSkillPath = join(
  hermesHome,
  "skills",
  "health",
  "vitalmcp-personal-context",
  "SKILL.md"
);
const databasePath = join(tempDir, "vital-agent.sqlite");
const cliPath = resolve(root, "packages", "local", "dist", "cli.js");
const hermesPath = resolveHermesBinary();
const isolatedEnv = {
  ...process.env,
  HOME: tempDir,
  HERMES_HOME: hermesHome,
  NO_COLOR: "1",
  TERM: "dumb"
};

let genericClient;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await cleanup();
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

try {
  run("vitalmcp build", "npm", [
    "run",
    "build",
    "--workspace",
    "vitalmcp"
  ]);
  if (process.platform !== "win32") {
    chmodSync(cliPath, 0o755);
  }
  verifyAgentNeutralCliHelp();
  installIsolatedHermesAdapter();
  await verifyGenericMcpClient();
  verifyHermesCli();
  console.log("\nVital Agent Sync generic MCP and Hermes adapter audit passed.");
} finally {
  await cleanup();
}

function verifyAgentNeutralCliHelp() {
  console.log("\n==> agent-neutral CLI surface");
  const help = capture(cliPath, ["--help"]);
  for (const expected of [
    "setup --transport relay --relay-url https://HOSTED-RELAY --agent <agent>",
    "print-agent-config --agent <agent>",
    "print-skill --agent <generic|hermes|openclaw|workbuddy>",
    "install-hermes-skill",
    "export-skill --agent <openclaw|workbuddy>"
  ]) {
    assert(help.includes(expected), `CLI help is missing the Agent-neutral entry: ${expected}`);
  }
}

function installIsolatedHermesAdapter() {
  console.log("\n==> isolated Hermes adapter install");
  const installOutput = capture(cliPath, [
    "install-hermes",
    "--hermes-config",
    hermesConfigPath,
    "--db",
    databasePath
  ], { env: isolatedEnv });
  assert(installOutput.includes("Vital Agent Sync MCP installed for Hermes"), "Hermes MCP install did not complete.");

  const config = readFileSync(hermesConfigPath, "utf8");
  assert(config.includes("mcp_servers:"), "Hermes config does not contain mcp_servers.");
  assert(config.includes("vital-agent-sync:"), "Hermes config does not contain the vital-agent-sync server.");
  assert(config.includes(cliPath), "Hermes config does not point at the compiled Vital Agent Sync CLI.");
  assert(config.includes(databasePath), "Hermes config does not point at the isolated Vital Agent Sync database.");

  const skillOutput = capture(cliPath, [
    "install-hermes-skill",
    "--hermes-skill-path",
    hermesSkillPath
  ], { env: isolatedEnv });
  assert(skillOutput.includes("Vital Agent Sync skill installed for Hermes"), "Hermes skill install did not complete.");

  const skill = readFileSync(hermesSkillPath, "utf8");
  assert(skill.includes("Target agent: Hermes."), "Installed Hermes skill is not targeted at Hermes.");
  assert(skill.includes("--agent hermes"), "Installed Hermes skill lacks Hermes setup commands.");
  assert(skill.includes("source=hermes"), "Installed Hermes skill lacks a Hermes mobile trigger source.");
  assert(!skill.includes("## OpenClaw Relay Setup Flow"), "Installed Hermes skill still contains an OpenClaw-only setup flow.");
}

async function verifyGenericMcpClient() {
  console.log("\n==> generic MCP protocol and tool call");
  let serverStderr = "";
  const transport = new StdioClientTransport({
    command: cliPath,
    args: ["mcp", "--db", databasePath],
    cwd: root,
    env: isolatedEnv,
    stderr: "pipe"
  });
  transport.stderr?.on("data", (chunk) => {
    serverStderr += chunk.toString();
  });
  genericClient = new Client({
    name: "vital-agent-sync-agent-adapter-audit",
    version: "1.0.0"
  });

  try {
    await genericClient.connect(transport);
    const tools = await genericClient.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);
    assert(toolNames.length === 12, `Generic MCP discovered ${toolNames.length} tools instead of 12.`);
    for (const required of [
      "vital_agent_status",
      "get_personal_context",
      "get_daily_health_summary",
      "get_sleep_trend",
      "get_workout_load",
      "get_recovery_signals",
      "get_weekly_summary",
      "list_source_devices",
      "record_feedback"
    ]) {
      assert(toolNames.includes(required), `Generic MCP is missing ${required}.`);
    }

    const result = await genericClient.callTool({
      name: "vital_agent_status",
      arguments: {}
    });
    const text = result.content.find((item) => item.type === "text")?.text;
    assert(typeof text === "string", "vital_agent_status did not return text content.");
    const status = JSON.parse(text);
    assert(status.ok === true, "vital_agent_status did not report ok=true.");
    assert(status.service === "vitalmcp", "vital_agent_status reported the wrong service.");
    assert(status.status === "running", "vital_agent_status did not report a running MCP data layer.");
    console.log(`Generic MCP discovered ${toolNames.length} tools and called vital_agent_status.`);
  } catch (error) {
    if (serverStderr) {
      process.stderr.write(serverStderr);
    }
    throw error;
  } finally {
    await genericClient.close().catch(() => {});
    genericClient = undefined;
  }
}

function verifyHermesCli() {
  console.log("\n==> installed Hermes CLI MCP handshake");
  const version = capture(hermesPath, ["--version"], { env: isolatedEnv });
  assert(version.includes("Hermes Agent"), "The resolved Hermes binary did not report a Hermes Agent version.");

  const list = capture(hermesPath, ["mcp", "list"], { env: isolatedEnv });
  assert(list.includes("vital-agent-sync"), "Hermes did not load the isolated vital-agent-sync MCP config.");
  assert(list.includes("enabled"), "Hermes did not report the vital-agent-sync MCP as enabled.");

  const test = capture(hermesPath, ["mcp", "test", "vital-agent-sync"], {
    env: isolatedEnv,
    timeout: 30_000
  });
  assert(test.includes("Connected"), "Hermes did not connect to the vital-agent-sync MCP server.");
  assert(test.includes("Tools discovered: 12"), "Hermes did not discover all 12 Vital Agent Sync tools.");
  assert(!test.includes("Connection failed"), "Hermes reported a failed Vital Agent Sync MCP connection.");
  for (const required of ["vital_agent_status", "get_personal_context", "get_weekly_summary"]) {
    assert(test.includes(required), `Hermes MCP discovery output is missing ${required}.`);
  }
  console.log(version.trim());
  console.log("Hermes loaded the isolated adapter, connected, and discovered 12 tools.");
}

function resolveHermesBinary() {
  const explicit = process.env.VITALMCP_HERMES_BIN;
  const candidates = [
    explicit,
    ...executableCandidatesFromPath("hermes"),
    join(homedir(), ".local", "bin", process.platform === "win32" ? "hermes.exe" : "hermes")
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue to the next candidate.
    }
  }

  throw new Error(
    "Hermes CLI was not found. Install Hermes or set VITALMCP_HERMES_BIN, then rerun npm run audit:agent-adapters."
  );
}

function executableCandidatesFromPath(name) {
  const suffixes = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  return (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .flatMap((directory) => suffixes.map((suffix) => join(directory, `${name}${suffix}`)));
}

function run(label, command, args, options = {}) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: options.env ?? process.env,
    stdio: "inherit",
    timeout: options.timeout ?? 120_000
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: options.env ?? process.env,
    encoding: "utf8",
    timeout: options.timeout ?? 30_000
  });
  if (result.error) {
    throw result.error;
  }
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) {
    process.stderr.write(output);
    throw new Error(`${command} ${args.join(" ")} exited with status ${result.status}.`);
  }
  return output;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function cleanup() {
  if (genericClient) {
    await genericClient.close().catch(() => {});
    genericClient = undefined;
  }
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
