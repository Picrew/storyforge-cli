#!/usr/bin/env python3
"""Storyforge parallel novel generation flow test.

Submits 2 novel async runs concurrently and polls until completion.
Uses the default model from global config (openrouter/stepfun/step-3.5-flash:free).
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

BASE_URL = "http://127.0.0.1:3210"
OUTPUT_ROOT = "/Users/lijunjie/Downloads/storyforge/generated-novels"

# Use OpenRouter with the default model from ~/.storyforge/config.json
PROVIDER_URL = "https://openrouter.ai/api/v1"
PROVIDER_MODEL = "stepfun/step-3.5-flash:free"
PROVIDER_KEY = os.environ.get("OPENROUTER_API_KEY", "")

POLL_INTERVAL_SEC = 5
TASK_TIMEOUT_SEC = 3600  # 60 minutes max

# ─── Novel Prompts ───────────────────────────────────────────────────────────

NOVEL_1_PROMPT = """写一部8章中文赛博朋克科幻小说，标题为"量子镜像"。

【世界观】2089年，新上海。量子计算已经突破极限，人类发现每一个重大决策都会产生一个"镜像现实"。一家名为"镜渊科技"的巨型企业掌控着量子桥接技术，能够窥探甚至干预平行现实。城市分为地上的"光域"和地下的"暗层"两个世界。

【主角】苏晗，35岁，前镜渊科技首席量子物理学家。三年前目睹一次实验事故后辞职，但事故真相被公司掩盖。她发现事故中死去的同事在另一个平行现实中还活着——并且正在执行一个可能毁灭两个现实的计划。

【核心冲突】苏晗必须穿越量子镜像，在两个现实之间寻找真相。每次穿越都会消耗她的"量子锚定"——一种让意识保持稳定的机制。她必须在意识彻底崩溃之前阻止灾难。

【要求】
- 共8章，每章约8000字（总计约64000字）
- 第1章：苏晗在暗层生活的日常被打破，发现已死同事的量子信号
- 第2章：重返镜渊科技调查，发现公司的量子桥接实验远比公开的更深入
- 第3章：第一次穿越镜像现实，发现镜像世界的巨大差异
- 第4章：在镜像世界遇到"已死"同事，发现他们的计划
- 第5章：回到原始现实，发现镜渊科技已经察觉她的行动
- 第6章：被迫在两个现实间周旋，量子锚定开始不稳定
- 第7章：最终对决，揭示实验事故的真正原因和公司的终极目的
- 第8章：高潮与结局，两个现实的命运抉择
- 每章要有独立的悬念和情节推进
- 风格硬核科幻，注重科学细节和人物心理
- 伏笔要前后呼应，逻辑自洽"""

NOVEL_2_PROMPT = """写一部7章中文历史悬疑小说，标题为"敦煌秘卷"。

【世界观】双时间线叙事——唐代天宝年间（公元750年前后）与2026年现代。故事围绕敦煌莫高窟中一个从未被发现的秘密洞窟展开，窟内藏有一卷用密码写成的经卷，记载了一个跨越1300年的惊天秘密。

【主角·现代线】陆鸣，32岁，敦煌研究院青年考古学家。性格内敛但执着。在一次例行修复工作中，意外发现壁画后隐藏的暗室和神秘经卷。经卷使用了一种从未见过的加密体系。

【主角·唐代线】张遂，莫高窟画师学徒，后成为密卷的守护者。他亲历了安史之乱前夕的一场政治阴谋，将真相编码藏入壁画和经卷中。

【核心冲突】现代线中，陆鸣的发现引来多方势力觊觎——学术对手、文物走私集团、甚至某个延续千年的神秘组织。唐代线中，张遂为保护秘密付出巨大代价。两条线在第6章汇合，揭示经卷中的终极真相。

