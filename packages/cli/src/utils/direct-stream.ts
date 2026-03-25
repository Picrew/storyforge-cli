import {
  getProviderApiKey,
  getProviderCompletionUrl,
  getModelProvider,
  stripProviderPrefix
} from "./provider-api.js";
import { streamOpenAICodexResponse } from "./openai-codex-responses.js";
import { resolveOpenAIOauthRuntimeContext } from "./openai-oauth-runtime.js";
import { tavilySearch } from "./tavily-search.js";
import { loadSessionConfig, getDefaultSessionConfigPath } from "./session-config.js";
import {
  buildLocalDateTimeAnswer,
  buildWebSearchQuery,
  injectWebSearchContextIntoPrompt,
  shouldAnswerWithLocalDateTime,
  shouldUseProactiveWebSearch
} from "./web-search-context.js";

export interface DirectStreamCallbacks {
  onText?: (text: string) => void;
  onError?: (message: string) => void;
  onComplete?: () => void;
}

export interface StartDirectStreamOptions extends DirectStreamCallbacks {
  model: string;
  prompt: string;
  history?: readonly { role: "user" | "assistant"; content: string }[];
}

export interface DirectStreamHandle {
  abort: () => void;
}

export function normalizeAssistantText(value: string): string {
  return value
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<\/?think>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildExtraHeaders(providerId: string): Record<string, string> {
  if (providerId === "openrouter") {
    return {
      "HTTP-Referer": "https://storyforge.local",
      "X-Title": "Storyforge CLI"
    };
  }

  return {};
}

/* ------------------------------------------------------------------ */
/*  Web-search tool calling helpers                                    */
/* ------------------------------------------------------------------ */

function getTavilyApiKey(): string | null {
  const envKey = process.env.TAVILY_API_KEY?.trim();

  if (envKey) {
    return envKey;
  }

  const config = loadSessionConfig(getDefaultSessionConfigPath());

  return config.tavilyApiKey ?? null;
}

function buildWebSearchTool(): Record<string, unknown> {
  const today = new Date().toISOString().split("T")[0];

  return {
    type: "function",
    function: {
      name: "web_search",
      description:
        `Search the web for current, real-time information. Today is ${today}. ` +
        "Use this when the user asks about current events, today's date or time, " +
        "latest news, stock prices, weather, sports scores, or any factual " +
        "information that may have changed after your training data cutoff.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query to look up"
          }
        },
        required: ["query"]
      }
    }
  };
}

interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string;
}

interface SseStreamResult {
  toolCalls: AccumulatedToolCall[];
}

/**
 * Read an SSE stream from a Chat-Completions response.
 * Emits text deltas via `onText` and returns any accumulated tool calls.
 */
async function readChatCompletionStream(
  body: ReadableStream<Uint8Array>,
  onText: ((text: string) => void) | undefined
): Promise<SseStreamResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const toolCallMap = new Map<number, AccumulatedToolCall>();
  let buffer = "";

  const processDataLine = (data: string): void => {
    if (data === "[DONE]") {
      return;
    }

    let parsed: {
      choices?: Array<{
        delta?: {
          content?: string;
          reasoning_content?: string;
          tool_calls?: Array<{
            index: number;
            id?: string;
            type?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
        finish_reason?: string | null;
      }>;
      error?: { message?: string };
    };

    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }

    if (parsed.error?.message) {
      throw new Error(parsed.error.message);
    }

    const delta = parsed.choices?.[0]?.delta;

    if (delta?.content) {
      onText?.(delta.content);
    }

    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        let entry = toolCallMap.get(tc.index);

        if (!entry) {
          entry = { id: "", name: "", arguments: "" };
          toolCallMap.set(tc.index, entry);
        }

        if (tc.id) {
          entry.id = tc.id;
        }

        if (tc.function?.name) {
          entry.name = tc.function.name;
        }

        if (tc.function?.arguments) {
          entry.arguments += tc.function.arguments;
        }
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith(":")) {
        continue;
      }

      if (!trimmed.startsWith("data: ")) {
        continue;
      }

      processDataLine(trimmed.slice(6));
    }
  }

  if (buffer.trim()) {
    const trimmed = buffer.trim();

    if (trimmed.startsWith("data: ")) {
      processDataLine(trimmed.slice(6));
    }
  }

  return { toolCalls: [...toolCallMap.values()] };
}

/* ------------------------------------------------------------------ */
/*  Main stream entry point                                            */
/* ------------------------------------------------------------------ */

