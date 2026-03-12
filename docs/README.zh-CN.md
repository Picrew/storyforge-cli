# Storyforge 新手完整教程（从安装到完本）

[English](./README.md) | **中文**

这份文档给第一次接触 Storyforge 的用户准备。

目标：从“刚安装”到“产出一本完整小说稿”。

![Storyforge preview shell](./assets/storyforge-preview-shell.jpg)

## 你会得到什么

- 一套可重复执行的创作流程
- 明确的命令顺序，不用猜下一步
- 从安装到产出 `story.md` 的完整路径
- 新手常见报错与排查方法

## 0. 先理解 Storyforge 的工作方式

Storyforge 不是“一个提示词生成整本书”的黑箱工具，而是分阶段推进：

1. 先建立结构化故事状态（世界观、角色、时间线、章节大纲）
2. 再按章节提交事件（`/commit`）
3. 每次提交都跑叙事 CI 检查（`/ci run`）
4. 然后渲染章节正文（`/render`）
5. 最后编译整本稿件（`/compile all`）

这个流程对新手很友好，因为你能随时查看和修改中间层。

## 1. 安装

## 1.1 macOS（推荐：Release 里的 DMG）

下载地址：

- Release 页面：`https://github.com/Picrew/storyforge-cli/releases`
- 选择版本（例如 `v0.1.1`）
- 下载 `storyforge-<version>-macos-universal.dmg`

安装步骤：

1. 双击打开 `.dmg`
2. 双击运行其中 `.pkg` 安装器
3. 按向导安装完成
4. 打开终端执行：

```bash
storyforge
```

如果提示 `command not found`，先检查：

```bash
ls -l /usr/local/bin/storyforge
```

若文件存在但命令仍不可用，补 PATH 后重开终端：

