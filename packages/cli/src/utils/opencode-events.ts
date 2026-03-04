export interface OpencodeJsonEvent {
  type?: string;
  sessionID?: string;
  part?: {
    text?: string;
  };
  error?: {
    message?: string;
    data?: {
      message?: string;
    };
  };
}

export function parseOpencodeEvent(line: string): OpencodeJsonEvent | null {
  try {
    return JSON.parse(line) as OpencodeJsonEvent;
  } catch {
    return null;
  }
}

export function getOpencodeEventText(event: OpencodeJsonEvent | null): string | null {
  if (event?.type === "text" && typeof event.part?.text === "string") {
    return event.part.text;
  }

  return null;
}

export function getOpencodeEventErrorMessage(event: OpencodeJsonEvent | null): string | null {
  if (event?.type !== "error") {
    return null;
  }

  const nestedMessage = event.error?.data?.message;

  if (typeof nestedMessage === "string" && nestedMessage.trim()) {
    return nestedMessage.trim();
  }

  const message = event.error?.message;

  if (typeof message === "string" && message.trim()) {
    return message.trim();
  }

  return "opencode returned an error event.";
}
