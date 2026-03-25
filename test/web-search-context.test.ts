import { describe, expect, it } from "vitest";
import {
  buildLocalDateTimeAnswer,
  buildWebSearchQuery,
  shouldAnswerWithLocalDateTime,
  shouldUseProactiveWebSearch
} from "../packages/cli/src/utils/web-search-context.js";

describe("web search context helpers", () => {
  it("detects realtime market/weather style prompts", () => {
    expect(shouldUseProactiveWebSearch("今天微软股价多少？")).toBe(true);
    expect(shouldUseProactiveWebSearch("What is the latest weather forecast in Shanghai today?")).toBe(true);
  });

  it("skips normal creative prompts", () => {
    expect(shouldUseProactiveWebSearch("请写一个赛博朋克短篇小说开头")).toBe(false);
    expect(shouldUseProactiveWebSearch("Refactor this TypeScript function for readability.")).toBe(false);
  });

  it("limits generated search query length", () => {
    const longPrompt = "x".repeat(500);
    const query = buildWebSearchQuery(longPrompt);
    expect(query.length).toBe(180);
  });

  it("detects date/time prompts for local deterministic fallback", () => {
    expect(shouldAnswerWithLocalDateTime("今天是几号")).toBe(true);
    expect(shouldAnswerWithLocalDateTime("what is today's date?")).toBe(true);
    expect(shouldAnswerWithLocalDateTime("写一个科幻故事开头")).toBe(false);
  });

  it("builds a local date/time answer string", () => {
    const answer = buildLocalDateTimeAnswer(new Date("2026-03-26T12:34:56.000Z"));
    expect(answer).toContain("当前本地时间");
  });
});
