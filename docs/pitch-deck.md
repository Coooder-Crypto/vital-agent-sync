# Vital Agent Sync Web Deck

这份 Deck 面向比赛展示，默认时长为 5–6 分钟，共 9 页。前半段证明产品闭环已经成立，后半段解释个人动机、Context Scaling 判断和长期方向。

## 运行方式

开发模式：

```bash
npm run dev:pitch
```

默认访问 `http://localhost:3000`。如果该端口已被占用，Next.js 会自动选择其他端口。

离线构建：

```bash
npm run build:pitch
npm run start:pitch
```

离线版本默认访问 `http://127.0.0.1:3100`，不依赖外部字体、图片或网络请求。

## 演示控制

| 操作 | 按键 |
| --- | --- |
| 下一页 | `→`、`Page Down`、`Space` |
| 上一页 | `←`、`Page Up` |
| 第一页 | `Home` 或 `R` |
| 最后一页 | `End` |
| 全屏 | `F` |
| 演讲备注 | `N` |
| 视频播放 / 暂停 | 第 4 页按 `V` 或点击视频 |

Deck 会忽略滚轮输入，避免触控板一次滑过多页。触摸设备可以左右滑动，一次手势只移动一页。

## 整体叙事

```text
AI 缺少真实个人上下文
→ Vital Agent Sync 建立用户控制的数据路径
→ 视频证明闭环已经跑通
→ 这不只是一个 HealthKit 连接器
→ Context Scaling 是下一条重要扩展轴
→ Context 必须在不转移所有权的前提下扩展
```

## 逐页说明

### 01. Vital Agent Sync

**页面任务**

让评委记住产品名和一句话定位：

> Apple Health context. Private by design.

**讲述建议**

> Vital Agent Sync 让 AI Agent 获得新鲜、经过授权的 Apple Health 上下文，同时让数据继续由用户控制。

不要在封面介绍功能列表，也不要展开部署方式。

---

### 02. AI 可以理解世界，却不知道今天的你

**页面任务**

用具体问题证明这不是知识问题，而是 Context 问题。

**讲述建议**

> 当我问 AI“根据我昨晚的睡眠和今天的状态，我适合高强度训练吗”，它可能懂运动科学，但它不知道昨晚发生了什么，也不知道自己看到的数据是否最新。

这一页不要批评模型能力。重点是模型缺少可验证的个人状态。

---

### 03. 一条由用户控制的 Context 路径

**页面任务**

用一张图讲清楚产品：

```text
Apple Health
→ iPhone summaries
→ Local receiver
→ MCP
→ Authorized Agent
```

**讲述建议**

> Agent 不直接访问 HealthKit。iPhone 只生成用户授权的摘要，Receiver 保存在用户自己的环境中，再通过 MCP 提供带范围和新鲜度的 Context。

三个关键词：

- `Scoped`
- `Fresh`
- `Revocable`

---

### 04. 从连接到第一次回答

**页面任务**

播放 45–60 秒真实产品视频。

**视频建议顺序**

1. Agent 发起连接或安装。
2. 本地 Receiver 显示配对入口。
3. iPhone 扫码并确认服务器、传输方式和权限。
4. 用户点击“立即同步”。
5. Agent 查询 MCP 并返回带数据新鲜度的回答。

**视频文件**

将最终视频保存为：

```text
apps/pitch/public/media/demo.mp4
```

建议格式：

- 1920 × 1080
- H.264
- 16:9
- 45–60 秒
- 不依赖音频，现场由演讲者讲述

不要在视频中展示真实二维码、Token、服务器地址或敏感健康信息。

---

### 05. Agent 得到证据，而不是 HealthKit 权限

**页面任务**

解释视频刚刚证明了什么，而不是重复演示步骤。

当前页面使用带有 `ILLUSTRATIVE OUTPUT` 标记的示例界面。最终版本应替换为真实 Agent 回答截图，并保留三个关注点：

1. 数据更新时间
2. Apple Health 观测事实
3. Agent 推断和限制

建议截图路径：

```text
apps/pitch/public/media/agent-answer.png
```

核心句：

> Fresh context. Explicit scope. No direct HealthKit access.

---

### 06. 我不想用交出所有数据，换取一个更懂我的 AI

**页面任务**

从产品证明转向个人动机。

**讲述建议**

> Apple Health 已经记录了很多关于我的真实状态，模型也已经具备分析这些信息的能力。但我发现，两者之间缺少一条持续、安全、由我控制的连接。

在正式比赛前，将这里替换为一个真实触发场景，建议控制在 3–5 句话：

- 当时你在使用什么 Agent？
- 你想问什么问题？
- 为什么手动导出或上传云端不能接受？
- 这个问题为什么值得自己解决？

---

### 07. 下一条 Scaling 轴，是 Context

**页面任务**

提出整场展示的上层判断。

**核心表达**

> Model scaling determines what AI can do.
> Context scaling determines whether it can do it for me.

这里的 Context Scaling 不是：

- 单纯扩大 Context Window
- 收集更多聊天历史
- 将全部私人数据交给模型

它是系统持续获得、筛选、验证、检索和安全使用真实世界 Context 的能力。

---

### 08. Context 应该扩展，但所有权不应转移

**页面任务**

把观点落回产品原则：

```text
Personal data sources
→ User-owned context layer
→ Authorized Agents
```

**讲述建议**

> 更懂用户的 AI，不应该自动意味着平台拥有更多用户数据。用户应该决定接入什么、谁能访问、数据是否足够新，以及何时撤销。

Health 是第一个 Context，也是最适合验证权限、新鲜度和隐私边界的数据源。

---

### 09. Health 是起点，不是边界

**页面任务**

结束时把产品和长期方向连接起来，但不要宣称已经完成通用个人数据平台。

**结尾建议**

> 我最初不是想把 Apple Health 接入一个 Agent。我想验证的是：私人 Context 能否像模型能力一样扩展，同时仍然属于用户。

不要使用单独的 “Thank you” 页。停留在这一页接受提问。

## 素材清单

正式版本至少需要：

- `demo.mp4`：45–60 秒完整流程
- `agent-answer.png`：真实 Agent 回答
- `iphone-sync.png`：iPhone 配对或同步完成页
- 演讲者姓名、团队和比赛名称
- “为什么做这个”的真实经历

## 现场检查

1. 使用比赛现场的电脑完成一次离线构建。
2. 断开网络后确认 Deck 仍能打开。
3. 确认字体、App 图标和视频均来自本地。
4. 通过 HDMI 或投影设备检查 16:9 裁切。
5. 测试 `F`、方向键、`N` 和 `V`。
6. 关闭系统通知和浏览器扩展提示。
7. 准备 PDF 或静态截图作为最终兜底。
