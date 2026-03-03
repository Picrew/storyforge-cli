import React from "react";
import { Box, Text } from "ink";
import { copy } from "../content/copy.js";
import { shouldUseCompactFooter } from "../layout/viewport.js";
import { themeTokens } from "../theme/tokens.js";
import { shortenPath, tildeifyPath } from "../utils/path.js";

interface FooterProps {
  cwd: string;
  width: number;
}

export function Footer({ cwd, width }: FooterProps): React.JSX.Element {
  if (shouldUseCompactFooter(width)) {
    return <Text color={themeTokens.textSecondary}>{copy.footer.compact}</Text>;
  }

  const centerLabel = copy.footer.center;
  const rightLabel = copy.footer.right;
  const reservedWidth = centerLabel.length + rightLabel.length + 6;
  const pathWidth = Math.max(10, width - reservedWidth);
  const displayPath = shortenPath(tildeifyPath(cwd), pathWidth);

  return (
    <Box width={width} justifyContent="space-between">
      <Text color={themeTokens.accentSecondary}>{displayPath}</Text>
      <Text color={themeTokens.accent}>[{centerLabel}]</Text>
      <Text color={themeTokens.textSecondary}>{rightLabel}</Text>
    </Box>
  );
}
