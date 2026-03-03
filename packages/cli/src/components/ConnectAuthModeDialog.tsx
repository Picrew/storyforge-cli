import React from "react";
import { Box, Text } from "ink";
import { themeTokens } from "../theme/tokens.js";

interface ConnectAuthModeDialogProps {
  width: number;
  providerTitle: string;
  selectedIndex: number;
}

const options = [
  {
    label: "ChatGPT Plus/Pro",
    description: "Open browser verification"
  },
  {
    label: "API key",
    description: "Paste a standard API key"
  }
] as const;

export function ConnectAuthModeDialog({
  width,
  providerTitle,
  selectedIndex
}: ConnectAuthModeDialogProps): React.JSX.Element {
  const activeIndex = Math.min(selectedIndex, options.length - 1);

  return (
    <Box
      width={width}
      flexDirection="column"
      borderStyle="round"
      borderColor={themeTokens.textSecondary}
      paddingX={2}
      paddingY={1}
    >
      <Box justifyContent="space-between">
        <Text bold color={themeTokens.accentSecondary}>
          Connect {providerTitle}
        </Text>
        <Text color={themeTokens.textSecondary}>esc</Text>
      </Box>
      <Text color={themeTokens.textSecondary}>Choose an auth method.</Text>
      <Box marginTop={1} flexDirection="column">
        {options.map((option, index) => {
          const isSelected = index === activeIndex;

          return (
            <Box key={option.label}>
              <Text color={themeTokens.textSecondary}>  </Text>
              <Text
                color={isSelected ? "black" : themeTokens.textPrimary}
                backgroundColor={isSelected ? themeTokens.accentSecondary : undefined}
              >
                {option.label}
              </Text>
              <Text color={themeTokens.textSecondary}> </Text>
              <Text
                color={isSelected ? "black" : themeTokens.textSecondary}
                backgroundColor={isSelected ? themeTokens.accentSecondary : undefined}
              >
                {option.description}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text color={themeTokens.accent}>↑↓</Text>
        <Text color={themeTokens.textSecondary}> move  </Text>
        <Text color={themeTokens.accent}>enter</Text>
        <Text color={themeTokens.textSecondary}> select</Text>
      </Box>
    </Box>
  );
}
