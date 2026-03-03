import React from "react";
import { Box, Text } from "ink";
import { themeTokens } from "../theme/tokens.js";
import { truncateEndByWidth } from "../utils/display-width.js";

interface ModelDialogProps {
  width: number;
  providerId: string;
  modelIds: readonly string[];
  selectedIndex: number;
  searchValue: string;
}

export function ModelDialog({
  width,
  providerId,
  modelIds,
  selectedIndex,
  searchValue
}: ModelDialogProps): React.JSX.Element {
  const valueWidth = Math.max(18, width - 8);
  const windowSize = 10;
  const safeSelectedIndex =
    modelIds.length > 0 ? Math.min(selectedIndex, modelIds.length - 1) : 0;
  const maxStartIndex = Math.max(0, modelIds.length - windowSize);
  const startIndex = Math.min(
    maxStartIndex,
    Math.max(0, safeSelectedIndex - Math.floor(windowSize / 2))
  );
  const visibleModelIds = modelIds.slice(startIndex, startIndex + windowSize);
  const shownEndIndex = visibleModelIds.length > 0 ? startIndex + visibleModelIds.length : 0;

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
          Switch model
        </Text>
        <Text color={themeTokens.textSecondary}>esc</Text>
      </Box>
      <Text color={themeTokens.textSecondary}>{providerId}</Text>
      <Box marginTop={1}>
        <Text color={themeTokens.textSecondary}>Search </Text>
        <Text color={themeTokens.accent}>{searchValue || "_"}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {visibleModelIds.length === 0 ? (
          <Text color={themeTokens.textSecondary}>  No matching models.</Text>
        ) : null}
        {visibleModelIds.map((modelId, index) => {
          const listIndex = startIndex + index;
          const isSelected = listIndex === safeSelectedIndex;

          return (
            <Box key={modelId}>
              <Text color={themeTokens.textSecondary}>  </Text>
              <Text
                color={isSelected ? "black" : themeTokens.textPrimary}
                backgroundColor={isSelected ? themeTokens.accentSecondary : undefined}
              >
                {truncateEndByWidth(modelId, valueWidth)}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text color={themeTokens.textSecondary}>
          {visibleModelIds.length === 0
            ? "0 models"
            : `showing ${startIndex + 1}-${shownEndIndex} of ${modelIds.length}`}
        </Text>
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
