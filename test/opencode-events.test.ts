import { describe, expect, it } from "vitest";
import {
  getOpencodeEventErrorMessage,
  getOpencodeEventText,
  parseOpencodeEvent
} from "../packages/cli/src/utils/opencode-events.js";

describe("opencode event parsing", () => {
  it("extracts streamed text payloads", () => {
    const event = parseOpencodeEvent(
      JSON.stringify({
        type: "text",
        part: {
          text: "hello"
        }
      })
    );

    expect(getOpencodeEventText(event)).toBe("hello");
    expect(getOpencodeEventErrorMessage(event)).toBeNull();
  });

  it("extracts nested error messages from error events", () => {
    const event = parseOpencodeEvent(
      JSON.stringify({
        type: "error",
        error: {
          data: {
            message: "Unable to connect. Is the computer able to access the url?"
          }
        }
      })
    );

    expect(getOpencodeEventText(event)).toBeNull();
    expect(getOpencodeEventErrorMessage(event)).toBe(
      "Unable to connect. Is the computer able to access the url?"
    );
  });
});