```bash
echo 'export PATH="/usr/local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

## 1.2 Linux（当前发布为 tar.gz 运行包）

当前 Linux 资产：

- `storyforge-<version>-linux-universal.tar.gz`

安装示例：

```bash
tar -xzf storyforge-0.1.1-linux-universal.tar.gz
cd storyforge-0.1.1-linux-universal
sudo mkdir -p /usr/local/lib/storyforge
sudo cp -R ./lib/storyforge/. /usr/local/lib/storyforge/
sudo install -m 0755 ./bin/storyforge /usr/local/bin/storyforge
storyforge
```

## 1.3 源码运行（开发模式）

```bash
pnpm install
pnpm dev
```

如果环境限制 `tsx`，改用编译版启动：

```bash
pnpm build
node packages/cli/dist/index.js
```

## 2. 运行前依赖

对于安装包（`.pkg` / `.dmg` / `tar.gz`），Storyforge 已内置 Node runtime。
你只需要本机具备：

- Python 3.10+
- `opencode` 可执行

检查命令：

```bash
python3 --version
opencode --version
```

如果你是源码运行（`pnpm dev`、`pnpm build`），仍然需要 Node.js 20+。

## 3. 新手先掌握这 8 个模式

## 模式 1：连接模式

目的：连接模型提供商与模型。

常用命令：

- `/connect`
- `/models`
- `/model <provider/model>`

## 模式 2：立项模式

目的：创建项目并输入 Brief。

常用命令：

- `/init`

说明：`/init` 后第一条普通输入会被当作故事 Brief。

## 模式 3：结构编辑模式

目的：先把世界设定修正好，避免后续跑偏。

常用命令：

- `/world`
- `/char`
- `/timeline`
- `/outline`

## 模式 4：事件提交模式

目的：把章节关键事件写入“规范状态”。

常用命令：

- `/commit --chapter chNN <event_text>`

章节号必须是 `ch01`、`ch02` 这种格式。

## 模式 5：质量检查模式

目的：检查剧情一致性与依赖关系。

常用命令：

- `/ci run`
- `/status`
- `/log`

## 模式 6：章节渲染模式

目的：从当前状态生成章节 markdown 正文。

常用命令：

- `/render chNN`
- `/render ch01..ch08`
- `/render all`

## 模式 7：完稿编译模式

目的：把章节合并成整本小说。

常用命令：

- `/compile all`
- `/compile ch01..ch08 --output ./.storyforge/manuscript/final.md`

## 模式 8：自由提示模式

目的：在命令之外获取灵感、改写建议、场景细化。

方式：直接输入普通文本并回车。

## 4. 一条龙实战（从 0 到完本）

下面这套顺序可以直接照做。

## Step 1：启动并连接模型

```text
storyforge
/connect
/models
```

也可以直接一行连接（以 OpenRouter 为例）：

```text
/connect openrouter <api-key>
/model openrouter/stepfun/step-3.5-flash:free
```

## Step 2：初始化并输入 Brief

```text
/init
```

随后输入普通文本 Brief（不是命令），示例：

```text
写一部8章中文科幻悬疑小说。主角林澈是一名记忆修复师，在近未来上海调查一连串“被删除的童年”。风格克制、偏现实，强调因果闭环与情感递进。
```

## Step 3：检查四张核心表

```text
/world
/char
/timeline
/outline
```

哪里不满意就直接改。示例：

```text
/world set premise 近未来上海，记忆修复成为灰色产业
/char add 林澈
/char set 1 role 主角
/timeline add 林澈接到第一位“童年空白”委托
/outline set 1 title 空白的相册
```

## Step 4：按章节重复核心循环

每章都执行：

1. 提交关键事件
2. 跑 CI
3. 渲染正文

第 1 章示例：

```text
/commit --chapter ch01 林澈在委托人的老照片里发现被涂抹的人影，决定追查底片来源
/ci run
/render ch01
```

第 2 章示例：

```text
/commit --chapter ch02 林澈找到冲印店旧服务器，发现三十年前同类案例的匿名档案
/ci run
/render ch02
```

如果 CI 报错，先不要急着 `--force`。先修表或修事件逻辑，再提交。

## Step 5：批量渲染后续章节

当 `ch01..ch08` 事件都提交完后：

```text
/render ch01..ch08
```

需要全量重渲染时：

```text
/render all --force
```

## Step 6：编译整本稿件

```text
/compile all
```

默认输出：

- `./.storyforge/manuscript/story.md`

至此，你已经得到一份完整小说稿。

## 5. 产物文件在哪里

在你执行 `storyforge` 的当前目录下，会生成 `.storyforge/`：

- `./.storyforge/workspace.json`：工作区索引
- `./.storyforge/projects/`：结构化项目状态
- `./.storyforge/chapters/chNN.md`：章节正文
- `./.storyforge/manuscript/story.md`：整本合并稿

建议：一部小说一个目录，便于管理。

## 6. 新手高频问题

## Q1：为什么 `/init` 后第一句话被“吃掉”了？

这是预期行为。它会作为故事 Brief。

## Q2：`/commit` CI 失败怎么处理？

先执行：

```text
/status
/log --chapter chNN
```

然后修复世界表、角色表、时间线，再重新提交。

## Q3：能否跳过 CI 直接推进？

可以：

```text
/commit --chapter chNN <event> --force
```

但不建议长期使用，后期会出现连续性问题。

## Q4：`opencode` 没装会怎样？

模型列表可能回退到内置目录，生成能力会受限。建议安装并确保 `opencode --version` 正常。

## 7. 给新手的建议节奏

1. 先做 4 章短篇，熟悉命令
2. 再做 8-12 章长篇
3. 每章坚持 `commit -> ci -> render`
4. 每 2-3 章执行一次 `/compile` 看整体节奏
5. 收尾前统一 `/render all --force` 再 `/compile all`

## 8. 相关文档

- [Quickstart](./quickstart.md)
- [Provider And Model Setup](./provider-and-model-setup.md)
- [Feature Overview](./feature-overview.md)
- [Command Reference](./command-reference.md)
- [Bash Workflow And Architecture](./bash-architecture.md)
- [Story Writing Quality Playbook](./story-writing-quality-playbook.md)
- [Troubleshooting](./troubleshooting.md)
