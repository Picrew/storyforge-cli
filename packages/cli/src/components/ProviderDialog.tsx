import React from "react";
import { Box, Text } from "ink";
import type { ProviderOption } from "../data/provider-catalog.js";
import { themeTokens } from "../theme/tokens.js";

interface ProviderDialogProps {
  width: number;
  providers: readonly ProviderOption[];
  selectedIndex: number;
  searchValue: string;
}

function truncateEnd(value: string, maxLength: number): string {
  if (maxLength <= 0) {
    return "";
  }

  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength <= 3) {
    return value.slice(0, maxLength);
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

export function ProviderDialog({
  width,
  providers,
  selectedIndex,
  searchValue
}: ProviderDialogProps): React.JSX.Element {
  const valueWidth = Math.max(18, width - 12);
  let previousGroup: ProviderOption["group"] | null = null;

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
          Connect a provider
        </Text>
        <Text color={themeTokens.textSecondary}>esc</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={themeTokens.textSecondary}>Search </Text>
        <Text color={themeTokens.accent}>{searchValue || "_"}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {providers.slice(0, 8).map((provider, index) => {
          const isSelected = index === Math.min(selectedIndex, providers.length - 1);
          const showGroupHeader = provider.group !== previousGroup;
          previousGroup = provider.group;

          return (
            <Box key={provider.id} flexDirection="column">
              {showGroupHeader ? (
                <Text bold color={themeTokens.accent}>
                  {provider.group === "popular" ? "Popular" : "Other"}
                </Text>
              ) : null}
              <Box>
                <Text color={themeTokens.textSecondary}>  </Text>
                <Text
                  color={isSelected ? "black" : themeTokens.textPrimary}
                  backgroundColor={isSelected ? themeTokens.accentSecondary : undefined}
                >
                  {truncateEnd(provider.title, valueWidth)}
                </Text>
                <Text color={themeTokens.textSecondary}> </Text>
                <Text
                  color={isSelected ? "black" : themeTokens.textSecondary}
                  backgroundColor={isSelected ? themeTokens.accentSecondary : undefined}
                >
                  {truncateEnd(provider.subtitle, Math.max(16, valueWidth - provider.title.length))}
                </Text>
              </Box>
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
