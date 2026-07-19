---
name: vital-agent-sync
description: 在 WorkBuddy 中安装、连接和使用 Vital Agent Sync，把 iPhone Apple Health 数据通过本地运行时和 MCP 安全地提供给用户自己的 Agent。用户说“安装 Vital Agent Sync”“连接苹果健康”“显示配对二维码”“同步健康数据”或询问睡眠、恢复、活动与训练状态时使用。
---

# Vital Agent Sync for WorkBuddy

把安装、iPhone 配对、首次同步和 MCP 验证串成一个引导流程。默认使用局域网和用户级 WorkBuddy MCP 配置，不要求域名、VPS、账号或付费服务。

Vital Agent Sync 是用户控制的数据网关，不是医疗服务。不得诊断、开药、替代急救或编造健康数据。

## 安装后的主动行为

当 Skill 刚安装，或用户要求安装、连接、显示二维码时，主动开始下面的流程。不要让用户自己寻找终端命令。

1. 说明将发生的持久化改动：
   - 将固定版本 `vitalmcp@0.5.2` 安装到用户目录 `~/.vitalmcp/npm-global`；
   - 在本机创建 `~/.vital-agent-sync` 私有状态和 SQLite 数据库；
   - 将 `vital-agent-sync` MCP 合并到 `~/.workbuddy/mcp.json`；
   - 安装并启动本地接收服务；
   - 创建一个短时有效的 iPhone 配对页面。
2. 请求用户批准安装运行时。不得使用 `sudo`，不得安装未固定版本。
3. 获得批准后运行：

   ```bash
   npm install --global --prefix "$HOME/.vitalmcp/npm-global" vitalmcp@0.5.2
   "$HOME/.vitalmcp/npm-global/bin/vitalmcp" --version
   ```

4. 如果 Node.js 或 npm 不存在，停止并请用户先通过 WorkBuddy 的运行环境设置安装 Node.js 22 或更新版本。安装后的 launcher 会固定本次 setup 使用的 Node 路径和原生模块 ABI；不得改用系统 Node 运行内部 CLI 文件。
5. 如果不是 macOS，说明当前“一句话安装 + 后台服务”首发流程只完成了 macOS 验证，然后停止自动安装；不要假装 Windows 后台服务已经可用。

## 一键引导流程

始终使用同一个绝对路径运行时：

```bash
"$HOME/.vitalmcp/npm-global/bin/vitalmcp"
```

不要在同一次安装中切换到裸 `vitalmcp`、未固定的 `npx` 或仓库源码。
Skill 只编排上述固定运行时。不得用 Python、SQLite 客户端、`nohup`、`screen` 或自制脚本实现第二套安装、迁移、查询或后台服务。

### 1. 生成可审阅计划

运行以下命令，不得添加 `--yes`：

```bash
"$HOME/.vitalmcp/npm-global/bin/vitalmcp" setup --transport lan --agent workbuddy --output json
```

只概括返回的 `plan` 和持久化改动，不展示或推断任何被隐藏的字段。明确说明 iPhone 与 Mac 需要位于可互相访问的可信局域网，然后请求用户确认执行。

如果命令返回 `receiver_identity_conflict`，说明端口上存在旧版或无法验证的接收端，然后停止。不得停止旧进程、迁移 `~/.healthlink`、复制 SQLite、删除 plist 或改用另一个端口；先让用户选择保留旧版、备份后迁移，或明确指定新端口重新配对。

### 2. 执行计划并处理系统边界

只有用户明确确认后才能运行：

```bash
"$HOME/.vitalmcp/npm-global/bin/vitalmcp" setup --resume --yes --output json
```

严格按返回的 `next_action.type` 继续：

- `activate_service`：WorkBuddy 沙箱不能调用用户级 `launchctl bootstrap`。把返回的单条 `next_action.command` 原样交给用户，请用户在 macOS Terminal 中执行，然后等待用户返回。不得在 WorkBuddy 内重试，不得使用 `sudo`，不得递归删除 quarantine 属性。
- `approve_mcp`：告诉用户在 WorkBuddy MCP 设置中审批并启用 `vital-agent-sync`，随后重启或重载 WorkBuddy。不得读取或修改 `~/.workbuddy/mcp-approvals.json`。新任务中必须先确认原生 `vital_agent_status` 工具可见并成功调用，之后才能运行返回的带 `--mcp-verified` 恢复命令。
- `sync_ios`：只有 launchd 已加载且 WorkBuddy MCP 已审批、重载并验证后，才显示本地配对页面。

当 `next_action.type` 为 `sync_ios` 时：

1. 只使用返回的 `next_action.url`。它应当是本机 `127.0.0.1` 配对页面。
2. 在 macOS 上用 `open <next_action.url>` 打开该本地页面，并同时给用户一个可点击的本地链接。
3. 告诉用户：页面会显示二维码；在 Vital Agent iOS App 中扫码、授权需要的 Apple Health 项目，然后执行“立即同步”。
4. 不得读取、截图、上传或转述页面里的二维码、深链、配对码及完整凭据。二维码只能在用户本机浏览器与 iPhone 之间传递。
5. 如果过期，运行 `"$HOME/.vitalmcp/npm-global/bin/vitalmcp" pair` 创建新的本地二维码。