【要求】
- 共7章，每章约8000字（总计约56000字）
- 第1章【现代】：陆鸣发现秘密洞窟和密卷，初步破译发现线索指向唐代
- 第2章【唐代】：张遂在莫高窟学艺，卷入宫廷秘密
- 第3章【现代】：陆鸣的发现泄露，各方势力开始介入
- 第4章【唐代】：安史之乱前夕，张遂决定将真相编码
- 第5章【现代】：陆鸣被迫独自追查，在敦煌周边发现更多线索
- 第6章【双线交汇】：陆鸣完全破译密卷，唐代真相完整呈现
- 第7章【终章】：真相大白，但陆鸣面临公布或守密的两难抉择
- 双时间线叙事要节奏紧凑，唐代线和现代线互相映照
- 考古细节和历史背景要考究真实
- 悬念层层递进，每章结尾有钩子引向下一章"""


@dataclass
class NovelResult:
    novel_id: str
    title: str
    success: bool
    wall_clock_sec: float
    task_id: str | None = None
    workspace_dir: str | None = None
    manuscript_path: str | None = None
    llm_calls: int | None = None
    chapter_count: int | None = None
    error: str | None = None
    stages: list[str] = field(default_factory=list)
    ci_passed: bool | None = None
    ci_errors: int | None = None
    ci_warnings: int | None = None
    commit_total: int | None = None
    commit_succeeded: int | None = None
    commit_failed: int | None = None
    rendered_chapters: list[str] | None = None
    compiled_chapters: list[str] | None = None
    missing_chapters: list[str] | None = None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def submit_novel(client: httpx.AsyncClient, novel_id: str, title: str, prompt: str) -> str:
    """Submit async run and return task_id."""
    body = {
        "mode": "async",
        "output_root": OUTPUT_ROOT,
        "title": title,
        "prompt": prompt,
        "model_config": {
            "api_url": PROVIDER_URL,
            "api_key": PROVIDER_KEY,
            "model": PROVIDER_MODEL,
            "timeout_ms": 300_000,
        },
        "render": {"chapter_range": "all", "force": True},
    }

    print(f"[{novel_id}] Submitting async run for '{title}'...")
    response = await client.post("/api/v1/story/run", json=body)
    payload = response.json()

    if payload.get("code") != 0:
        raise RuntimeError(f"Submit failed: code={payload.get('code')}, msg={payload.get('msg')}")

    task_id = payload["data"]["task_id"]
    status = payload["data"]["status"]
    print(f"[{novel_id}] Task submitted: {task_id} (status={status})")
    return task_id


async def poll_task(client: httpx.AsyncClient, novel_id: str, task_id: str) -> dict[str, Any]:
    """Poll until task reaches terminal state."""
    start = time.perf_counter()
    last_stage = ""

    while True:
        elapsed = time.perf_counter() - start
        if elapsed > TASK_TIMEOUT_SEC:
            raise TimeoutError(f"Task {task_id} timed out after {TASK_TIMEOUT_SEC}s")

        response = await client.get(f"/api/v1/tasks/{task_id}")
        payload = response.json()

        if payload.get("code") != 0:
            raise RuntimeError(f"Poll failed: {payload.get('msg')}")

        data = payload["data"]
        status = data.get("status", "")
        progress = data.get("progress") or {}
        stage = progress.get("stage", "")
        message = progress.get("message", "")

        if stage != last_stage:
            print(f"[{novel_id}] [{elapsed:.0f}s] stage={stage}: {message}")
            last_stage = stage

        if status in ("succeeded", "failed"):
            return data

        await asyncio.sleep(POLL_INTERVAL_SEC)


async def run_novel(
    client: httpx.AsyncClient,
    novel_id: str,
    title: str,
    prompt: str,
) -> NovelResult:
    """Full lifecycle: submit -> poll -> collect result."""
    started = time.perf_counter()

    try:
        task_id = await submit_novel(client, novel_id, title, prompt)
        terminal = await poll_task(client, novel_id, task_id)
        wall_clock_sec = time.perf_counter() - started

        if terminal.get("status") == "succeeded":
            result = terminal.get("result", {})
            metrics = result.get("metrics", {})
            ci = result.get("ci", {})
            commits = result.get("commits", {})
            render = result.get("render", {})
            compile_info = result.get("compile", {})

            return NovelResult(
                novel_id=novel_id,
                title=title,
                success=True,
                wall_clock_sec=wall_clock_sec,
                task_id=task_id,
                workspace_dir=result.get("workspace_dir"),
                manuscript_path=result.get("manuscript_path"),
                llm_calls=metrics.get("llm_calls"),
                chapter_count=len(render.get("chapter_ids", [])),
                ci_passed=ci.get("passed"),
                ci_errors=ci.get("errors"),
                ci_warnings=ci.get("warnings"),
                commit_total=commits.get("total"),
                commit_succeeded=commits.get("succeeded"),
                commit_failed=commits.get("failed"),
                rendered_chapters=render.get("rendered"),
                compiled_chapters=compile_info.get("compiled_chapters"),
                missing_chapters=compile_info.get("missing_chapters"),
            )
        else:
            return NovelResult(
                novel_id=novel_id,
                title=title,
                success=False,
                wall_clock_sec=wall_clock_sec,
                task_id=task_id,
                error=terminal.get("error", "Task failed with no error message"),
            )
    except Exception as exc:
        wall_clock_sec = time.perf_counter() - started
        return NovelResult(
            novel_id=novel_id,
            title=title,
            success=False,
            wall_clock_sec=wall_clock_sec,
            error=str(exc),
        )


def print_result(r: NovelResult) -> None:
    """Pretty print one novel result."""
    status = "SUCCESS" if r.success else "FAILED"
    print(f"\n{'='*70}")
    print(f"[{r.novel_id}] {r.title} — {status}")
    print(f"{'='*70}")
    print(f"  Wall clock:        {r.wall_clock_sec:.1f}s ({r.wall_clock_sec/60:.1f}min)")
    print(f"  Task ID:           {r.task_id or 'N/A'}")
    print(f"  Workspace:         {r.workspace_dir or 'N/A'}")
    print(f"  Manuscript:        {r.manuscript_path or 'N/A'}")
    print(f"  LLM calls:        {r.llm_calls or 'N/A'}")
    print(f"  Chapter count:     {r.chapter_count or 'N/A'}")
    print(f"  CI passed:         {r.ci_passed}")
    print(f"  CI errors/warns:   {r.ci_errors}/{r.ci_warnings}")
    print(f"  Commits:           {r.commit_succeeded}/{r.commit_total} succeeded")
    if r.commit_failed and r.commit_failed > 0:
        print(f"  Commit failures:   {r.commit_failed}")
    print(f"  Rendered chapters: {r.rendered_chapters or 'N/A'}")
    print(f"  Compiled chapters: {r.compiled_chapters or 'N/A'}")
    if r.missing_chapters:
        print(f"  Missing chapters:  {r.missing_chapters}")
    if r.error:
        print(f"  Error:             {r.error[:500]}")
    print()


def git_auto_commit(results: list[NovelResult]) -> str | None:
    """Auto commit generated novels to git."""
    os.chdir("/Users/lijunjie/Downloads/storyforge")

    # Check for new files in generated-novels
    status = subprocess.run(
        ["git", "status", "--porcelain", "generated-novels/"],
        capture_output=True, text=True
    )

    if not status.stdout.strip():
        print("[git] No new files to commit")
        return None

    print(f"[git] New files detected:\n{status.stdout.strip()}")

    # Stage generated novels
    subprocess.run(["git", "add", "generated-novels/"], check=True)

    # Build commit message
    titles = [r.title for r in results if r.success]
    chapters = sum(r.chapter_count or 0 for r in results if r.success)
    msg = (
        f"test: parallel novel generation flow test\n\n"
        f"Generated {len(titles)} novel(s) in parallel:\n"
        + "\n".join(f"  - {t}" for t in titles)
        + f"\n\nTotal chapters: {chapters}\n"
        f"Total wall clock: {sum(r.wall_clock_sec for r in results):.0f}s\n\n"
        f"Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
    )

    result = subprocess.run(
        ["git", "commit", "-m", msg],
        capture_output=True, text=True
    )

    if result.returncode == 0:
        print(f"[git] Committed successfully")
        # Get the commit hash
        hash_result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True
        )
        return hash_result.stdout.strip()
    else:
        print(f"[git] Commit failed: {result.stderr}")
        return None


async def main() -> None:
    print("=" * 70)
    print("Storyforge Parallel Novel Generation Flow Test")
    print(f"Time: {now_iso()}")
    print(f"Model: {PROVIDER_MODEL}")
    print(f"Output: {OUTPUT_ROOT}")
    print("=" * 70)

    # Verify API health
    timeout = httpx.Timeout(connect=30.0, read=60.0, write=30.0, pool=30.0)
    limits = httpx.Limits(max_connections=20, max_keepalive_connections=10)

    async with httpx.AsyncClient(base_url=BASE_URL, timeout=timeout, limits=limits) as client:
        health = await client.get("/api/v1/health")
        if health.status_code != 200:
            print(f"API server not healthy: HTTP {health.status_code}")
            sys.exit(1)
        print("[health] API server OK\n")

        # Launch both novels concurrently
        novels = [
            ("novel-1-quantum", "量子镜像", NOVEL_1_PROMPT),
            ("novel-2-dunhuang", "敦煌秘卷", NOVEL_2_PROMPT),
        ]

        tasks = [run_novel(client, nid, title, prompt) for nid, title, prompt in novels]
        results: list[NovelResult] = await asyncio.gather(*tasks)

    # Print results
    print("\n" + "=" * 70)
    print("RESULTS SUMMARY")
    print("=" * 70)

    for r in results:
        print_result(r)

    # Overall stats
    successes = [r for r in results if r.success]
    failures = [r for r in results if not r.success]
    total_time = max(r.wall_clock_sec for r in results)  # parallel so max
    total_llm = sum(r.llm_calls or 0 for r in results)
    total_chapters = sum(r.chapter_count or 0 for r in results)

    print(f"Overall: {len(successes)} succeeded, {len(failures)} failed")
    print(f"Parallel wall clock: {total_time:.1f}s ({total_time/60:.1f}min)")
    print(f"Total LLM calls: {total_llm}")
    print(f"Total chapters generated: {total_chapters}")

    # Check manuscript word counts if available
    for r in results:
        if r.success and r.manuscript_path and Path(r.manuscript_path).exists():
            text = Path(r.manuscript_path).read_text(encoding="utf-8")
            # Count Chinese characters + English words
            import re
            chinese_chars = len(re.findall(r'[\u4e00-\u9fff]', text))
            english_words = len(re.findall(r'[a-zA-Z]+', text))
            total_chars = chinese_chars + english_words
            print(f"\n[{r.novel_id}] Manuscript stats:")
            print(f"  Chinese characters: {chinese_chars}")
            print(f"  English words: {english_words}")
            print(f"  Total file size: {len(text)} bytes")

    # Write test report
    report_path = Path(OUTPUT_ROOT) / f"flow-test-report-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    report = {
        "test_time": now_iso(),
        "model": PROVIDER_MODEL,
        "provider_url": PROVIDER_URL,
        "novels": [
            {
                "novel_id": r.novel_id,
                "title": r.title,
                "success": r.success,
                "wall_clock_sec": round(r.wall_clock_sec, 1),
                "task_id": r.task_id,
                "workspace_dir": r.workspace_dir,
                "manuscript_path": r.manuscript_path,
                "llm_calls": r.llm_calls,
                "chapter_count": r.chapter_count,
                "ci_passed": r.ci_passed,
                "ci_errors": r.ci_errors,
                "ci_warnings": r.ci_warnings,
                "commit_total": r.commit_total,
                "commit_succeeded": r.commit_succeeded,
                "commit_failed": r.commit_failed,
                "rendered_chapters": r.rendered_chapters,
                "compiled_chapters": r.compiled_chapters,
                "missing_chapters": r.missing_chapters,
                "error": r.error,
            }
            for r in results
        ],
        "summary": {
            "total_novels": len(results),
            "succeeded": len(successes),
            "failed": len(failures),
            "parallel_wall_clock_sec": round(total_time, 1),
            "total_llm_calls": total_llm,
            "total_chapters": total_chapters,
        },
    }

    Path(OUTPUT_ROOT).mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\nReport saved: {report_path}")

    # Auto git commit
    print("\n[git] Auto-committing generated novels...")
    commit_hash = git_auto_commit(results)
    if commit_hash:
        print(f"[git] Commit hash: {commit_hash}")

    # Issues found
    print("\n" + "=" * 70)
    print("ISSUES / OBSERVATIONS")
    print("=" * 70)

    issues = []

    for r in results:
        if not r.success:
            issues.append(f"[{r.novel_id}] FAILED: {r.error}")
        else:
            if r.commit_failed and r.commit_failed > 0:
                issues.append(f"[{r.novel_id}] {r.commit_failed} commit(s) failed")
            if r.missing_chapters:
                issues.append(f"[{r.novel_id}] Missing chapters in compile: {r.missing_chapters}")
            if r.ci_errors and r.ci_errors > 0:
                issues.append(f"[{r.novel_id}] CI had {r.ci_errors} error(s)")
            if r.manuscript_path and Path(r.manuscript_path).exists():
                text = Path(r.manuscript_path).read_text(encoding="utf-8")
                import re
                char_count = len(re.findall(r'[\u4e00-\u9fff]', text))
                expected_min = (r.chapter_count or 0) * 5000  # Relaxed expectation
                if char_count < expected_min:
                    issues.append(
                        f"[{r.novel_id}] Manuscript shorter than expected: "
                        f"{char_count} chars vs ~{expected_min} expected minimum"
                    )

    if not issues:
        print("No issues detected!")
    else:
        for issue in issues:
            print(f"  - {issue}")

    print()


if __name__ == "__main__":
    asyncio.run(main())
