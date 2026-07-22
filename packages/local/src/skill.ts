import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const VITALMCP_SKILL_NAME = "vitalmcp-personal-context";
export const WORKBUDDY_SKILL_NAME = "vital-agent-sync";
export const VITALMCP_SKILL_VERSION = "0.5.3";

export type SkillInstallOptions = {
  hermesHome?: string;
  skillPath?: string;
};

export type SkillInstallResult = {
  skillPath: string;
  backupPath?: string;
};

export type SkillPackageOptions = VitalAgentSkillOptions & {
  outputDir: string;
};

export type SkillPackageResult = {
  packageDir: string;
  skillPath: string;
  readmePath?: string;
};

export type VitalAgentSkillOptions = {
  agent?: "generic" | "hermes" | "openclaw" | "workbuddy";
};

export function buildVitalAgentSkillMarkdown(options: VitalAgentSkillOptions = {}): string {
  const agent = options.agent ?? "generic";
  if (agent === "workbuddy") {
    return buildWorkBuddySkillMarkdown();
  }
  const targetAgent = agent !== "generic" ? `\nTarget agent: ${agentDisplayName(agent)}.\n` : "";
  const agentSubject = agent === "generic" ? "the user's MCP-compatible Agent" : agentDisplayName(agent);
  const triggerSource = agent === "generic" ? "agent" : agent;
  const skillTitle = "Vital Agent Sync Personal Context";
  const skillDescription = "Use Vital Agent Sync MCP for personal health, recovery, and activity context.";
  return `---
name: ${VITALMCP_SKILL_NAME}
description: ${skillDescription}
version: ${VITALMCP_SKILL_VERSION}
metadata:
  openclaw:
    requires:
      bins:
        - vitalmcp
    install:
      - kind: node
        package: vitalmcp@${VITALMCP_SKILL_VERSION}
        bins:
          - vitalmcp
    os:
      - macos
      - linux
      - windows
  hermes:
    tags: [vitalmcp, mcp, personal-context, health]
---

# ${skillTitle}

## Overview

Use this skill when the user asks about their personal status, energy, recovery, sleep, workout readiness, or recent activity. Vital Agent Sync is a user-controlled data gateway, not a medical provider.
${targetAgent}

Vital Agent Sync data comes from MCP tools. Do not invent health, sleep, workout, or recovery facts that are not present in tool output.

## After Skill Installation

Proactively offer to initialize Vital Agent Sync. Do not wait for the user to discover setup commands.

1. Explain that Vital Agent Sync will create private local state, configure one shared MCP server, install a local receiver service, and create one iOS pairing action. LAN is the Local Preview default.
2. Ask whether the user wants to review the setup plan.
3. Run the machine-readable setup command without \`--yes\`. Summarize only the returned redacted \`plan\` entries.
4. After explicit approval, resume with \`--yes\`.
5. Present only the safe local onboarding URL in \`next_action.url\`. Never decode the credential payload.
6. After the first iOS sync, resume setup and verify freshness through \`vital_agent_status\`.
7. When setup is complete, call \`get_personal_context\` and offer the first useful health answer.

The Skill is an orchestration layer. Removing or upgrading it must not remove \`~/.vital-agent-sync\`, rotate runtime identity, delete local history, or break generic MCP.

## When to Use

- The user asks "How am I today?", "Should I exercise?", "Am I recovered?", or similar.
- The user asks for analysis that may benefit from sleep, activity, heart-rate, HRV, VO2 max, blood oxygen, respiratory rate, body temperature, body composition, or workout context.
- The user asks whether recent sync data is available.
- The user asks to revoke, inspect, or troubleshoot connected Vital Agent Sync source devices.

Do not use this skill for diagnosis, prescriptions, emergency advice, or unsupported medical claims.

## Tool Strategy

1. Call \`get_personal_context\` first for broad questions about today, recovery, energy, or activity.
2. Use lower-level tools only for follow-up detail:
   - \`get_daily_health_summary\` for a specific date's health metrics, including activity, sleep, heart, respiratory, temperature, and body-composition summaries when available.
   - \`get_sleep_trend\` for sleep continuity.
   - \`get_workout_load\` for workout and activity load.
   - \`get_recovery_signals\` for sleep, heart-rate, HRV, oxygen, respiratory, temperature, activity, and workout-minutes context.
   - \`get_weekly_summary\` for compact 7-day health, activity, and recovery summaries.
   - \`vital_agent_status\`, \`list_source_devices\`, and \`revoke_source_device\` for setup and troubleshooting.
   - \`list_devices\` and \`revoke_device\` only as legacy aliases when an older agent flow expects those names.
   - \`record_feedback\` only when the user explicitly gives feedback, a correction, or a preference that should improve future Vital Agent Sync analysis.
3. Mention data freshness before analysis when the answer depends on recency.
4. If the latest sync is stale or missing, say that plainly and suggest syncing Vital Agent Sync.
5. In relay mode, call or suggest \`vitalmcp pull\` before freshness-sensitive analysis when \`vital_agent_status.relay.suggested_next_action\` indicates a pull is needed.

## Agent Setup Flow

When the user asks ${agentSubject} to install or connect Vital Agent Sync, keep the core logic in \`vitalmcp\`. Do not implement transport logic, parse private keys, or store health data inside the skill.

### Local Preview: LAN By Default

1. Check whether a compatible local runtime is installed:
   \`\`\`bash
   vitalmcp --version
   \`\`\`
   If the command is missing or outside the compatible 0.5.x range, use the pinned package fallback for this Skill version:
   \`\`\`bash
   npx -y vitalmcp@${VITALMCP_SKILL_VERSION} --version
   \`\`\`
   Select one runtime command for the whole flow: use \`vitalmcp\` when the installed version is compatible; otherwise prefix every local CLI invocation below with \`npx -y vitalmcp@${VITALMCP_SKILL_VERSION}\`. Do not switch runners midway through setup, and do not use an unpinned \`npx\` package.
   Do not use \`sudo npm install -g\`.
2. Explain that LAN requires the iPhone and receiver to share a reachable trusted network. It does not require a relay URL, VPS, domain, Vital Agent Sync account, or payment method. Request a redacted setup plan:
   \`\`\`bash
   vitalmcp setup --transport lan --agent ${agent} --output json
   \`\`\`
3. Explain the returned plan and obtain explicit approval. Then resume the shared bootstrap:
   \`\`\`bash
   vitalmcp setup --resume --yes --output json
   \`\`\`
4. Open or present the local pairing URL in \`next_action.url\`. Do not copy pairing credentials into Agent messages. If the pairing code expires, run:
   \`\`\`bash
   vitalmcp pair
   \`\`\`
5. Ask the user to scan the pairing QR in the Vital Agent app, grant Apple Health access, and run Sync Now.
6. Resume setup to observe the first ingest, then use \`vital_agent_status\` and \`get_personal_context\`:
   \`\`\`bash
   vitalmcp setup --resume --yes --output json
   \`\`\`

The v0.1 delivery promise is manual Sync Now plus catch-up when the iOS app is active or returns to the foreground. iOS background opportunities are best-effort. Never promise scheduled daily or weekly delivery, an exact interval, or a guaranteed background sync time.

### Optional Private Remote Path: Tailscale

Offer Tailscale when the user needs to sync away from the receiver's LAN. Before setup, explain that the user must:

- install and sign in to Tailscale on both the iPhone and receiver machine
- have a Tailscale account and an authorized tailnet that includes both devices
- keep the receiver reachable under its approved MagicDNS name or Tailscale address

Then request a separate reviewed plan:

\`\`\`bash
vitalmcp setup --transport tailscale --tailscale-name <host.tailnet.ts.net> --agent ${agent} --output json
\`\`\`

After explicit approval, resume with \`vitalmcp setup --resume --yes --output json\`. Do not silently switch an existing LAN installation to Tailscale. Tailscale is optional and user-managed; Vital Agent Sync does not create an account, install the apps, or authorize tailnet devices.

### LAN And Tailscale Troubleshooting

1. Check runtime and receiver state with \`vitalmcp status\`, \`vitalmcp service status\`, and \`vitalmcp logs\`.
2. For LAN, run \`vitalmcp doctor --transport lan\` and confirm the pairing URL is not \`127.0.0.1\` or \`localhost\` and is reachable from the iPhone on the trusted network.
3. For Tailscale, confirm both devices are signed in to the same authorized tailnet, then run \`vitalmcp doctor --transport tailscale --tailscale-name <host.tailnet.ts.net>\`.
4. If a pairing code expires, run \`vitalmcp pair\`. To revoke a paired source, call MCP \`revoke_source_device\`, remove the saved connection in the iOS app, then pair again. Revocation stops that source without deleting local SQLite history.

### Relay: Future And Experimental

Hosted Relay is not available, recommended, or required in the Local Preview flow. Never ask a Local Preview user for a relay URL, VPS, domain, account, or payment method. Only discuss relay setup when the user explicitly asks to test an experimental deployment or operate a self-hosted relay.

For an explicit hosted-relay experiment, resolve the HTTPS relay URL from installed product configuration or the user's relay operator. Never invent a relay domain. Request a redacted setup plan:

\`\`\`bash
vitalmcp setup --transport relay --relay-url https://HOSTED-RELAY --agent ${agent} --output json
\`\`\`

After explicit approval, resume setup, present only the safe local URL in \`next_action.url\`, ask the user to sync, pull encrypted envelopes, and verify freshness:

\`\`\`bash
vitalmcp setup --resume --yes --output json
vitalmcp pull
vitalmcp setup --resume --yes --output json
\`\`\`

If the user explicitly chooses a self-hosted relay:

1. Generate and start the relay Compose file with \`vitalmcp print-relay-docker-compose > docker-compose.relay.yml\` and \`docker compose -f docker-compose.relay.yml up -d\`.
2. Request and review \`vitalmcp setup --transport self-hosted-relay --relay-url http://HOST:8790 --agent ${agent} --output json\`.
3. After consent and iOS onboarding, run \`vitalmcp pull\` and query health data through MCP.

Relay setup may install a \`relay-pull\` service. A pull schedule only moves already-uploaded encrypted envelopes; it is not an iOS sync schedule and must not be described as guaranteed daily or weekly delivery. Do not use relay lifecycle commands as an automatic troubleshooting step.

## Relay And Privacy Guardrails

- Never print, request, summarize, or copy files under \`~/.vital-agent-sync/secrets\`.
- Do not ask the user to paste private keys into an Agent chat.
- Treat the complete onboarding QR, deep link, and text code as credentials. They contain \`upload_auth_secret\`, \`relay_access_token\`, and sometimes \`relay_api_token\`; show them only to the user for transfer to the intended Vital Agent Sync source device, and never paste them into Agent chat, logs, memory, tool arguments, issue trackers, or support messages.
- Hosted and self-hosted relays should contain encrypted envelopes plus minimal hashed tenant/revocation metadata; relay operators should not be able to decrypt health payloads.
- Treat \`~/.vital-agent-sync/config.json\`, \`~/.vital-agent-sync/vital-agent.sqlite\`, generated reports, and exported summaries as sensitive local state.
- Do not dump raw health tables or long metric histories unless the user explicitly asks for that detail.
- If \`vital_agent_status\` shows stale or missing data, suggest \`vitalmcp pull\` for relay mode or ask the user to sync from iOS. When mobile deep-link support is available, suggest \`vitalmcp://sync?source=${triggerSource}&request_id=...\`; do not put health plaintext in callback URLs.
- If \`vitalmcp pull\` reports a failed envelope, tell the user the envelope was not acknowledged and point them to \`vitalmcp relay status\` or \`vitalmcp doctor --agent ${agent}\`.

## Unlink, Rotation, And Reset

Run lifecycle commands only after the user explicitly confirms the action:

- \`vitalmcp relay unlink --yes\` blocks the current source device at the relay and purges its queued envelopes. Reconnecting requires credential rotation and fresh iOS onboarding.
- \`vitalmcp relay rotate --yes\` preserves the relay user and source IDs, purges envelopes encrypted with the old key, replaces local encryption/authentication credentials, and requires fresh iOS onboarding.
- \`vitalmcp relay reset --yes\` revokes and purges the old relay user, creates new user/device IDs and credentials, resets the local cursor, and requires fresh iOS onboarding.
- \`vitalmcp relay migrate --yes --transport self-hosted-relay --relay-url <target>\` revokes the old identity, preserves local SQLite health history, creates fresh credentials for the target relay, and requires fresh iOS onboarding.

Do not run these commands as an automatic troubleshooting step. Explain that queued-but-unpulled envelopes are deleted and stop the workflow if the user does not confirm.

## Report Templates

Use these templates when the user asks for a concise daily or weekly health report. Keep the report grounded in MCP output and omit sections when supporting data is missing.

Daily report:

1. Freshness: latest source generated time, latest local sync or relay pull time, and missing metrics.
2. Today snapshot: sleep, steps, active energy, workouts, and any available heart or recovery signals.
3. Interpretation: separate observed data from inference; note confidence when metrics are sparse.
4. Suggested plan: practical activity, recovery, and work pacing suggestions within non-medical boundaries.
5. Next sync action: relay pull, iOS sync deep link, or direct gateway pairing action only when needed.

Weekly report:

1. Freshness and coverage: number of covered days, source devices, missing metrics, and stale-data warning if relevant.
2. Sleep pattern: total/average sleep and notable low or high days.
3. Activity load: total steps, active energy, exercise/workout minutes, and trend direction.
4. Recovery signals: resting heart rate, HRV, oxygen, respiratory, temperature, and workout load only when present.
5. User-facing conclusion: one concise summary, practical next actions, and uncertainty boundaries.

Do not save reports to files unless the user explicitly asks. Treat generated reports as sensitive local health summaries.

## Response Boundaries

- Give practical planning and wellness framing, not medical diagnosis.
- Use cautious language when data is incomplete.
- Separate observed data from inference.
- Match the user's language.
- If the user asks for exact reasons behind a health signal that Vital Agent Sync does not contain, say the data cannot prove that.

## Verification Checklist

- [ ] Vital Agent Sync MCP tool output was used for health claims.
- [ ] Data freshness or missing data was surfaced.
- [ ] Relay mode used \`vitalmcp pull\` before MCP analysis when fresh data was needed.
- [ ] Private keys and raw local state were not exposed.
- [ ] Onboarding credentials were not copied into Agent messages, logs, memory, or tool arguments.
- [ ] Medical-safety boundaries were respected.
- [ ] Local Preview setup used LAN by default, or documented Tailscale prerequisites before an explicit Tailscale choice.
- [ ] Hosted Relay was described only as future/experimental, never as the default or recommended path.
- [ ] Sync timing was described as manual plus foreground catch-up, with background delivery best-effort and unscheduled.
`;
}

