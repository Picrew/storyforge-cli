import React, { useEffect, useRef, useState } from "react";
import { useApp, useInput, useStdout } from "ink";
import {
  applyConnectCommand,
  applyModelCommand
} from "../commands/command-actions.js";
import {
  getCommandAutocompleteValue,
  getCommandPreviewItems,
  getSelectedCommandPreviewItem,
  isExitCommand,
  shouldShowCommandPreview
} from "../commands/command-preview.js";
import { getProviderMatches, getProviderOption } from "../data/provider-catalog.js";
import {
  appendConnectCredentialsCharacter,
  appendInputCharacter,
  applyConfigAndNotice,
  clearExpiredNotice,
  clearInputValue,
  closeModal,
  createInitialAppState,
  deleteConnectCredentialsCharacter,
  deleteInputCharacter,
  moveConnectAuthModeSelection,
  moveCommandSelection,
  moveConnectProviderSelection,
  moveModelPickerSelection,
  moveTranscriptScroll,
  openConnectAuthModeModal,
  openConnectCredentialsModal,
  openConnectOauthModal,
  openConnectProviderModal,
  openModelPickerModal,
  resetTranscriptScroll,
  reopenConnectProviderModal,
  replaceInputValue,
  setConnectProviderSearch,
  setConnectOauthFlowState,
  setModelPickerSearch,
  setTransientNotice,
  syncViewportMode,
  toggleConnectOauthFlowMode
} from "../state/app-state.js";
import { AppShell } from "./AppShell.js";
import type {
  AppState,
  SessionConfig,
  SessionConnection,
  TranscriptEntry
} from "../types.js";
import {
  getDefaultSessionConfigPath,
  loadSessionConfig,
  saveSessionConfig
} from "../utils/session-config.js";
import {
  getSystemOpencodeAuthPath,
  getOauthCredential,
  hasOauthCredential,
  launchOauthLogin,
  syncApiCredential,
  syncOauthCredential,
  syncOauthCredentialRecord
} from "../utils/opencode-auth.js";
import { startOpenAIOauthSession } from "../utils/openai-oauth.js";
import { getModelOptionsForProvider } from "../utils/opencode-models.js";
import {
  normalizeAssistantText,
  startOpencodeStream
} from "../utils/opencode-run.js";

export interface AppProps {
  terminalWidthOverride?: number;
  cwdOverride?: string;
  configPathOverride?: string;
  initialConfigOverride?: SessionConfig;
}

function getAvailableModelIds(config: SessionConfig, providerId: string): readonly string[] {
  const modelIds = getModelOptionsForProvider(providerId).map((model) => model.id);

  if (config.model && !modelIds.includes(config.model)) {
    return [config.model, ...modelIds];
  }

  return modelIds;
}

function getFilteredModelIds(state: AppState): readonly string[] {
  if (!state.modal || state.modal.kind !== "model-picker") {
    return [];
  }

  const normalizedSearch = state.modal.searchValue.trim().toLowerCase();

  if (!normalizedSearch) {
    return state.modal.modelIds;
  }

  return state.modal.modelIds.filter((modelId) => modelId.toLowerCase().includes(normalizedSearch));
}

function parseCommandInput(inputValue: string): { command: string; args: string[] } | null {
  const rawInput = inputValue.trim();

  if (!rawInput.startsWith("/")) {
    return null;
  }

  const [command, ...args] = rawInput.split(/\s+/);

  return {
    command: command.toLowerCase(),
    args
  };
}

