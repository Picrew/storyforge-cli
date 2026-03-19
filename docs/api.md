# Storyforge API

中文 | [English](#english)

## 中文

Storyforge API 提供了一个简化的 HTTP REST 层，支持：

- 一键生成整本小说（`sync` + `async`）
- 分步调用核心写作流程（init/refresh/edit/commit/ci/render/compile）
- 每次请求传入 `api_url + api_key + model`，便于大规模实验

默认输出目录：

```text
<current-working-directory>/generated-novels
```

在当前仓库中，通常对应：

```text
/Users/lijunjie/Downloads/storyforge/generated-novels
```

可通过环境变量覆盖默认值，并配置异步任务保留策略：

```bash
export STORYFORGE_API_OUTPUT_ROOT=/your/custom/output/root
export STORYFORGE_API_TASK_TTL_MS=21600000
export STORYFORGE_API_TASK_CLEANUP_INTERVAL_MS=30000
export STORYFORGE_API_TASK_MAX_ENTRIES=1000
export STORYFORGE_API_ASYNC_RUN_CONCURRENCY=2
export STORYFORGE_API_ASYNC_RUN_QUEUE_LIMIT=200
export STORYFORGE_API_ASYNC_RUN_TIMEOUT_MS=1800000
```

## 启动服务

```bash
storyforge api serve --port 3210
```

默认监听：`http://127.0.0.1:3210`

健康检查：

```bash
curl http://127.0.0.1:3210/api/v1/health
```

## 响应格式

所有接口统一返回：

```json
{
  "code": 0,
  "msg": "ok",
  "request_id": "uuid",
  "data": {}
}
```

- `code = 0`：成功
- `code != 0`：失败（参数错误、任务不存在、内部错误等）

## 1) 一键流程

### `POST /api/v1/story/run`

- `mode=sync`：阻塞直到完成；若客户端断开，服务端会中止执行
- `mode=async`：立即返回 `task_id`，后续轮询任务
- `mode=async`：受服务端 watchdog 保护，超过 `STORYFORGE_API_ASYNC_RUN_TIMEOUT_MS` 会自动失败

请求示例（sync，DeepSeek）：

```bash
curl -X POST http://127.0.0.1:3210/api/v1/story/run \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "sync",
    "title": "Memory Archive",
    "prompt": "写一部两章科幻悬疑小说，主角是记忆修复师。",
    "model_config": {
      "api_url": "https://api.deepseek.com",
      "api_key": "<YOUR_API_KEY>",
      "model": "deepseek-chat"
    },
    "render": {
      "chapter_range": "all",
      "force": true
    }
  }'
```

可选字段：

- `workspace_dir`: 指定工作目录（不传则自动生成）
- `output_root`: 指定输出根目录（不传使用默认 generated-novels）
- `edits`: 在一键流程中追加结构表编辑
- `events`: 覆盖自动章节事件提交（不传则按 outline 自动提交）
- `compile.output_path`: 指定成稿输出路径

返回结果中包含：

- `metrics.elapsed_ms`: 本次一键流程总耗时（毫秒）
- `metrics.llm_calls`: 本次流程的大模型调用次数（按 runner 调用计数）

## 2) 异步任务查询

### `GET /api/v1/tasks/:task_id`

```bash
curl http://127.0.0.1:3210/api/v1/tasks/<task_id>
```

状态：`queued | running | succeeded | failed`

说明：异步任务状态默认会在完成后保留一段时间（TTL），到期后 `GET /api/v1/tasks/:task_id` 会返回任务不存在。

## 3) 分步接口

### `POST /api/v1/story/init`

创建项目；若带 `prompt + model_config`，会立即完成 bootstrap。

### `POST /api/v1/story/refresh`

刷新结构化表，`scope` 支持：

- `all`
- `world`
- `characters`（或 `char`）
- `timeline`
- `outline`

### `POST /api/v1/story/edit`

统一简化编辑：

- `table`: `world | char | timeline | outline`
- `action`: `set | add | remove`

示例：

```json
{
  "workspace_dir": "/path/to/workspace",
  "project_id": "<project_id>",
  "table": "world",
  "action": "set",
  "field": "setting",
  "value": "Near-future Shanghai"
}
```

### `POST /api/v1/story/commit`

提交章节事件补丁。

### `POST /api/v1/story/ci`

运行叙事 CI（`scope: all | commit`）。

### `POST /api/v1/story/render`

渲染章节（`chapter_range` 或 `chapter_ids`）。

### `POST /api/v1/story/compile`

编译章节到整本稿件。

## 常见错误码

- `4001`: 参数校验失败
- `4002`: 请求体过大
- `4003`: JSON 解析失败
- `4007`: task_id URL 编码非法
- `4290`: 异步任务容量已满（请稍后重试）
- `4291`: 异步队列已满（请稍后重试）
- `4990`: 任务被中止（客户端断开或服务端超时 watchdog 触发）
- `4040`: 项目不存在
- `4041`: 任务不存在
- `5000/5001`: 服务内部错误

## 安全建议

- 不要把真实 `api_key` 提交到仓库。
- 建议由调用方动态注入 key（环境变量或密钥管理系统）。
- 服务不应打印或持久化明文 key。
- 可结合任务 TTL 与任务数上限配置，避免长时间批量实验导致内存增长。

---

## English

Storyforge API is a simplified HTTP REST layer that supports:

- one-shot full novel generation (`sync` + `async`)
- step-by-step workflow calls (init/refresh/edit/commit/ci/render/compile)
- request-level `api_url + api_key + model` for large-scale experiments

Default output root:

```text
<current-working-directory>/generated-novels
```

In this repository, it is typically:

```text
/Users/lijunjie/Downloads/storyforge/generated-novels
```

You can override this default and tune async task retention:

```bash
export STORYFORGE_API_OUTPUT_ROOT=/your/custom/output/root
export STORYFORGE_API_TASK_TTL_MS=21600000
export STORYFORGE_API_TASK_CLEANUP_INTERVAL_MS=30000
export STORYFORGE_API_TASK_MAX_ENTRIES=1000
export STORYFORGE_API_ASYNC_RUN_CONCURRENCY=2
export STORYFORGE_API_ASYNC_RUN_QUEUE_LIMIT=200
export STORYFORGE_API_ASYNC_RUN_TIMEOUT_MS=1800000
```

## Start Server

```bash
storyforge api serve --port 3210
```

Default address: `http://127.0.0.1:3210`

Health endpoint:

```bash
curl http://127.0.0.1:3210/api/v1/health
```

## Response Envelope

```json
{
  "code": 0,
  "msg": "ok",
  "request_id": "uuid",
  "data": {}
}
```

- `code = 0`: success
- `code != 0`: error

## One-Shot Endpoint

### `POST /api/v1/story/run`

- `mode=sync`: wait until completion (server aborts work if the client disconnects)
- `mode=async`: return `task_id` immediately and poll later
- `mode=async`: protected by watchdog timeout (`STORYFORGE_API_ASYNC_RUN_TIMEOUT_MS`)

Example:

```bash
curl -X POST http://127.0.0.1:3210/api/v1/story/run \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "sync",
    "title": "Memory Archive",
    "prompt": "Write a two-chapter sci-fi mystery novel.",
    "model_config": {
      "api_url": "https://api.deepseek.com",
      "api_key": "<YOUR_API_KEY>",
      "model": "deepseek-chat"
    }
  }'
```

Optional fields:

- `workspace_dir`
- `output_root`
- `edits`
- `events`
- `render`
- `compile.output_path`

Run result also includes:

- `metrics.elapsed_ms`: end-to-end one-shot duration in milliseconds
- `metrics.llm_calls`: number of LLM runner calls in this run

## Async Task Endpoint

### `GET /api/v1/tasks/:task_id`

Task states: `queued | running | succeeded | failed`

Note: completed async tasks are retained for a TTL window and then evicted.

## Step Endpoints

- `POST /api/v1/story/init`
- `POST /api/v1/story/refresh`
- `POST /api/v1/story/edit`
- `POST /api/v1/story/commit`
- `POST /api/v1/story/ci`
- `POST /api/v1/story/render`
- `POST /api/v1/story/compile`

## Error Codes

- `4001` validation error
- `4002` body too large
- `4003` invalid JSON
- `4007` invalid task_id URL encoding
- `4290` async task capacity reached (retry later)
- `4291` async queue is full (retry later)
- `4990` task aborted (client disconnected or watchdog timeout)
- `4040` project not found
- `4041` task not found
- `5000/5001` internal error

## Security Notes

- Never commit real API keys.
- Inject keys at runtime (env vars / secret manager).
- Avoid logging or persisting plain-text keys.
- Use task TTL and max-entry limits for long-running experiment workloads.
