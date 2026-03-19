#!/usr/bin/env python3
"""Storyforge API async batch client.

Usage:
  pip install httpx
  export DEEPSEEK_API_KEY="<your-key>"
  python3 docs/examples/storyforge_api_batch_async.py

Environment variables:
  STORYFORGE_BASE_URL            default: http://127.0.0.1:3210
  STORYFORGE_OUTPUT_ROOT         default: /Users/lijunjie/Downloads/storyforge/generated-novels
  STORYFORGE_PROVIDER_URL        default: https://api.deepseek.com
  STORYFORGE_PROVIDER_MODEL      default: deepseek-chat
  DEEPSEEK_API_KEY               required
  STORYFORGE_MAX_CONCURRENCY     default: 3
  STORYFORGE_POLL_INTERVAL_SEC   default: 2
  STORYFORGE_TASK_TIMEOUT_SEC    default: 1800
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

BASE_URL = os.getenv("STORYFORGE_BASE_URL", "http://127.0.0.1:3210").rstrip("/")
OUTPUT_ROOT = os.getenv(
    "STORYFORGE_OUTPUT_ROOT",
    "/Users/lijunjie/Downloads/storyforge/generated-novels",
)
PROVIDER_URL = os.getenv("STORYFORGE_PROVIDER_URL", "https://api.deepseek.com").rstrip("/")
PROVIDER_MODEL = os.getenv("STORYFORGE_PROVIDER_MODEL", "deepseek-chat")
PROVIDER_KEY = os.getenv("DEEPSEEK_API_KEY", "").strip()
MAX_CONCURRENCY = int(os.getenv("STORYFORGE_MAX_CONCURRENCY", "3"))
POLL_INTERVAL_SEC = float(os.getenv("STORYFORGE_POLL_INTERVAL_SEC", "2"))
TASK_TIMEOUT_SEC = float(os.getenv("STORYFORGE_TASK_TIMEOUT_SEC", "1800"))


PROMPTS = [
    (
        "case-a",
        "写一部4章中文科幻悬疑小说。主角是记忆修复师林澈，在近未来上海调查一连串“被删除的童年”。要求：每章有独立悬念与反转，整体伏笔闭环，结局有道德两难。",
    ),
    (
        "case-b",
        "写一部4章古风武侠小说。主角沈执是被逐出师门的刀客，为查清师门灭门真相踏入江湖。要求：门派纷争、快意恩仇、情义抉择并重，最终揭示“仇人”真实身份。",
    ),
    (
        "case-c",
        "写一部4章都市现实题材小说。主角周岚在互联网大厂裁员潮中重建生活，夹在家庭责任、职业理想与个人情感之间。要求：真实细节、人物成长弧线清晰，结尾克制但有希望。",
    ),
]


@dataclass
class CaseResult:
    case_id: str
    success: bool
    wall_clock_ms: int
    api_elapsed_ms: int | None
    llm_calls: int | None
    chapter_count: int | None
    code: int
    msg: str
    task_id: str | None
    workspace_dir: str | None
    manuscript_path: str | None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def require_key() -> None:
    if PROVIDER_KEY:
        return

    raise RuntimeError("Missing DEEPSEEK_API_KEY. Please export it before running.")


def extract_json(response: httpx.Response) -> dict[str, Any]:
    try:
        payload = response.json()
    except Exception as exc:
        raise RuntimeError(f"Invalid JSON response: HTTP {response.status_code}") from exc

    if not isinstance(payload, dict):
        raise RuntimeError(f"Invalid envelope type: HTTP {response.status_code}")

    return payload


def ensure_ok_envelope(payload: dict[str, Any], context: str) -> dict[str, Any]:
    code = payload.get("code")
    msg = str(payload.get("msg", ""))

    if code != 0:
        raise RuntimeError(f"{context} failed: code={code}, msg={msg}")

    data = payload.get("data")

    if not isinstance(data, dict):
        raise RuntimeError(f"{context} returned invalid data field")

    return data


async def submit_run(client: httpx.AsyncClient, case_id: str, prompt: str) -> str:
    body = {
        "mode": "async",
        "output_root": OUTPUT_ROOT,
        "title": f"Python Batch {case_id}",
        "prompt": prompt,
        "model_config": {
            "api_url": PROVIDER_URL,
            "api_key": PROVIDER_KEY,
            "model": PROVIDER_MODEL,
            "timeout_ms": 240_000,
        },
        "render": {"chapter_range": "all", "force": True},
    }

    response = await client.post("/api/v1/story/run", json=body)
    payload = extract_json(response)
    data = ensure_ok_envelope(payload, f"submit {case_id}")
    task_id = data.get("task_id")

    if not isinstance(task_id, str) or not task_id.strip():
        raise RuntimeError(f"submit {case_id} missing task_id")

    return task_id


async def poll_task(client: httpx.AsyncClient, task_id: str) -> dict[str, Any]:
    start = time.perf_counter()

    while True:
        if time.perf_counter() - start > TASK_TIMEOUT_SEC:
            raise TimeoutError(f"poll task timeout: {task_id}")

        response = await client.get(f"/api/v1/tasks/{task_id}")
        payload = extract_json(response)
        data = ensure_ok_envelope(payload, f"poll {task_id}")
        status = str(data.get("status", ""))

        if status in ("succeeded", "failed"):
            return data

        await asyncio.sleep(POLL_INTERVAL_SEC)


async def run_case(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    case_id: str,
    prompt: str,
) -> CaseResult:
    started = time.perf_counter()

    async with sem:
        try:
            task_id = await submit_run(client, case_id, prompt)
            terminal = await poll_task(client, task_id)
            wall_clock_ms = int((time.perf_counter() - started) * 1000)

            if terminal.get("status") == "succeeded":
                result = terminal.get("result")
                if not isinstance(result, dict):
                    raise RuntimeError("task succeeded but result is missing")

                metrics = result.get("metrics") if isinstance(result.get("metrics"), dict) else {}
                render = result.get("render") if isinstance(result.get("render"), dict) else {}
                chapter_ids = render.get("chapter_ids") if isinstance(render.get("chapter_ids"), list) else []

                return CaseResult(
                    case_id=case_id,
                    success=True,
                    wall_clock_ms=wall_clock_ms,
                    api_elapsed_ms=metrics.get("elapsed_ms") if isinstance(metrics.get("elapsed_ms"), int) else None,
                    llm_calls=metrics.get("llm_calls") if isinstance(metrics.get("llm_calls"), int) else None,
                    chapter_count=len(chapter_ids),
                    code=0,
                    msg="ok",
                    task_id=task_id,
                    workspace_dir=result.get("workspace_dir") if isinstance(result.get("workspace_dir"), str) else None,
                    manuscript_path=result.get("manuscript_path") if isinstance(result.get("manuscript_path"), str) else None,
                )

            return CaseResult(
                case_id=case_id,
                success=False,
                wall_clock_ms=wall_clock_ms,
                api_elapsed_ms=None,
                llm_calls=None,
                chapter_count=None,
                code=-1,
                msg=str(terminal.get("error", "task failed")),
                task_id=task_id,
                workspace_dir=None,
                manuscript_path=None,
            )
        except Exception as exc:
            wall_clock_ms = int((time.perf_counter() - started) * 1000)
            return CaseResult(
                case_id=case_id,
                success=False,
                wall_clock_ms=wall_clock_ms,
                api_elapsed_ms=None,
                llm_calls=None,
                chapter_count=None,
                code=-1,
                msg=str(exc),
                task_id=None,
                workspace_dir=None,
                manuscript_path=None,
            )


def markdown_report(results: list[CaseResult], raw_file: Path) -> str:
    ok_items = [item for item in results if item.success]

    def avg(values: list[int | None]) -> int | None:
        xs = [v for v in values if isinstance(v, int)]
        if not xs:
            return None
        return round(sum(xs) / len(xs))

    lines = [
        "# Storyforge Python Async Batch Report",
        "",
        "| case | success | wall_clock_ms | api_elapsed_ms | llm_calls | chapter_count | code/msg | task_id | workspace_dir |",
        "|---|---|---:|---:|---:|---:|---|---|---|",
    ]

    for item in results:
        lines.append(
            f"| {item.case_id} | {'SUCCESS' if item.success else 'FAILED'} | {item.wall_clock_ms} | "
            f"{item.api_elapsed_ms if item.api_elapsed_ms is not None else 'null'} | "
            f"{item.llm_calls if item.llm_calls is not None else 'null'} | "
            f"{item.chapter_count if item.chapter_count is not None else 'null'} | "
            f"{item.code}/{str(item.msg).replace('|', '/')} | "
            f"{item.task_id or '-'} | {item.workspace_dir or '-'} |"
        )

    lines.extend(
        [
            "",
            f"- total: {len(results)}",
            f"- success: {len(ok_items)}",
            f"- failed: {len(results) - len(ok_items)}",
            f"- avg_wall_clock_ms: {avg([item.wall_clock_ms for item in ok_items])}",
            f"- avg_llm_calls: {avg([item.llm_calls for item in ok_items])}",
            f"- raw_file: {raw_file}",
        ]
    )

    return "\n".join(lines)


async def main() -> None:
    require_key()
    output_root = Path(OUTPUT_ROOT)
    output_root.mkdir(parents=True, exist_ok=True)

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    raw_file = output_root / f"python-batch-raw-{stamp}.json"
    report_file = output_root / f"python-batch-report-{stamp}.md"

    timeout = httpx.Timeout(connect=30.0, read=30.0, write=30.0, pool=30.0)
    limits = httpx.Limits(max_connections=max(20, MAX_CONCURRENCY * 4), max_keepalive_connections=20)
    sem = asyncio.Semaphore(MAX_CONCURRENCY)

    async with httpx.AsyncClient(base_url=BASE_URL, timeout=timeout, limits=limits) as client:
        health = await client.get("/api/v1/health")
        if health.status_code != 200:
            raise RuntimeError(f"API health check failed: HTTP {health.status_code}")

        tasks = [run_case(client, sem, case_id, prompt) for case_id, prompt in PROMPTS]
        results = await asyncio.gather(*tasks)

    payload = {
        "generated_at": now_iso(),
        "base_url": BASE_URL,
        "provider": {
            "api_url": PROVIDER_URL,
            "api_key": "***",
            "model": PROVIDER_MODEL,
        },
        "max_concurrency": MAX_CONCURRENCY,
        "results": [item.__dict__ for item in results],
    }

    raw_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    report_text = markdown_report(results, raw_file)
    report_file.write_text(report_text + "\n", encoding="utf-8")

    print(report_text)
    print(f"\nreport_file: {report_file}")


if __name__ == "__main__":
    asyncio.run(main())