export function exportVitalAgentSkillPackage(options: SkillPackageOptions): SkillPackageResult {
  const packageDir = resolveHomePath(options.outputDir);
  const agent = options.agent ?? "openclaw";
  const skillPath = join(packageDir, "SKILL.md");
  const readmePath = join(packageDir, "README.md");
  mkdirSync(packageDir, { recursive: true });
  rmSync(join(packageDir, "clawhub.json"), { force: true });
  rmSync(readmePath, { force: true });
  writeFileSync(skillPath, buildVitalAgentSkillMarkdown({ agent }), "utf8");
  if (agent !== "workbuddy") {
    writeFileSync(readmePath, buildSkillPackageReadme(agent), "utf8");
  }
  return {
    packageDir,
    skillPath,
    readmePath: agent === "workbuddy" ? undefined : readmePath
  };
}

function buildWorkBuddySkillMarkdown(): string {
  const runtime = `"$HOME/.vitalmcp/npm-global/bin/vitalmcp"`;
  return `---
name: ${WORKBUDDY_SKILL_NAME}
description: 在 WorkBuddy 中安装、连接和使用 Vital Agent Sync，把 iPhone Apple Health 数据通过本地运行时和 MCP 安全地提供给用户自己的 Agent。用户说“安装 Vital Agent Sync”“连接苹果健康”“显示配对二维码”“同步健康数据”或询问睡眠、恢复、活动与训练状态时使用。
---

# Vital Agent Sync for WorkBuddy

把安装、iPhone 配对、首次同步和 MCP 验证串成一个引导流程。默认使用局域网和用户级 WorkBuddy MCP 配置，不要求域名、VPS、账号或付费服务。

Vital Agent Sync 是用户控制的数据网关，不是医疗服务。不得诊断、开药、替代急救或编造健康数据。

## 安装后的主动行为

当 Skill 刚安装，或用户要求安装、连接、显示二维码时，主动开始下面的流程。不要让用户自己寻找终端命令。

1. 一次性说明并请求确认以下改动：
   - 将固定版本 \`vitalmcp@${VITALMCP_SKILL_VERSION}\` 安装到用户目录 \`~/.vitalmcp/npm-global\`；
   - 在本机创建 \`~/.vital-agent-sync\` 私有状态和 SQLite 数据库；
   - 将 \`vital-agent-sync\` MCP 合并到 \`~/.workbuddy/mcp.json\`；
   - 在当前 WorkBuddy 会话中启动局域网接收进程；该 Local Preview 进程可能在 WorkBuddy 退出后停止；
   - 创建一个短时有效的 iPhone 配对页面。
2. 同时明确：Mac 将在 \`0.0.0.0:8787\` 接收同一可信局域网内的 iPhone 请求；本机浏览器通过 \`127.0.0.1\` 显示私密二维码，二维码内部使用 iPhone 可达的 Mac 局域网地址。
3. 这是首次配对前唯一一次安装确认。用户确认后不得再生成第二份计划或再次询问是否执行，直接运行：

   \`\`\`bash
   npm install --global --prefix "$HOME/.vitalmcp/npm-global" vitalmcp@${VITALMCP_SKILL_VERSION}
   ${runtime} --version
   ${runtime} setup --transport lan --agent workbuddy --yes --output json
   \`\`\`

4. 如果 Node.js 或 npm 不存在，停止并请用户先通过 WorkBuddy 的运行环境设置安装 Node.js 22 或更新版本。安装后的 launcher 会固定本次 setup 使用的 Node 路径和原生模块 ABI；不得改用系统 Node 运行内部 CLI 文件。
5. 如果不是 macOS，说明当前“一句话安装 + 后台服务”首发流程只完成了 macOS 验证，然后停止自动安装；不要假装 Windows 后台服务已经可用。

## 一键引导流程

始终使用同一个绝对路径运行时：

\`\`\`bash
${runtime}
\`\`\`

不要在同一次安装中切换到裸 \`vitalmcp\`、未固定的 \`npx\` 或仓库源码。
Skill 只编排上述固定运行时。不得用 Python、SQLite 客户端、\`nohup\`、\`screen\` 或自制脚本实现第二套安装、迁移、查询或后台服务。

### 1. 单次确认后执行

安装确认必须同时覆盖 npm 运行时和 CLI 返回的持久化计划。不得在 npm 安装后再次请求确认。CLI 使用 \`--yes\` 是因为用户已经批准了上面的完整改动清单；不得把 \`--yes\` 用于清单之外的删除、迁移、密钥轮换或网络模式切换。

如果命令返回 \`receiver_identity_conflict\`，说明端口上存在旧版或无法验证的接收端，然后停止。不得停止旧进程、迁移 \`~/.healthlink\`、复制 SQLite、删除 plist 或改用另一个端口；先让用户选择保留旧版、备份后迁移，或明确指定新端口重新配对。

### 2. 显示本地二维码并处理 MCP 审批

严格按返回的 \`next_action.type\` 继续：

- \`activate_service\`：默认 WorkBuddy Local Preview 不应返回此状态。不要把 Terminal 命令交给普通用户；说明运行时未切换到会话托管模式并停止，交由产品故障排查。
- \`approve_mcp\`：如果同时返回 \`next_action.url\`，立即打开本地配对页面，不要让 MCP 审批阻塞二维码。随后引导用户在 WorkBuddy MCP 设置中信任 \`vital-agent-sync\`；批准只影响后续健康数据读取，不影响本机二维码显示。不得读取或修改 WorkBuddy 的审批存储。
- \`sync_ios\`：立即打开返回的本地配对页面。

当返回任何 \`next_action.url\` 时：

1. 只使用返回的 \`next_action.url\`。浏览器页面应当是本机 \`127.0.0.1\`；这不等于 iPhone 的连接地址，二维码内部必须使用 Mac 的局域网地址。
2. 在 macOS 上用 \`open <next_action.url>\` 打开该本地页面，并同时给用户一个可点击的本地链接。
3. 告诉用户：页面会显示二维码；在 Vital Agent iOS App 中扫码、授权需要的 Apple Health 项目，然后执行“立即同步”。
4. 不得读取、截图、上传或转述页面里的二维码、深链、配对码及完整凭据。二维码只能在用户本机浏览器与 iPhone 之间传递。
5. 如果过期，运行 \`${runtime} pair\` 创建新的本地二维码。

WorkBuddy 重启或重载后，只要原生 \`vital_agent_status\` 已可调用，就立即执行返回的带 \`--mcp-verified\` 恢复命令，不再要求用户发送第二句安装指令或再次确认。MCP 未经批准前不得读取健康数据，也不得用 SQLite、CLI 查询或手写 MCP 协议绕过审批。

### 3. 验证首次同步

用户确认已经在 iPhone 完成同步后，再运行：

\`\`\`bash
${runtime} setup --resume --yes --output json
${runtime} status --output json
\`\`\`

确认 \`sync_count\` 增加且存在最新同步时间。再次调用原生 \`vital_agent_status\`；只有状态和新鲜度正常时，才调用 \`get_personal_context\` 给出第一次摘要。
如果原生 MCP 工具尚未加载，停止并请用户重启 WorkBuddy。不得直接读取 SQLite，不得用 Python、CLI 内部 API 或手写 JSON-RPC 绕过 MCP 的权限与隐私边界。

## 首次健康数据调用前的隐私提示

在第一次执行任何会读取健康数据的操作前明确告诉用户；这包括 MCP 工具、SQLite、内部 HTTP API、CLI 查询和直接 MCP 协议调用：

> Vital Agent Sync 的数据库和同步运行时保留在本机；但 WorkBuddy 调用 MCP 后，返回的必要健康上下文可能会发送给你在 WorkBuddy 中选择的模型提供商。请确认所选模型和权限符合你的隐私要求。

等待用户确认后才能继续。该提示每次安装至少出现一次。只请求回答当前问题所需的最少数据，不得为了“更全面”而读取无关指标或长时间原始历史。

## MCP 工具策略

1. 宽泛问题优先调用 \`get_personal_context\`。
2. 具体问题按需调用：
   - \`vital_agent_status\`：连接、设备数量和新鲜度；
   - \`get_daily_health_summary\`：某一天；
   - \`get_sleep_trend\`：睡眠趋势；
   - \`get_workout_load\`：活动和训练负荷；
   - \`get_recovery_signals\`：恢复相关信号；
   - \`get_weekly_summary\`：七天摘要；
   - \`list_source_devices\`、\`revoke_source_device\`：设备管理；
   - \`record_feedback\`：仅在用户明确给出反馈时使用。
3. 依赖近期数据的回答必须先说明最后同步时间。
4. 缺失或过期的数据必须直接说明，不得推测补全。
5. 把“观测数据”和“有限推断”分开表述；数据稀疏或不连续时不得声称存在趋势、疲劳、恢复不足或风险。
6. 不提供诊断、治疗、用药、确定的睡眠时长或训练处方。用户要求健康建议时，只提供一般性非医疗信息，并提醒其依据的数据范围。

## 故障排查

按顺序运行：

\`\`\`bash
${runtime} service status
${runtime} doctor --agent workbuddy --transport lan
${runtime} logs --lines 100
\`\`\`

- 若 \`vital-agent-sync\` MCP 为红色，检查 \`~/.workbuddy/mcp.json\` 是否为有效 JSON，以及其中的 Node 和 CLI 绝对路径是否存在。
- 若二维码在 iPhone 上不可达，确认 Mac 与 iPhone 在同一可信局域网，且配对地址不是面向 iPhone 的 \`localhost\`。
- 若 CLI 返回 \`receiver_identity_conflict\`，只展示脱敏诊断和官方下一步，不读取或迁移旧数据库。
- 若默认 WorkBuddy 流程返回 \`service_activation_required\`，停止并报告会话托管模式未生效，不要要求普通用户打开 Terminal。不得修改 \`.zprofile\`、\`.zshrc\`、登录项或 LaunchAgent 文件，不得使用 \`nohup\`、\`screen\`、Python \`Popen\` 等方式绕过官方运行时。
- 不得对 WorkBuddy、Node 或 npm 目录执行递归 \`xattr\`、\`chmod\` 或 \`chown\`，不得编辑 MCP 审批存储来伪造授权。
- 不得自动执行停止旧服务、删除、重置、数据迁移、密钥轮换或设备撤销。
- 移除或升级 Skill 不得删除 \`~/.vital-agent-sync\`、本地历史、运行时身份、服务或 MCP 配置。

## 安全边界

- 不得读取、打印、总结或复制 \`~/.vital-agent-sync/secrets\` 下的文件。
- 不得要求用户把私钥、令牌、二维码、深链或配对码粘贴到聊天中。
- 不得把完整配对页面、SQLite、健康原始行或报告上传到模型、日志、Issue 或支持渠道。
- 不得读取或复制 \`~/.healthlink\`、其他旧版数据库或其密钥；迁移必须由经过审计的官方 CLI 在单独的用户确认流程中完成。
- 不得宣称“本地存储”等同于“本地模型推理”。
- 默认只提供手动“立即同步”和 iOS 前台补同步；不得承诺固定的后台同步时间。
- 匹配用户的语言回答。
`;
}

