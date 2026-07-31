import { tavilySearch } from "./tavily-search.js";
import { loadSessionConfig, getDefaultSessionConfigPath } from "./session-config.js";
import {
  buildWebSearchQuery,
  injectWebSearchContextIntoPrompt,
  shouldUseProactiveWebSearch
} from "./web-search-context.js";

const OPENAI_CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";

export interface CodexHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface OpenAICodexStreamOptions {
  accessToken: string;
  accountId?: string | null;
  model: string;
  prompt: string;
  history?: readonly CodexHistoryMessage[];
  signal?: AbortSignal;
  onText?: (chunk: string) => void;
}

interface CodexRequestMessage {
  role: "user" | "assistant";
  content: Array<{
    type: "input_text" | "output_text";
    text: string;
  }>;
}

interface ParsedSseEvent {
  event: string | null;
  data: string;
}

interface CodexFunctionCall {
  callId: string;
  name: string;
  arguments: string;
}

interface CodexStreamResult {
  output: string;
  functionCalls: CodexFunctionCall[];
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildCodexRequestMessages(
  prompt: string,
  history?: readonly CodexHistoryMessage[]
): CodexRequestMessage[] {
  const payloadMessages: CodexRequestMessage[] = [];

  for (const row of history ?? []) {
    const normalizedContent = row.content.trim();

    if (!normalizedContent) {
      continue;
    }

    payloadMessages.push({
      role: row.role,
      content: [
        {
          type: row.role === "assistant" ? "output_text" : "input_text",
          text: normalizedContent
        }
      ]
    });
  }

  payloadMessages.push({
    role: "user",
    content: [
      {
        type: "input_text",
        text: prompt.trim()
      }
    ]
  });

  return payloadMessages;
}

function extractErrorMessageFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const directMessage = asNonEmptyString(record.message);

  if (directMessage) {
    return directMessage;
  }

  if (record.error && typeof record.error === "object") {
    const nestedMessage = asNonEmptyString((record.error as Record<string, unknown>).message);

    if (nestedMessage) {
      return nestedMessage;
    }
  }

  const directError = asNonEmptyString(record.error);

  if (directError) {
    return directError;
  }

  const detail = asNonEmptyString(record.detail);

  if (detail) {
    return detail;
  }

  return null;
}

async function extractHttpErrorMessage(response: Response): Promise<string> {
  const fallback = `OpenAI request failed with status ${response.status}.`;

  try {
    const text = await response.text();
    const trimmed = text.trim();

    if (!trimmed) {
      return fallback;
    }

    try {
      const parsed = JSON.parse(trimmed);
      return extractErrorMessageFromPayload(parsed) ?? fallback;
    } catch {
      return trimmed.slice(0, 240);
    }
  } catch {
    return fallback;
  }
}

function parseSseLine(line: string): { field: string; value: string } | null {
  const separator = line.indexOf(":");

  if (separator === -1) {
    return null;
  }

  const field = line.slice(0, separator).trim();
  const value = line.slice(separator + 1).trimStart();
  return {
    field,
    value
  };
}

/* ------------------------------------------------------------------ */
/*  Web search tool for Responses API format                           */
/* ------------------------------------------------------------------ */

function getTavilyApiKey(): string | null {
  const envKey = process.env.TAVILY_API_KEY?.trim();

  if (envKey) {
    return envKey;
  }

  const config = loadSessionConfig(getDefaultSessionConfigPath());

  return config.tavilyApiKey ?? null;
}

function buildCodexWebSearchTool(): Record<string, unknown> {
  const today = new Date().toISOString().split("T")[0];

  return {
    type: "function",
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
  };
}

/* ------------------------------------------------------------------ */
/*  SSE stream reader                                                  */
/* ------------------------------------------------------------------ */

