# Storyforge CLI

[English](./README.md) | **中文**

![preview badge](https://img.shields.io/badge/preview-v0.1.0-f97316)
![node badge](https://img.shields.io/badge/node-%3E%3D20.0.0-16a34a)
![license badge](https://img.shields.io/badge/license-Apache%202.0-2563eb)

一个面向场景、情节弧线与长篇虚构创作的写作者优先终端界面。

Storyforge 是一个面向小说工作流的开源 CLI 界面。当前仓库已经具备第一个真正的写作核心能力：持久化小说项目库、`/init` 初始化流程，以及在终端里展示的结构化故事表格。

> 当前版本仍然处于早期阶段，但已经可以初始化一部小说、记录故事 brief，并生成可编辑的 `world`、`characters`、`timeline` 和 `outline` 表。

![Storyforge 预览界面](./docs/assets/storyforge-preview-shell.jpg)

## 为什么是 Storyforge

- 围绕小说创作场景设计，而不是面向通用编码任务。
- 终端原生、键盘优先，不依赖浏览器。
- 用 TypeScript、Ink 和清晰的 workspace 结构打下了可持续扩展的基础。

## 当前已经可用

- 支持多种终端宽度的响应式 ASCII Storyforge 头部。
- 用于建立氛围和定位的欢迎卡片。
- 可交互的输入框，支持输入、`Backspace` 删除、`Enter` 提交，以及 `Esc` 或 `Ctrl+C` 退出。
- 输入 `/` 时会出现顶部命令面板，支持 `Tab` 自动补全和 `Enter` 选中。
- `/connect` 会先打开 provider 选择器，再进入凭据填写。
- `/models` 会打开模型选择器；本机装了 `opencode` 时，会优先读取 `opencode models <provider>` 的结果。
- 也支持直接手输 `/connect <provider> <api-key> [base-url]` 和 `/model <provider/model>`。
- 再次打开时会自动恢复上一次保存的 provider 和 model。
- 每个工作目录都会在 `./.storyforge/workspace.json` 中维护项目索引，并把具体项目保存到 `./.storyforge/projects/`。
- 可以反复用 `/init` 创建新的空白小说骨架，再开始填写故事 brief。
- `/projects` 可以列出当前目录下保存过的小说项目，并按序号重新打开。
- `/init` 之后的第一条普通文本会被当作故事生成 brief，并依次生成：
  `world`、`characters`、`timeline`、`outline`。
- `/world`、`/char`、`/timeline`、`/outline` 会把当前结构化表格直接追加到 transcript 历史里。
- 结构化故事数据支持命令式编辑，包括 add/set/remove。
- 能适配宽窄终端的底部状态栏。

完成首次 bootstrap 后，后续普通 prompt 仍然会继续走自由聊天式的流式对话面板。

## 快速开始

### 环境要求

- Node.js 20 或更高版本
- pnpm 9 或更高版本

### 安装依赖

```bash
pnpm install
```

### 启动预览界面

```bash
pnpm dev
```

### 构建 CLI

```bash
pnpm build
```

### 运行构建产物

```bash
node packages/cli/dist/index.js
```

### 全局链接本地命令

```bash
pnpm link:global
storyforge
```

如果链接后仍然找不到 `storyforge` 命令，先执行一次 `pnpm setup`，然后重启当前 shell，让 pnpm 的全局 bin 目录进入 `PATH`。

## 文档

- [文档索引](./docs/README.md)
- [Quickstart](./docs/quickstart.md)
- [Feature Overview](./docs/feature-overview.md)
- [Command Reference](./docs/command-reference.md)
- [Provider And Model Setup](./docs/provider-and-model-setup.md)
- [Troubleshooting](./docs/troubleshooting.md)

## 项目结构

```text
.
├── docs/
│   ├── assets/    # README 图片与文档资源
│   └── *.md       # 当前预览版的使用文档
├── packages/
│   └── cli/       # Storyforge 可执行 CLI 包
├── test/          # 根目录渲染测试与 smoke test
├── package.json   # workspace 编排入口
└── pnpm-workspace.yaml
```

## 开发

在仓库根目录执行：

```bash
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## 测试

项目使用 `Vitest` 和 `ink-testing-library`。

当前测试覆盖聚焦在 UI 外壳：

- 不同视口下的头部渲染
- 输入框交互行为
- 底栏布局变化
- CLI 首帧渲染 smoke test

运行完整测试：

```bash
pnpm test
```

## 技术栈

- TypeScript
- React 19
- Ink
- ink-gradient
- Vitest
- pnpm workspace

## 贡献说明

项目目前仍处于基础阶段。

如果你继续扩展，建议保持这些约束：

- 保持模块边界清晰
- 注释简洁并使用英文
- 不要把占位行为包装成已完成能力
- 优先提交经过验证的 UI 变更

## 许可证

当前仓库使用 [Apache License 2.0](./LICENSE)。

版权所有 2026 Jayden
