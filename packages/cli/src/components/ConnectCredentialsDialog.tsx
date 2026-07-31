import React from "react";
import { Box, Text } from "ink";
import { themeTokens } from "../theme/tokens.js";

interface ConnectCredentialsDialogProps {
  width: number;
  providerId: string;
  fieldLabel: string;
  helperText: string;
  apiKeyValue: string;
}

function renderField(label: string, value: string): React.JSX.Element {
  const maskedValue = value ? "•".repeat(Math.min(value.length, 32)) : "_";

  return (
    <Box>
      <Text color={themeTokens.accent}>{label.padEnd(8, " ")}</Text>
      <Text color={themeTokens.textSecondary}> </Text>
      <Text color="black" backgroundColor={themeTokens.accentSecondary}>
        {maskedValue}
      </Text>
    </Box>
  );
}

export function ConnectCredentialsDialog({
  width,
  providerId,
  fieldLabel,
  helperText,
  apiKeyValue,
}: ConnectCredentialsDialogProps): React.JSX.Element {
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
          Connect {providerId}
        </Text>
        <Text color={themeTokens.textSecondary}>esc</Text>
      </Box>
      <Text color={themeTokens.textSecondary}>{helperText}</Text>
      <Box marginTop={1} flexDirection="column">
        {renderField(fieldLabel, apiKeyValue)}
      </Box>
    </Box>
  );
}
