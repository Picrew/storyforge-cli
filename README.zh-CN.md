# Storyforge CLI

[English](./README.md) | **中文**

![preview badge](https://img.shields.io/badge/preview-v0.2.0-f97316)
![node badge](https://img.shields.io/badge/node-%3E%3D20.0.0-16a34a)
![python badge](https://img.shields.io/badge/python-%3E%3D3.10-3776ab)
![license badge](https://img.shields.io/badge/license-Apache%202.0-2563eb)

Storyforge 是一个面向长篇小说创作的终端工作流系统。

V2 的核心思想是：长篇生成不再依赖“不断塞更长上下文”，而是“持续维护世界状态，再从状态渲染文本”。

## 核心闭环

```text
/init -> brief 初始化
/commit -> 事件补丁 -> 确定性 CI
/render -> 从章节状态快照渲染正文
/compile -> 合并成完整稿件
```

## 当前已实现

- 工作目录级别的持久化小说项目库。
- 结构化 bootstrap：`world / characters / timeline / outline`。
- V2 世界状态 schema（自动兼容迁移 v1 项目）。
- Python agent 子进程桥接（JSON stdin/stdout）：
  - `plan_patch`
  - `apply_patch`
  - `run_ci`
  - `build_impact`
- 确定性叙事 CI 规则：
  - 时间线单调
  - 实体引用存在性
  - 物品守恒
  - 伏笔逾期未闭环告警
- 依赖追踪与 dirty chapter 增量标记。
- 渲染结果输出到 `.storyforge/chapters/chNN.md`。
- 编译结果默认输出到 `.storyforge/manuscript/story.md`。

## V2 命令集

- `/init`
- `/projects`
- `/world` `/char` `/timeline` `/outline`
- `/commit --chapter chNN <event_text>`
- `/commit --chapter chNN --patch-file <json_path>`
- `/commit --chapter chNN <event_text> --force`
- `/status`
- `/log [--chapter chNN] [--limit N] [--visual]`
- `/ci run [--all|--commit <id>]`
- `/render <chNN|chNN..chMM|all> [--force] [--style <name>]`
- `/compile <range|all> [--output <path>]`

具体参数与行为见 [Command Reference](./docs/command-reference.md)。

## 快速开始

### 环境要求

- Node.js 20+
- pnpm 9+
- Python 3.10+（用于本地 story agent）
- 已安装并可执行 `opencode`

### 安装依赖

```bash
pnpm install
```

### 启动

```bash
pnpm dev
```

### 构建与运行

```bash
pnpm build
node packages/cli/dist/index.js
```

## 一次典型 V2 会话

```text
/connect deepseek <api-key>
/model deepseek/deepseek-chat
/init
<输入 brief>
/commit --chapter ch01 林远在地下室发现密账本
/ci run
/render ch01
/compile all
```

## 测试说明

项目使用 `Vitest` + `ink-testing-library`，当前已覆盖：

- V2 命令解析与流程测试
- v1 -> v2 迁移测试
- 确定性 CI 规则测试
- render/compile 产物测试
- 默认纳入 `pnpm test` 的 DeepSeek 在线端到端测试

运行：

```bash
pnpm lint
pnpm typecheck
pnpm test
```

快速离线回归（跳过在线 DeepSeek e2e）：

```bash
pnpm test:offline
```

## 文档

- [文档索引](./docs/README.md)
- [Quickstart](./docs/quickstart.md)
- [Feature Overview](./docs/feature-overview.md)
- [Command Reference](./docs/command-reference.md)
- [Architecture](./ARCHITECTURE.md)
- [V2 功能框架图 (ASCII)](./docs/v2-feature-framework.txt)

## 许可证

[Apache License 2.0](./LICENSE)
