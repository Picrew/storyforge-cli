import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { getStoryforgeOpencodeDataDir } from "./opencode-auth.js";

interface OpencodeJsonEvent {
  type?: string;
  sessionID?: string;
  part?: {
    text?: string;
  };
}

export interface OpencodeStreamCallbacks {
  onSessionId?: (sessionId: string) => void;
  onText?: (text: string) => void;
  onError?: (message: string) => void;
  onComplete?: () => void;
}

export interface StartOpencodeStreamOptions extends OpencodeStreamCallbacks {
  cwd: string;
  model: string;
  prompt: string;
  sessionId?: string | null;
}

function parseEvent(line: string): OpencodeJsonEvent | null {
  try {
    return JSON.parse(line) as OpencodeJsonEvent;
  } catch {
    return null;
  }
}

export function normalizeAssistantText(value: string): string {
  return value
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<\/?think>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function startOpencodeStream({
  cwd,
  model,
  prompt,
  sessionId,
  onSessionId,
  onText,
  onError,
  onComplete
}: StartOpencodeStreamOptions): ChildProcessByStdio<null, Readable, Readable> {
  const trimmedPrompt = prompt.trim();
  const args = ["run", "--format", "json", "-m", model];

  if (sessionId) {
    args.push("-s", sessionId);
  }

  args.push(trimmedPrompt);

  const child = spawn("opencode", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      XDG_DATA_HOME: getStoryforgeOpencodeDataDir()
    }
  });
  let stdoutBuffer = "";
  let stderrBuffer = "";

  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (!line) {
        continue;
      }

      const event = parseEvent(line);

      if (!event) {
        continue;
      }

      if (typeof event.sessionID === "string") {
        onSessionId?.(event.sessionID);
      }

      if (event.type === "text" && typeof event.part?.text === "string") {
        onText?.(event.part.text);
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    stderrBuffer += chunk.toString();
  });

  child.on("error", (error) => {
    onError?.(error.message);
  });

  child.on("close", (code) => {
    const finalLine = stdoutBuffer.trim();

    if (finalLine) {
      const event = parseEvent(finalLine);

      if (event) {
        if (typeof event.sessionID === "string") {
          onSessionId?.(event.sessionID);
        }

        if (event.type === "text" && typeof event.part?.text === "string") {
          onText?.(event.part.text);
        }
      }
    }

    if (code !== 0) {
      const message = stderrBuffer.trim() || `opencode run exited with status ${code ?? "unknown"}.`;
      onError?.(message);
      return;
    }

    onComplete?.();
  });

  return child;
}
