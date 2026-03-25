import { afterEach, describe, expect, it, vi } from "vitest";

const providerApiMock = vi.hoisted(() => ({
  getProviderApiKey: vi.fn(() => "provider-test-key"),
  getProviderCompletionUrl: vi.fn(() => "https://provider.test.local/v1/chat/completions"),
  getModelProvider: vi.fn((model: string) => model.split("/")[0] || null),
  stripProviderPrefix: vi.fn((model: string) => model.includes("/") ? model.slice(model.indexOf("/") + 1) : model)
}));

const sessionConfigMock = vi.hoisted(() => ({
  loadSessionConfig: vi.fn(() => ({})),
  getDefaultSessionConfigPath: vi.fn(() => "/tmp/storyforge-test-config.json")
}));

vi.mock("../packages/cli/src/utils/provider-api.js", () => ({
  getProviderApiKey: providerApiMock.getProviderApiKey,
  getProviderCompletionUrl: providerApiMock.getProviderCompletionUrl,
  getModelProvider: providerApiMock.getModelProvider,
  stripProviderPrefix: providerApiMock.stripProviderPrefix
}));

vi.mock("../packages/cli/src/utils/session-config.js", () => ({
  loadSessionConfig: sessionConfigMock.loadSessionConfig,
  getDefaultSessionConfigPath: sessionConfigMock.getDefaultSessionConfigPath
}));

vi.mock("../packages/cli/src/utils/openai-oauth-runtime.js", () => ({
  resolveOpenAIOauthRuntimeContext: () => null
}));

import { startDirectStream } from "../packages/cli/src/utils/direct-stream.js";

const COMPLETION_URL = "https://provider.test.local/v1/chat/completions";
const TAVILY_URL = "https://api.tavily.com/search";

function createStreamingCompletionResponse(text: string): Response {
  const payload =
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n` +
    "data: [DONE]\n\n";
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

function parseRequestJsonBody(body: BodyInit | null | undefined): Record<string, unknown> {
  if (typeof body !== "string") {
    throw new Error("Expected JSON body string.");
  }

  return JSON.parse(body) as Record<string, unknown>;
}

describe("direct stream proactive web search fallback", () => {
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

  it("injects search context for realtime prompts even without tool calls", async () => {
    process.env.TAVILY_API_KEY = "test-tavily-key";

    globalThis.fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === TAVILY_URL) {
        return new Response(
          JSON.stringify({
            answer: "MSFT is trading around 430 USD.",
            results: []
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      if (url !== COMPLETION_URL) {
        throw new Error(`Unexpected URL: ${url}`);
      }

      const requestBody = parseRequestJsonBody(init?.body);
      const messages = requestBody.messages as Array<{ role: string; content: string }>;
      const latestUserMessage = messages[messages.length - 1];

      expect(latestUserMessage?.role).toBe("user");
      expect(latestUserMessage?.content).toContain("[[WEB_SEARCH_CONTEXT]]");
      expect(latestUserMessage?.content).toContain("MSFT is trading around 430 USD.");

      return createStreamingCompletionResponse("微软当前股价约 430 美元。");
    }) as typeof fetch;

    const streamedChunks: string[] = [];

    await new Promise<void>((resolve, reject) => {
      startDirectStream({
        model: "deepseek/deepseek-chat",
        prompt: "今天微软股价多少？",
        onText: (chunk) => {
          streamedChunks.push(chunk);
        },
        onError: (message) => {
          reject(new Error(message));
        },
        onComplete: resolve
      });
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(streamedChunks.join("")).toContain("[web search:");
    expect(streamedChunks.join("")).toContain("微软当前股价约 430 美元。");
  });

  it("emits a clear hint when realtime prompt is sent without Tavily key", async () => {
    delete process.env.TAVILY_API_KEY;

    globalThis.fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url !== COMPLETION_URL) {
        throw new Error(`Unexpected URL: ${url}`);
      }

      const requestBody = parseRequestJsonBody(init?.body);
      const messages = requestBody.messages as Array<{ role: string; content: string }>;
      const latestUserMessage = messages[messages.length - 1];

      expect(latestUserMessage?.content).not.toContain("[[WEB_SEARCH_CONTEXT]]");

      return createStreamingCompletionResponse("我当前无法联网。");
    }) as typeof fetch;

    const streamedChunks: string[] = [];

    await new Promise<void>((resolve, reject) => {
      startDirectStream({
        model: "deepseek/deepseek-chat",
        prompt: "今天微软股价多少？",
        onText: (chunk) => {
          streamedChunks.push(chunk);
        },
        onError: (message) => {
          reject(new Error(message));
        },
        onComplete: resolve
      });
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(streamedChunks.join("")).toContain("[web search unavailable: missing Tavily API key");
  });

  it("returns local date/time immediately for date-only prompts", async () => {
    delete process.env.TAVILY_API_KEY;
    globalThis.fetch = vi.fn(async () => {
      throw new Error("fetch should not be called for local date/time fallback");
    }) as typeof fetch;

    const streamedChunks: string[] = [];

    await new Promise<void>((resolve, reject) => {
      startDirectStream({
        model: "openrouter/stepfun/step-3.5-flash:free",
        prompt: "今天是几号",
        onText: (chunk) => {
          streamedChunks.push(chunk);
        },
        onError: (message) => {
          reject(new Error(message));
        },
        onComplete: resolve
      });
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(streamedChunks.join("")).toContain("当前本地时间");
  });
});