async function readCodexSseStream(
  body: ReadableStream<Uint8Array>,
  onText: ((chunk: string) => void) | undefined
): Promise<CodexStreamResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();

  let output = "";
  let buffer = "";
  let currentEvent: string | null = null;
  let dataLines: string[] = [];
  const functionCalls: CodexFunctionCall[] = [];

  const flushEvent = (): void => {
    if (dataLines.length === 0) {
      currentEvent = null;
      return;
    }

    const event: ParsedSseEvent = {
      event: currentEvent,
      data: dataLines.join("\n")
    };
    const trimmed = event.data.trim();
    currentEvent = null;
    dataLines = [];

    if (!trimmed || trimmed === "[DONE]") {
      return;
    }

    let payload: unknown;

    try {
      payload = JSON.parse(trimmed);
    } catch {
      return;
    }

    if (!payload || typeof payload !== "object") {
      return;
    }

    const record = payload as Record<string, unknown>;
    const eventType = asNonEmptyString(record.type) ?? event.event;

    /* Error detection */
    const payloadMessage = extractErrorMessageFromPayload(payload);

    if (payloadMessage && (eventType?.includes("error") ?? false)) {
      throw new Error(payloadMessage);
    }

    if (event.event === "error") {
      throw new Error(payloadMessage ?? "OpenAI codex stream failed.");
    }

    /* Text delta */
    if (eventType === "response.output_text.delta") {
      const delta = asNonEmptyString(record.delta);

      if (delta) {
        output += delta;
        onText?.(delta);
      }

      return;
    }

    /* Function call completed */
    if (eventType === "response.output_item.done") {
      const item = record.item as Record<string, unknown> | undefined;

      if (item && item.type === "function_call") {
        const callId = asNonEmptyString(item.call_id) ?? "";
        const name = asNonEmptyString(item.name) ?? "";
        const args = asNonEmptyString(item.arguments) ?? "{}";

        if (name) {
          functionCalls.push({ callId, name, arguments: args });
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

    for (const rawLine of lines) {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

      if (line.length === 0) {
        flushEvent();
        continue;
      }

      if (line.startsWith(":")) {
        continue;
      }

      const parsedLine = parseSseLine(line);

      if (!parsedLine) {
        continue;
      }

      if (parsedLine.field === "event") {
        currentEvent = parsedLine.value || null;
        continue;
      }

      if (parsedLine.field === "data") {
        dataLines.push(parsedLine.value);
      }
    }
  }

  if (buffer.trim().length > 0) {
    const parsedLine = parseSseLine(buffer.trim());

    if (parsedLine?.field === "event") {
      currentEvent = parsedLine.value || null;
    } else if (parsedLine?.field === "data") {
      dataLines.push(parsedLine.value);
    }
  }

  flushEvent();

  return { output, functionCalls };
}

/* ------------------------------------------------------------------ */
/*  Main entry                                                         */
/* ------------------------------------------------------------------ */

export async function streamOpenAICodexResponse(options: OpenAICodexStreamOptions): Promise<string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.accessToken}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream"
  };

  if (options.accountId?.trim()) {
    headers["ChatGPT-Account-Id"] = options.accountId.trim();
  }

  const tavilyApiKey = getTavilyApiKey();
  const tools = tavilyApiKey ? [buildCodexWebSearchTool()] : undefined;
  let effectivePrompt = options.prompt.trim();
  const shouldSearch = shouldUseProactiveWebSearch(effectivePrompt);

  if (!tavilyApiKey && shouldSearch) {
    options.onText?.(
      "\n[web search unavailable: missing Tavily API key. Set TAVILY_API_KEY or ~/.storyforge/config.json:tavilyApiKey]\n\n"
    );
  }

  if (tavilyApiKey && shouldSearch) {
    const proactiveQuery = buildWebSearchQuery(effectivePrompt);
    options.onText?.(`\n[web search: "${proactiveQuery}"]\n\n`);

    try {
      const proactiveSearchResults = await tavilySearch(
        tavilyApiKey,
        proactiveQuery,
        options.signal
      );
      effectivePrompt = injectWebSearchContextIntoPrompt(
        effectivePrompt,
        proactiveQuery,
        proactiveSearchResults
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.onText?.(`\n[web search failed: ${message}]\n\n`);
    }
  }

  // Build the base input (chat history + current prompt)
  const baseInput: unknown[] = buildCodexRequestMessages(effectivePrompt, options.history);
  const currentInput = [...baseInput];
  let toolRoundsLeft = 3;
  let totalOutput = "";

  while (true) {
    const includeTools = tavilyApiKey && toolRoundsLeft > 0;

    const response = await fetch(OPENAI_CODEX_RESPONSES_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: options.model,
        instructions: "",
        input: currentInput,
        store: false,
        stream: true,
        ...(includeTools ? { tools } : {})
      }),
      signal: options.signal
    });

    if (!response.ok) {
      throw new Error(await extractHttpErrorMessage(response));
    }

    if (!response.body) {
      throw new Error("OpenAI codex endpoint returned an empty response body.");
    }

    const result = await readCodexSseStream(response.body, options.onText);
    totalOutput += result.output;

    /* No function calls — normal completion */
    const searchCalls = result.functionCalls.filter((fc) => fc.name === "web_search");

    if (searchCalls.length === 0 || !tavilyApiKey || toolRoundsLeft <= 0) {
      break;
    }

    /* Execute web search tool calls */
    for (const fc of searchCalls) {
      let searchQuery: string;

      try {
        const args = JSON.parse(fc.arguments) as { query: string };
        searchQuery = args.query;
      } catch {
        currentInput.push(
          { type: "function_call", call_id: fc.callId, name: fc.name, arguments: fc.arguments },
          { type: "function_call_output", call_id: fc.callId, output: "Invalid arguments." }
        );
        continue;
      }

      const indicator = `\n[web search: "${searchQuery}"]\n\n`;
      options.onText?.(indicator);
      totalOutput += indicator;

      try {
        const searchResults = await tavilySearch(
          tavilyApiKey,
          searchQuery,
          options.signal
        );

        currentInput.push(
          { type: "function_call", call_id: fc.callId, name: fc.name, arguments: fc.arguments },
          { type: "function_call_output", call_id: fc.callId, output: searchResults }
        );
      } catch {
        currentInput.push(
          { type: "function_call", call_id: fc.callId, name: fc.name, arguments: fc.arguments },
          { type: "function_call_output", call_id: fc.callId, output: "Search failed." }
        );
      }
    }

    toolRoundsLeft -= 1;
  }

  return totalOutput;
}
