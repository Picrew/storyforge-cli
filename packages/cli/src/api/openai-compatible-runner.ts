import {
  normalizeAssistantText
} from "../utils/opencode-run.js";
import type {
  StructuredRunOptions,
  StructuredRunner
} from "../story/structured-run.js";

interface OpenAICompatibleChoiceMessage {
  content?: unknown;
}

interface OpenAICompatibleChoice {
  message?: OpenAICompatibleChoiceMessage;
}

interface OpenAICompatiblePayload {
  choices?: OpenAICompatibleChoice[];
  error?: unknown;
  message?: unknown;
}

export interface OpenAICompatibleRunnerConfig {
  apiUrl: string;
  apiKey: string;
  defaultModel?: string;
  timeoutMs?: number;
  systemPrompt?: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const RETRYABLE_ENDPOINT_STATUS = new Set([404, 405]);
const TRANSIENT_RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const DEFAULT_MAX_ATTEMPTS_PER_URL = 3;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLikelyTransientNetworkError(error: unknown): boolean {
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

function mergeAbortSignals(
  timeoutSignal: AbortSignal,
  callerSignal: AbortSignal | undefined
): { signal: AbortSignal; cleanup: () => void } {
  if (!callerSignal) {
    return {
      signal: timeoutSignal,
      cleanup: () => {}
    };
  }

  const controller = new AbortController();

  const forwardAbort = (source: AbortSignal): void => {
    if (controller.signal.aborted) {
      return;
    }

    controller.abort(source.reason);
  };

  const onTimeoutAbort = (): void => {
    forwardAbort(timeoutSignal);
  };

  const onCallerAbort = (): void => {
    forwardAbort(callerSignal);
  };

  timeoutSignal.addEventListener("abort", onTimeoutAbort, { once: true });
  callerSignal.addEventListener("abort", onCallerAbort, { once: true });

  if (timeoutSignal.aborted) {
    forwardAbort(timeoutSignal);
  }

  if (callerSignal.aborted) {
    forwardAbort(callerSignal);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      timeoutSignal.removeEventListener("abort", onTimeoutAbort);
      callerSignal.removeEventListener("abort", onCallerAbort);
    }
  };
}

function getCallerAbortMessage(callerSignal: AbortSignal | undefined): string {
  const reason = callerSignal?.reason;

  if (reason instanceof Error && reason.message.trim()) {
    return reason.message.trim();
  }

  if (typeof reason === "string" && reason.trim()) {
    return reason.trim();
  }

  return "Provider request was aborted by caller.";
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function buildCompletionUrls(apiUrl: string): string[] {
  const normalizedBase = normalizeBaseUrl(apiUrl);
  const candidates = [
    `${normalizedBase}/chat/completions`
  ];

  if (/\/v1$/i.test(normalizedBase)) {
    const withoutV1 = normalizedBase.replace(/\/v1$/i, "");

    if (withoutV1) {
      candidates.push(`${withoutV1}/chat/completions`);
    }
  } else {
    candidates.push(`${normalizedBase}/v1/chat/completions`);
  }

  return [...new Set(candidates)];
}

function normalizeTimeoutMs(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_TIMEOUT_MS;
  }

  return Math.max(1_000, Math.floor(value));
}

function toTextFromMessageContent(content: unknown): string {
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

function extractResponseText(payload: OpenAICompatiblePayload | null): string {
  if (!payload || !Array.isArray(payload.choices) || payload.choices.length === 0) {
    return "";
  }

  return toTextFromMessageContent(payload.choices[0]?.message?.content);
}

function extractProviderError(payload: OpenAICompatiblePayload | null, status: number): string {
  if (!payload) {
    return `Provider returned error (status ${status}).`;
  }

  const direct = asNonEmptyString(payload.message);

  if (direct) {
    return direct;
  }

  if (payload.error && typeof payload.error === "object") {
    const errorRecord = payload.error as Record<string, unknown>;
    const message = asNonEmptyString(errorRecord.message);

    if (message) {
      return message;
    }
  }

  const message = asNonEmptyString(payload.error);

  if (message) {
    return message;
  }

  return `Provider returned error (status ${status}).`;
}

async function parseJsonPayload(response: Response): Promise<OpenAICompatiblePayload | null> {
  try {
    const parsed = await response.json();

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return parsed as OpenAICompatiblePayload;
  } catch {
    return null;
  }
}

async function requestOpenAICompatibleResponse(
  config: OpenAICompatibleRunnerConfig,
  model: string,
  prompt: string,
  history: readonly { role: "user" | "assistant"; content: string }[] | undefined,
  callerSignal: AbortSignal | undefined
): Promise<string> {
  if (callerSignal?.aborted) {
    throw new Error(getCallerAbortMessage(callerSignal));
  }

  const timeoutMs = normalizeTimeoutMs(config.timeoutMs);
  const urls = buildCompletionUrls(config.apiUrl);
  let lastError: Error | null = null;

  const historyMessages = (history ?? []).map((entry) => ({
    role: entry.role,
    content: entry.content
  }));

  const messages = [
    ...(config.systemPrompt?.trim()
      ? [{ role: "system" as const, content: config.systemPrompt.trim() }]
      : []),
    ...historyMessages,
    { role: "user" as const, content: prompt.trim() }
  ];

  for (const url of urls) {
    for (let attempt = 1; attempt <= DEFAULT_MAX_ATTEMPTS_PER_URL; attempt += 1) {
      const abortController = new AbortController();
      const timeout = setTimeout(() => {
        abortController.abort();
      }, timeoutMs);
      const mergedSignal = mergeAbortSignals(abortController.signal, callerSignal);

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model,
            messages,
            stream: false
          }),
          signal: mergedSignal.signal
        });
        const payload = await parseJsonPayload(response);

