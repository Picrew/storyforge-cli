import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { getStoryforgeOpencodeDataDir } from "./opencode-auth.js";
import {
  getOpencodeEventErrorMessage,
  getOpencodeEventText,
  parseOpencodeEvent
} from "./opencode-events.js";

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
  let eventErrorMessage: string | null = null;

  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (!line) {
        continue;
      }

      const event = parseOpencodeEvent(line);

      if (!event) {
        continue;
      }

      if (typeof event.sessionID === "string") {
        onSessionId?.(event.sessionID);
      }

      const errorMessage = getOpencodeEventErrorMessage(event);

      if (errorMessage) {
        eventErrorMessage = errorMessage;
        continue;
      }

      const text = getOpencodeEventText(event);

      if (text) {
        onText?.(text);
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
      const event = parseOpencodeEvent(finalLine);

      if (event) {
        if (typeof event.sessionID === "string") {
          onSessionId?.(event.sessionID);
        }

        const errorMessage = getOpencodeEventErrorMessage(event);

        if (errorMessage) {
          eventErrorMessage = errorMessage;
        }

        const text = getOpencodeEventText(event);

        if (text) {
          onText?.(text);
        }
      }
    }

    if (eventErrorMessage) {
      onError?.(eventErrorMessage);
      return;
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
