# Storyforge HTTP API（中文）

[English](./api.md) | **中文**

本文档用于通过 REST API 调用 Storyforge，覆盖“一键生成”和“分步流程”两种方式。

## 快速开始

启动 API 服务：

```bash
storyforge api serve --port 3210
```

默认地址：

```text
http://127.0.0.1:3210
```

可选服务端参数（适合批量实验）：

```bash
export STORYFORGE_API_OUTPUT_ROOT=/your/custom/output/root
export STORYFORGE_API_TASK_TTL_MS=21600000
export STORYFORGE_API_TASK_CLEANUP_INTERVAL_MS=30000
export STORYFORGE_API_TASK_MAX_ENTRIES=1000
export STORYFORGE_API_ASYNC_RUN_CONCURRENCY=2
export STORYFORGE_API_ASYNC_RUN_QUEUE_LIMIT=200
export STORYFORGE_API_ASYNC_RUN_TIMEOUT_MS=1800000
```

健康检查：

```bash
curl http://127.0.0.1:3210/api/v1/health
```

## 统一响应格式

所有接口都返回：

```json
{
  "code": 0,
  "msg": "ok",
  "request_id": "uuid",
  "data": {}
}
```

- `code = 0`：成功
- `code != 0`：失败

## 模型配置（请求级）

每个请求都可以自带模型配置：

```json
"model_config": {
  "api_url": "https://api.deepseek.com",
  "api_key": "<YOUR_API_KEY>",
  "model": "deepseek-chat",
  "timeout_ms": 240000
}
```

这样你做大规模实验时，不依赖本地固定 provider 配置。

## 1）一键流程

### `POST /api/v1/story/run`

- `mode=sync`：阻塞直到完成（客户端断开时，服务端会中止执行）
- `mode=async`：立即返回 `task_id`，再轮询 `/api/v1/tasks/:task_id`
- 异步任务受 watchdog 保护，超过 `STORYFORGE_API_ASYNC_RUN_TIMEOUT_MS` 会失败

### curl（sync）

```bash
curl -X POST http://127.0.0.1:3210/api/v1/story/run \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "sync",
    "title": "Memory Archive",
    "prompt": "写一部4章科幻悬疑小说。",
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

### Python（sync）

```python
import httpx

payload = {
    "mode": "sync",
    "title": "Memory Archive",
    "prompt": "写一部4章科幻悬疑小说。",
    "model_config": {
        "api_url": "https://api.deepseek.com",
        "api_key": "<YOUR_API_KEY>",
        "model": "deepseek-chat",
    },
    "render": {"chapter_range": "all", "force": True},
}

resp = httpx.post("http://127.0.0.1:3210/api/v1/story/run", json=payload, timeout=900.0)
resp.raise_for_status()
print(resp.json())
```

### curl（async 提交）

```bash
curl -X POST http://127.0.0.1:3210/api/v1/story/run \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "async",
    "title": "Batch Job",
    "prompt": "写一部4章武侠小说。",
    "model_config": {
      "api_url": "https://api.deepseek.com",
      "api_key": "<YOUR_API_KEY>",
      "model": "deepseek-chat"
    }
  }'
```

### Python（async 提交 + 轮询）

```python
import time
import httpx

BASE = "http://127.0.0.1:3210"

body = {
    "mode": "async",
    "title": "Batch Job",
    "prompt": "写一部4章武侠小说。",
    "model_config": {
        "api_url": "https://api.deepseek.com",
        "api_key": "<YOUR_API_KEY>",
        "model": "deepseek-chat",
    },
}

with httpx.Client(base_url=BASE, timeout=60.0) as client:
    submit = client.post("/api/v1/story/run", json=body)
    submit.raise_for_status()
    task_id = submit.json()["data"]["task_id"]

    while True:
        task = client.get(f"/api/v1/tasks/{task_id}")
        task.raise_for_status()
        data = task.json()["data"]
        if data["status"] in ("succeeded", "failed"):
            print(data)
            break
        time.sleep(2)
