# Bash Workflow And Architecture (3-Novel Run)

This document focuses on the command-line batch pipeline used by `test-3novels.ts`.

## Feature Map

| Capability | CLI Command / Script | Core Module | Output |
| --- | --- | --- | --- |
| Initialize story project and bootstrap tables | `/init` (interactive) or `runStoryTask` in `test-3novels.ts` | `packages/cli/src/story/bootstrap.ts` | `world`, `characters`, `timeline`, `outline` in project state |
| Event-to-state patching | `/commit --chapter chNN <event>` | `packages/cli/src/story/simulation.ts` + `packages/cli/story_agent.py` | Updated world-state + commit history |
| Deterministic CI checks | `/ci run` | `packages/cli/src/story/simulation.ts` + `packages/cli/story_agent.py` | CI report (`ciHistory`) |
| Chapter rendering | `/render` or `renderStoryChapters` in `test-3novels.ts` | `packages/cli/src/story/simulation.ts` | `.storyforge/chapters/chNN.md` |
| Manuscript compilation | `/compile` or `compileStoryChapters` in `test-3novels.ts` | `packages/cli/src/story/simulation.ts` | `.storyforge/manuscript/story.md` or custom output |
| Batch 3-novel generation | `pnpm exec tsx test-3novels.ts` | `test-3novels.ts` | `generated-novels/<timestamp>/...` |

## Current Serial Flow (Before Optimization)

```mermaid
flowchart TD
    A["bash: pnpm exec tsx test-3novels.ts"] --> B["Load ~/.storyforge/config.json<br/>Sync credential"]
    B --> C["Novel loop (serial): Novel1 -> Novel2 -> Novel3"]
    C --> D["Bootstrap (serial): foundation -> characters -> timeline -> outline"]
    D --> E["Commit loop (serial by event/chapter)"]
    E --> F["Run CI"]
    F --> G["Render chapters (serial by chapter)"]
    G --> H["Compile manuscript + copy project/chapter artifacts"]
    H --> I["Write summary.json"]
```

## Optimized Flow (Now Implemented)

```mermaid
flowchart TD
    A["bash: pnpm exec tsx test-3novels.ts"] --> B["Load config + sync credential"]
    B --> C["Novel worker pool<br/>(STORYFORGE_NOVEL_CONCURRENCY)"]

    C --> N1["Novel pipeline #1"]
    C --> N2["Novel pipeline #2"]
    C --> N3["Novel pipeline #3"]

    subgraph NP["Per-Novel Pipeline"]
      P1["Bootstrap (serial stages)"] --> P2["Commit events (serial)"]
      P2 --> P3["Run CI"]
      P3 --> P4["Render chapter pool<br/>(maxConcurrency = STORYFORGE_RENDER_CONCURRENCY)"]
      P4 --> P5["Compile + export artifacts"]
    end

    N1 --> NP
    N2 --> NP
    N3 --> NP

    MG["Global model-call limiter<br/>(STORYFORGE_MODEL_CONCURRENCY)"] -. controls .-> P1
    MG -. controls .-> P2
    MG -. controls .-> P4

    NP --> S["Write ordered summary.json"]
```

## Bash Knobs

Use these environment variables to tune throughput safely:

```bash
STORYFORGE_NOVEL_CONCURRENCY=2 \
STORYFORGE_MODEL_CONCURRENCY=2 \
STORYFORGE_RENDER_CONCURRENCY=2 \
pnpm exec tsx test-3novels.ts
```

Practical defaults:

- `STORYFORGE_NOVEL_CONCURRENCY=2`: two novels in flight.
- `STORYFORGE_MODEL_CONCURRENCY=2`: global guardrail for model calls.
- `STORYFORGE_RENDER_CONCURRENCY=2`: per-novel chapter render parallelism.

If your provider starts rate-limiting or timing out, lower `STORYFORGE_MODEL_CONCURRENCY` first.