export function startDirectStream({
  model,
  prompt,
  history,
  onText,
  onError,
  onComplete
}: StartDirectStreamOptions): DirectStreamHandle {
  const abortController = new AbortController();

  const providerId = getModelProvider(model);

  if (!providerId) {
    queueMicrotask(() => {
      onError?.(`Cannot determine provider from model "${model}". Use provider/model format.`);
    });
    return { abort: () => abortController.abort() };
  }

  const trimmedPrompt = prompt.trim();

  if (shouldAnswerWithLocalDateTime(trimmedPrompt)) {
    const localDateTime = buildLocalDateTimeAnswer();

    queueMicrotask(() => {
      onText?.(localDateTime);
      onComplete?.();
    });

    return { abort: () => abortController.abort() };
  }

  const apiKey = getProviderApiKey(providerId);

  if (!apiKey) {
    queueMicrotask(() => {
      onError?.(
        `No API key found for ${providerId}. Run /connect ${providerId} <api-key> first.`
      );
    });
    return { abort: () => abortController.abort() };
  }

  const modelId = stripProviderPrefix(model);

  const historyMessages = (history ?? []).map((msg) => ({
    role: msg.role,
    content: msg.content
  }));
  const openAIOauthRuntime =
    providerId === "openai" ? resolveOpenAIOauthRuntimeContext(apiKey) : null;
  const completionUrl = openAIOauthRuntime ? null : getProviderCompletionUrl(providerId);

  if (!openAIOauthRuntime && !completionUrl) {
    queueMicrotask(() => {
      onError?.(`No API endpoint configured for provider "${providerId}".`);
    });
    return { abort: () => abortController.abort() };
  }

  void (async () => {
    try {
      /* ---------- Codex Responses API path (OpenAI OAuth) ---------- */
      if (openAIOauthRuntime) {
        await streamOpenAICodexResponse({
          accessToken: openAIOauthRuntime.accessToken,
          accountId: openAIOauthRuntime.accountId,
          model: modelId,
          prompt,
          history: historyMessages,
          signal: abortController.signal,
          onText
        });
        onComplete?.();
        return;
      }

      /* ---------- Chat Completions path (all providers) ---------- */
      if (!completionUrl) {
        onError?.(`No API endpoint configured for provider "${providerId}".`);
        return;
      }

      const tavilyApiKey = getTavilyApiKey();
      const extraHeaders = buildExtraHeaders(providerId);
      const webSearchTool = tavilyApiKey ? [buildWebSearchTool()] : undefined;
      let effectivePrompt = trimmedPrompt;
      const shouldSearch = shouldUseProactiveWebSearch(effectivePrompt);

      if (!tavilyApiKey && shouldSearch) {
        onText?.(
          "\n[web search unavailable: missing Tavily API key. Set TAVILY_API_KEY or ~/.storyforge/config.json:tavilyApiKey]\n\n"
        );
      }

      if (tavilyApiKey && shouldSearch) {
        const proactiveQuery = buildWebSearchQuery(effectivePrompt);
        onText?.(`\n[web search: "${proactiveQuery}"]\n\n`);

        try {
          const proactiveSearchResults = await tavilySearch(
            tavilyApiKey,
            proactiveQuery,
            abortController.signal
          );
          effectivePrompt = injectWebSearchContextIntoPrompt(
            effectivePrompt,
            proactiveQuery,
            proactiveSearchResults
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          onText?.(`\n[web search failed: ${message}]\n\n`);
        }
      }

      const messages: Record<string, unknown>[] = [
        ...historyMessages,
        { role: "user" as const, content: effectivePrompt }
      ];

      let currentMessages = [...messages];
      let toolRoundsLeft = 3;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const includeTools = tavilyApiKey && toolRoundsLeft > 0;

        const response = await fetch(completionUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            ...extraHeaders
          },
          body: JSON.stringify({
            model: modelId,
            messages: currentMessages,
            stream: true,
            ...(includeTools ? { tools: webSearchTool } : {})
          }),
          signal: abortController.signal
        });

        if (!response.ok) {
          let errorMessage = `Provider returned status ${response.status}.`;

          try {
            const errorBody = (await response.json()) as Record<string, unknown>;
            const errorField = errorBody.error;

            if (typeof errorField === "string" && errorField.trim()) {
              errorMessage = errorField.trim();
            } else if (errorField && typeof errorField === "object") {
              const errorRecord = errorField as Record<string, unknown>;

              if (typeof errorRecord.message === "string" && errorRecord.message.trim()) {
                errorMessage = errorRecord.message.trim();
              }
            }
          } catch {
            // Could not parse error body.
          }

          onError?.(errorMessage);
          return;
        }

        if (!response.body) {
          onError?.("Provider returned empty response body.");
          return;
        }

        const result = await readChatCompletionStream(
          response.body,
          onText
        );

        /* No tool calls — normal completion */
        const searchCalls = result.toolCalls.filter((tc) => tc.name === "web_search");

        if (searchCalls.length === 0 || !tavilyApiKey || toolRoundsLeft <= 0) {
          break;
        }

        /* Execute ALL web search tool calls */
        const assistantToolCalls = result.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments }
        }));

        currentMessages = [
          ...currentMessages,
          { role: "assistant", content: null, tool_calls: assistantToolCalls }
        ];

        let anySearchSucceeded = false;

        for (const tc of searchCalls) {
          let searchQuery: string;

          try {
            const args = JSON.parse(tc.arguments) as { query: string };
            searchQuery = args.query;
          } catch {
            currentMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: "Invalid search arguments."
            });
            continue;
          }

          onText?.(`\n[web search: "${searchQuery}"]\n\n`);

          try {
            const searchResults = await tavilySearch(
              tavilyApiKey,
              searchQuery,
              abortController.signal
            );
            currentMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: searchResults
            });
            anySearchSucceeded = true;
          } catch {
            currentMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: "Search failed."
            });
          }
        }

        if (!anySearchSucceeded) {
          break;
        }

        toolRoundsLeft -= 1;
      }

      onComplete?.();
    } catch (error) {
      if (abortController.signal.aborted) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      onError?.(message);
    }
  })();

  return {
    abort: () => {
      abortController.abort();
    }
  };
}
