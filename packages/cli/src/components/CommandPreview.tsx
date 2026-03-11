import React from "react";
import { Box, Text } from "ink";
import type { CommandPreviewItem } from "../commands/command-preview.js";
import { themeTokens } from "../theme/tokens.js";

interface CommandPreviewProps {
  width: number;
  items: readonly CommandPreviewItem[];
  selectedIndex: number;
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

export function CommandPreview({
  width,
  items,
  selectedIndex
}: CommandPreviewProps): React.JSX.Element {
  const divider = " ".repeat(Math.max(8, width - 4));
  const commandWidth = Math.max(10, Math.min(18, Math.floor(width * 0.22)));
  const descriptionWidth = Math.max(16, width - commandWidth - 8);

  return (
    <Box
      width={width}
      flexDirection="column"
      borderStyle="single"
      borderColor={themeTokens.textSecondary}
      paddingX={1}
    >
      {items.map((item, index) => {
        const isSelected = index === Math.min(selectedIndex, items.length - 1);

        return (
          <Box key={item.command}>
            <Text color={themeTokens.textSecondary}>| </Text>
            <Text
              color={isSelected ? "black" : themeTokens.textPrimary}
              backgroundColor={isSelected ? themeTokens.accentSecondary : undefined}
            >
              {item.command.padEnd(commandWidth, " ")}
            </Text>
            <Text color={themeTokens.textSecondary}> </Text>
            <Text
              color={isSelected ? "black" : themeTokens.textSecondary}
              backgroundColor={isSelected ? themeTokens.accentSecondary : undefined}
            >
              {truncateEnd(item.description, descriptionWidth)}
            </Text>
            <Text color={themeTokens.textSecondary}> </Text>
            <Text color={themeTokens.textSecondary}>|</Text>
          </Box>
        );
      })}
      <Text color={themeTokens.textSecondary}>{divider}</Text>
      <Box>
        <Text color={themeTokens.accent}>tab</Text>
        <Text color={themeTokens.textSecondary}> autocomplete</Text>
        <Text color={themeTokens.textSecondary}>  </Text>
        <Text color={themeTokens.accent}>enter</Text>
        <Text color={themeTokens.textSecondary}> select</Text>
        <Text color={themeTokens.textSecondary}>  </Text>
        <Text color={themeTokens.accent}>esc</Text>
        <Text color={themeTokens.textSecondary}> close</Text>
      </Box>
    </Box>
  );
}
