import React from "react";
import { Box, Text } from "ink";
import { themeTokens } from "../theme/tokens.js";
import type { SessionConfig } from "../types.js";

function stripProviderFromModel(model: string, provider: string | null): string {
  if (!provider) {
    return model;
  }

  const prefix = `${provider}/`;

  if (model.toLowerCase().startsWith(prefix.toLowerCase())) {
    return model.slice(prefix.length);
  }

  return model;
}

interface SessionStatusProps {
  width: number;
  config: SessionConfig;
}

interface StatusRow {
  label: string;
  value: string;
  highlighted?: boolean;
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

function getAuthStatus(config: SessionConfig): string {
  if (!config.connection) {
    return "waiting for credentials";
  }

  if (config.connection.authMode === "oauth") {
    return config.connection.authLabel ?? "Connected via browser auth";
  }

  if (config.connection.apiKey) {
    return "API key saved";
  }

  return config.connection.authLabel ?? "Saved in .storyforge";
}

export function SessionStatus({ width, config }: SessionStatusProps): React.JSX.Element {
  const showBadge = width >= 52;
  const divider = "-".repeat(Math.max(12, width - 6));
  const valueWidth = Math.max(14, width - 18);
  const rows: StatusRow[] = [
    {
      label: "provider",
      value: config.connection?.provider ?? "run /connect",
      highlighted: !config.connection
    },
    {
      label: "model",
      value: config.model
        ? stripProviderFromModel(config.model, config.connection?.provider ?? null)
        : "run /models",
      highlighted: !config.model
    },
    {
      label: "auth",
      value: getAuthStatus(config)
    }
  ];

  if (config.connection?.baseUrl) {
    rows.push({
      label: "base url",
      value: config.connection.baseUrl
    });
  }

  return (
    <Box
      width={width}
      flexDirection="column"
      borderStyle="single"
      borderColor={themeTokens.border}
      paddingX={2}
    >
      <Box justifyContent={showBadge ? "space-between" : "flex-start"}>
        <Text bold color={themeTokens.accent}>
          MODEL SETUP
        </Text>
        {showBadge ? (
          <Text color={themeTokens.accentSecondary}>
            {config.model ? "PERSISTED" : "READY"}
          </Text>
        ) : null}
      </Box>
      <Text color={themeTokens.border}>{divider}</Text>
      {rows.map((row) => (
        <Box key={row.label}>
          <Text color={themeTokens.accent}>{row.label.toUpperCase().padEnd(8, " ")}</Text>
          <Text color={themeTokens.accentSecondary}> | </Text>
          <Text color={row.highlighted ? themeTokens.accent : themeTokens.textPrimary}>
            {truncateEnd(row.value, valueWidth)}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