export function installHermesVitalAgentSkill(options: SkillInstallOptions = {}): SkillInstallResult {
  const skillPath = getHermesSkillPath(options);
  mkdirSync(dirname(skillPath), { recursive: true });

  const backupPath = existsSync(skillPath) ? uniqueBackupPath(skillPath) : undefined;
  if (backupPath) {
    copyFileSync(skillPath, backupPath);
  }

  writeFileSync(skillPath, buildVitalAgentSkillMarkdown({ agent: "hermes" }), "utf8");

  return {
    skillPath,
    backupPath
  };
}

export function getHermesSkillPath(options: SkillInstallOptions = {}): string {
  return resolveHomePath(options.skillPath ?? join(options.hermesHome ?? process.env.HERMES_HOME ?? "~/.hermes", "skills", "health", VITALMCP_SKILL_NAME, "SKILL.md"));
}

function resolveHomePath(path: string): string {
  if (path === "~") {
    return homedir();
  }
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

function timestampForFilename(): string {
  const iso = new Date().toISOString();
  return iso
    .replaceAll("-", "")
    .replace("T", "-")
    .replaceAll(":", "")
    .replace(".", "")
    .replace("Z", "");
}

function uniqueBackupPath(skillPath: string): string {
  const base = `${skillPath}.vitalmcp-backup-${timestampForFilename()}`;
  if (!existsSync(base)) {
    return base;
  }

  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("Could not allocate a unique Vital Agent Sync skill backup path.");
}

export function readInstalledHermesSkill(options: SkillInstallOptions = {}): string | undefined {
  const skillPath = getHermesSkillPath(options);
  return existsSync(skillPath) ? readFileSync(skillPath, "utf8") : undefined;
}

function buildSkillPackageReadme(agent: NonNullable<VitalAgentSkillOptions["agent"]>): string {
  return `# Vital Agent Sync Personal Context Skill

Target agent: ${agentDisplayName(agent)}.

This package contains a Vital Agent Sync skill for LAN-first agent-guided setup, optional user-managed Tailscale access, freshness checks, and MCP-based personal health context. Experimental relay guidance remains available for explicit tests. The skill delegates all local runtime, transport, crypto, storage, and MCP behavior to \`vitalmcp\`.

Package contents:

- \`SKILL.md\`: the skill prompt, ClawHub metadata, runtime requirements, and operating rules.
- \`README.md\`: this file.

Before publishing, verify:

- \`vitalmcp print-skill --agent openclaw\` matches \`SKILL.md\`.
- Private files under \`~/.vital-agent-sync/secrets\` are never copied into the package.
- The package contains no health data, SQLite files, relay envelopes, tokens, or local user IDs.
- The skill still points agents to MCP tools instead of embedding health data or crypto.

ClawHub publishes skills under MIT-0. Do not add a conflicting per-skill license.

Validate the package before publication:

\`\`\`bash
npm i -g clawhub
clawhub login
clawhub whoami
clawhub skill publish . \\
  --slug ${VITALMCP_SKILL_NAME} \\
  --name "Vital Agent Sync Personal Context" \\
  --version ${VITALMCP_SKILL_VERSION} \\
  --changelog "LAN-first Local Preview" \\
  --dry-run
\`\`\`

After publication, install the final owner/slug from a clean OpenClaw environment:

\`\`\`bash
openclaw skills install <owner-or-final-slug>
\`\`\`
`;
}

function agentDisplayName(agent: NonNullable<VitalAgentSkillOptions["agent"]>): string {
  switch (agent) {
  case "hermes":
    return "Hermes";
  case "openclaw":
    return "OpenClaw";
  case "workbuddy":
    return "WorkBuddy";
  case "generic":
    return "Generic MCP Agent";
  }
}
