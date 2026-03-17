import { describe, expect, it } from "vitest";

// Test the SGR mouse event parsing logic directly
const SGR_MOUSE_RE = /\x1b\[<(\d+);\d+;\d+[Mm]/g;
const SCROLL_UP_BUTTON = 64;
const SCROLL_DOWN_BUTTON = 65;

function parseScrollEvents(data: string): number[] {
  const events: number[] = [];
  let match: RegExpExecArray | null;

  SGR_MOUSE_RE.lastIndex = 0;

  while ((match = SGR_MOUSE_RE.exec(data)) !== null) {
    const button = parseInt(match[1], 10);

    if (button === SCROLL_UP_BUTTON) {
      events.push(1);
    } else if (button === SCROLL_DOWN_BUTTON) {
      events.push(-1);
    }
  }

  return events;
}

describe("Mouse scroll event parsing", () => {
  it("detects SGR scroll up events", () => {
    const data = "\x1b[<64;40;15M";
    expect(parseScrollEvents(data)).toEqual([1]);
  });

  it("detects SGR scroll down events", () => {
    const data = "\x1b[<65;40;15M";
    expect(parseScrollEvents(data)).toEqual([-1]);
  });

  it("handles multiple scroll events in one data chunk", () => {
    const data = "\x1b[<64;40;15M\x1b[<64;40;15M\x1b[<65;40;15M";
    expect(parseScrollEvents(data)).toEqual([1, 1, -1]);
  });

  it("ignores non-scroll mouse events (click, move)", () => {
    // Button 0 = left click, button 32 = move
    const data = "\x1b[<0;40;15M\x1b[<32;40;15m";
    expect(parseScrollEvents(data)).toEqual([]);
  });

  it("ignores non-mouse data", () => {
    const data = "hello world\x1b[A\x1b[B";
    expect(parseScrollEvents(data)).toEqual([]);
  });

  it("handles scroll events mixed with other data", () => {
    const data = "abc\x1b[<64;10;5Mxyz\x1b[<65;10;5M";
    expect(parseScrollEvents(data)).toEqual([1, -1]);
  });
});
