import { normalizeAssistantText } from "../utils/direct-stream.js";
import {
  getProviderApiKey,
  getProviderCompletionUrl,
  getModelProvider,
  stripProviderPrefix
} from "../utils/provider-api.js";
import { streamOpenAICodexResponse } from "../utils/openai-codex-responses.js";
import { resolveOpenAIOauthRuntimeContext } from "../utils/openai-oauth-runtime.js";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface StructuredRunOptions {
  cwd: string;
  model: string;
  prompt: string;
  stage: string;
  history?: readonly ChatMessage[];
  signal?: AbortSignal;
}

export type StructuredRunner = (options: StructuredRunOptions) => Promise<string>;

function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }

  throw createAbortError("Structured run aborted.");
}

function toTextFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  const chunks: string[] = [];

  for (const row of content) {
    if (typeof row === "string") {
      chunks.push(row);
      continue;
    }

    if (!row || typeof row !== "object") {
      continue;
    }

    const record = row as Record<string, unknown>;

    if (typeof record.text === "string") {
      chunks.push(record.text);
      continue;
    }

    if (typeof record.content === "string") {
      chunks.push(record.content);
    }
  }

  return chunks.join("");
}

function extractResponseContent(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const choices = (payload as Record<string, unknown>).choices;

  if (!Array.isArray(choices) || choices.length === 0) {
    return "";
  }

  const firstChoice = choices[0];

  if (!firstChoice || typeof firstChoice !== "object") {
    return "";
  }

  const message = (firstChoice as Record<string, unknown>).message;

  if (!message || typeof message !== "object") {
    return "";
  }

  return toTextFromContent((message as Record<string, unknown>).content);
}

function getProviderErrorMessage(payload: unknown, status: number, providerId: string): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const errorField = record.error;

    if (typeof errorField === "string" && errorField.trim()) {
      return errorField.trim();
    }

    if (errorField && typeof errorField === "object") {
      const errorRecord = errorField as Record<string, unknown>;

      if (typeof errorRecord.message === "string" && errorRecord.message.trim()) {
        return errorRecord.message.trim();
      }
    }
  }

  return `${providerId} request failed with status ${status}.`;
}

const REQUEST_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 3;
const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function isTransientNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  return (
    message.includes("fetch failed") ||
    message.includes("networkerror") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("timed out") ||
    message.includes("socket hang up")
  );
}

function retryDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function runDirectStructuredPrompt(
  model: string,
  prompt: string,
  history?: readonly ChatMessage[],
  signal?: AbortSignal
): Promise<string> {
  throwIfAborted(signal);

  const providerId = getModelProvider(model);

  if (!providerId) {
    throw new Error(`Cannot determine provider from model "${model}". Use provider/model format.`);
  }

  const apiKey = getProviderApiKey(providerId);

  if (!apiKey) {
    throw new Error(
      `No API key found for ${providerId}. Run /connect ${providerId} <api-key> first.`
    );
  }

  const modelId = stripProviderPrefix(model);
  const openAIOauthRuntime =
    providerId === "openai" ? resolveOpenAIOauthRuntimeContext(apiKey) : null;
  const completionUrl = openAIOauthRuntime ? null : getProviderCompletionUrl(providerId);

  if (!openAIOauthRuntime && !completionUrl) {
    throw new Error(`No API endpoint configured for provider "${providerId}".`);
  }
  const extraHeaders = buildExtraHeaders(providerId);

  const historyMessages = (history ?? []).map((msg) => ({
    role: msg.role,
    content: msg.content
  }));

  const messages = [
    ...historyMessages,
    { role: "user" as const, content: prompt.trim() }
  ];

  const body = JSON.stringify({
    model: modelId,
    messages
  });

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    throwIfAborted(signal);

    const timeoutController = new AbortController();
    const timeout = setTimeout(() => {
      timeoutController.abort();
    }, REQUEST_TIMEOUT_MS);

    const onCallerAbort = (): void => {
      timeoutController.abort();
    };

    signal?.addEventListener("abort", onCallerAbort, { once: true });

    try {
      if (openAIOauthRuntime) {
        const content = await streamOpenAICodexResponse({
          accessToken: openAIOauthRuntime.accessToken,
          accountId: openAIOauthRuntime.accountId,
          model: modelId,
          prompt,
          history,
          signal: timeoutController.signal
        });

        if (!content.trim()) {
          throw new Error(`${providerId} response did not contain text output.`);
        }

        return normalizeAssistantText(content);
      }

      if (!completionUrl) {
        throw new Error(`No API endpoint configured for provider "${providerId}".`);
      }

      const response = await fetch(completionUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...extraHeaders
        },
        body,
        signal: timeoutController.signal
      });

      let payload: unknown = null;

      try {
        payload = await response.json();
      } catch {
        // Response body could not be parsed.
      }

      if (response.ok) {
        const content = extractResponseContent(payload);

        if (!content.trim()) {
          throw new Error(`${providerId} response did not contain text output.`);
        }

        return normalizeAssistantText(content);
      }

      const errorMessage = getProviderErrorMessage(payload, response.status, providerId);

      if (TRANSIENT_STATUS.has(response.status) && attempt < MAX_ATTEMPTS) {
        lastError = new Error(errorMessage);
        await retryDelay(500 * (2 ** (attempt - 1)));
        continue;
      }

      throw new Error(errorMessage);
    } catch (error) {
      if (signal?.aborted) {
        throw createAbortError("Structured run aborted.");
      }

      if (error instanceof Error && error.name === "AbortError") {
        if (attempt < MAX_ATTEMPTS) {
          lastError = new Error(`${providerId} request timed out (attempt ${attempt}).`);
          await retryDelay(500 * (2 ** (attempt - 1)));
          continue;
        }

        throw new Error(`${providerId} request timed out after ${REQUEST_TIMEOUT_MS / 1_000}s.`, { cause: error });
      }

      if (isTransientNetworkError(error) && attempt < MAX_ATTEMPTS) {
        lastError = error instanceof Error ? error : new Error(String(error));
        await retryDelay(500 * (2 ** (attempt - 1)));
        continue;
      }

      if (error instanceof Error) {
        throw error;
      }

      throw new Error(String(error), { cause: error });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onCallerAbort);
    }
  }

  throw lastError ?? new Error(`${providerId} request failed.`);
}

export const runStructuredPrompt: StructuredRunner = async (
  options: StructuredRunOptions
): Promise<string> => {
  return runDirectStructuredPrompt(options.model, options.prompt, options.history, options.signal);
};

function stripCodeFences(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}

function findBalancedJsonBlock(value: string): string | null {
  const startIndex = value.search(/[[{]/);

  if (startIndex === -1) {
    return null;
  }

  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < value.length; index += 1) {
    const char = value[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === "\"") {
        inString = false;
      }

      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{" || char === "[") {
      stack.push(char);
      continue;
    }

    if (char === "}" || char === "]") {
      const current = stack[stack.length - 1];

      if (
        (char === "}" && current === "{") ||
        (char === "]" && current === "[")
      ) {
        stack.pop();
      }

      if (stack.length === 0) {
        return value.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

export function parseStructuredJson<T>(value: string): T {
  const trimmed = stripCodeFences(value);

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const balanced = findBalancedJsonBlock(trimmed);

    if (!balanced) {
      throw new Error("Structured output did not contain a valid JSON block.");
    }

    return JSON.parse(balanced) as T;
  }
}