### 3. 验证首次同步

用户确认已经在 iPhone 完成同步后，再运行：

```bash
"$HOME/.vitalmcp/npm-global/bin/vitalmcp" setup --resume --yes --output json
"$HOME/.vitalmcp/npm-global/bin/vitalmcp" status --output json
```

确认 `sync_count` 增加且存在最新同步时间。再次调用原生 `vital_agent_status`；只有状态和新鲜度正常时，才调用 `get_personal_context` 给出第一次摘要。
如果原生 MCP 工具尚未加载，停止并请用户重启 WorkBuddy。不得直接读取 SQLite，不得用 Python、CLI 内部 API 或手写 JSON-RPC 绕过 MCP 的权限与隐私边界。

## 首次健康数据调用前的隐私提示

在第一次执行任何会读取健康数据的操作前明确告诉用户；这包括 MCP 工具、SQLite、内部 HTTP API、CLI 查询和直接 MCP 协议调用：

> Vital Agent Sync 的数据库和同步运行时保留在本机；但 WorkBuddy 调用 MCP 后，返回的必要健康上下文可能会发送给你在 WorkBuddy 中选择的模型提供商。请确认所选模型和权限符合你的隐私要求。

等待用户确认后才能继续。该提示每次安装至少出现一次。只请求回答当前问题所需的最少数据，不得为了“更全面”而读取无关指标或长时间原始历史。

## MCP 工具策略

1. 宽泛问题优先调用 `get_personal_context`。
2. 具体问题按需调用：
   - `vital_agent_status`：连接、设备数量和新鲜度；
   - `get_daily_health_summary`：某一天；
   - `get_sleep_trend`：睡眠趋势；
   - `get_workout_load`：活动和训练负荷；
   - `get_recovery_signals`：恢复相关信号；
   - `get_weekly_summary`：七天摘要；
   - `list_source_devices`、`revoke_source_device`：设备管理；
   - `record_feedback`：仅在用户明确给出反馈时使用。
3. 依赖近期数据的回答必须先说明最后同步时间。
4. 缺失或过期的数据必须直接说明，不得推测补全。
5. 把“观测数据”和“有限推断”分开表述；数据稀疏或不连续时不得声称存在趋势、疲劳、恢复不足或风险。
6. 不提供诊断、治疗、用药、确定的睡眠时长或训练处方。用户要求健康建议时，只提供一般性非医疗信息，并提醒其依据的数据范围。

## 故障排查

按顺序运行：

```bash
"$HOME/.vitalmcp/npm-global/bin/vitalmcp" service status
"$HOME/.vitalmcp/npm-global/bin/vitalmcp" doctor --agent workbuddy --transport lan
"$HOME/.vitalmcp/npm-global/bin/vitalmcp" logs --lines 100
```

- 若 `vital-agent-sync` MCP 为红色，检查 `~/.workbuddy/mcp.json` 是否为有效 JSON，以及其中的 Node 和 CLI 绝对路径是否存在。
- 若二维码在 iPhone 上不可达，确认 Mac 与 iPhone 在同一可信局域网，且配对地址不是面向 iPhone 的 `localhost`。
- 若 CLI 返回 `receiver_identity_conflict`，只展示脱敏诊断和官方下一步，不读取或迁移旧数据库。
- 若 CLI 返回 `service_activation_required`，只交付返回的 Terminal 命令并等待；若返回其他 `service_manager_failed` 或 `launchctl` 错误，停止并展示错误。不得修改 `.zprofile`、`.zshrc`、登录项或 LaunchAgent 文件，不得使用 `nohup`、`screen`、Python `Popen` 等方式绕过正式服务管理器。
- 不得对 WorkBuddy、Node 或 npm 目录执行递归 `xattr`、`chmod` 或 `chown`，不得编辑 MCP 审批存储来伪造授权。
- 不得自动执行停止旧服务、删除、重置、数据迁移、密钥轮换或设备撤销。
- 移除或升级 Skill 不得删除 `~/.vital-agent-sync`、本地历史、运行时身份、服务或 MCP 配置。

## 安全边界

- 不得读取、打印、总结或复制 `~/.vital-agent-sync/secrets` 下的文件。
- 不得要求用户把私钥、令牌、二维码、深链或配对码粘贴到聊天中。
- 不得把完整配对页面、SQLite、健康原始行或报告上传到模型、日志、Issue 或支持渠道。
- 不得读取或复制 `~/.healthlink`、其他旧版数据库或其密钥；迁移必须由经过审计的官方 CLI 在单独的用户确认流程中完成。
- 不得宣称“本地存储”等同于“本地模型推理”。
- 默认只提供手动“立即同步”和 iOS 前台补同步；不得承诺固定的后台同步时间。
- 匹配用户的语言回答。
