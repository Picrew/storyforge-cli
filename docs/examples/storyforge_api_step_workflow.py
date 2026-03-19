#!/usr/bin/env python3
"""Storyforge API step-by-step workflow example.

Run:
  pip install httpx
  export DEEPSEEK_API_KEY="<your-key>"
  python3 docs/examples/storyforge_api_step_workflow.py
"""

from __future__ import annotations

import json
import os
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


def require_key() -> None:
    if PROVIDER_KEY:
        return
    raise RuntimeError("Missing DEEPSEEK_API_KEY. Please export it first.")


def model_config() -> dict[str, Any]:
    return {
        "api_url": PROVIDER_URL,
        "api_key": PROVIDER_KEY,
        "model": PROVIDER_MODEL,
        "timeout_ms": 240_000,
    }


def extract_data(body: dict[str, Any], path: str) -> dict[str, Any]:
    code = body.get("code")
    msg = body.get("msg")
    if code != 0:
        raise RuntimeError(f"{path} failed: code={code}, msg={msg}")

    data = body.get("data")
    if not isinstance(data, dict):
        raise RuntimeError(f"{path} returned invalid data field")

    return data


def sf_post(client: httpx.Client, path: str, payload: dict[str, Any]) -> dict[str, Any]:
    response = client.post(path, json=payload)
    response.raise_for_status()
    body = response.json()
    if not isinstance(body, dict):
        raise RuntimeError(f"{path} returned invalid JSON object")
    return extract_data(body, path)


def main() -> None:
    require_key()
    Path(OUTPUT_ROOT).mkdir(parents=True, exist_ok=True)

    with httpx.Client(base_url=BASE_URL, timeout=300.0) as client:
        health = client.get("/api/v1/health")
        health.raise_for_status()

        init_data = sf_post(
            client,
            "/api/v1/story/init",
            {
                "title": "Python Step Workflow Story",
                "output_root": OUTPUT_ROOT,
                "prompt": "写一部4章中文科幻悬疑小说，主角是记忆修复师林澈。",
                "model_config": model_config(),
            },
        )

        workspace_dir = init_data["workspace_dir"]
        project_id = init_data["project_id"]

        sf_post(
            client,
            "/api/v1/story/edit",
            {
                "workspace_dir": workspace_dir,
                "project_id": project_id,
                "table": "world",
                "action": "set",
                "field": "setting",
                "value": "Near-future Shanghai",
            },
        )

        sf_post(
            client,
            "/api/v1/story/commit",
            {
                "workspace_dir": workspace_dir,
                "project_id": project_id,
                "chapter_id": "ch01",
                "event_text": "林澈在旧相册里发现童年空白照片，并决定追查来源。",
                "force": True,
                "model_config": model_config(),
            },
        )

        ci_data = sf_post(
            client,
            "/api/v1/story/ci",
            {
                "workspace_dir": workspace_dir,
                "project_id": project_id,
                "scope": "all",
            },
        )

        render_data = sf_post(
            client,
            "/api/v1/story/render",
            {
                "workspace_dir": workspace_dir,
                "project_id": project_id,
                "chapter_range": "all",
                "force": True,
                "model_config": model_config(),
            },
        )

        compile_data = sf_post(
            client,
            "/api/v1/story/compile",
            {
                "workspace_dir": workspace_dir,
                "project_id": project_id,
                "chapter_range": "all",
                "output_path": "final-story.md",
            },
        )

    result = {
        "workspace_dir": workspace_dir,
        "project_id": project_id,
        "ci": ci_data,
        "render": render_data,
        "compile": compile_data,
    }

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
