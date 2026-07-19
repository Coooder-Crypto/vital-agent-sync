# Vital Agent Sync

[English](README.md)

Vital Agent Sync 是面向个人 AI Agent 的开源 Apple Health 本地桥接器。iPhone App 只读取用户授权的 HealthKit 摘要，把数据发送到用户自己控制的接收端，保存在本地 SQLite，并通过 MCP 提供最小必要上下文。

它是数据连接器，不是 Agent、医疗设备、健康云服务，也不提供诊断、治疗或急救建议。

## 当前路线

`0.5.2` 是源码分发的 Local Preview，严格按以下顺序推进：

| 阶段 | 体验 | 状态 |
| --- | --- | --- |
| 1 | WorkBuddy 与 `vitalmcp` 在同一台 Mac，iPhone 通过可信局域网同步 | 当前唯一优先级 |
| 2 | Hermes、通用 MCP 和其他 Agent 复用同一个本地运行时 | 下一阶段 |
| 3 | Agent 与 `vitalmcp` 部署在用户自己的服务器，iPhone 通过 Tailscale 同步 | 最后阶段 |

当前不做托管 Relay、账号、付费、订阅、App Store 上线、公共 VPS、域名或营销推广。完整决策见[产品计划](docs/product-plan.md)。

## WorkBuddy 一句话安装

从 [SkillHub](https://skillhub.cn/skills/vital-agent-sync) 安装 Vital Agent Sync，然后对 WorkBuddy 说：

> 安装 Vital Agent Sync，使用局域网连接我的 iPhone。先说明所有持久化修改，等我确认后执行，最后在本机打开配对二维码。

Skill 会：

- 无 `sudo` 安装固定版本的 `vitalmcp`；
- 修改文件、服务、网络和 MCP 配置前展示脱敏计划并等待确认；
- 记录 setup 使用的 Node 路径与原生模块 ABI，让 Terminal、launchd 和 MCP 使用同一兼容运行时；
- 遇到 WorkBuddy 沙箱边界时暂停，只让用户在 macOS Terminal 执行一条返回的 launchd 激活命令，不使用 `sudo`；
- 等待用户审批 WorkBuddy MCP、重载并成功调用原生 `vital_agent_status` 后再配对；
- 只在用户本地浏览器打开包含凭据的二维码；
- 第一次读取健康数据前说明模型隐私边界并等待确认。

手动备用入口：

```bash
npx -y vitalmcp@0.5.2 setup --agent workbuddy --transport lan
```

首次同步后检查：

```bash
vitalmcp status --output json
vitalmcp doctor --agent workbuddy --transport lan
```

## 本地 Hermes 与其他 Agent

所有 Agent 复用同一个接收端、SQLite、setup 状态和 MCP 工具：

```bash
npx -y vitalmcp@0.5.2 setup --agent hermes --transport lan
npx -y vitalmcp@0.5.2 setup --agent generic --transport lan
npx -y vitalmcp@0.5.2 setup --agent openclaw --transport lan
```

Hermes 是第二阶段的第一优先级，通用 stdio MCP 是可移植基线，不依赖任何 Agent 市场上架。

## Tailscale 用户服务器

最后阶段让 Agent、`vitalmcp`、SQLite 和 MCP 在同一台用户服务器上运行，Tailscale 只负责 iPhone 到接收端的私有 HTTPS：

```bash
npx -y vitalmcp@0.5.2 setup \
  --agent hermes \
  --manager systemd \
  --transport tailscale \
  --tailscale-name receiver.example-tailnet.ts.net
```

第一版服务器模式不会通过网络暴露 MCP，也不使用 Funnel、公共 DNS 或托管 Relay。详见[部署方式](docs/deployment-methods.md)与 [Tailscale iOS 引导](docs/tailscale-ios-onboarding.md)。

## 安装 iPhone App

当前 iOS App 以源码提供，HealthKit 测试需要真机：

```bash
cd apps/ios
xcodegen generate
open VitalAgentSync.xcodeproj
```

在 Xcode 中选择自己的 Apple Development Team 和唯一 Bundle Identifier，保留 HealthKit capability 后运行到 iPhone。扫码时检查接收端地址和授权范围，只选择愿意同步的数据。

## 数据与隐私

```text
iPhone HealthKit
  -> 可信局域网或用户自己的 Tailscale
  -> 用户运行的 vitalmcp
  -> 本地 SQLite
  -> MCP 工具
  -> 用户选择的 Agent 与模型提供商
```

本地存储不等于本地模型推理。Agent 或模型提供商可能收到 MCP 返回的最小健康上下文。不得把二维码、onboarding 链接、密钥、token、数据库、Health 导出或未脱敏日志粘贴到 Agent 对话或公开 Issue。

当前支持手动同步和前台补同步；iOS 后台执行是 best effort，不承诺固定时间表。

## 开发与贡献

```bash
npm ci
npm run typecheck
npm run test:local
npm run test:ios
npm run audit:oss
```

详细文档见[文档索引](docs/README.md)。提交代码前阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题通过 [SECURITY.md](SECURITY.md) 的私密渠道报告，安装问题使用 [GitHub Discussions](https://github.com/Coooder-Crypto/vital-agent-sync/discussions)。

项目使用 [MIT License](LICENSE)。
