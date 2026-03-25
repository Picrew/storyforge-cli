import React from "react";
import { Box, Text } from "ink";
import {
  getCommandPreviewItems,
  shouldShowCommandPreview
} from "../commands/command-preview.js";
import { CommandPreview } from "../components/CommandPreview.js";
import { ConnectAuthModeDialog } from "../components/ConnectAuthModeDialog.js";
import { ConnectCredentialsDialog } from "../components/ConnectCredentialsDialog.js";
import { ConnectOauthDialog } from "../components/ConnectOauthDialog.js";
import { ModelDialog } from "../components/ModelDialog.js";
import { ProjectDialog } from "../components/ProjectDialog.js";
import { ProviderDialog } from "../components/ProviderDialog.js";
import { getProviderMatches, getProviderOption } from "../data/provider-catalog.js";
import { getContentWidth, shouldCondenseWelcome } from "../layout/viewport.js";
import { themeTokens } from "../theme/tokens.js";
import type { AppState } from "../types.js";
import { Footer } from "../components/Footer.js";
import { Header } from "../components/Header.js";
import { InputFrame } from "../components/InputFrame.js";
import { ResponsePanel } from "../components/ResponsePanel.js";
import { SessionStatus } from "../components/SessionStatus.js";
import { WelcomeCard } from "../components/WelcomeCard.js";
import {
  getSystemOpencodeAuthPath,
  hasOauthCredential
} from "../utils/opencode-auth.js";

interface AppShellProps {
  state: AppState;
  terminalWidth: number;
  terminalHeight?: number;
  cwd: string;
}

