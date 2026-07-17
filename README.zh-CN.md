# Vital Agent Sync

[English](README.md)

Vital Agent Sync 是面向 WorkBuddy 和其他 MCP Agent 的 local-first Apple Health 连接器。iPhone App 只读取用户授权的 HealthKit 数据，把精简后的健康摘要发送到用户自己控制的接收端，保存在本地 SQLite，并通过 MCP 提供有范围、有新鲜度说明的上下文。

它不是 Agent、医疗设备、健康云服务，也不提供诊断、处方或医疗建议。

## 当前版本

`0.5.1` 是 Local Preview：

- 局域网是默认路径，不需要账号、域名、VPS 或付费服务；
- Tailscale Serve HTTPS 是可选的私有远程路径；
- 支持 WorkBuddy、Hermes、OpenClaw 和通用 MCP 客户端；
- Docker 和自托管 relay 面向高级用户；
- 托管 relay 仍是实验功能；
- iOS App 当前以源码形式提供，尚未发布 App Store 版本。

## WorkBuddy 一句话安装

从 SkillHub 安装 `Vital Agent Sync` Skill，然后对 WorkBuddy 说：

> 安装 Vital Agent Sync，并在本机显示 iPhone 配对二维码。

Skill 会先展示脱敏安装计划，在修改本机配置前询问确认，安装固定版本的 `vitalmcp`，配置 MCP，并只在用户本地浏览器中打开带凭据的二维码。

## 手动安装 runtime

需要 Node.js 22 或更新版本：

```bash
npx -y vitalmcp@0.5.1 setup --agent auto --transport lan
```

首次同步后可以检查状态：

```bash
vitalmcp status --output json
vitalmcp doctor --transport lan
```

## 安装 iPhone App

HealthKit 的有效测试需要真机。在 macOS 上安装 Xcode 和 XcodeGen，然后：

```bash
cd apps/ios
xcodegen generate
open VitalAgentSync.xcodeproj
```

在 Xcode 中选择自己的 Apple Developer Team，并为本地构建设置唯一 Bundle Identifier。保留 HealthKit capability，连接 iPhone 后运行 App，扫描 runtime 显示的二维码，确认接收端地址和权限范围，再完成首次同步。

仓库不会提供或提交任何签名证书、Provisioning Profile 或 App Store Connect 凭据。

## 数据路径

```text
iPhone HealthKit
  -> 可信局域网或用户自己的 Tailscale 网络
  -> 用户自己运行的 vitalmcp 接收端
  -> 本地 SQLite
  -> MCP 工具
  -> 用户选择的 Agent 和模型提供商
```

默认路径没有 Vital Agent Sync 托管服务。Agent 或模型提供商可能收到 MCP 返回的健康上下文；“数据存储在本地”不等于“模型推理也在本地”。

不要把配对二维码、onboarding 链接、密钥、token、数据库、Apple Health 导出或包含健康数据的日志粘贴到 Agent 对话、公开 Issue 或支持渠道。

## 项目结构

| 路径 | 内容 |
| --- | --- |
| `apps/ios/` | SwiftUI HealthKit App、XcodeGen 工程、资源和 iOS 测试 |
| `packages/local/` | `vitalmcp`、接收端、SQLite、MCP、Agent 适配和传输层 |
| `skills/vital-agent-sync/` | Agent Skill 源文件和发布检查 |
| `deploy/` | Docker 与自托管 relay 模板 |
| `apps/www/` | 产品网站源码 |
| `docs/` | 架构、部署、隐私、威胁模型和协议文档 |

SkillHub 使用的独立公开仓库是 [`Coooder-Crypto/vital-agent-sync-skill`](https://github.com/Coooder-Crypto/vital-agent-sync-skill)。完整开源边界见 [docs/open-source-scope.md](docs/open-source-scope.md)。

## 开发与检查

```bash
npm ci
npm run typecheck
npm run test:local
npm run build:local
npm run audit:oss
```

`audit:oss` 会检查完整工作树和可达 Git 历史，但在仓库切换为公开之前，仍需人工检查远程分支、Issue、PR、Actions 日志、附件和发布产物。

## 参与项目

提交代码前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题通过 [SECURITY.md](SECURITY.md) 中的私密渠道报告，不要创建包含敏感内容的公开 Issue。一般使用帮助见 [SUPPORT.md](SUPPORT.md)，版本变化见 [CHANGELOG.md](CHANGELOG.md)。

Vital Agent Sync 使用 [MIT License](LICENSE)。
