import React from "react";
import { Box, Text } from "ink";
import type { OauthFlowMode, OauthFlowPhase } from "../types.js";
import { themeTokens } from "../theme/tokens.js";
import { wrapTextByWidth } from "../utils/display-width.js";

interface ConnectOauthDialogProps {
  width: number;
  providerId: string;
  providerTitle: string;
  helperText: string;
  hasSavedCredential: boolean;
  canImportCredential: boolean;
  flowMode: OauthFlowMode;
  flowPhase: OauthFlowPhase;
  authUrl: string | null;
  userCode: string | null;
  statusMessage: string | null;
  errorMessage: string | null;
}

function WrappedText({
  label,
  value,
  width,
  color
}: {
  label: string;
  value: string;
  width: number;
  color: string;
}): React.JSX.Element {
  const lines = wrapTextByWidth(value, Math.max(12, width));

  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <Text key={`${label}-${index}`} color={color}>
          {index === 0 ? `${label}${line}` : `${" ".repeat(label.length)}${line}`}
        </Text>
      ))}
    </Box>
  );
}

export function ConnectOauthDialog({
  width,
  providerId,
  providerTitle,
  helperText,
  hasSavedCredential,
  canImportCredential,
  flowMode,
  flowPhase,
  authUrl,
  userCode,
  statusMessage,
  errorMessage
}: ConnectOauthDialogProps): React.JSX.Element {
  const bodyWidth = Math.max(18, width - 8);
  const showOpenAIModePicker = providerId === "openai" && !hasSavedCredential;
  const isWaiting = flowPhase === "launching" || flowPhase === "waiting";

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
      <Text color={themeTokens.textSecondary}>{helperText}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text color={themeTokens.textPrimary}>
          {hasSavedCredential
            ? `A saved ${providerTitle} browser token already exists in .storyforge.`
            : providerId === "openai"
              ? flowMode === "headless"
                ? "Press Enter to start the OpenAI device-code flow."
                : "Press Enter to start the OpenAI browser verification flow."
              : "Press Enter to start the browser verification flow."}
        </Text>
        <Text color={themeTokens.textSecondary}>
          {hasSavedCredential
            ? "Enter will reuse it for this connection."
            : providerId === "openai"
              ? flowMode === "headless"
                ? "Storyforge will generate a code, poll OpenAI, then persist the token in .storyforge."
                : "Storyforge will open the verification page, wait for the callback, then persist the token in .storyforge."
              : "If a verification URL appears, finish it in the browser and Storyforge will persist the token."}
        </Text>
        {showOpenAIModePicker ? (
          <Box marginTop={1}>
            <Text color={themeTokens.textSecondary}>Mode </Text>
            <Text
              color={flowMode === "browser" ? "black" : themeTokens.textPrimary}
              backgroundColor={flowMode === "browser" ? themeTokens.accentSecondary : undefined}
            >
              Browser
            </Text>
            <Text color={themeTokens.textSecondary}>  </Text>
            <Text
              color={flowMode === "headless" ? "black" : themeTokens.textPrimary}
              backgroundColor={flowMode === "headless" ? themeTokens.accentSecondary : undefined}
            >
              Headless
            </Text>
          </Box>
        ) : null}
        {!hasSavedCredential && !isWaiting ? (
          <Box>
            <Text color={themeTokens.accent}>Verification</Text>
            <Text color={themeTokens.textSecondary}>
              {providerId === "openai" && flowMode === "headless"
                ? " page and code appear during the next step."
                : " link appears during the next step."}
            </Text>
          </Box>
        ) : null}
        {!hasSavedCredential && canImportCredential ? (
          <Text color={themeTokens.textSecondary}>
            A reusable local credential is also available as a fallback.
          </Text>
        ) : null}
        {statusMessage ? (
          <Text color={themeTokens.accentSecondary}>{statusMessage}</Text>
        ) : null}
        {userCode ? (
          <Text color={themeTokens.accent}>Code: {userCode}</Text>
        ) : null}
        {authUrl ? (
          <WrappedText
            label="URL: "
            value={authUrl}
            width={bodyWidth - 5}
            color={themeTokens.textPrimary}
          />
        ) : null}
        {errorMessage ? (
          <WrappedText
            label="Error: "
            value={errorMessage}
            width={bodyWidth - 7}
            color={themeTokens.notice}
          />
        ) : null}
      </Box>
      <Box marginTop={1}>
        <Text color={themeTokens.accent}>enter</Text>
        <Text color={themeTokens.textSecondary}>
          {hasSavedCredential ? " continue  " : isWaiting ? " pending  " : " continue  "}
        </Text>
        {showOpenAIModePicker && !isWaiting ? (
          <>
            <Text color={themeTokens.accent}>tab</Text>
            <Text color={themeTokens.textSecondary}> mode  </Text>
          </>
        ) : null}
        <Text color={themeTokens.accent}>esc</Text>
        <Text color={themeTokens.textSecondary}>{isWaiting ? " cancel" : " back"}</Text>
      </Box>
    </Box>
  );
}
