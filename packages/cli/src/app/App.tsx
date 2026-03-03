import React, { useEffect, useState } from "react";
import { useApp, useInput, useStdout } from "ink";
import {
  appendInputCharacter,
  clearExpiredNotice,
  createInitialAppState,
  deleteInputCharacter,
  submitInput,
  syncViewportMode
} from "../state/app-state.js";
import { AppShell } from "./AppShell.js";
import type { AppState } from "../types.js";

export interface AppProps {
  terminalWidthOverride?: number;
  cwdOverride?: string;
}

export function App({ terminalWidthOverride, cwdOverride }: AppProps = {}): React.JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const terminalWidth = terminalWidthOverride ?? stdout?.columns ?? 80;
  const [state, setState] = useState<AppState>(() => createInitialAppState(terminalWidth));
  const cwd = cwdOverride ?? process.cwd();

  useEffect(() => {
    setState((currentState) => syncViewportMode(currentState, terminalWidth));
  }, [terminalWidth]);

  useEffect(() => {
    if (!state.transientNotice) {
      return undefined;
    }

    const timeout = Math.max(0, state.transientNotice.expiresAt - Date.now());
    const timer = setTimeout(() => {
      setState((currentState) => clearExpiredNotice(currentState));
    }, timeout);

    return () => {
      clearTimeout(timer);
    };
  }, [state.transientNotice]);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }

    if (key.return) {
      setState((currentState) => submitInput(currentState));
      return;
    }

    if (key.backspace || key.delete) {
      setState((currentState) => deleteInputCharacter(currentState));
      return;
    }

    if (key.ctrl || key.meta || key.escape || key.tab) {
      return;
    }

    if (input) {
      setState((currentState) => appendInputCharacter(currentState, input));
    }
  });

  return <AppShell state={state} terminalWidth={terminalWidth} cwd={cwd} />;
}