export function AppShell({
  state,
  terminalWidth,
  terminalHeight = 30,
  cwd
}: AppShellProps): React.JSX.Element {
  const contentWidth = getContentWidth(terminalWidth);
  const condensedWelcome = shouldCondenseWelcome(contentWidth);
  const showCommandPreview = shouldShowCommandPreview(state.inputValue);
  const commandPreviewItems = showCommandPreview ? getCommandPreviewItems(state.inputValue) : [];
  const overlayWidth = Math.max(32, Math.min(Math.max(terminalWidth - 4, 32), contentWidth));
  const providerModal = state.modal?.kind === "connect-provider" ? state.modal : null;
  const authModeModal = state.modal?.kind === "connect-auth-mode" ? state.modal : null;
  const oauthModal = state.modal?.kind === "connect-oauth" ? state.modal : null;
  const modelModal = state.modal?.kind === "model-picker" ? state.modal : null;
  const providerMatches = providerModal ? getProviderMatches(providerModal.searchValue) : [];
  const authModeProvider = authModeModal ? getProviderOption(authModeModal.providerId) : null;
  const oauthProvider = oauthModal ? getProviderOption(oauthModal.providerId) : null;
  let filteredModelIds: readonly string[] = [];
  let filteredGroupedEntries: readonly import("../types.js").ModelListEntry[] | undefined;

  if (modelModal) {
    const normalizedSearch = modelModal.searchValue.trim().toLowerCase();
    filteredModelIds = modelModal.modelIds.filter((modelId) =>
      modelId.toLowerCase().includes(normalizedSearch)
    );

    if (modelModal.groupedEntries && modelModal.groupedEntries.length > 0) {
      if (!normalizedSearch) {
        filteredGroupedEntries = modelModal.groupedEntries;
      } else {
        const filtered: import("../types.js").ModelListEntry[] = [];
        let lastHeader: import("../types.js").ModelListEntry | null = null;
        let headerHasItems = false;

        for (const entry of modelModal.groupedEntries) {
          if (entry.kind === "header") {
            if (lastHeader && headerHasItems) {
              // keep previous header's items (already pushed)
            }

            lastHeader = entry;
            headerHasItems = false;
          } else if (entry.modelId && entry.modelId.toLowerCase().includes(normalizedSearch)) {
            if (lastHeader && !headerHasItems) {
              filtered.push(lastHeader);
              headerHasItems = true;
            }

            filtered.push(entry);
          }
        }

        if (filtered.length === 0 && normalizedSearch.includes("/") && normalizedSearch.indexOf("/") < normalizedSearch.length - 1) {
          filtered.push({ kind: "header", label: "Use new model" });
          filtered.push({ kind: "item", modelId: normalizedSearch });
        }

        filteredGroupedEntries = filtered.length > 0 ? filtered : undefined;
      }
    }
  }

  const transcriptTurns =
    state.transcript.length > 0
      ? state.transcript
      : state.latestExchange
        ? [{ id: "latest", ...state.latestExchange }]
        : [];
  const hasTranscript = transcriptTurns.length > 0;
  const showWelcome = !hasTranscript;
  const transcriptVisibleLines = Math.max(
    8,
    Math.min(
      26,
      terminalHeight -
        (hasTranscript ? 5 : condensedWelcome ? 18 : 22) -
        (state.transientNotice ? 1 : 0)
    )
  );

  if (state.modal) {
    return (
      <Box width="100%" flexDirection="column" alignItems="center" paddingY={1}>
        <Box width={overlayWidth}>
          {state.modal.kind === "connect-provider" ? (
            <ProviderDialog
              width={overlayWidth}
              providers={providerMatches}
              selectedIndex={state.modal.selectedIndex}
              searchValue={state.modal.searchValue}
            />
          ) : null}
          {state.modal.kind === "connect-credentials" ? (
            <ConnectCredentialsDialog
              width={overlayWidth}
              providerId={state.modal.providerId}
              fieldLabel={state.modal.fieldLabel}
              helperText={state.modal.helperText}
              apiKeyValue={state.modal.apiKeyValue}
            />
          ) : null}
          {state.modal.kind === "connect-auth-mode" && authModeProvider ? (
            <ConnectAuthModeDialog
              width={overlayWidth}
              providerTitle={authModeProvider.title}
              selectedIndex={state.modal.selectedIndex}
            />
          ) : null}
          {state.modal.kind === "connect-oauth" && oauthProvider ? (
            <ConnectOauthDialog
              width={overlayWidth}
              providerId={oauthProvider.id}
              providerTitle={oauthProvider.title}
              helperText={oauthProvider.credentialHelperText}
              hasSavedCredential={
                state.config.connection?.provider === oauthProvider.id &&
                state.config.connection.authMode === "oauth" &&
                Boolean(state.config.connection.apiKey)
              }
              canImportCredential={hasOauthCredential(
                oauthProvider.id,
                getSystemOpencodeAuthPath()
              )}
              flowMode={state.modal.flowMode}
              flowPhase={state.modal.flowPhase}
              authUrl={state.modal.authUrl}
              userCode={state.modal.userCode}
              statusMessage={state.modal.statusMessage}
              errorMessage={state.modal.errorMessage}
            />
          ) : null}
          {state.modal.kind === "model-picker" ? (
            <ModelDialog
              width={overlayWidth}
              providerId={state.modal.providerId}
              modelIds={filteredModelIds}
              selectedIndex={state.modal.selectedIndex}
              searchValue={state.modal.searchValue}
              groupedEntries={filteredGroupedEntries}
            />
          ) : null}
          {state.modal.kind === "project-picker" ? (
            <ProjectDialog
              width={overlayWidth}
              projects={state.storyProjects}
              currentProjectId={state.storyProjectId}
              selectedIndex={state.modal.selectedIndex}
            />
          ) : null}
        </Box>
      </Box>
    );
  }

  return (
    <Box width="100%" flexDirection="column" alignItems="center" paddingY={1}>
      <Box width={contentWidth} flexDirection="column">
        <Header mode={state.viewportMode} />
        {showWelcome ? (
          <Box marginTop={1}>
            <WelcomeCard width={contentWidth} condensed={condensedWelcome} />
          </Box>
        ) : null}
        <Box marginTop={1}>
          <SessionStatus width={contentWidth} config={state.config} />
        </Box>
        {hasTranscript ? (
          <Box marginTop={1}>
            <ResponsePanel
              width={contentWidth}
              turns={transcriptTurns}
              scrollOffset={state.transcriptScrollOffset}
              visibleLines={transcriptVisibleLines}
              pendingTask={state.pendingTask}
            />
          </Box>
        ) : null}
        {state.transientNotice ? (
          <Box marginTop={1}>
            <Text color={themeTokens.notice}>{state.transientNotice.message}</Text>
          </Box>
        ) : null}
        <Box marginTop={1}>
          <InputFrame width={contentWidth} value={state.inputValue} cursorPosition={state.inputCursorPosition} />
        </Box>
        {showCommandPreview ? (
          <Box marginTop={1}>
            <CommandPreview
              width={contentWidth}
              items={commandPreviewItems}
              selectedIndex={state.commandSelectionIndex}
            />
          </Box>
        ) : null}
        <Box marginTop={1}>
          <Footer cwd={cwd} width={contentWidth} pendingTask={state.pendingTask} />
        </Box>
      </Box>
    </Box>
  );
}
