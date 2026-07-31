import { useEffect, useRef } from "react";

const MOUSE_SGR_ENABLE = "\x1b[?1000h\x1b[?1006h";
const MOUSE_SGR_DISABLE = "\x1b[?1000l\x1b[?1006l";

// SGR extended mouse format: ESC [ < button ; col ; row M/m
// Button 64 = scroll up, 65 = scroll down
const SGR_MOUSE_RE = new RegExp(`${String.fromCharCode(27)}\\[<(\\d+);\\d+;\\d+[Mm]`, "g");

const SCROLL_UP_BUTTON = 64;
const SCROLL_DOWN_BUTTON = 65;
const LINES_PER_SCROLL = 3;

export function useMouseWheel(onScroll: (delta: number) => void): void {
  const callbackRef = useRef(onScroll);
  callbackRef.current = onScroll;

  useEffect(() => {
    if (!process.stdout.isTTY) {
      return;
    }

    process.stdout.write(MOUSE_SGR_ENABLE);

    // Batch rapid scroll events into a single state update per frame
    let pendingDelta = 0;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flush = (): void => {
      flushTimer = null;

      if (pendingDelta !== 0) {
        callbackRef.current(pendingDelta);
        pendingDelta = 0;
      }
    };

    const handleData = (data: Buffer): void => {
      const str = data.toString("utf8");
      let match: RegExpExecArray | null;

      SGR_MOUSE_RE.lastIndex = 0;

      while ((match = SGR_MOUSE_RE.exec(str)) !== null) {
        const button = parseInt(match[1], 10);

        if (button === SCROLL_UP_BUTTON) {
          pendingDelta += LINES_PER_SCROLL;
        } else if (button === SCROLL_DOWN_BUTTON) {
          pendingDelta -= LINES_PER_SCROLL;
        }
      }

      // Coalesce into one update per ~16ms (roughly 60fps)
      if (pendingDelta !== 0 && flushTimer === null) {
        flushTimer = setTimeout(flush, 16);
      }
    };

    process.stdin.on("data", handleData);

    return () => {
      process.stdin.removeListener("data", handleData);

      if (flushTimer !== null) {
        clearTimeout(flushTimer);
      }

      process.stdout.write(MOUSE_SGR_DISABLE);
    };
  }, []);
}
