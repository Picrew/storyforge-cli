import React from "react";
import { Box, Text } from "ink";
import { copy } from "../content/copy.js";
import { themeTokens } from "../theme/tokens.js";

interface WelcomeCardProps {
  width: number;
  condensed: boolean;
}

export function WelcomeCard({ width, condensed }: WelcomeCardProps): React.JSX.Element {
  const body = condensed ? copy.condensedWelcomeBody : copy.welcomeBody;
  const showBadge = width >= 52;
  const divider = "-".repeat(Math.max(12, width - 6));

  return (
    <Box
      width={width}
      flexDirection="column"
      borderStyle="single"
      borderColor={themeTokens.border}
      paddingX={2}
      paddingY={0}
    >
      <Box justifyContent={showBadge ? "space-between" : "flex-start"}>
        <Text bold color={themeTokens.accent}>
          {copy.welcomeTitle.toUpperCase()}
        </Text>
        {showBadge ? <Text color={themeTokens.accentSecondary}>INTERACTIVE PREVIEW</Text> : null}
      </Box>
      <Text color={themeTokens.border}>{divider}</Text>
      {body.map((line, index) => (
        <Box key={line}>
          <Text color={themeTokens.accent}>
            {width < 40 ? "•" : String(index + 1).padStart(2, "0")}
          </Text>
          <Text color={themeTokens.accentSecondary}>{width < 40 ? " " : " | "}</Text>
          <Text color={themeTokens.textPrimary}>{line}</Text>
        </Box>
      ))}
    </Box>
  );
}
