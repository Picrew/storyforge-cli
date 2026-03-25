import {
  getProviderApiKey,
  getProviderCompletionUrl,
  getModelProvider,
  stripProviderPrefix
} from "./provider-api.js";

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

  const apiKey = getProviderApiKey(providerId);

  if (!apiKey) {
    queueMicrotask(() => {
      onError?.(
        `No API key found for ${providerId}. Run /connect ${providerId} <api-key> first.`
      );
    });
    return { abort: () => abortController.abort() };
  }

  const completionUrl = getProviderCompletionUrl(providerId);

  if (!completionUrl) {
    queueMicrotask(() => {
      onError?.(`No API endpoint configured for provider "${providerId}".`);
    });
    return { abort: () => abortController.abort() };
  }

  const modelId = stripProviderPrefix(model);

  const historyMessages = (history ?? []).map((msg) => ({
    role: msg.role,
    content: msg.content
  }));

  const messages = [
    ...historyMessages,
    { role: "user" as const, content: prompt.trim() }
  ];

  const extraHeaders = buildExtraHeaders(providerId);

  void (async () => {
    try {
      const response = await fetch(completionUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...extraHeaders
        },
        body: JSON.stringify({
          model: modelId,
          messages,
          stream: true
        }),
        signal: abortController.signal
      });

      if (!response.ok) {
        let errorMessage = `Provider returned status ${response.status}.`;

        try {
          const errorBody = await response.json() as Record<string, unknown>;
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

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

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

          const data = trimmed.slice(6);

          if (data === "[DONE]") {
            continue;
          }

          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{
                delta?: { content?: string; reasoning_content?: string };
                finish_reason?: string | null;
              }>;
              error?: { message?: string };
            };

            if (parsed.error?.message) {
              onError?.(parsed.error.message);
              return;
            }

            const delta = parsed.choices?.[0]?.delta;

            if (delta?.content) {
              onText?.(delta.content);
            }
          } catch {
            // Skip malformed SSE chunks.
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        const trimmed = buffer.trim();

        if (trimmed.startsWith("data: ") && trimmed.slice(6) !== "[DONE]") {
          try {
            const parsed = JSON.parse(trimmed.slice(6)) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const delta = parsed.choices?.[0]?.delta;

            if (delta?.content) {
              onText?.(delta.content);
            }
          } catch {
            // Skip.
          }
        }
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
