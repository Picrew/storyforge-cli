import React from "react";
import { Box, Text } from "ink";
import { getContentWidth, shouldCondenseWelcome } from "../layout/viewport.js";
import { themeTokens } from "../theme/tokens.js";
import type { AppState } from "../types.js";
import { Footer } from "../components/Footer.js";
import { Header } from "../components/Header.js";
import { InputFrame } from "../components/InputFrame.js";
import { WelcomeCard } from "../components/WelcomeCard.js";

interface AppShellProps {
  state: AppState;
  terminalWidth: number;
  cwd: string;
}

export function AppShell({ state, terminalWidth, cwd }: AppShellProps): React.JSX.Element {
  const contentWidth = getContentWidth(terminalWidth);
  const condensedWelcome = shouldCondenseWelcome(contentWidth);

  return (
    <Box width="100%" flexDirection="column" alignItems="center" paddingY={1}>
      <Box width={contentWidth} flexDirection="column">
        <Header mode={state.viewportMode} />
        <Box marginTop={1}>
          <WelcomeCard width={contentWidth} condensed={condensedWelcome} />
        </Box>
        {state.transientNotice ? (
          <Box marginTop={1}>
            <Text color={themeTokens.notice}>{state.transientNotice.message}</Text>
          </Box>
        ) : null}
        <Box marginTop={1}>
          <InputFrame width={contentWidth} value={state.inputValue} />
        </Box>
        <Box marginTop={1}>
          <Footer cwd={cwd} width={contentWidth} />
        </Box>
      </Box>
    </Box>
  );
}