export function App({
  terminalWidthOverride,
  cwdOverride,
  configPathOverride,
  initialConfigOverride
}: AppProps = {}): React.JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const terminalWidth = terminalWidthOverride ?? stdout?.columns ?? 80;
  const terminalHeight = stdout?.rows ?? 30;
  const configPath = configPathOverride ?? getDefaultSessionConfigPath();
  const [state, setState] = useState<AppState>(() =>
    createInitialAppState(
      terminalWidth,
      initialConfigOverride ?? loadSessionConfig(configPath)
    )
  );
  const stateRef = useRef(state);
  const streamProcessRef = useRef<ReturnType<typeof startOpencodeStream> | null>(null);
  const streamRunIdRef = useRef(0);
  const oauthSessionRef = useRef<Awaited<ReturnType<typeof startOpenAIOauthSession>> | null>(null);
  const oauthRunIdRef = useRef(0);
  const cwd = cwdOverride ?? process.cwd();

  const applyStateUpdate = (updater: (currentState: AppState) => AppState): void => {
    setState((currentState) => {
      const nextState = updater(currentState);
      stateRef.current = nextState;
      return nextState;
    });
  };

  const commitState = (nextState: AppState): void => {
    stateRef.current = nextState;
    setState(nextState);
  };

  const stopStreamingProcess = (): void => {
    streamRunIdRef.current += 1;

    if (!streamProcessRef.current) {
      return;
    }

    streamProcessRef.current.kill();
    streamProcessRef.current = null;
  };

  const clearOauthSession = (): void => {
    if (!oauthSessionRef.current) {
      return;
    }

    oauthSessionRef.current.cancel();
    oauthSessionRef.current = null;
  };

  const stopOauthSession = (): void => {
    oauthRunIdRef.current += 1;
    clearOauthSession();
  };

  const persistConfig = (nextState: AppState, configToPersist: SessionConfig | null): AppState => {
    if (!configToPersist) {
      return nextState;
    }

    const saveError = saveSessionConfig(configToPersist, configPath);

    if (!saveError) {
      return nextState;
    }

    return setTransientNotice(
      nextState,
      `Saved for this run, but persistence failed: ${saveError}`
    );
  };

  const getLatestTranscriptEntry = (
    transcript: readonly TranscriptEntry[]
  ): TranscriptEntry | null => transcript[transcript.length - 1] ?? null;

  const appendTranscriptEntry = (
    currentState: AppState,
    entry: TranscriptEntry
  ): AppState => ({
    ...currentState,
    latestExchange: entry,
    transcript: [...currentState.transcript, entry],
    transcriptScrollOffset: 0
  });

  const updateLatestTranscriptEntry = (
    currentState: AppState,
    updater: (entry: TranscriptEntry) => TranscriptEntry
  ): AppState => {
    const latestEntry = getLatestTranscriptEntry(currentState.transcript);

    if (!latestEntry) {
      return currentState;
    }

    const nextEntry = updater(latestEntry);

    return {
      ...currentState,
      latestExchange: nextEntry,
      transcript: [...currentState.transcript.slice(0, -1), nextEntry]
    };
  };

  const syncManagedOauthCredential = (
    providerId: string,
    sourcePath?: string
  ): { accessToken: string | null; syncError: string | null } => {
    const credential = getOauthCredential(providerId, sourcePath);

    if (!credential) {
      return {
        accessToken: null,
        syncError: null
      };
    }

    return {
      accessToken: credential.access,
      syncError: syncOauthCredentialRecord(providerId, credential)
    };
  };

  const beginNativeOpenAIOauthFlow = async (currentState: AppState): Promise<void> => {
    if (
      !currentState.modal ||
      currentState.modal.kind !== "connect-oauth" ||
      currentState.modal.providerId !== "openai"
    ) {
      return;
    }

    const flowMode = currentState.modal.flowMode;
    stopOauthSession();
    const runId = oauthRunIdRef.current;
    commitState(
      setConnectOauthFlowState(currentState, {
        flowPhase: "launching",
        authUrl: null,
        userCode: null,
        statusMessage:
          flowMode === "headless"
            ? "Requesting a device code from OpenAI..."
            : "Starting the local callback server...",
        errorMessage: null
      })
    );

    try {
      const session = await startOpenAIOauthSession(flowMode);

      if (oauthRunIdRef.current !== runId) {
        session.cancel();
        return;
      }

      oauthSessionRef.current = session;
      const waitingState = stateRef.current;

      if (
        waitingState.modal &&
        waitingState.modal.kind === "connect-oauth" &&
        waitingState.modal.providerId === "openai"
      ) {
        commitState(
          setConnectOauthFlowState(waitingState, {
            flowPhase: "waiting",
            authUrl: session.authUrl,
            userCode: session.userCode,
            statusMessage:
              flowMode === "headless"
                ? "OpenAI is waiting for the device-code confirmation."
                : session.browserOpened
                  ? "Browser opened. Finish the sign-in page to continue."
                  : "Open the URL below manually, then finish the sign-in page.",
            errorMessage: null
          })
        );
      }

      const credential = await session.waitForCompletion();

      if (oauthRunIdRef.current !== runId) {
        return;
      }

      oauthSessionRef.current = null;
      const activeState = stateRef.current;

      if (
        !activeState.modal ||
        activeState.modal.kind !== "connect-oauth" ||
        activeState.modal.providerId !== "openai"
      ) {
        return;
      }

      const now = Date.now();
      const authSyncError = syncOauthCredentialRecord("openai", {
        access: credential.accessToken,
        refresh: credential.refreshToken,
        expires: credential.expiresAt,
        accountId: credential.accountId
      });
      const connectedState = connectWithSession(
        closeModal(activeState),
        {
          provider: "openai",
          authMode: "oauth",
          apiKey: credential.accessToken,
          baseUrl: null,
          authLabel: "ChatGPT Plus/Pro"
        },
        now
      );
      const nextState = openModelPickerForCurrentConnection(
        authSyncError
          ? setTransientNotice(
              connectedState,
              `Connected OpenAI, but the oauth cache failed to save: ${authSyncError}`,
              now
            )
          : connectedState,
        now
      );

      commitState(nextState);
    } catch (error) {
      if (oauthRunIdRef.current !== runId) {
        return;
      }

      oauthSessionRef.current = null;
      const activeState = stateRef.current;

      if (
        !activeState.modal ||
        activeState.modal.kind !== "connect-oauth" ||
        activeState.modal.providerId !== "openai"
      ) {
        return;
      }

      const reusableCredential = getOauthCredential("openai", getSystemOpencodeAuthPath());

      if (reusableCredential) {
        const now = Date.now();
        const cacheSyncError = syncOauthCredentialRecord("openai", reusableCredential);
        const connectedState = connectWithSession(
          closeModal(activeState),
          {
            provider: "openai",
            authMode: "oauth",
            apiKey: reusableCredential.access,
            baseUrl: null,
            authLabel: "ChatGPT Plus/Pro"
          },
          now
        );
        const nextState = openModelPickerForCurrentConnection(
          setTransientNotice(
            connectedState,
            cacheSyncError
              ? `OpenAI browser auth failed, and the fallback credential imported but could not refresh the local oauth cache: ${cacheSyncError}`
              : "OpenAI browser auth failed, so Storyforge imported the existing local opencode credential instead.",
            now
          ),
          now
        );

        commitState(nextState);
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      commitState(
        setConnectOauthFlowState(activeState, {
          flowPhase: "failed",
          statusMessage: "Press Enter to retry, or Tab to switch to the other OpenAI flow.",
          errorMessage: message
        })
      );
    }
  };

  const openProviderConnectFlow = (currentState: AppState, providerId: string, now: number): AppState => {
    const providerOption = getProviderOption(providerId);

    if (!providerOption) {
      return setTransientNotice(currentState, `Unknown provider: ${providerId}`, now);
    }

    if (providerOption.authKind === "choice") {
      return openConnectAuthModeModal(currentState, providerOption.id);
    }

    if (providerOption.authKind === "oauth") {
      return openConnectOauthModal(currentState, providerOption.id);
    }

    return openConnectCredentialsModal(
      currentState,
      providerOption.id,
      providerOption.credentialLabel,
      providerOption.credentialHelperText
    );
  };

  const connectWithSession = (
    currentState: AppState,
    connection: SessionConnection,
    now: number
  ): AppState => {
    stopStreamingProcess();
    stopOauthSession();
    const connectResult = applyConnectCommand(currentState.config, connection);
    const nextState = applyConfigAndNotice(
      {
        ...currentState,
        latestExchange:
          getLatestTranscriptEntry(currentState.transcript) ?? currentState.latestExchange,
        pendingRequest: false,
        opencodeSessionId: null
      },
      connectResult.nextConfig,
      connectResult.message,
      now
    );

    return persistConfig(nextState, connectResult.nextConfig);
  };

  const primeConnectionForRun = (connection: SessionConnection): string | null => {
    if (!connection.apiKey) {
      return null;
    }

    if (connection.authMode === "oauth") {
      return syncOauthCredential(connection.provider, connection.apiKey);
    }

    return syncApiCredential(connection.provider, connection.apiKey);
  };

  const openModelPickerForCurrentConnection = (currentState: AppState, now: number): AppState => {
    if (!currentState.config.connection) {
      return setTransientNotice(currentState, "Run /connect first.", now);
    }

    const providerId = currentState.config.connection.provider;
    const modelIds = getAvailableModelIds(currentState.config, providerId);

    if (modelIds.length === 0) {
      return setTransientNotice(currentState, `No models found for ${providerId}.`, now);
    }

    const selectedIndex = currentState.config.model
      ? Math.max(0, modelIds.indexOf(currentState.config.model))
      : 0;

    return openModelPickerModal(currentState, providerId, modelIds, selectedIndex);
  };

  const handlePlainPromptSubmit = (currentState: AppState, now: number): AppState => {
    const prompt = currentState.inputValue.trim();

    if (!prompt) {
      return currentState;
    }

    const currentConnection = currentState.config.connection;
    const currentModel = currentState.config.model;

    if (!currentConnection) {
      return setTransientNotice(clearInputValue(currentState), "Run /connect first.", now);
    }

    if (!currentModel) {
      return setTransientNotice(clearInputValue(currentState), "Run /models first.", now);
    }

    if (currentState.pendingRequest) {
      return setTransientNotice(currentState, "Wait for the current reply to finish.", now);
    }

    const syncError = primeConnectionForRun(currentConnection);

    if (syncError) {
      const failedEntry: TranscriptEntry = {
        id: `turn-${Date.now()}-error`,
        prompt,
        response: syncError,
        provider: currentConnection.provider,
        model: currentModel,
        failed: true
      };

      return appendTranscriptEntry(
        {
          ...clearInputValue(currentState),
          transientNotice: {
            message: "Credential sync failed before sending.",
            expiresAt: now + 2_500
          }
        },
        failedEntry
      );
    }
    stopStreamingProcess();
    const streamRunId = streamRunIdRef.current + 1;
    streamRunIdRef.current = streamRunId;
    const pendingEntry: TranscriptEntry = {
      id: `turn-${Date.now()}-${streamRunId}`,
      prompt,
      response: "",
      provider: currentConnection.provider,
      model: currentModel,
      failed: false,
      rawResponse: "",
      streaming: true
    };
    const initialState = appendTranscriptEntry(
      {
        ...clearInputValue(currentState),
        transientNotice: null,
        pendingRequest: true
      },
      pendingEntry
    );

    streamProcessRef.current = startOpencodeStream({
      cwd,
      model: currentModel,
      prompt,
      sessionId: currentState.opencodeSessionId,
      onSessionId: (sessionId) => {
        if (streamRunIdRef.current !== streamRunId) {
          return;
        }

        applyStateUpdate((activeState) => {
          if (activeState.opencodeSessionId === sessionId) {
            return activeState;
          }

          return {
            ...activeState,
            opencodeSessionId: sessionId
          };
        });
      },
      onText: (chunk) => {
        if (streamRunIdRef.current !== streamRunId) {
          return;
        }

        applyStateUpdate((activeState) => {
          if (!getLatestTranscriptEntry(activeState.transcript)) {
            return activeState;
          }

          return updateLatestTranscriptEntry(activeState, (latestEntry) => {
            const rawResponse = `${latestEntry.rawResponse ?? ""}${chunk}`;

            return {
              ...latestEntry,
              rawResponse,
              response: normalizeAssistantText(rawResponse),
              streaming: true
            };
          });
        });
      },
      onError: (message) => {
        if (streamRunIdRef.current !== streamRunId) {
          return;
        }

        streamProcessRef.current = null;
        applyStateUpdate((activeState) => {
          const nextState = updateLatestTranscriptEntry(activeState, (latestEntry) => ({
            ...latestEntry,
            failed: true,
            streaming: false,
            response: latestEntry.response || message,
            rawResponse: latestEntry.rawResponse || message
          }));

          return {
            ...nextState,
            pendingRequest: false,
            transientNotice: {
              message: "Message send failed.",
              expiresAt: Date.now() + 2_500
            }
          };
        });
      },
      onComplete: () => {
        if (streamRunIdRef.current !== streamRunId) {
          return;
        }

        streamProcessRef.current = null;
        applyStateUpdate((activeState) => {
          const latestEntry = getLatestTranscriptEntry(activeState.transcript);

          if (!latestEntry) {
            return {
              ...activeState,
              pendingRequest: false
            };
          }

          const normalized = normalizeAssistantText(
            latestEntry.rawResponse ?? latestEntry.response
          );

          return {
            ...updateLatestTranscriptEntry(activeState, (currentEntry) => ({
              ...currentEntry,
              response: normalized,
              rawResponse: currentEntry.rawResponse ?? currentEntry.response,
              streaming: false
            })),
            pendingRequest: false
          };
        });
      }
    });

    return initialState;
  };

  const executePaletteAction = (currentState: AppState, now: number): { nextState: AppState; shouldExit: boolean } => {
    const paletteState = clearInputValue(currentState);
    const selectedItem = getSelectedCommandPreviewItem(
      currentState.inputValue,
      currentState.commandSelectionIndex
    );

    if (!selectedItem) {
      return {
        nextState: currentState,
        shouldExit: false
      };
    }

    if (selectedItem.action === "connect") {
      return {
        nextState: openConnectProviderModal(paletteState),
        shouldExit: false
      };
    }

    if (selectedItem.action === "models") {
      return {
        nextState: openModelPickerForCurrentConnection(paletteState, now),
        shouldExit: false
      };
    }

    return {
      nextState: paletteState,
      shouldExit: true
    };
  };

  const handleConnectProviderSubmit = (currentState: AppState): AppState => {
    if (!currentState.modal || currentState.modal.kind !== "connect-provider") {
      return currentState;
    }

    const providers = getProviderMatches(currentState.modal.searchValue);
    const selectedProvider = providers[Math.min(currentState.modal.selectedIndex, providers.length - 1)];

    if (!selectedProvider) {
      return currentState;
    }

    return openProviderConnectFlow(currentState, selectedProvider.id, Date.now());
  };

  const handleConnectAuthModeSubmit = (currentState: AppState, now: number): AppState => {
    if (!currentState.modal || currentState.modal.kind !== "connect-auth-mode") {
      return currentState;
    }

    const providerOption = getProviderOption(currentState.modal.providerId);

    if (!providerOption) {
      return setTransientNotice(closeModal(currentState), "Unknown provider.", now);
    }

    if (currentState.modal.selectedIndex <= 0) {
      return openConnectOauthModal(currentState, providerOption.id);
    }

    return openConnectCredentialsModal(
      currentState,
      providerOption.id,
      "API key",
      "Enter saves to .storyforge and opens model picker."
    );
  };

  const handleConnectOauthSubmit = (currentState: AppState, now: number): AppState => {
    if (!currentState.modal || currentState.modal.kind !== "connect-oauth") {
      return currentState;
    }

    const providerOption = getProviderOption(currentState.modal.providerId);

    if (!providerOption) {
      return setTransientNotice(closeModal(currentState), "Unknown provider.", now);
    }

    const storedToken =
      currentState.config.connection?.provider === providerOption.id &&
      currentState.config.connection.authMode === "oauth" &&
      currentState.config.connection.apiKey
        ? currentState.config.connection.apiKey
        : null;
    let loginError: string | null = null;

    if (!storedToken) {
      if (providerOption.id === "openai") {
        return currentState;
      }

      loginError = launchOauthLogin(providerOption.id);
    }

    const managedCredential = syncManagedOauthCredential(providerOption.id);
    const reusableCredential = hasOauthCredential(providerOption.id, getSystemOpencodeAuthPath())
      ? syncManagedOauthCredential(providerOption.id, getSystemOpencodeAuthPath())
      : { accessToken: null, syncError: null };
    const accessToken =
      storedToken ?? managedCredential.accessToken ?? reusableCredential.accessToken;
    const syncError =
      managedCredential.accessToken
        ? managedCredential.syncError
        : reusableCredential.accessToken
          ? reusableCredential.syncError
          : null;

    if (!accessToken) {
      return setTransientNotice(
        closeModal(currentState),
        loginError ?? `No ${providerOption.title} credential was detected after login.`,
        now
      );
    }

    let connectedState = connectWithSession(
      closeModal(currentState),
      {
        provider: providerOption.id,
        authMode: "oauth",
        apiKey: accessToken,
        baseUrl: null,
        authLabel: providerOption.authLabel
      },
      now
    );

    if (syncError) {
      connectedState = setTransientNotice(
        connectedState,
        `Connected ${providerOption.title}, but the oauth cache failed to save: ${syncError}`,
        now
      );
    }

    if (loginError && !storedToken) {
      return openModelPickerForCurrentConnection(
        setTransientNotice(
          connectedState,
          `Imported an existing ${providerOption.title} credential because browser auth could not be reopened here.`,
          now
        ),
        now
      );
    }

    return openModelPickerForCurrentConnection(connectedState, now);
  };

  const handleConnectCredentialsSubmit = (currentState: AppState, now: number): AppState => {
    if (!currentState.modal || currentState.modal.kind !== "connect-credentials") {
      return currentState;
    }

    const apiKey = currentState.modal.apiKeyValue.trim();

    if (!apiKey) {
      return setTransientNotice(currentState, "API key is required.", now);
    }

    const providerOption = getProviderOption(currentState.modal.providerId);
    const connection: SessionConnection = {
      provider: currentState.modal.providerId,
      authMode: "api",
      apiKey,
      baseUrl: null,
      authLabel: providerOption?.authLabel ?? "Saved in .storyforge"
    };
    const persistedState = connectWithSession(closeModal(currentState), connection, now);

    return openModelPickerForCurrentConnection(persistedState, now);
  };

  const handleModelPickerSubmit = (currentState: AppState, now: number): AppState => {
    if (!currentState.modal || currentState.modal.kind !== "model-picker") {
      return currentState;
    }

    const filteredModelIds = getFilteredModelIds(currentState);
    const selectedModelId =
      filteredModelIds[Math.min(currentState.modal.selectedIndex, filteredModelIds.length - 1)];

    if (!selectedModelId) {
      return setTransientNotice(currentState, "No matching models.", now);
    }

    const outcome = applyModelCommand(currentState.config, selectedModelId);

    if ("error" in outcome) {
      return setTransientNotice(currentState, outcome.error, now);
    }

    const nextState = applyConfigAndNotice(
      {
        ...closeModal(currentState),
        latestExchange:
          getLatestTranscriptEntry(currentState.transcript) ?? currentState.latestExchange,
        opencodeSessionId: null
      },
      outcome.nextConfig,
      outcome.message,
      now
    );

    return persistConfig(nextState, outcome.nextConfig);
  };

  const handleCommandSubmit = (currentState: AppState, now: number): { nextState: AppState; shouldExit: boolean } => {
    if (shouldShowCommandPreview(currentState.inputValue)) {
      return executePaletteAction(currentState, now);
    }

    const parsedCommand = parseCommandInput(currentState.inputValue);

    if (!parsedCommand) {
      return {
        nextState: handlePlainPromptSubmit(currentState, now),
        shouldExit: false
      };
    }

    switch (parsedCommand.command) {
      case "/connect":
        if (parsedCommand.args.length === 0) {
          return {
            nextState: openConnectProviderModal(currentState),
            shouldExit: false
          };
        }

        {
          const provider = parsedCommand.args[0]?.toLowerCase();
          const providerOption = provider ? getProviderOption(provider) : null;

          if (!providerOption) {
            return {
              nextState: setTransientNotice(clearInputValue(currentState), `Unknown provider: ${provider ?? ""}`, now),
              shouldExit: false
            };
          }

          if (parsedCommand.args.length === 1) {
            return {
              nextState: openProviderConnectFlow(currentState, providerOption.id, now),
              shouldExit: false
            };
          }

          if (providerOption.authKind === "oauth") {
            return {
              nextState: setTransientNotice(
                clearInputValue(currentState),
                `Use /connect and select ${providerOption.title} to launch its OAuth flow.`,
                now
              ),
              shouldExit: false
            };
          }
        }

        if (parsedCommand.args.length < 2) {
          return {
            nextState: setTransientNotice(clearInputValue(currentState), "Usage: /connect <provider> <api-key> [base-url]", now),
            shouldExit: false
          };
        }

        {
          const [providerRaw, apiKey, ...baseUrlParts] = parsedCommand.args;
          const provider = providerRaw.toLowerCase();
          const nextState = connectWithSession(
            currentState,
            {
              provider,
              authMode: "api",
              apiKey,
              baseUrl: baseUrlParts.length > 0 ? baseUrlParts.join(" ").trim() || null : null,
              authLabel: "Saved in .storyforge"
            },
            now
          );

          return {
            nextState,
            shouldExit: false
          };
        }
      case "/model":
      case "/models":
        if (parsedCommand.args.length === 0) {
          return {
            nextState: openModelPickerForCurrentConnection(currentState, now),
            shouldExit: false
          };
        }

        if (parsedCommand.args.length !== 1) {
          return {
            nextState: setTransientNotice(clearInputValue(currentState), "Usage: /model <provider/model>", now),
            shouldExit: false
          };
        }

        {
          const outcome = applyModelCommand(currentState.config, parsedCommand.args[0]);

          if ("error" in outcome) {
            return {
              nextState: setTransientNotice(clearInputValue(currentState), outcome.error, now),
              shouldExit: false
            };
          }

          const nextState = applyConfigAndNotice(
            {
              ...currentState,
              latestExchange:
                getLatestTranscriptEntry(currentState.transcript) ?? currentState.latestExchange,
              opencodeSessionId: null
            },
            outcome.nextConfig,
            outcome.message,
            now
          );

          return {
            nextState: persistConfig(nextState, outcome.nextConfig),
            shouldExit: false
          };
        }
      case "/exit":
        return {
          nextState: currentState,
          shouldExit: true
        };
      default:
        return {
          nextState: setTransientNotice(
            clearInputValue(currentState),
            `Unknown command: ${parsedCommand.command}`,
            now
          ),
          shouldExit: false
        };
    }
  };

  useEffect(() => {
    applyStateUpdate((currentState) => syncViewportMode(currentState, terminalWidth));
  }, [terminalWidth]);

  useEffect(() => {
    if (!state.transientNotice) {
      return undefined;
    }

    const timeout = Math.max(0, state.transientNotice.expiresAt - Date.now());
    const timer = setTimeout(() => {
      applyStateUpdate((currentState) => clearExpiredNotice(currentState));
    }, timeout);

    return () => {
      clearTimeout(timer);
    };
  }, [state.transientNotice]);

  useEffect(() => {
    return () => {
      stopStreamingProcess();
      stopOauthSession();
    };
  }, []);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }

    const currentState = stateRef.current;

    if (currentState.modal) {
      if (key.escape) {
        if (currentState.modal.kind === "connect-oauth") {
          stopOauthSession();
        }

        if (
          currentState.modal.kind === "connect-auth-mode" ||
          currentState.modal.kind === "connect-credentials" ||
          currentState.modal.kind === "connect-oauth"
        ) {
          commitState(reopenConnectProviderModal(currentState, currentState.modal.providerId));
          return;
        }

        commitState(closeModal(currentState));
        return;
      }

      if (currentState.modal.kind === "connect-provider") {
        const providerCount = getProviderMatches(currentState.modal.searchValue).length;

        if (key.upArrow) {
          commitState(moveConnectProviderSelection(currentState, providerCount, -1));
          return;
        }

        if (key.downArrow) {
          commitState(moveConnectProviderSelection(currentState, providerCount, 1));
          return;
        }

        if (key.return) {
          commitState(handleConnectProviderSubmit(currentState));
          return;
        }

        if (key.backspace || key.delete) {
          commitState(
            setConnectProviderSearch(currentState, currentState.modal.searchValue.slice(0, -1))
          );
          return;
        }

        if (key.ctrl || key.meta || key.tab) {
          return;
        }

        if (input) {
          commitState(
            setConnectProviderSearch(currentState, `${currentState.modal.searchValue}${input}`)
          );
        }

        return;
      }

      if (currentState.modal.kind === "connect-auth-mode") {
        if (key.upArrow) {
          commitState(moveConnectAuthModeSelection(currentState, 2, -1));
          return;
        }

        if (key.downArrow) {
          commitState(moveConnectAuthModeSelection(currentState, 2, 1));
          return;
        }

        if (key.return) {
          commitState(handleConnectAuthModeSubmit(currentState, Date.now()));
        }

        return;
      }

      if (currentState.modal.kind === "connect-oauth") {
        if (
          key.tab &&
          currentState.modal.providerId === "openai" &&
          currentState.modal.flowPhase !== "launching" &&
          currentState.modal.flowPhase !== "waiting" &&
          !(
            currentState.config.connection?.provider === "openai" &&
            currentState.config.connection.authMode === "oauth" &&
            currentState.config.connection.apiKey
          )
        ) {
          commitState(toggleConnectOauthFlowMode(currentState));
          return;
        }

        if (key.return) {
          if (
            currentState.modal.providerId === "openai" &&
            !(
              currentState.config.connection?.provider === "openai" &&
              currentState.config.connection.authMode === "oauth" &&
              currentState.config.connection.apiKey
            )
          ) {
            if (
              currentState.modal.flowPhase === "launching" ||
              currentState.modal.flowPhase === "waiting"
            ) {
              return;
            }

            void beginNativeOpenAIOauthFlow(currentState);
            return;
          }

          commitState(handleConnectOauthSubmit(currentState, Date.now()));
        }

        return;
      }

      if (currentState.modal.kind === "connect-credentials") {
        if (key.return) {
          commitState(handleConnectCredentialsSubmit(currentState, Date.now()));
          return;
        }

        if (key.backspace || key.delete) {
          commitState(deleteConnectCredentialsCharacter(currentState));
          return;
        }

        if (key.ctrl || key.meta) {
          return;
        }

        if (input) {
          commitState(appendConnectCredentialsCharacter(currentState, input));
        }

        return;
      }

      const filteredModelIds = getFilteredModelIds(currentState);

      if (key.upArrow) {
        commitState(moveModelPickerSelection(currentState, filteredModelIds.length, -1));
        return;
      }

      if (key.downArrow) {
        commitState(moveModelPickerSelection(currentState, filteredModelIds.length, 1));
        return;
      }

      if (key.return) {
        commitState(handleModelPickerSubmit(currentState, Date.now()));
        return;
      }

      if (key.backspace || key.delete) {
        commitState(setModelPickerSearch(currentState, currentState.modal.searchValue.slice(0, -1)));
        return;
      }

      if (key.ctrl || key.meta || key.tab) {
        return;
      }

      if (input) {
        commitState(setModelPickerSearch(currentState, `${currentState.modal.searchValue}${input}`));
      }

      return;
    }

    if (currentState.pendingRequest) {
      if (key.upArrow) {
        commitState(moveTranscriptScroll(currentState, 1));
        return;
      }

      if (key.downArrow) {
        commitState(moveTranscriptScroll(currentState, -1));
        return;
      }

      if (key.escape) {
        stopStreamingProcess();
        const nextState = updateLatestTranscriptEntry(currentState, (latestEntry) => ({
          ...latestEntry,
          failed: true,
          streaming: false,
          response: latestEntry.response || "Generation cancelled.",
          rawResponse: latestEntry.rawResponse || "Generation cancelled."
        }));
        commitState({
          ...nextState,
          pendingRequest: false,
          transientNotice: {
            message: "Generation cancelled.",
            expiresAt: Date.now() + 2_500
          }
        });
      }

      return;
    }

    if (key.escape) {
      if (shouldShowCommandPreview(currentState.inputValue)) {
        commitState(clearInputValue(currentState));
        return;
      }

      exit();
      return;
    }

    if (!shouldShowCommandPreview(currentState.inputValue) && key.upArrow) {
      commitState(moveTranscriptScroll(currentState, 1));
      return;
    }

    if (!shouldShowCommandPreview(currentState.inputValue) && key.downArrow) {
      commitState(moveTranscriptScroll(currentState, -1));
      return;
    }

    if (shouldShowCommandPreview(currentState.inputValue) && key.upArrow) {
      commitState(
        moveCommandSelection(
          currentState,
          getCommandPreviewItems(currentState.inputValue).length,
          -1
        )
      );
      return;
    }

    if (shouldShowCommandPreview(currentState.inputValue) && key.downArrow) {
      commitState(
        moveCommandSelection(
          currentState,
          getCommandPreviewItems(currentState.inputValue).length,
          1
        )
      );
      return;
    }

    if (key.return) {
      if (isExitCommand(currentState.inputValue)) {
        exit();
        return;
      }

      const submission = handleCommandSubmit(currentState, Date.now());
      const nextState = submission.shouldExit
        ? submission.nextState
        : resetTranscriptScroll(submission.nextState);

      if (submission.shouldExit) {
        exit();
        return;
      }

      commitState(nextState);
      return;
    }

    if (key.tab && shouldShowCommandPreview(currentState.inputValue)) {
      const autocompletedValue = getCommandAutocompleteValue(
        currentState.inputValue,
        currentState.commandSelectionIndex
      );

      if (autocompletedValue) {
        commitState(replaceInputValue(currentState, autocompletedValue));
      }

      return;
    }

    if (key.backspace || key.delete) {
      applyStateUpdate((nextState) => deleteInputCharacter(nextState));
      return;
    }

    if (key.ctrl || key.meta || key.tab) {
      return;
    }

    if (input) {
      applyStateUpdate((nextState) => appendInputCharacter(nextState, input));
    }
  });

  return (
    <AppShell
      state={state}
      terminalWidth={terminalWidth}
      terminalHeight={terminalHeight}
      cwd={cwd}
    />
  );
}
