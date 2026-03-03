import React from "react";
import { Box, Text } from "ink";
import { copy } from "../content/copy.js";
import { themeTokens } from "../theme/tokens.js";
import {
  truncateEndByWidth,
  truncateStartByWidth
} from "../utils/display-width.js";

interface InputFrameProps {
  width: number;
  value: string;
}

export function InputFrame({ width, value }: InputFrameProps): React.JSX.Element {
  const prompt = "> ";
  const innerWidth = Math.max(8, width - 6);
  const showHint = width >= 64;
  const divider = "-".repeat(Math.max(8, innerWidth));
  const contentWidth = Math.max(6, innerWidth - prompt.length - 1);
  const displayValue = value
    ? truncateStartByWidth(value, contentWidth - 1)
    : truncateEndByWidth(copy.placeholder, contentWidth);

  return (
    <Box
      width={width}
      flexDirection="column"
      borderStyle="single"
      borderColor={themeTokens.border}
      paddingX={2}
    >
      <Box justifyContent={showHint ? "space-between" : "flex-start"}>
        <Text color={themeTokens.accentSecondary}>PROMPT LANE</Text>
        {showHint ? (
          <Text color={themeTokens.textSecondary}>↑↓ scroll / / commands / Enter sends / Esc exits</Text>
        ) : null}
      </Box>
      <Text color={themeTokens.border}>{divider}</Text>
      <Box>
        <Text color={themeTokens.accent}>{prompt}</Text>
        <Text color={value ? themeTokens.accent : themeTokens.textSecondary}>{displayValue}</Text>
        {value ? <Text color={themeTokens.accent}>_</Text> : null}
      </Box>
    </Box>
  );
}