```

### Python 并发调用（推荐）

```bash
pip install httpx
export DEEPSEEK_API_KEY="<YOUR_API_KEY>"
export STORYFORGE_BASE_URL="http://127.0.0.1:3210"
export STORYFORGE_OUTPUT_ROOT="/Users/lijunjie/Downloads/storyforge/generated-novels"
export STORYFORGE_MAX_CONCURRENCY=3
python3 docs/examples/storyforge_api_batch_async.py
```

脚本路径：

- `docs/examples/storyforge_api_batch_async.py`

## 2）异步任务查询

### `GET /api/v1/tasks/:task_id`

状态值：

```text
queued | running | succeeded | failed
```

### curl

```bash
curl http://127.0.0.1:3210/api/v1/tasks/<task_id>
```

### Python

```python
import httpx

task_id = "<task_id>"
resp = httpx.get(f"http://127.0.0.1:3210/api/v1/tasks/{task_id}", timeout=30.0)
resp.raise_for_status()
print(resp.json())
```

说明：

- 异步任务状态会保留一段 TTL 时间，到期后会被清理。

## 3）分步接口

这部分就是你在 CLI 截图里看到的那套流程 API 化版本。

### 通用 Python helper

```python
import httpx

BASE_URL = "http://127.0.0.1:3210"

client = httpx.Client(base_url=BASE_URL, timeout=120.0)

def sf_post(path: str, payload: dict):
    resp = client.post(path, json=payload)
    resp.raise_for_status()
    body = resp.json()
    if body.get("code") != 0:
        raise RuntimeError(f"{path} failed: {body.get('code')} {body.get('msg')}")
    return body["data"]
```

### `POST /api/v1/story/init`

创建项目；带 `prompt + model_config` 时会立即 bootstrap。

#### curl

```bash
curl -X POST http://127.0.0.1:3210/api/v1/story/init \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Step Story",
    "output_root": "/Users/lijunjie/Downloads/storyforge/generated-novels",
    "prompt": "写一部4章记忆修复题材小说。",
    "model_config": {
      "api_url": "https://api.deepseek.com",
      "api_key": "<YOUR_API_KEY>",
      "model": "deepseek-chat"
    }
  }'
```

#### Python

```python
init_data = sf_post("/api/v1/story/init", {
    "title": "Step Story",
    "output_root": "/Users/lijunjie/Downloads/storyforge/generated-novels",
    "prompt": "写一部4章记忆修复题材小说。",
    "model_config": {
        "api_url": "https://api.deepseek.com",
        "api_key": "<YOUR_API_KEY>",
        "model": "deepseek-chat",
    },
})
workspace_dir = init_data["workspace_dir"]
project_id = init_data["project_id"]
```

### `POST /api/v1/story/refresh`

刷新结构表（`scope`：`all|world|characters|char|timeline|outline`）。

#### curl

```bash
curl -X POST http://127.0.0.1:3210/api/v1/story/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "workspace_dir": "<workspace_dir>",
    "project_id": "<project_id>",
    "scope": "outline",
    "model_config": {
      "api_url": "https://api.deepseek.com",
      "api_key": "<YOUR_API_KEY>",
      "model": "deepseek-chat"
    }
  }'
```

#### Python

```python
sf_post("/api/v1/story/refresh", {
    "workspace_dir": workspace_dir,
    "project_id": project_id,
    "scope": "outline",
    "model_config": {
        "api_url": "https://api.deepseek.com",
        "api_key": "<YOUR_API_KEY>",
        "model": "deepseek-chat",
    },
})
```

### `POST /api/v1/story/edit`

统一编辑接口（`table=world|char|timeline|outline`，`action=set|add|remove`）。

#### curl

```bash
curl -X POST http://127.0.0.1:3210/api/v1/story/edit \
  -H "Content-Type: application/json" \
  -d '{
    "workspace_dir": "<workspace_dir>",
    "project_id": "<project_id>",
    "table": "world",
    "action": "set",
    "field": "setting",
    "value": "Near-future Shanghai"
  }'
