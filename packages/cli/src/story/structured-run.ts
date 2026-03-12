import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { getStoryforgeOpencodeDataDir } from "../utils/opencode-auth.js";
import { normalizeAssistantText } from "../utils/opencode-run.js";
import {
  getDefaultSessionConfigPath,
  loadSessionConfig
} from "../utils/session-config.js";
import {
  getOpencodeEventErrorMessage,
  getOpencodeEventText,
  parseOpencodeEvent
} from "../utils/opencode-events.js";

export interface StructuredRunOptions {
  cwd: string;
  model: string;
  prompt: string;
  stage: string;
}

export type StructuredRunner = (options: StructuredRunOptions) => Promise<string>;

function getModelProvider(model: string): string | null {
  const separatorIndex = model.indexOf("/");

  if (separatorIndex <= 0) {
    return null;
  }

  return model.slice(0, separatorIndex).trim().toLowerCase();
}

function readOpenRouterApiKeyFromConfig(): string | null {
  const sessionConfig = loadSessionConfig(getDefaultSessionConfigPath());
  const connection = sessionConfig.connection;

  if (!connection || connection.provider !== "openrouter" || !connection.apiKey) {
    return null;
  }

  const key = connection.apiKey.trim();

  return key || null;
}

function getOpenRouterApiKey(): string | null {
  const envKey = process.env.OPENROUTER_API_KEY?.trim();

  if (envKey) {
    return envKey;
  }

  return readOpenRouterApiKeyFromConfig();
}

function toOpenRouterModelId(model: string): string {
  const prefix = "openrouter/";

  if (!model.toLowerCase().startsWith(prefix)) {
    return model.trim();
  }

  return model.slice(prefix.length).trim();
}

function toTextFromOpenRouterContent(content: unknown): string {
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

function extractOpenRouterContent(payload: unknown): string {
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

  return toTextFromOpenRouterContent((message as Record<string, unknown>).content);
}

function getOpenRouterErrorMessage(payload: unknown, status: number): string {
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

  return `OpenRouter request failed with status ${status}.`;
}

async function runOpenRouterStructuredPrompt(model: string, prompt: string): Promise<string> {
  const apiKey = getOpenRouterApiKey();

  if (!apiKey) {
    throw new Error(
      "OpenRouter API key was not found. Run /connect openrouter <api-key> first, or set OPENROUTER_API_KEY."
    );
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://storyforge.local",
      "X-Title": "Storyforge CLI"
    },
    body: JSON.stringify({
      model: toOpenRouterModelId(model),
      messages: [
        {
          role: "user",
          content: prompt.trim()
        }
      ]
    })
  });

  let payload: unknown = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(getOpenRouterErrorMessage(payload, response.status));
  }

  const content = extractOpenRouterContent(payload);

  if (!content.trim()) {
    throw new Error("OpenRouter response did not contain text output.");
  }

  return normalizeAssistantText(content);
}

const runWithOpencode: StructuredRunner = async ({
  cwd,
  model,
  prompt
}: StructuredRunOptions): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const child = spawn("opencode", ["run", "--format", "json", "-m", model, prompt.trim()], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        XDG_DATA_HOME: getStoryforgeOpencodeDataDir()
      }
    });
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let result = "";
    let eventErrorMessage: string | null = null;

    (child.stdout as Readable).on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const event = parseOpencodeEvent(rawLine.trim());

        const errorMessage = getOpencodeEventErrorMessage(event);

        if (errorMessage) {
          eventErrorMessage = errorMessage;
          continue;
        }

        const text = getOpencodeEventText(event);

        if (text) {
          result += text;
        }
      }
    });

    (child.stderr as Readable).on("data", (chunk) => {
      stderrBuffer += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      const finalLine = stdoutBuffer.trim();

      if (finalLine) {
        const event = parseOpencodeEvent(finalLine);

        const errorMessage = getOpencodeEventErrorMessage(event);

        if (errorMessage) {
          eventErrorMessage = errorMessage;
        }

        const text = getOpencodeEventText(event);

        if (text) {
          result += text;
        }
      }

      if (eventErrorMessage) {
        reject(new Error(eventErrorMessage));
        return;
      }

      if (code !== 0) {
        reject(new Error(stderrBuffer.trim() || `opencode run exited with status ${code ?? "unknown"}.`));
        return;
      }

      resolve(normalizeAssistantText(result));
    });
  });

export const runStructuredPrompt: StructuredRunner = async (
  options: StructuredRunOptions
): Promise<string> => {
  const provider = getModelProvider(options.model);

  if (provider === "openrouter") {
    return runOpenRouterStructuredPrompt(options.model, options.prompt);
  }

  return runWithOpencode(options);
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
