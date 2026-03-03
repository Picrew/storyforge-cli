import type { PropsWithChildren } from "react";
import React from "react";
import { Box, Text } from "ink";
import Gradient from "ink-gradient";
import { themeTokens, shouldUseGradient } from "../theme/tokens.js";

export function GradientText({ children }: PropsWithChildren): React.JSX.Element {
  if (!shouldUseGradient()) {
    return <Text color={themeTokens.accent}>{children}</Text>;
  }

  if (typeof children !== "string") {
    return (
      <Gradient colors={[...themeTokens.gradient]}>
        <Text>{children}</Text>
      </Gradient>
    );
  }

  const lines = children.split("\n");

  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <Gradient key={`${index}-${line}`} colors={[...themeTokens.gradient]}>
          <Text>{line.length > 0 ? line : " "}</Text>
        </Gradient>
      ))}
    </Box>
  );
}
