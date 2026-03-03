import { copy } from "../content/copy.js";
import { resolveViewportMode } from "../layout/viewport.js";
import type { AppState } from "../types.js";

const NOTICE_TTL_MS = 2500;

export function createInitialAppState(terminalWidth: number): AppState {
  return {
    inputValue: "",
    transientNotice: null,
    viewportMode: resolveViewportMode(terminalWidth)
  };
}

export function syncViewportMode(state: AppState, terminalWidth: number): AppState {
  const nextMode = resolveViewportMode(terminalWidth);

  if (state.viewportMode === nextMode) {
    return state;
  }

  return {
    ...state,
    viewportMode: nextMode
  };
}

export function appendInputCharacter(state: AppState, input: string): AppState {
  if (!input) {
    return state;
  }

  return {
    ...state,
    inputValue: `${state.inputValue}${input}`
  };
}

export function deleteInputCharacter(state: AppState): AppState {
  if (!state.inputValue) {
    return state;
  }

  return {
    ...state,
    inputValue: state.inputValue.slice(0, -1)
  };
}

export function submitInput(state: AppState, now: number = Date.now()): AppState {
  if (!state.inputValue.trim()) {
    return state;
  }

  return {
    ...state,
    inputValue: "",
    transientNotice: {
      message: copy.previewNotice,
      expiresAt: now + NOTICE_TTL_MS
    }
  };
}

export function clearExpiredNotice(state: AppState, now: number = Date.now()): AppState {
  if (!state.transientNotice) {
    return state;
  }

  if (state.transientNotice.expiresAt > now) {
    return state;
  }

  return {
    ...state,
    transientNotice: null
  };
}