        if (response.ok) {
          const content = extractResponseText(payload);

          if (!content.trim()) {
            throw new Error("Provider response did not contain text output.");
          }

          return normalizeAssistantText(content);
        }

        const providerMessage = extractProviderError(payload, response.status);

        if (RETRYABLE_ENDPOINT_STATUS.has(response.status)) {
          lastError = new Error(providerMessage);
          break;
        }

        if (TRANSIENT_RETRYABLE_STATUS.has(response.status) && attempt < DEFAULT_MAX_ATTEMPTS_PER_URL) {
          await delay(250 * (2 ** (attempt - 1)));
          continue;
        }

        throw new Error(providerMessage);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          if (callerSignal?.aborted) {
            throw new Error(getCallerAbortMessage(callerSignal), {
              cause: error
            });
          }

          if (attempt < DEFAULT_MAX_ATTEMPTS_PER_URL) {
            await delay(250 * (2 ** (attempt - 1)));
            continue;
          }

          throw new Error(`Provider request timed out after ${timeoutMs}ms.`, {
            cause: error
          });
        }

        if (isLikelyTransientNetworkError(error) && attempt < DEFAULT_MAX_ATTEMPTS_PER_URL) {
          await delay(250 * (2 ** (attempt - 1)));
          continue;
        }

        if (error instanceof Error) {
          throw error;
        }

        throw new Error(String(error), {
          cause: error
        });
      } finally {
        clearTimeout(timeout);
        mergedSignal.cleanup();
      }
    }
  }

  throw lastError ?? new Error("Provider returned error.");
}

export function createOpenAICompatibleRunner(
  config: OpenAICompatibleRunnerConfig
): StructuredRunner {
  const apiUrl = asNonEmptyString(config.apiUrl);
  const apiKey = asNonEmptyString(config.apiKey);

  if (!apiUrl) {
    throw new Error("model_config.api_url is required.");
  }

  if (!apiKey) {
    throw new Error("model_config.api_key is required.");
  }

  const normalizedConfig: OpenAICompatibleRunnerConfig = {
    ...config,
    apiUrl,
    apiKey
  };

  return async (options: StructuredRunOptions): Promise<string> => {
    const model = asNonEmptyString(options.model) ?? asNonEmptyString(normalizedConfig.defaultModel);

    if (!model) {
      throw new Error("Model is required for provider calls.");
    }

    const prompt = options.prompt.trim();

    if (!prompt) {
      throw new Error("Prompt cannot be empty.");
    }

    return requestOpenAICompatibleResponse(normalizedConfig, model, prompt, options.history, options.signal);
  };
}
