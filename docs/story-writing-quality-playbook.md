# Story Writing Quality Playbook

This playbook captures high-yield fiction quality rules adapted from the `seek-writer` pipeline and now applied to `storyforge`.

## Why this exists

`storyforge` previously focused on structural generation (world/characters/timeline/outline + render).
Quality regressions mostly came from:

- weak chapter openings
- inconsistent chapter-to-chapter continuity
- generic AI-flavor phrasing
- mixed-language noise in Chinese output
- heading/format drift in chapter files

## Prompt rules now emphasized

- Start with momentum, not warm-up exposition.
- Avoid weak openings:
  - weather-only opening
  - waking-up routine
  - mirror self-description
  - neutral commute scene
- Use scene-level flow: Goal -> Conflict -> Outcome.
- Keep “show, don’t tell” as default transformation.
- Avoid AI-flavor transitions:
  - `Meanwhile`
  - `Suddenly`
  - `In that moment`
  - `Little did they know`
- Avoid repetitive sentence starts and repetitive rhythm.
- End chapter with forward momentum (question, reveal, threat, or hard choice).
- Keep language purity:
  - Chinese output should remain natural Chinese unless proper nouns require otherwise.

## Continuity strategy

- Render prompt now includes previous chapter context:
  - previous chapter id/title
  - previous chapter summary (plan/timeline/commits)
  - previous chapter ending excerpt (tail anchor)
- If previous tail exists, new chapter should begin as an immediate next beat.

## Post-render cleanup

- Strip markdown code fences if the model wraps output.
- Strip accidental leading chapter headings (`#`, `Chapter 1`, `第一章`, etc.).

## Practical usage notes

- For strongest continuity, render chapters in natural chapter order.
- If quality matters more than speed, prefer lower render concurrency.
- Keep chapter target words explicit in outline when possible.
