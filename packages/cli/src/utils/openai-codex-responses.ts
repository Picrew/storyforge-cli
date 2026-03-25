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

function parseDeltaChunk(event: ParsedSseEvent, payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const record = payload as Record<string, unknown>;
  const eventType = asNonEmptyString(record.type) ?? event.event;
  const delta = asNonEmptyString(record.delta);

  if (eventType === "response.output_text.delta" && delta) {
    return delta;
  }

  if (delta && eventType?.includes("delta")) {
    return delta;
  }

  return "";
}

function parseEventError(event: ParsedSseEvent, payload: unknown): string | null {
  const payloadMessage = extractErrorMessageFromPayload(payload);
  const eventType =
    payload && typeof payload === "object"
      ? asNonEmptyString((payload as Record<string, unknown>).type) ?? event.event
      : event.event;

  if (payloadMessage && (eventType?.includes("error") ?? false)) {
    return payloadMessage;
  }

  if (event.event === "error") {
    return payloadMessage ?? "OpenAI codex stream failed.";
  }

  return null;
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

export async function streamOpenAICodexResponse(options: OpenAICodexStreamOptions): Promise<string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.accessToken}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream"
  };

  if (options.accountId?.trim()) {
    headers["ChatGPT-Account-Id"] = options.accountId.trim();
  }

  const response = await fetch(OPENAI_CODEX_RESPONSES_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: options.model,
      instructions: "",
      input: buildCodexRequestMessages(options.prompt, options.history),
      store: false,
      stream: true
    }),
    signal: options.signal
  });

  if (!response.ok) {
    throw new Error(await extractHttpErrorMessage(response));
  }

  if (!response.body) {
    throw new Error("OpenAI codex endpoint returned an empty response body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let output = "";
  let buffer = "";
  let currentEvent: string | null = null;
  let dataLines: string[] = [];

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

    let payload: unknown = null;

    try {
      payload = JSON.parse(trimmed);
    } catch {
      return;
    }

    const errorMessage = parseEventError(event, payload);

    if (errorMessage) {
      throw new Error(errorMessage);
    }

    const deltaChunk = parseDeltaChunk(event, payload);

    if (deltaChunk) {
      output += deltaChunk;
      options.onText?.(deltaChunk);
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

  return output;
}
