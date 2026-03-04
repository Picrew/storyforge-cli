import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { getStoryforgeOpencodeDataDir } from "../utils/opencode-auth.js";
import { normalizeAssistantText } from "../utils/opencode-run.js";

interface OpencodeJsonEvent {
  type?: string;
  part?: {
    text?: string;
  };
}

export interface StructuredRunOptions {
  cwd: string;
  model: string;
  prompt: string;
  stage: string;
}

export type StructuredRunner = (options: StructuredRunOptions) => Promise<string>;

function parseEvent(line: string): OpencodeJsonEvent | null {
  try {
    return JSON.parse(line) as OpencodeJsonEvent;
  } catch {
    return null;
  }
}

export const runStructuredPrompt: StructuredRunner = async ({
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

    (child.stdout as Readable).on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const event = parseEvent(rawLine.trim());

        if (event?.type === "text" && typeof event.part?.text === "string") {
          result += event.part.text;
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
        const event = parseEvent(finalLine);

        if (event?.type === "text" && typeof event.part?.text === "string") {
          result += event.part.text;
        }
      }

      if (code !== 0) {
        reject(new Error(stderrBuffer.trim() || `opencode run exited with status ${code ?? "unknown"}.`));
        return;
      }

      resolve(normalizeAssistantText(result));
    });
  });

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