```

#### Python

```python
sf_post("/api/v1/story/edit", {
    "workspace_dir": workspace_dir,
    "project_id": project_id,
    "table": "world",
    "action": "set",
    "field": "setting",
    "value": "Near-future Shanghai",
})
```

### `POST /api/v1/story/commit`

提交章节事件补丁。

#### curl

```bash
curl -X POST http://127.0.0.1:3210/api/v1/story/commit \
  -H "Content-Type: application/json" \
  -d '{
    "workspace_dir": "<workspace_dir>",
    "project_id": "<project_id>",
    "chapter_id": "ch01",
    "event_text": "林澈在旧相册里发现童年空白照片。",
    "force": true,
    "model_config": {
      "api_url": "https://api.deepseek.com",
      "api_key": "<YOUR_API_KEY>",
      "model": "deepseek-chat"
    }
  }'
```

#### Python

```python
sf_post("/api/v1/story/commit", {
    "workspace_dir": workspace_dir,
    "project_id": project_id,
    "chapter_id": "ch01",
    "event_text": "林澈在旧相册里发现童年空白照片。",
    "force": True,
    "model_config": {
        "api_url": "https://api.deepseek.com",
        "api_key": "<YOUR_API_KEY>",
        "model": "deepseek-chat",
    },
})
```

### `POST /api/v1/story/ci`

运行叙事 CI（`scope=all|commit`）。

#### curl

```bash
curl -X POST http://127.0.0.1:3210/api/v1/story/ci \
  -H "Content-Type: application/json" \
  -d '{
    "workspace_dir": "<workspace_dir>",
    "project_id": "<project_id>",
    "scope": "all"
  }'
```

#### Python

```python
sf_post("/api/v1/story/ci", {
    "workspace_dir": workspace_dir,
    "project_id": project_id,
    "scope": "all",
})
```

### `POST /api/v1/story/render`

渲染章节（`chapter_range` 或 `chapter_ids`）。

#### curl

```bash
curl -X POST http://127.0.0.1:3210/api/v1/story/render \
  -H "Content-Type: application/json" \
  -d '{
    "workspace_dir": "<workspace_dir>",
    "project_id": "<project_id>",
    "chapter_range": "all",
    "force": true,
    "model_config": {
      "api_url": "https://api.deepseek.com",
      "api_key": "<YOUR_API_KEY>",
      "model": "deepseek-chat"
    }
  }'
```

#### Python

```python
sf_post("/api/v1/story/render", {
    "workspace_dir": workspace_dir,
    "project_id": project_id,
    "chapter_range": "all",
    "force": True,
    "model_config": {
        "api_url": "https://api.deepseek.com",
        "api_key": "<YOUR_API_KEY>",
        "model": "deepseek-chat",
    },
})
```

### `POST /api/v1/story/compile`

编译章节为整本稿件。

#### curl

```bash
curl -X POST http://127.0.0.1:3210/api/v1/story/compile \
  -H "Content-Type: application/json" \
  -d '{
    "workspace_dir": "<workspace_dir>",
    "project_id": "<project_id>",
    "chapter_range": "all",
    "output_path": "final-story.md"
  }'
```

#### Python

```python
compile_data = sf_post("/api/v1/story/compile", {
    "workspace_dir": workspace_dir,
    "project_id": project_id,
    "chapter_range": "all",
    "output_path": "final-story.md",
})
print("compiled to:", compile_data["output_path"])
```

### 分步流程 Python 完整脚本

```bash
pip install httpx
export DEEPSEEK_API_KEY="<YOUR_API_KEY>"
python3 docs/examples/storyforge_api_step_workflow.py
```

脚本路径：

- `docs/examples/storyforge_api_step_workflow.py`

## 常见错误码

- `4001`：参数校验失败
- `4002`：请求体过大
- `4003`：JSON 解析失败
- `4007`：`task_id` URL 编码非法
- `4290`：异步任务容量已满
- `4291`：异步队列已满
- `4990`：任务被中止（客户端断开或 watchdog 超时）
- `4040`：项目不存在
- `4041`：任务不存在
- `5000/5001`：内部错误

## 输出产物

默认输出根目录：

```text
<current-working-directory>/generated-novels
```

常见产物：

- `.storyforge/projects/<project_id>.json`
- `.storyforge/chapters/chNN.md`
- `manuscript.md` 或自定义输出路径
- `run-summary.json`（一键流程摘要）

## 安全建议

- 不要把真实 API key 提交到仓库。
- 通过环境变量或密钥系统动态注入 key。
- 避免日志输出明文 key。
- 大规模压测时建议调优异步并发/队列/超时参数。
