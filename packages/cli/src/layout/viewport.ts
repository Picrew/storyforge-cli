import type { ViewportMode } from "../types.js";

const HERO_BREAKPOINT = 100;
const COMPACT_BREAKPOINT = 74;
const WELCOME_CONDENSE_BREAKPOINT = 84;
const MAX_CONTENT_WIDTH = 110;
const MIN_CONTENT_WIDTH = 20;

export function resolveViewportMode(width: number): ViewportMode {
  if (width >= HERO_BREAKPOINT) {
    return "hero";
  }

  if (width >= COMPACT_BREAKPOINT) {
    return "compact";
  }

  return "minimal";
}

export function getContentWidth(width: number): number {
  const gutter = width >= 96 ? 10 : 6;
  const availableWidth = width - gutter;
  return Math.max(MIN_CONTENT_WIDTH, Math.min(MAX_CONTENT_WIDTH, availableWidth));
}

export function shouldCondenseWelcome(width: number): boolean {
  return width < WELCOME_CONDENSE_BREAKPOINT;
}

export function shouldUseCompactFooter(width: number): boolean {
  return width < COMPACT_BREAKPOINT;
}
