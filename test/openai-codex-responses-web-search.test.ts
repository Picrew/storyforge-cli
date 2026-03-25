import { afterEach, describe, expect, it, vi } from "vitest";
import { streamOpenAICodexResponse } from "../packages/cli/src/utils/openai-codex-responses.js";

const CODEX_URL = "https://chatgpt.com/backend-api/codex/responses";
const TAVILY_URL = "https://api.tavily.com/search";

function createSseResponse(events: readonly Record<string, unknown>[]): Response {
  const payload = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    }
  });

  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" }
  });
}

function parseJsonBody(body: BodyInit | null | undefined): Record<string, unknown> {
  if (typeof body !== "string") {
    throw new Error("Expected request body to be a JSON string.");
  }

  return JSON.parse(body) as Record<string, unknown>;
}

describe("openai codex responses web-search tool", () => {
  const originalFetch = globalThis.fetch;
  const originalTavilyEnv = process.env.TAVILY_API_KEY;

  afterEach(() => {
    globalThis.fetch = originalFetch;

    if (originalTavilyEnv === undefined) {
      delete process.env.TAVILY_API_KEY;
    } else {
      process.env.TAVILY_API_KEY = originalTavilyEnv;
    }
  });

  it("uses function tool schema (not web_search_preview) when Tavily key exists", async () => {
    process.env.TAVILY_API_KEY = "test-tavily-key";

    globalThis.fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url !== CODEX_URL) {
        throw new Error(`Unexpected URL: ${url}`);
      }

      const body = parseJsonBody(init?.body);
      const tools = body.tools as Array<Record<string, unknown>> | undefined;

      expect(tools).toHaveLength(1);
      expect(tools?.[0]?.type).toBe("function");
      expect(tools?.[0]?.name).toBe("web_search");
      expect(JSON.stringify(tools)).not.toContain("web_search_preview");

      return createSseResponse([
        {
          type: "response.output_text.delta",
          delta: "ok"
        }
      ]);
    }) as typeof fetch;

    const output = await streamOpenAICodexResponse({
      accessToken: "token",
      model: "gpt-5.4-mini",
      prompt: "test prompt"
    });

    expect(output).toContain("ok");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("feeds function call output back to codex after Tavily search", async () => {
    process.env.TAVILY_API_KEY = "test-tavily-key";

    let codexCallCount = 0;

    globalThis.fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === TAVILY_URL) {
        return new Response(
          JSON.stringify({
            answer: "Microsoft stock is up.",
            results: []
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      if (url !== CODEX_URL) {
        throw new Error(`Unexpected URL: ${url}`);
      }

      const body = parseJsonBody(init?.body);

      if (codexCallCount === 0) {
        codexCallCount += 1;

        return createSseResponse([
          {
            type: "response.output_item.done",
            item: {
              type: "function_call",
              call_id: "call_1",
              name: "web_search",
              arguments: JSON.stringify({ query: "microsoft stock price" })
            }
          }
        ]);
      }

      const inputItems = body.input as Array<Record<string, unknown>>;
      const toolOutput = inputItems.find(
        (item) =>
          item.type === "function_call_output" &&
          item.call_id === "call_1" &&
          typeof item.output === "string"
      );

      expect(toolOutput).toBeDefined();
      expect(String(toolOutput?.output)).toContain("Summary: Microsoft stock is up.");

      return createSseResponse([
        {
          type: "response.output_text.delta",
          delta: "final answer"
        }
      ]);
    }) as typeof fetch;

    const output = await streamOpenAICodexResponse({
      accessToken: "token",
      model: "gpt-5.4-mini",
      prompt: "Please look up Microsoft fundamentals"
    });

    expect(output).toContain("[web search: \"microsoft stock price\"]");
    expect(output).toContain("final answer");
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });
});
