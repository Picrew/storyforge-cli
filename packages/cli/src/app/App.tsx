import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React, { useEffect, useRef, useState } from "react";
import { useApp, useInput, useStdout } from "ink";
import {
  applyConnectCommand,
  applyModelCommand
} from "../commands/command-actions.js";
import { handleStoryCommand } from "../commands/story-commands.js";
import {
  getCommandAutocompleteValue,
  getCommandPreviewItems,
  getSelectedCommandPreviewItem,
  isExitCommand,
  shouldShowCommandPreview
} from "../commands/command-preview.js";
import { buildStoryTranscriptSnapshot } from "../components/StoryPanel.js";
import { getProviderMatches, getProviderOption } from "../data/provider-catalog.js";
import { getContentWidth } from "../layout/viewport.js";
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
  moveInputCursor,
  moveInputCursorToEnd,
  moveInputCursorToStart,
  moveModelPickerSelection,
  moveProjectPickerSelection,
  moveTranscriptScroll,
  openConnectAuthModeModal,
  openConnectCredentialsModal,
  openConnectOauthModal,
  openConnectProviderModal,
  openModelPickerModal,
  openProjectPickerModal,
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
import {
  createStoryProject,
  getStoryProjectAbsolutePath,
  getStoryProjectPath,
  loadStoryWorkspace,
  loadStoryProject,
  saveStoryProject,
  setActiveStoryProject
} from "../story/project-store.js";
import {
  runStoryTask,
  type StoryBootstrapStage,
  type StoryTaskResult
} from "../story/bootstrap.js";
import {
  runStructuredPrompt,
  type ChatMessage,
  type StructuredRunner
} from "../story/structured-run.js";
import {
  commitStoryEvent,
  compileStoryChapters,
  renderStoryChapters,
  runStoryCi
} from "../story/simulation.js";
import {
  runChapterValidationRepairGate,
  runStoryValidationRepairGate,
  validateStoryProject
} from "../story/story-validation.js";
import {
  getStoryArtifactPaths,
  writeStoryArtifactJson
} from "../story/artifact-store.js";
import type { StoryLibraryEntry, StoryProject } from "../story/types.js";
import { findLatestIncompleteStoryTaskCheckpoint } from "../story/task-checkpoint.js";
import { AppShell } from "./AppShell.js";
import type {
  AppState,
  ModelListEntry,
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
import { startGitHubCopilotOauthSession } from "../utils/github-copilot-oauth.js";
import { fetchModelIdsAsync, getModelOptionsForProvider } from "../utils/opencode-models.js";
import {
  normalizeAssistantText,
  startDirectStream,
  type DirectStreamHandle
} from "../utils/direct-stream.js";
import { useMouseWheel } from "../components/useMouseWheel.js";

export interface AppProps {
  terminalWidthOverride?: number;
  cwdOverride?: string;
  configPathOverride?: string;
  initialConfigOverride?: SessionConfig;
  structuredRunnerOverride?: StructuredRunner;
}

function getAvailableModelIds(config: SessionConfig, providerId: string): readonly string[] {
  const modelIds = getModelOptionsForProvider(providerId).map((model) => model.id);

  if (config.model && !modelIds.includes(config.model) && config.model.startsWith(`${providerId}/`)) {
    return [config.model, ...modelIds];
  }

  return modelIds;
}

function looksLikeModelId(value: string): boolean {
  const sep = value.indexOf("/");

  return sep > 0 && sep < value.length - 1;
}

function getFilteredModelIds(state: AppState): readonly string[] {
  if (!state.modal || state.modal.kind !== "model-picker") {
    return [];
  }

  const normalizedSearch = state.modal.searchValue.trim().toLowerCase();
  const sourceModelIds =
    normalizedSearch.length > 0
      ? (state.modal.allModelIds ?? state.modal.modelIds)
      : state.modal.modelIds;

  if (!normalizedSearch) {
    return sourceModelIds;
  }

  const matched = sourceModelIds.filter((modelId) => modelId.toLowerCase().includes(normalizedSearch));

  if (matched.length === 0 && looksLikeModelId(normalizedSearch)) {
    return [normalizedSearch];
  }

  return matched;
}

function parseCommandInput(inputValue: string): { command: string; args: string[] } | null {
  const rawInput = inputValue.trim();

  if (!rawInput.startsWith("/")) {
    return null;
  }

  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const character of rawInput) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += character;
  }

  if (escaped) {
    current += "\\";
  }
  if (current) {
    tokens.push(current);
  }

  const [command = "", ...args] = tokens;

  return {
    command: command.toLowerCase(),
    args
  };
}

export function App({
  terminalWidthOverride,
  cwdOverride,
  configPathOverride,
  initialConfigOverride,
  structuredRunnerOverride
}: AppProps = {}): React.JSX.Element {
  interface ManagedOauthSession {
    cancel: () => void;
  }

  const { exit } = useApp();
  const { stdout } = useStdout();
  const terminalWidth = terminalWidthOverride ?? stdout?.columns ?? 80;
  const terminalHeight = stdout?.rows ?? 30;
  const cwdRef = React.useRef(cwdOverride ?? process.cwd());
  const cwd = cwdRef.current;
  const configPath = configPathOverride ?? getDefaultSessionConfigPath();
  let initialStoryProjectId: string | null = null;
  let initialStoryProjects: readonly StoryLibraryEntry[] = [];
  let initialStoryProject: StoryProject | null = null;
  let initialStoryLoadError: string | null = null;
  let initialRecoveryNotice: string | null = null;

  try {
    const loadedWorkspace = loadStoryWorkspace(cwd);

    initialStoryProjectId = loadedWorkspace.activeProjectId;
    initialStoryProjects = loadedWorkspace.projects;
    initialStoryProject = loadedWorkspace.activeProject;
    if (initialStoryProjectId) {
      const checkpoint = findLatestIncompleteStoryTaskCheckpoint(cwd, initialStoryProjectId);
      if (checkpoint) {
        initialRecoveryNotice =
          `Incomplete story task found (${checkpoint.completedStages.length}/${checkpoint.totalStages}, ` +
          `${checkpoint.status}). Run /resume or /retry.`;
      }
    }
  } catch (error) {
    initialStoryLoadError =
      error instanceof Error
        ? `Story project could not be loaded: ${error.message}`
        : "Story project could not be loaded.";
  }

  const [state, setState] = useState<AppState>(() => {
    const initialState = createInitialAppState(
      terminalWidth,
      initialConfigOverride ?? loadSessionConfig(configPath),
      initialStoryProject,
      initialStoryProjectId,
      initialStoryProjects
    );

    return initialStoryLoadError || initialRecoveryNotice
      ? setTransientNotice(initialState, initialStoryLoadError ?? initialRecoveryNotice ?? "")
      : initialState;
  });
  const stateRef = useRef(state);
  const streamProcessRef = useRef<DirectStreamHandle | null>(null);
  const streamRunIdRef = useRef(0);
  const earlyStreamChunkBufferRef = useRef<Map<number, string>>(new Map());
  const oauthSessionRef = useRef<ManagedOauthSession | null>(null);
  const oauthRunIdRef = useRef(0);
  const storyTaskRunIdRef = useRef(0);
  const storyAbortControllerRef = useRef<AbortController | null>(null);
  const modelCacheRef = useRef<Map<string, readonly string[]>>(new Map());
  const modelFetchingRef = useRef<Set<string>>(new Set());
  const structuredRunner = structuredRunnerOverride ?? runStructuredPrompt;

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

  useMouseWheel((delta) => {
    applyStateUpdate((currentState) => moveTranscriptScroll(currentState, delta));
  });

  const stopStreamingProcess = (): void => {
    streamRunIdRef.current += 1;
    earlyStreamChunkBufferRef.current.clear();

    if (!streamProcessRef.current) {
      return;
    }

    streamProcessRef.current.abort();
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

  const persistStoryProjectState = (
    currentState: AppState,
    storyProject: StoryProject,
    activeStoryView: AppState["activeStoryView"],
    message: string,
    now: number
  ): AppState => {
    const saveError = saveStoryProject(cwd, storyProject, currentState.storyProjectId);
    const nextProjects = syncStoryProjectList(
      currentState.storyProjects,
      currentState.storyProjectId,
      storyProject
    );
    const nextState: AppState = {
      ...currentState,
      storyProject,
      storyProjects: nextProjects,
      activeStoryView,
      inputValue: "",
      inputCursorPosition: 0,
      commandSelectionIndex: 0
    };

    if (!saveError) {
      return setTransientNotice(nextState, message, now);
    }

    return setTransientNotice(
      nextState,
      `${message} Saved for this run, but story persistence failed: ${saveError}`,
      now
    );
  };

  const updateStoryTranscript = (
    runId: number,
    message: string,
    project?: StoryProject,
    activeView?: AppState["activeStoryView"]
  ): void => {
    if (storyTaskRunIdRef.current !== runId) {
      return;
    }

    applyStateUpdate((activeState) => {
      const response =
        project && activeView
          ? buildStoryTranscriptResponse(
              project,
              activeView,
              message,
              activeState.storyProjectId,
              activeState.storyProjects
            )
          : message;
      const nextState = updateLatestTranscriptEntry(activeState, (latestEntry) => ({
        ...latestEntry,
        response,
        rawResponse: response,
        streaming: false
      }));

      return {
        ...nextState,
        transientNotice: {
          message,
          expiresAt: Date.now() + 2_500
        }
      };
    });
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

  const formatParsedCommandPrompt = (parsedCommand: { command: string; args: string[] }): string =>
    parsedCommand.args.length > 0
      ? `${parsedCommand.command} ${parsedCommand.args.join(" ")}`
      : parsedCommand.command;

  const getDefaultStoryView = (project: StoryProject): AppState["activeStoryView"] => {
    if (project.outline.length > 0) {
      return "outline";
    }

    if (project.timeline.length > 0) {
      return "timeline";
    }

    if (project.characters.length > 0) {
      return "characters";
    }

    return "world";
  };

  const syncStoryProjectList = (
    projectList: readonly StoryLibraryEntry[],
    projectId: string | null,
    project: StoryProject
  ): readonly StoryLibraryEntry[] => {
    if (!projectId) {
      return projectList;
    }

    const nextEntry = {
      ...(projectList.find((entry) => entry.id === projectId) ?? {
        id: projectId,
        file: path.relative(path.join(cwd, ".storyforge"), getStoryProjectPath(cwd))
      }),
      title: project.meta.title,
      status: project.meta.status,
      createdAt: project.meta.createdAt,
      updatedAt: project.meta.updatedAt
    };

    const nextProjects = projectList.map((entry) =>
      entry.id === projectId ? nextEntry : entry
    );

    if (nextProjects.some((entry) => entry.id === projectId)) {
      return nextProjects;
    }

    return [...nextProjects, nextEntry];
  };

  const getStoryProjectPathLabel = (
    projectId: string | null,
    projectList: readonly StoryLibraryEntry[]
  ): string => {
    const storyProjectPath = getStoryProjectAbsolutePath(cwd, projectId, projectList);
    const relativeStoryPath = path.relative(cwd, storyProjectPath);

    return relativeStoryPath.startsWith(".") ? relativeStoryPath : `./${relativeStoryPath}`;
  };

  const getStoryTranscriptWidth = (): number => Math.max(24, getContentWidth(terminalWidth) - 9);

  const buildStoryTranscriptResponse = (
    project: StoryProject,
    activeView: AppState["activeStoryView"],
    message: string,
    projectId: string | null,
    projectList: readonly StoryLibraryEntry[]
  ): string =>
    `${message}\n${buildStoryTranscriptSnapshot(
      project,
      activeView,
      getStoryProjectPathLabel(projectId, projectList),
      getStoryTranscriptWidth()
    )}`;

  const appendStoryTextEntry = (
    currentState: AppState,
    prompt: string,
    response: string,
    model: string
  ): AppState =>
    appendTranscriptEntry(currentState, {
      id: `story-view-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      prompt,
      response,
      rawResponse: response,
      provider: "storyforge",
      model,
      failed: false,
      streaming: false
    });

  const appendStoryTranscriptEntry = (
    currentState: AppState,
    prompt: string,
    project: StoryProject,
    activeView: AppState["activeStoryView"],
    message: string,
    model: string = "story/project"
  ): AppState => {
    const response = buildStoryTranscriptResponse(
      project,
      activeView,
      message,
      currentState.storyProjectId,
      currentState.storyProjects
    );

    return appendStoryTextEntry(currentState, prompt, response, model);
  };

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
      const nextState = openModelPickerForProvider(
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
        const nextState = openModelPickerForProvider(
          setTransientNotice(
            connectedState,
            cacheSyncError
              ? `OpenAI browser auth failed, and the fallback credential imported but could not refresh the local oauth cache: ${cacheSyncError}`
              : "OpenAI browser auth failed, so Storyforge imported the existing local credential instead.",
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

  const beginNativeGitHubCopilotOauthFlow = async (currentState: AppState): Promise<void> => {
    if (
      !currentState.modal ||
      currentState.modal.kind !== "connect-oauth" ||
      currentState.modal.providerId !== "github-copilot"
    ) {
      return;
    }

    stopOauthSession();
    const runId = oauthRunIdRef.current;
    commitState(
      setConnectOauthFlowState(currentState, {
        flowPhase: "launching",
        authUrl: null,
        userCode: null,
        statusMessage: "Requesting a device code from GitHub...",
        errorMessage: null
      })
    );

    try {
      const session = await startGitHubCopilotOauthSession("browser");

      if (oauthRunIdRef.current !== runId) {
        session.cancel();
        return;
      }

      oauthSessionRef.current = session;
      const waitingState = stateRef.current;

      if (
        waitingState.modal &&
        waitingState.modal.kind === "connect-oauth" &&
        waitingState.modal.providerId === "github-copilot"
      ) {
        commitState(
          setConnectOauthFlowState(waitingState, {
            flowPhase: "waiting",
            authUrl: session.authUrl,
            userCode: session.userCode,
            statusMessage: session.browserOpened
              ? "Browser opened. Finish the GitHub verification page to continue."
              : "Open the URL below manually, then complete the GitHub verification page.",
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
        activeState.modal.providerId !== "github-copilot"
      ) {
        return;
      }

      const now = Date.now();
      const authSyncError = syncOauthCredentialRecord("github-copilot", {
        access: credential.accessToken,
        refresh: credential.refreshToken,
        expires: credential.expiresAt,
        accountId: null
      });
      const connectedState = connectWithSession(
        closeModal(activeState),
        {
          provider: "github-copilot",
          authMode: "oauth",
          apiKey: credential.accessToken,
          baseUrl: null,
          authLabel: "GitHub browser auth"
        },
        now
      );
      const nextState = openModelPickerForProvider(
        authSyncError
          ? setTransientNotice(
              connectedState,
              `Connected GitHub Copilot, but the oauth cache failed to save: ${authSyncError}`,
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
        activeState.modal.providerId !== "github-copilot"
      ) {
        return;
      }

      const reusableCredential = getOauthCredential("github-copilot", getSystemOpencodeAuthPath());

      if (reusableCredential) {
        const now = Date.now();
        const cacheSyncError = syncOauthCredentialRecord("github-copilot", reusableCredential);
        const connectedState = connectWithSession(
          closeModal(activeState),
          {
            provider: "github-copilot",
            authMode: "oauth",
            apiKey: reusableCredential.access,
            baseUrl: null,
            authLabel: "GitHub browser auth"
          },
          now
        );
        const nextState = openModelPickerForProvider(
          setTransientNotice(
            connectedState,
            cacheSyncError
              ? `GitHub browser auth failed, and the fallback credential imported but could not refresh the local oauth cache: ${cacheSyncError}`
              : "GitHub browser auth failed, so Storyforge imported the existing local credential instead.",
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
          statusMessage: "Press Enter to retry GitHub browser auth.",
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
        pendingTask: null,
        chatSessionId: null
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

  const rebuildModelPickerWithCache = (
    currentState: AppState,
    cache: Map<string, readonly string[]>
  ): AppState => {
    if (!currentState.modal || currentState.modal.kind !== "model-picker") {
      return currentState;
    }

    if (!currentState.modal.groupedEntries) {
      return currentState;
    }

    const recentModels = currentState.config.recentModels ?? [];
    const currentProviderId = currentState.config.connection?.provider;

    if (!currentProviderId) {
      return currentState;
    }

    if (recentModels.length === 0) {
      return currentState;
    }

    const visibleModelIds: string[] = [];
    const visibleEntries: ModelListEntry[] = [];
    const visibleUsedModelIds = new Set<string>();

    const grouped = new Map<string, string[]>();

    for (const modelId of recentModels) {
      const sep = modelId.indexOf("/");
      const provider = sep > 0 ? modelId.slice(0, sep) : currentProviderId;

      if (!grouped.has(provider)) {
        grouped.set(provider, []);
      }

      grouped.get(provider)!.push(modelId);
    }

    const appendVisibleGroup = (providerId: string, modelIds: readonly string[]): void => {
      if (modelIds.length === 0) {
        return;
      }

      const providerOption = getProviderOption(providerId);
      visibleEntries.push({ kind: "header", label: providerOption?.title ?? providerId });

      for (const modelId of modelIds) {
        if (visibleUsedModelIds.has(modelId)) {
          continue;
        }

        visibleEntries.push({ kind: "item", modelId });
        visibleModelIds.push(modelId);
        visibleUsedModelIds.add(modelId);
      }
    };

    appendVisibleGroup(currentProviderId, grouped.get(currentProviderId) ?? []);

    for (const [providerId, models] of grouped) {
      if (providerId === currentProviderId) {
        continue;
      }

      appendVisibleGroup(providerId, models);
    }

    if (visibleModelIds.length === 0) {
      return currentState;
    }

    const providerOrder: string[] = [];

    providerOrder.push(currentProviderId);

    for (const pid of grouped.keys()) {
      if (!providerOrder.includes(pid)) {
        providerOrder.push(pid);
      }
    }

    for (const pid of cache.keys()) {
      if (!providerOrder.includes(pid)) {
        providerOrder.push(pid);
      }
    }

    const allModelIds: string[] = [];
    const allEntries: ModelListEntry[] = [];
    const allUsedModelIds = new Set<string>();

    for (const providerId of providerOrder) {
      const historyModels = grouped.get(providerId) ?? [];
      const cachedModels = cache.get(providerId) ?? [];
      const providerOption = getProviderOption(providerId);
      const label = providerOption?.title ?? providerId;

      const providerModels = [...historyModels];

      for (const m of cachedModels) {
        if (!providerModels.includes(m)) {
          providerModels.push(m);
        }
      }

      if (providerModels.length === 0) {
        continue;
      }

      allEntries.push({ kind: "header", label });

      for (const modelId of providerModels) {
        if (allUsedModelIds.has(modelId)) {
          continue;
        }

        allEntries.push({ kind: "item", modelId });
        allModelIds.push(modelId);
        allUsedModelIds.add(modelId);
      }
    }

    const effectiveAllModelIds = allModelIds.length > 0 ? allModelIds : visibleModelIds;
    const effectiveAllEntries = allEntries.length > 0 ? allEntries : visibleEntries;

    return {
      ...currentState,
      modal: {
        ...currentState.modal,
        modelIds: visibleModelIds,
        groupedEntries: visibleEntries,
        allModelIds: effectiveAllModelIds,
        allGroupedEntries: effectiveAllEntries,
        selectedIndex: Math.min(
          currentState.modal.selectedIndex,
          Math.max(
            0,
            (currentState.modal.searchValue.trim()
              ? effectiveAllModelIds.length
              : visibleModelIds.length) - 1
          )
        )
      }
    };
  };

  const openModelPickerForProvider = (currentState: AppState, now: number): AppState => {
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

  const openModelPickerFromHistory = (currentState: AppState, now: number): AppState => {
    if (!currentState.config.connection) {
      return setTransientNotice(currentState, "Run /connect first.", now);
    }

    const currentProviderId = currentState.config.connection.provider;
    const recentModels = currentState.config.recentModels ?? [];

    if (recentModels.length === 0) {
      return openModelPickerForProvider(currentState, now);
    }

    const visibleModelIds = [...recentModels];
    const visibleEntries: ModelListEntry[] = [];

    const grouped = new Map<string, string[]>();

    for (const modelId of recentModels) {
      const sep = modelId.indexOf("/");
      const provider = sep > 0 ? modelId.slice(0, sep) : currentProviderId;

      if (!grouped.has(provider)) {
        grouped.set(provider, []);
      }

      grouped.get(provider)!.push(modelId);
    }

    const appendVisibleGroup = (providerId: string, modelIds: readonly string[]): void => {
      if (modelIds.length === 0) {
        return;
      }

      const providerOption = getProviderOption(providerId);
      visibleEntries.push({ kind: "header", label: providerOption?.title ?? providerId });

      for (const modelId of modelIds) {
        visibleEntries.push({ kind: "item", modelId });
      }
    };

    appendVisibleGroup(currentProviderId, grouped.get(currentProviderId) ?? []);

    for (const [providerId, models] of grouped) {
      if (providerId === currentProviderId) {
        continue;
      }

      appendVisibleGroup(providerId, models);
    }

    if (visibleModelIds.length === 0) {
      return setTransientNotice(currentState, `No models found for ${currentProviderId}.`, now);
    }

    const providerOrder: string[] = [currentProviderId];

    for (const providerId of grouped.keys()) {
      if (!providerOrder.includes(providerId)) {
        providerOrder.push(providerId);
      }
    }

    for (const providerId of modelCacheRef.current.keys()) {
      if (!providerOrder.includes(providerId)) {
        providerOrder.push(providerId);
      }
    }

    const allModelIds: string[] = [];
    const allEntries: ModelListEntry[] = [];
    const usedAllModelIds = new Set<string>();

    for (const providerId of providerOrder) {
      const historyModels = grouped.get(providerId) ?? [];
      const cachedModels = modelCacheRef.current.get(providerId) ?? [];
      const providerModels = [...historyModels];

      for (const modelId of cachedModels) {
        if (!providerModels.includes(modelId)) {
          providerModels.push(modelId);
        }
      }

      if (providerModels.length === 0) {
        continue;
      }

      const providerOption = getProviderOption(providerId);
      allEntries.push({ kind: "header", label: providerOption?.title ?? providerId });

      for (const modelId of providerModels) {
        if (usedAllModelIds.has(modelId)) {
          continue;
        }

        allEntries.push({ kind: "item", modelId });
        allModelIds.push(modelId);
        usedAllModelIds.add(modelId);
      }
    }

    const effectiveAllModelIds = allModelIds.length > 0 ? allModelIds : visibleModelIds;
    const effectiveAllEntries = allEntries.length > 0 ? allEntries : visibleEntries;

    let selectedIndex = 0;

    if (currentState.config.model) {
      const idx = visibleModelIds.indexOf(currentState.config.model);

      if (idx >= 0) {
        selectedIndex = idx;
      }
    }

    return openModelPickerModal(
      currentState,
      currentProviderId,
      visibleModelIds,
      selectedIndex,
      visibleEntries,
      effectiveAllModelIds,
      effectiveAllEntries
    );
  };

  const getStoryStageLabel = (stage: StoryBootstrapStage): string => {
    switch (stage) {
      case "foundation":
        return "World foundation";
      case "characters":
        return "Character generation";
      case "timeline":
        return "Timeline generation";
      case "outline":
        return "Outline generation";
    }
  };

  const runStoryPipeline = async (
    runId: number,
    taskKind: "story-bootstrap" | "story-refresh",
    baseProject: StoryProject,
    projectId: string | null,
    scope: "all" | "world" | "characters" | "timeline" | "outline",
    model: string,
    resumeTaskId?: string
  ): Promise<void> => {
    await Promise.resolve();
    let result: StoryTaskResult;
    const abortController = new AbortController();
    storyAbortControllerRef.current = abortController;

    try {
      result = await runStoryTask({
        cwd,
        projectId,
        model,
        project: baseProject,
        runner: structuredRunner,
        scope,
        taskId: resumeTaskId,
        resume: Boolean(resumeTaskId),
        abortSignal: abortController.signal,
        onCheckpoint: (checkpoint) => {
          if (storyTaskRunIdRef.current !== runId) {
            return;
          }
          applyStateUpdate((activeState) => ({
            ...activeState,
            pendingTask: {
              kind: taskKind,
              stage: checkpoint.currentStage,
              taskId: checkpoint.id,
              stageIndex: checkpoint.stageIndex,
              totalStages: checkpoint.totalStages,
              startedAt: new Date(checkpoint.startedAt).getTime(),
              retryCount: checkpoint.retryCount,
              checkpointPath: checkpoint.checkpointPath
            }
          }));
        },
        onStageStart: ({ project, view, message }) => {
          if (storyTaskRunIdRef.current !== runId) {
            return;
          }

          applyStateUpdate((activeState) => ({
            ...activeState,
            storyProject: project,
            storyProjects: syncStoryProjectList(
              activeState.storyProjects,
              activeState.storyProjectId,
              project
            ),
            activeStoryView: view
          }));
          updateStoryTranscript(runId, message, project, view);
        },
        onStageComplete: ({ project, view, message }) => {
          if (storyTaskRunIdRef.current !== runId) {
            return;
          }

          applyStateUpdate((activeState) => ({
            ...activeState,
            storyProject: project,
            storyProjects: syncStoryProjectList(
              activeState.storyProjects,
              activeState.storyProjectId,
              project
            ),
            activeStoryView: view
          }));
          updateStoryTranscript(runId, message, project, view);
        }
      });
    } catch (error) {
      if (storyTaskRunIdRef.current !== runId) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      applyStateUpdate((activeState) =>
        setTransientNotice(
          {
            ...updateLatestTranscriptEntry(activeState, (latestEntry) => ({
              ...latestEntry,
              response: `Story task failed. ${message}`,
              rawResponse: `Story task failed. ${message}`,
              failed: true,
              streaming: false
            })),
            pendingTask: null
          },
          "Story task failed."
        )
      );
      if (storyAbortControllerRef.current === abortController) {
        storyAbortControllerRef.current = null;
      }
      return;
    }

    if (storyAbortControllerRef.current === abortController) {
      storyAbortControllerRef.current = null;
    }

    if (storyTaskRunIdRef.current !== runId) {
      return;
    }

    applyStateUpdate((activeState) => {
      const finalView =
        scope === "all"
          ? "outline"
          : scope === "world"
            ? "world"
            : scope;
      const successMessage =
        taskKind === "story-bootstrap"
          ? "Story tables are ready. Next: /commit --chapter ch01"
          : scope === "all"
            ? "Story tables refreshed."
            : `Refreshed ${finalView}.`;
      const failureMessage = result.failedStage
        ? `${getStoryStageLabel(result.failedStage)} failed. Existing sections were kept.`
        : "Story task failed.";
      const checkpointHint = result.taskCheckpoint
        ? ` Completed ${result.taskCheckpoint.completedStages.length}/${result.taskCheckpoint.totalStages}. Run /retry or /resume. Checkpoint: ${result.taskCheckpoint.checkpointPath}`
        : " Run /retry or /resume.";
      const validationHint = result.validationReport
        ? ` Validation: ${result.validationReport.passed ? "pass" : "fail"} (${result.validationReport.issues.length} issue(s)).`
        : "";
      const transcriptMessage = result.ok
        ? `${successMessage}${validationHint}`
        : result.errorMessage
          ? `${failureMessage} ${result.errorMessage}${checkpointHint}`
          : `${failureMessage}${checkpointHint}`;
      const transcriptResponse = buildStoryTranscriptResponse(
        result.project,
        finalView,
        transcriptMessage,
        activeState.storyProjectId,
        syncStoryProjectList(activeState.storyProjects, activeState.storyProjectId, result.project)
      );
      const nextState = updateLatestTranscriptEntry(activeState, (latestEntry) => ({
        ...latestEntry,
        response: transcriptResponse,
        rawResponse: transcriptResponse,
        streaming: false,
        failed: !result.ok
      }));

      return setTransientNotice(
        {
          ...nextState,
          storyProject: result.project,
          storyProjects: syncStoryProjectList(
            nextState.storyProjects,
            nextState.storyProjectId,
            result.project
          ),
          activeStoryView: finalView,
          pendingTask: null
        },
        result.ok ? successMessage : failureMessage
      );
    });
  };

  const formatCiReportSummary = (project: StoryProject): string => {
    const latest = project.ciHistory[project.ciHistory.length - 1];

    if (!latest) {
      return "CI not run yet.";
    }

    return `CI ${latest.passed ? "pass" : "fail"} (${latest.errors.length} error(s), ${latest.warnings.length} warning(s))`;
  };

  const runStoryCommitCommand = async (
    runId: number,
    baseProject: StoryProject,
    command: {
      chapterId: string;
      eventText: string;
      patchFilePath: string | null;
      force: boolean;
    },
    model: string
  ): Promise<void> => {
    await Promise.resolve();
    const abortController = new AbortController();
    storyAbortControllerRef.current = abortController;

    try {
      const result = await commitStoryEvent({
        cwd,
        model,
        project: baseProject,
        chapterId: command.chapterId,
        eventText: command.eventText,
        patchFilePath: command.patchFilePath,
        force: command.force,
        runner: structuredRunner,
        abortSignal: abortController.signal
      });

      if (storyTaskRunIdRef.current !== runId) {
        return;
      }

      if (!result.ok) {
        applyStateUpdate((activeState) => {
          const response = `${result.message}`;

          return setTransientNotice(
            {
              ...updateLatestTranscriptEntry(activeState, (entry) => ({
                ...entry,
                response,
                rawResponse: response,
                failed: true,
                streaming: false
              })),
              pendingTask: null
            },
            "Story commit blocked by CI."
          );
        });
        return;
      }

      applyStateUpdate((activeState) => {
        const saveError = saveStoryProject(cwd, result.project, activeState.storyProjectId);
        const response = buildStoryTranscriptResponse(
          result.project,
          "world",
          saveError
            ? `${result.message} Saved for this run, but story persistence failed: ${saveError}`
            : `${result.message} ${formatCiReportSummary(result.project)} Next: /render ${command.chapterId}`,
          activeState.storyProjectId,
          syncStoryProjectList(activeState.storyProjects, activeState.storyProjectId, result.project)
        );
        const nextState = updateLatestTranscriptEntry(activeState, (entry) => ({
          ...entry,
          response,
          rawResponse: response,
          failed: false,
          streaming: false
        }));

        return setTransientNotice(
          {
            ...nextState,
            storyProject: result.project,
            storyProjects: syncStoryProjectList(
              nextState.storyProjects,
              nextState.storyProjectId,
              result.project
            ),
            activeStoryView: "world",
            pendingTask: null
          },
          "Story commit applied."
        );
      });
    } catch (error) {
      if (storyTaskRunIdRef.current !== runId) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      applyStateUpdate((activeState) =>
        setTransientNotice(
          {
            ...updateLatestTranscriptEntry(activeState, (entry) => ({
              ...entry,
              response: `Story commit failed. ${message}`,
              rawResponse: `Story commit failed. ${message}`,
              failed: true,
              streaming: false
            })),
            pendingTask: null
          },
          "Story commit failed."
        )
      );
    } finally {
      if (storyAbortControllerRef.current === abortController) {
        storyAbortControllerRef.current = null;
      }
    }
  };

  const runStoryCiCommand = async (
    runId: number,
    baseProject: StoryProject,
    scope: "all" | "commit",
    commitId: string | null
  ): Promise<void> => {
    try {
      const result = await runStoryCi({
        project: baseProject,
        scope,
        commitId
      });

      if (storyTaskRunIdRef.current !== runId) {
        return;
      }

      applyStateUpdate((activeState) => {
        const saveError = saveStoryProject(cwd, result.project, activeState.storyProjectId);
        const response = buildStoryTranscriptResponse(
          result.project,
          activeState.activeStoryView ?? "world",
          saveError
            ? `CI finished with ${result.report.passed ? "pass" : "fail"}. Persistence failed: ${saveError}`
            : `CI finished with ${result.report.passed ? "pass" : "fail"} (${result.report.errors.length} error(s), ${result.report.warnings.length} warning(s)).`,
          activeState.storyProjectId,
          syncStoryProjectList(activeState.storyProjects, activeState.storyProjectId, result.project)
        );
        const nextState = updateLatestTranscriptEntry(activeState, (entry) => ({
          ...entry,
          response,
          rawResponse: response,
          failed: !result.report.passed,
          streaming: false
        }));

        return setTransientNotice(
          {
            ...nextState,
            storyProject: result.project,
            storyProjects: syncStoryProjectList(
              nextState.storyProjects,
              nextState.storyProjectId,
              result.project
            ),
            pendingTask: null
          },
          result.report.passed ? "CI passed." : "CI failed."
        );
      });
    } catch (error) {
      if (storyTaskRunIdRef.current !== runId) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      applyStateUpdate((activeState) =>
        setTransientNotice(
          {
            ...updateLatestTranscriptEntry(activeState, (entry) => ({
              ...entry,
              response: `CI run failed. ${message}`,
              rawResponse: `CI run failed. ${message}`,
              failed: true,
              streaming: false
            })),
            pendingTask: null
          },
          "CI run failed."
        )
      );
    }
  };

  const runStoryRenderCommand = async (
    runId: number,
    baseProject: StoryProject,
    projectId: string | null,
    command: {
      chapterIds: string[];
      force: boolean;
      style: string | null;
    },
    model: string
  ): Promise<void> => {
    await Promise.resolve();
    const abortController = new AbortController();
    storyAbortControllerRef.current = abortController;

    try {
      const result = await renderStoryChapters({
        cwd,
        projectId,
        model,
        project: baseProject,
        chapterIds: command.chapterIds,
        style: command.style,
        force: command.force,
        validateOutput: true,
        runner: structuredRunner,
        abortSignal: abortController.signal
      });

      if (storyTaskRunIdRef.current !== runId) {
        return;
      }

      applyStateUpdate((activeState) => {
        const saveError = saveStoryProject(cwd, result.project, activeState.storyProjectId);
        const renderedLabel = result.rendered.length > 0 ? result.rendered.join(", ") : "none";
        const skippedLabel = result.skipped.length > 0 ? result.skipped.join(", ") : "none";
        const errorLabel = result.errors.length > 0
          ? result.errors.map((entry) => `${entry.chapterId}: ${entry.message}`).join("; ")
          : "none";
        const response = buildStoryTranscriptResponse(
          result.project,
          activeState.activeStoryView ?? "world",
          saveError
            ? `Render finished (rendered: ${renderedLabel}; skipped: ${skippedLabel}; errors: ${errorLabel}). Persistence failed: ${saveError}`
            : `Render finished (rendered: ${renderedLabel}; skipped: ${skippedLabel}; errors: ${errorLabel}). Next: /compile all`,
          activeState.storyProjectId,
          syncStoryProjectList(activeState.storyProjects, activeState.storyProjectId, result.project)
        );
        const nextState = updateLatestTranscriptEntry(activeState, (entry) => ({
          ...entry,
          response,
          rawResponse: response,
          failed: false,
          streaming: false
        }));

        return setTransientNotice(
          {
            ...nextState,
            storyProject: result.project,
            storyProjects: syncStoryProjectList(
              nextState.storyProjects,
              nextState.storyProjectId,
              result.project
            ),
            pendingTask: null
          },
          result.errors.length > 0 ? "Render completed with errors." : "Render completed."
        );
      });
    } catch (error) {
      if (storyTaskRunIdRef.current !== runId) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      applyStateUpdate((activeState) =>
        setTransientNotice(
          {
            ...updateLatestTranscriptEntry(activeState, (entry) => ({
              ...entry,
              response: `Render failed. ${message}`,
              rawResponse: `Render failed. ${message}`,
              failed: true,
              streaming: false
            })),
            pendingTask: null
          },
          "Render failed."
        )
      );
    } finally {
      if (storyAbortControllerRef.current === abortController) {
        storyAbortControllerRef.current = null;
      }
    }
  };

  const runStoryCompileCommand = async (
    runId: number,
    baseProject: StoryProject,
    projectId: string | null,
    command: {
      chapterIds: string[];
      outputPath: string | null;
    }
  ): Promise<void> => {
    // Let the caller commit the pending state before this synchronous command
    // publishes its completion state.
    await Promise.resolve();

    try {
      const result = compileStoryChapters({
        cwd,
        projectId,
        project: baseProject,
        chapterIds: command.chapterIds,
        outputPath: command.outputPath
      });

      if (storyTaskRunIdRef.current !== runId) {
        return;
      }

      applyStateUpdate((activeState) =>
        setTransientNotice(
          {
            ...updateLatestTranscriptEntry(activeState, (entry) => ({
              ...entry,
              response: `Compiled chapters: ${result.compiledChapters.join(", ") || "none"}\nMissing chapters: ${result.missingChapters.join(", ") || "none"}\nOutput: ${path.relative(cwd, result.outputPath) || result.outputPath}\nNext: /validate all`,
              rawResponse: `Compiled chapters: ${result.compiledChapters.join(", ") || "none"}\nMissing chapters: ${result.missingChapters.join(", ") || "none"}\nOutput: ${path.relative(cwd, result.outputPath) || result.outputPath}\nNext: /validate all`,
              failed: !result.wroteOutput,
              streaming: false
            })),
            pendingTask: null
          },
          result.wroteOutput ? "Compile completed." : "Compile failed: no chapters found."
        )
      );
    } catch (error) {
      if (storyTaskRunIdRef.current !== runId) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      applyStateUpdate((activeState) =>
        setTransientNotice(
          {
            ...updateLatestTranscriptEntry(activeState, (entry) => ({
              ...entry,
              response: `Compile failed. ${message}`,
              rawResponse: `Compile failed. ${message}`,
              failed: true,
              streaming: false
            })),
            pendingTask: null
          },
          "Compile failed."
        )
      );
    }
  };

  const runStoryValidateCommand = async (
    runId: number,
    baseProject: StoryProject,
    projectId: string,
    command: {
      chapterIds: string[];
      repair: boolean;
    },
    model: string | null
  ): Promise<void> => {
    await Promise.resolve();
    const abortController = new AbortController();
    storyAbortControllerRef.current = abortController;

    try {
      let nextProject = baseProject;
      const chapterTexts: Record<string, string> = {};
      const artifactPaths = getStoryArtifactPaths(cwd, projectId);
      for (const chapterId of command.chapterIds) {
        const chapterPath = path.join(artifactPaths.chapters, `${chapterId}.md`);
        if (fs.existsSync(chapterPath)) {
          chapterTexts[chapterId] = fs.readFileSync(chapterPath, "utf8");
        }
      }

      let repairedTargets: string[] = [];
      let repairAttempts = 0;
      if (command.repair) {
        if (!model) {
          throw new Error("Select a model before using --repair.");
        }
        const gate = await runStoryValidationRepairGate(nextProject, {
          cwd,
          model,
          runner: structuredRunner,
          chapterTexts,
          abortSignal: abortController.signal,
          onTargetRepaired: ({ project }) => {
            nextProject = project;
            const error = saveStoryProject(cwd, nextProject, projectId);
            if (error) {
              throw new Error(`Could not persist repaired target: ${error}`);
            }
          }
        });
        nextProject = gate.project;
        repairedTargets = gate.repairedTargets;
        repairAttempts += gate.repairAttempts;

        for (const [chapterId, text] of Object.entries(chapterTexts)) {
          const chapterGate = await runChapterValidationRepairGate({
            cwd,
            model,
            project: nextProject,
            chapterId,
            text,
            runner: structuredRunner,
            abortSignal: abortController.signal
          });
          repairAttempts += chapterGate.repairAttempts;
          if (chapterGate.repairAttempts > 0) {
            chapterTexts[chapterId] = chapterGate.text;
            fs.writeFileSync(
              path.join(artifactPaths.chapters, `${chapterId}.md`),
              chapterGate.text.endsWith("\n") ? chapterGate.text : `${chapterGate.text}\n`,
              "utf8"
            );
            repairedTargets.push(`chapter:${chapterId}`);
          }
        }
      }

      const report = validateStoryProject(nextProject, { chapterTexts });
      const reportPath = writeStoryArtifactJson(cwd, projectId, "logs", "validation-report.json", {
        report,
        repairedTargets,
        repairAttempts
      });
      const saveError = saveStoryProject(cwd, nextProject, projectId);
      if (storyTaskRunIdRef.current !== runId) {
        return;
      }
      const categoryCounts = [...new Set(report.issues.map((issue) => issue.category))]
        .map((category) =>
          `${category}:${report.issues.filter((issue) => issue.category === category).length}`
        )
        .join(", ");
      const response = [
        `Validation ${report.passed ? "passed" : "failed"}: ${report.issues.length} issue(s).`,
        categoryCounts ? `Issues: ${categoryCounts}` : "All schema, chapter, fact, word-count, character, and foreshadow checks passed.",
        command.repair
          ? `Repair attempts: ${repairAttempts}; repaired: ${repairedTargets.join(", ") || "none"}.`
          : "Run /validate all --repair to repair only failed sections.",
        `Report: ${path.relative(cwd, reportPath)}`,
        saveError ? `Project persistence warning: ${saveError}` : ""
      ].filter(Boolean).join("\n");

      applyStateUpdate((activeState) =>
        setTransientNotice(
          {
            ...updateLatestTranscriptEntry(activeState, (entry) => ({
              ...entry,
              response,
              rawResponse: response,
              failed: !report.passed,
              streaming: false
            })),
            storyProject: nextProject,
            storyProjects: syncStoryProjectList(
              activeState.storyProjects,
              activeState.storyProjectId,
              nextProject
            ),
            pendingTask: null
          },
          report.passed ? "Validation passed." : "Validation found unresolved issues."
        )
      );
    } catch (error) {
      if (storyTaskRunIdRef.current !== runId) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      applyStateUpdate((activeState) =>
        setTransientNotice(
          {
            ...updateLatestTranscriptEntry(activeState, (entry) => ({
              ...entry,
              response: `Validation failed. ${message}`,
              rawResponse: `Validation failed. ${message}`,
              failed: true,
              streaming: false
            })),
            pendingTask: null
          },
          "Validation failed."
        )
      );
    } finally {
      if (storyAbortControllerRef.current === abortController) {
        storyAbortControllerRef.current = null;
      }
    }
  };

  const handlePlainPromptSubmit = (currentState: AppState, now: number): AppState => {
    const prompt = currentState.inputValue.trim();

    if (!prompt) {
      return currentState;
    }

    const currentConnection = currentState.config.connection;
    const currentModel = currentState.config.model;

    if (!currentConnection) {
      return setTransientNotice(currentState, "Run /connect first. Your draft was preserved.", now);
    }

    if (!currentModel) {
      return setTransientNotice(clearInputValue(currentState), "Run /models first.", now);
    }

    if (currentState.pendingTask) {
      return setTransientNotice(currentState, "Wait for the current task to finish.", now);
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

    if (currentState.storyProject?.meta.status === "awaiting_brief") {
      const seededProject: StoryProject = {
        ...currentState.storyProject,
        brief: {
          ...currentState.storyProject.brief,
          seedPrompt: prompt
        },
        meta: {
          ...currentState.storyProject.meta,
          status: "bootstrapping",
          updatedAt: new Date().toISOString()
        }
      };
      const storyRunId = storyTaskRunIdRef.current + 1;
      storyTaskRunIdRef.current = storyRunId;
      const pendingStoryProjects = syncStoryProjectList(
        currentState.storyProjects,
        currentState.storyProjectId,
        seededProject
      );
      const pendingResponse = buildStoryTranscriptResponse(
        seededProject,
        "world",
        "Generating world foundation...",
        currentState.storyProjectId,
        pendingStoryProjects
      );
      const pendingEntry: TranscriptEntry = {
        id: `story-${Date.now()}-${storyRunId}`,
        prompt,
        response: pendingResponse,
        provider: currentConnection.provider,
        model: currentModel,
        failed: false,
        rawResponse: pendingResponse,
        streaming: false
      };
      const initialState = appendTranscriptEntry(
        persistStoryProjectState(
          {
            ...clearInputValue(currentState),
            transientNotice: null,
            pendingTask: {
              kind: "story-bootstrap",
              stage: "foundation"
            }
          },
          seededProject,
          "world",
          "Story brief captured. Bootstrapping project...",
          now
        ),
        pendingEntry
      );

      void runStoryPipeline(
        storyRunId,
        "story-bootstrap",
        seededProject,
        currentState.storyProjectId,
        "all",
        currentModel
      );
      return initialState;
    }

    stopStreamingProcess();
    const streamRunId = streamRunIdRef.current + 1;
    streamRunIdRef.current = streamRunId;
    earlyStreamChunkBufferRef.current.delete(streamRunId);
    const pendingEntry: TranscriptEntry = {
      id: `turn-${Date.now()}-${streamRunId}`,
      prompt,
      response: "",
      provider: currentConnection.provider,
      model: currentModel,
      failed: false,
      rawResponse: "",
      streaming: true,
      startedAt: Date.now()
    };
    const initialState = appendTranscriptEntry(
      {
        ...clearInputValue(currentState),
        transientNotice: null,
        pendingTask: {
          kind: "chat",
          stage: null
        }
      },
      pendingEntry
    );

    const chatHistory: ChatMessage[] = currentState.transcript
      .filter(
        (entry) =>
          !entry.failed &&
          entry.response &&
          entry.provider !== "storyforge"
      )
      .flatMap((entry) => [
        { role: "user" as const, content: entry.prompt },
        { role: "assistant" as const, content: entry.response }
      ]);

    streamProcessRef.current = startDirectStream({
      model: currentModel,
      prompt,
      history: chatHistory,
      onText: (chunk) => {
        if (streamRunIdRef.current !== streamRunId) {
          earlyStreamChunkBufferRef.current.delete(streamRunId);
          return;
        }

        applyStateUpdate((activeState) => {
          const latestEntry = getLatestTranscriptEntry(activeState.transcript);

          if (!latestEntry) {
            const existingBufferedChunk = earlyStreamChunkBufferRef.current.get(streamRunId) ?? "";
            earlyStreamChunkBufferRef.current.set(
              streamRunId,
              `${existingBufferedChunk}${chunk}`
            );
            return activeState;
          }

          const bufferedChunk = earlyStreamChunkBufferRef.current.get(streamRunId);

          if (bufferedChunk) {
            earlyStreamChunkBufferRef.current.delete(streamRunId);
          }

          const effectiveChunk = bufferedChunk ? `${bufferedChunk}${chunk}` : chunk;

          return updateLatestTranscriptEntry(activeState, (currentEntry) => {
            const rawResponse = `${currentEntry.rawResponse ?? ""}${effectiveChunk}`;

            return {
              ...currentEntry,
              rawResponse,
              response: normalizeAssistantText(rawResponse),
              streaming: true
            };
          });
        });
      },
      onError: (message) => {
        if (streamRunIdRef.current !== streamRunId) {
          earlyStreamChunkBufferRef.current.delete(streamRunId);
          return;
        }

        streamProcessRef.current = null;
        applyStateUpdate((activeState) => {
          const bufferedChunk = earlyStreamChunkBufferRef.current.get(streamRunId) ?? "";
          earlyStreamChunkBufferRef.current.delete(streamRunId);
          const nextState = updateLatestTranscriptEntry(activeState, (latestEntry) => ({
            ...latestEntry,
            failed: true,
            streaming: false,
            completedAt: Date.now(),
            response: normalizeAssistantText(
              `${bufferedChunk}${latestEntry.rawResponse ?? latestEntry.response ?? ""}`
            ) || message,
            rawResponse:
              `${bufferedChunk}${latestEntry.rawResponse ?? latestEntry.response ?? ""}` || message
          }));

          return {
            ...nextState,
            pendingTask: null,
            transientNotice: {
              message: "Message send failed.",
              expiresAt: Date.now() + 2_500
            }
          };
        });
      },
      onComplete: () => {
        if (streamRunIdRef.current !== streamRunId) {
          earlyStreamChunkBufferRef.current.delete(streamRunId);
          return;
        }

        streamProcessRef.current = null;
        applyStateUpdate((activeState) => {
          const bufferedChunk = earlyStreamChunkBufferRef.current.get(streamRunId) ?? "";
          earlyStreamChunkBufferRef.current.delete(streamRunId);
          const latestEntry = getLatestTranscriptEntry(activeState.transcript);

          if (!latestEntry) {
            return {
              ...activeState,
              pendingTask: null
            };
          }

          const rawResponse =
            `${bufferedChunk}${latestEntry.rawResponse ?? latestEntry.response ?? ""}`;
          const normalized = normalizeAssistantText(rawResponse);

          return {
            ...updateLatestTranscriptEntry(activeState, (currentEntry) => ({
              ...currentEntry,
              response: normalized,
              rawResponse,
              streaming: false,
              completedAt: Date.now()
            })),
            pendingTask: null
          };
        });
      }
    });

    return initialState;
  };

  const executeParsedCommand = (
    currentState: AppState,
    parsedCommand: { command: string; args: string[] },
    now: number
  ): { nextState: AppState; shouldExit: boolean } => {
    const storyResult = handleStoryCommand(
      {
        currentProject: currentState.storyProject,
        currentProjectId: currentState.storyProjectId,
        projects: currentState.storyProjects
      },
      parsedCommand
    );
    const commandPrompt = formatParsedCommandPrompt(parsedCommand);

    if (storyResult.type !== "not-handled") {
      if (storyResult.type === "notice") {
        return {
          nextState: setTransientNotice(clearInputValue(currentState), storyResult.message, now),
          shouldExit: false
        };
      }

      if (storyResult.type === "library") {
        return {
          nextState: appendStoryTextEntry(
            setTransientNotice(clearInputValue(currentState), storyResult.message, now),
            commandPrompt,
            storyResult.response,
            "story/library"
          ),
          shouldExit: false
        };
      }

      if (storyResult.type === "project-picker") {
        const activeProjectIndex = currentState.storyProjects.findIndex(
          (entry) => entry.id === currentState.storyProjectId
        );
        const selectedIndex = activeProjectIndex >= 0 ? activeProjectIndex : 0;

        return {
          nextState: setTransientNotice(
            openProjectPickerModal(clearInputValue(currentState), selectedIndex),
            storyResult.message,
            now
          ),
          shouldExit: false
        };
      }

      if (storyResult.type === "create") {
        if (storyResult.dir) {
          const expandedDir = storyResult.dir === "~"
            ? os.homedir()
            : storyResult.dir.startsWith("~/")
              ? path.join(os.homedir(), storyResult.dir.slice(2))
              : storyResult.dir;
          const resolvedDir = path.isAbsolute(expandedDir)
            ? expandedDir
            : path.resolve(cwd, expandedDir);

          try {
            fs.mkdirSync(resolvedDir, { recursive: true });
          } catch {
            return {
              nextState: setTransientNotice(
                clearInputValue(currentState),
                `Failed to create directory: ${resolvedDir}`,
                now
              ),
              shouldExit: false
            };
          }

          cwdRef.current = resolvedDir;
        }

        const activeCwd = cwdRef.current;
        const createResult = createStoryProject(activeCwd, storyResult.project);
        const nextStateBase: AppState = {
          ...clearInputValue(currentState),
          storyProject: storyResult.project,
          storyProjectId: createResult.projectId,
          storyProjects: createResult.projects,
          activeStoryView: storyResult.activeView
        };
        const nextState = appendStoryTranscriptEntry(
          setTransientNotice(
            nextStateBase,
            createResult.error
              ? `${storyResult.message} Saved for this run, but story persistence failed: ${createResult.error}`
              : storyResult.message,
            now
          ),
          commandPrompt,
          storyResult.project,
          storyResult.activeView,
          storyResult.message
        );

        return {
          nextState,
          shouldExit: false
        };
      }

      if (storyResult.type === "open") {
        const activateError = setActiveStoryProject(cwd, storyResult.projectId);
        const openedProject = loadStoryProject(cwd, storyResult.projectId);

        if (!openedProject) {
          return {
            nextState: setTransientNotice(
              clearInputValue(currentState),
              "The selected story project could not be loaded.",
              now
            ),
            shouldExit: false
          };
        }

        const nextState = appendStoryTranscriptEntry(
          setTransientNotice(
            {
              ...clearInputValue(currentState),
              storyProject: openedProject,
              storyProjectId: storyResult.projectId,
              activeStoryView: getDefaultStoryView(openedProject)
            },
            activateError
              ? `${storyResult.message} Saved for this run, but project selection failed to persist: ${activateError}`
              : storyResult.message,
            now
          ),
          commandPrompt,
          openedProject,
          getDefaultStoryView(openedProject),
          storyResult.message
        );

        return {
          nextState,
          shouldExit: false
        };
      }

      if (storyResult.type === "view") {
        return {
          nextState: appendStoryTranscriptEntry(
            setTransientNotice(
              {
                ...clearInputValue(currentState),
                activeStoryView: storyResult.activeView
              },
              storyResult.message,
              now
            ),
            commandPrompt,
            currentState.storyProject as StoryProject,
            storyResult.activeView,
            storyResult.message
          ),
          shouldExit: false
        };
      }

      if (storyResult.type === "mutate") {
        return {
          nextState: appendStoryTranscriptEntry(
            persistStoryProjectState(
              currentState,
              storyResult.project,
              storyResult.activeView,
              storyResult.message,
              now
            ),
            commandPrompt,
            storyResult.project,
            storyResult.activeView,
            storyResult.message
          ),
          shouldExit: false
        };
      }

      if (storyResult.type === "commit") {
        const storyProject = currentState.storyProject;

        if (!storyProject) {
          return {
            nextState: setTransientNotice(
              clearInputValue(currentState),
              "Run /init first to create a story project.",
              now
            ),
            shouldExit: false
          };
        }

        const currentConnection = currentState.config.connection;
        const currentModel = currentState.config.model;

        if (!storyResult.patchFilePath) {
          if (!currentConnection) {
            return {
              nextState: setTransientNotice(clearInputValue(currentState), "Run /connect first.", now),
              shouldExit: false
            };
          }

          if (!currentModel) {
            return {
              nextState: setTransientNotice(clearInputValue(currentState), "Run /models first.", now),
              shouldExit: false
            };
          }

          const syncError = primeConnectionForRun(currentConnection);

          if (syncError) {
            return {
              nextState: setTransientNotice(
                clearInputValue(currentState),
                `Credential sync failed before commit: ${syncError}`,
                now
              ),
              shouldExit: false
            };
          }
        }

        const modelForCommit = currentModel ?? "deepseek/deepseek-chat";
        const storyRunId = storyTaskRunIdRef.current + 1;
        storyTaskRunIdRef.current = storyRunId;
        const pendingEntry: TranscriptEntry = {
          id: `story-commit-${Date.now()}-${storyRunId}`,
          prompt: commandPrompt,
          response: storyResult.message,
          provider: currentConnection?.provider ?? "storyforge",
          model: modelForCommit,
          failed: false,
          rawResponse: storyResult.message,
          streaming: false
        };
        const nextState = appendTranscriptEntry(
          setTransientNotice(
            {
              ...clearInputValue(currentState),
              pendingTask: {
                kind: "story-commit",
                stage: storyResult.chapterId
              }
            },
            storyResult.message,
            now
          ),
          pendingEntry
        );

        void runStoryCommitCommand(
          storyRunId,
          storyProject,
          {
            chapterId: storyResult.chapterId,
            eventText: storyResult.eventText,
            patchFilePath: storyResult.patchFilePath
              ? path.resolve(
                  cwd,
                  storyResult.patchFilePath === "~"
                    ? os.homedir()
                    : storyResult.patchFilePath.startsWith("~/")
                      ? path.join(os.homedir(), storyResult.patchFilePath.slice(2))
                      : storyResult.patchFilePath
                )
              : null,
            force: storyResult.force
          },
          modelForCommit
        );

        return {
          nextState,
          shouldExit: false
        };
      }

      if (storyResult.type === "ci") {
        const storyProject = currentState.storyProject;

        if (!storyProject) {
          return {
            nextState: setTransientNotice(
              clearInputValue(currentState),
              "Run /init first to create a story project.",
              now
            ),
            shouldExit: false
          };
        }

        const storyRunId = storyTaskRunIdRef.current + 1;
        storyTaskRunIdRef.current = storyRunId;
        const pendingEntry: TranscriptEntry = {
          id: `story-ci-${Date.now()}-${storyRunId}`,
          prompt: commandPrompt,
          response: storyResult.message,
          provider: "storyforge",
          model: "story/ci",
          failed: false,
          rawResponse: storyResult.message,
          streaming: false
        };
        const nextState = appendTranscriptEntry(
          setTransientNotice(
            {
              ...clearInputValue(currentState),
              pendingTask: {
                kind: "story-ci",
                stage: storyResult.scope
              }
            },
            storyResult.message,
            now
          ),
          pendingEntry
        );

        void runStoryCiCommand(storyRunId, storyProject, storyResult.scope, storyResult.commitId);

        return {
          nextState,
          shouldExit: false
        };
      }

      if (storyResult.type === "render") {
        const storyProject = currentState.storyProject;

        if (!storyProject) {
          return {
            nextState: setTransientNotice(
              clearInputValue(currentState),
              "Run /init first to create a story project.",
              now
            ),
            shouldExit: false
          };
        }

        const currentConnection = currentState.config.connection;
        const currentModel = currentState.config.model;

        if (!currentConnection) {
          return {
            nextState: setTransientNotice(clearInputValue(currentState), "Run /connect first.", now),
            shouldExit: false
          };
        }

        if (!currentModel) {
          return {
            nextState: setTransientNotice(clearInputValue(currentState), "Run /models first.", now),
            shouldExit: false
          };
        }

        const syncError = primeConnectionForRun(currentConnection);

        if (syncError) {
          return {
            nextState: setTransientNotice(
              clearInputValue(currentState),
              `Credential sync failed before render: ${syncError}`,
              now
            ),
            shouldExit: false
          };
        }

        const storyRunId = storyTaskRunIdRef.current + 1;
        storyTaskRunIdRef.current = storyRunId;
        const pendingEntry: TranscriptEntry = {
          id: `story-render-${Date.now()}-${storyRunId}`,
          prompt: commandPrompt,
          response: storyResult.message,
          provider: currentConnection.provider,
          model: currentModel,
          failed: false,
          rawResponse: storyResult.message,
          streaming: false
        };
        const nextState = appendTranscriptEntry(
          setTransientNotice(
            {
              ...clearInputValue(currentState),
              pendingTask: {
                kind: "story-render",
                stage: storyResult.chapterIds.join(",")
              }
            },
            storyResult.message,
            now
          ),
          pendingEntry
        );

        void runStoryRenderCommand(
          storyRunId,
          storyProject,
          currentState.storyProjectId,
          {
            chapterIds: storyResult.chapterIds,
            force: storyResult.force,
            style: storyResult.style
          },
          currentModel
        );

        return {
          nextState,
          shouldExit: false
        };
      }

      if (storyResult.type === "compile") {
        const storyProject = currentState.storyProject;

        if (!storyProject) {
          return {
            nextState: setTransientNotice(
              clearInputValue(currentState),
              "Run /init first to create a story project.",
              now
            ),
            shouldExit: false
          };
        }

        const storyRunId = storyTaskRunIdRef.current + 1;
        storyTaskRunIdRef.current = storyRunId;
        const pendingEntry: TranscriptEntry = {
          id: `story-compile-${Date.now()}-${storyRunId}`,
          prompt: commandPrompt,
          response: storyResult.message,
          provider: "storyforge",
          model: "story/compile",
          failed: false,
          rawResponse: storyResult.message,
          streaming: false
        };
        const nextState = appendTranscriptEntry(
          setTransientNotice(
            {
              ...clearInputValue(currentState),
              pendingTask: {
                kind: "story-compile",
                stage: storyResult.chapterIds.join(",")
              }
            },
            storyResult.message,
            now
          ),
          pendingEntry
        );

        void runStoryCompileCommand(storyRunId, storyProject, currentState.storyProjectId, {
          chapterIds: storyResult.chapterIds,
          outputPath: storyResult.outputPath
        });

        return {
          nextState,
          shouldExit: false
        };
      }

      if (storyResult.type === "validate") {
        const storyProject = currentState.storyProject;
        const projectId = currentState.storyProjectId;
        if (!storyProject || !projectId) {
          return {
            nextState: setTransientNotice(
              clearInputValue(currentState),
              "Run /init first to create a story project.",
              now
            ),
            shouldExit: false
          };
        }
        if (storyResult.repair) {
          if (!currentState.config.connection) {
            return {
              nextState: setTransientNotice(clearInputValue(currentState), "Run /connect first.", now),
              shouldExit: false
            };
          }
          if (!currentState.config.model) {
            return {
              nextState: setTransientNotice(clearInputValue(currentState), "Run /models first.", now),
              shouldExit: false
            };
          }
          const syncError = primeConnectionForRun(currentState.config.connection);
          if (syncError) {
            return {
              nextState: setTransientNotice(
                clearInputValue(currentState),
                `Credential sync failed before repair: ${syncError}`,
                now
              ),
              shouldExit: false
            };
          }
        }

        const storyRunId = storyTaskRunIdRef.current + 1;
        storyTaskRunIdRef.current = storyRunId;
        const pendingEntry: TranscriptEntry = {
          id: `story-validate-${Date.now()}-${storyRunId}`,
          prompt: commandPrompt,
          response: storyResult.message,
          provider: currentState.config.connection?.provider ?? "storyforge",
          model: storyResult.repair
            ? currentState.config.model ?? "story/validate"
            : "story/validate",
          failed: false,
          rawResponse: storyResult.message,
          streaming: false
        };
        const nextState = appendTranscriptEntry(
          setTransientNotice(
            {
              ...clearInputValue(currentState),
              pendingTask: {
                kind: "story-validate",
                stage: storyResult.repair ? "repair" : "check"
              }
            },
            storyResult.message,
            now
          ),
          pendingEntry
        );

        void runStoryValidateCommand(
          storyRunId,
          storyProject,
          projectId,
          {
            chapterIds: storyResult.chapterIds,
            repair: storyResult.repair
          },
          currentState.config.model
        );

        return {
          nextState,
          shouldExit: false
        };
      }

      if (storyResult.type !== "refresh") {
        return {
          nextState: currentState,
          shouldExit: false
        };
      }

      const currentConnection = currentState.config.connection;
      const currentModel = currentState.config.model;

      if (!currentConnection) {
        return {
          nextState: setTransientNotice(clearInputValue(currentState), "Run /connect first.", now),
          shouldExit: false
        };
      }

      if (!currentModel) {
        return {
          nextState: setTransientNotice(clearInputValue(currentState), "Run /models first.", now),
          shouldExit: false
        };
      }

      const syncError = primeConnectionForRun(currentConnection);

      if (syncError) {
        return {
          nextState: setTransientNotice(
            clearInputValue(currentState),
            `Credential sync failed before refresh: ${syncError}`,
            now
          ),
          shouldExit: false
        };
      }

      const storyProject = currentState.storyProject;

      if (!storyProject) {
        return {
          nextState: setTransientNotice(
            clearInputValue(currentState),
            "Run /init first to create a story project.",
            now
          ),
          shouldExit: false
        };
      }

      const storyRunId = storyTaskRunIdRef.current + 1;
      storyTaskRunIdRef.current = storyRunId;
      const pendingEntry: TranscriptEntry = {
        id: `story-refresh-${Date.now()}-${storyRunId}`,
        prompt: commandPrompt,
        response: storyResult.message,
        provider: currentConnection.provider,
        model: currentModel,
        failed: false,
        rawResponse: storyResult.message,
        streaming: false
      };
      const nextState = appendTranscriptEntry(
        setTransientNotice(
          {
            ...clearInputValue(currentState),
            activeStoryView: storyResult.activeView,
            pendingTask: {
              kind: "story-refresh",
              stage: storyResult.scope
            }
          },
          storyResult.message,
          now
        ),
        pendingEntry
      );

      void runStoryPipeline(
        storyRunId,
        "story-refresh",
        storyProject,
        currentState.storyProjectId,
        storyResult.scope,
        currentModel
      );

      return {
        nextState,
        shouldExit: false
      };
    }

    switch (parsedCommand.command) {
      case "/cancel":
        if (!currentState.pendingTask || !storyAbortControllerRef.current) {
          return {
            nextState: setTransientNotice(
              clearInputValue(currentState),
              "No cancellable story task is running.",
              now
            ),
            shouldExit: false
          };
        }
        storyAbortControllerRef.current.abort("Cancelled by user.");
        return {
          nextState: setTransientNotice(
            clearInputValue(currentState),
            "Cancellation requested; checkpoint preserved.",
            now
          ),
          shouldExit: false
        };

      case "/retry":
      case "/resume": {
        if (currentState.pendingTask) {
          return {
            nextState: setTransientNotice(
              clearInputValue(currentState),
              "Cancel or wait for the current task first.",
              now
            ),
            shouldExit: false
          };
        }
        if (!currentState.storyProject || !currentState.storyProjectId || !currentState.config.model) {
          return {
            nextState: setTransientNotice(
              clearInputValue(currentState),
              "A project and model are required to resume.",
              now
            ),
            shouldExit: false
          };
        }
        let checkpoint;
        try {
          checkpoint = findLatestIncompleteStoryTaskCheckpoint(cwd, currentState.storyProjectId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            nextState: setTransientNotice(
              clearInputValue(currentState),
              `Checkpoint recovery stopped safely. ${message}`,
              now
            ),
            shouldExit: false
          };
        }
        if (!checkpoint) {
          return {
            nextState: setTransientNotice(
              clearInputValue(currentState),
              "No incomplete checkpoint was found.",
              now
            ),
            shouldExit: false
          };
        }
        const scope = checkpoint.scope as "all" | "world" | "characters" | "timeline" | "outline";
        const storyRunId = storyTaskRunIdRef.current + 1;
        storyTaskRunIdRef.current = storyRunId;
        const taskKind = checkpoint.kind === "story-refresh"
          ? "story-refresh"
          : "story-bootstrap";
        const pendingEntry: TranscriptEntry = {
          id: `story-resume-${Date.now()}-${storyRunId}`,
          prompt: parsedCommand.command,
          response: `Resuming checkpoint ${checkpoint.id}...`,
          provider: currentState.config.connection?.provider ?? "storyforge",
          model: currentState.config.model,
          failed: false,
          streaming: false
        };

        void runStoryPipeline(
          storyRunId,
          taskKind,
          currentState.storyProject,
          currentState.storyProjectId,
          scope,
          currentState.config.model,
          checkpoint.id
        );

        return {
          nextState: appendTranscriptEntry(
            {
              ...clearInputValue(currentState),
              pendingTask: {
                kind: taskKind,
                stage: checkpoint.currentStage,
                taskId: checkpoint.id,
                stageIndex: checkpoint.stageIndex,
                totalStages: checkpoint.totalStages,
                startedAt: new Date(checkpoint.startedAt).getTime(),
                retryCount: checkpoint.retryCount,
                checkpointPath: checkpoint.checkpointPath
              }
            },
            pendingEntry
          ),
          shouldExit: false
        };
      }

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

        return {
          nextState: setTransientNotice(
            clearInputValue(currentState),
            "API keys are not accepted in commands. Run /connect <provider> and use the protected credential dialog.",
            now
          ),
          shouldExit: false
        };
      case "/model":
      case "/models":
        if (parsedCommand.args.length === 0) {
          return {
            nextState: openModelPickerFromHistory(currentState, now),
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
              chatSessionId: null
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
      case "/clear":
        return {
          nextState: {
            ...clearInputValue(currentState),
            transcript: [],
            transcriptScrollOffset: 0,
            latestExchange: null
          },
          shouldExit: false
        };
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
        nextState: openModelPickerFromHistory(paletteState, now),
        shouldExit: false
      };
    }

    if (selectedItem.action === "clear") {
      return {
        nextState: {
          ...paletteState,
          transcript: [],
          transcriptScrollOffset: 0,
          latestExchange: null
        },
        shouldExit: false
      };
    }

    if (selectedItem.action === "exit") {
      return {
        nextState: paletteState,
        shouldExit: true
      };
    }

    return executeParsedCommand(
      paletteState,
      {
        command: selectedItem.command,
        args: []
      },
      now
    );
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

    if (currentState.modal.selectedIndex === 0) {
      return openConnectOauthModal(currentState, providerOption.id, "browser");
    }

    if (currentState.modal.selectedIndex === 1) {
      return openConnectOauthModal(currentState, providerOption.id, "headless");
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
      return openModelPickerForProvider(
        setTransientNotice(
          connectedState,
          `Imported an existing ${providerOption.title} credential because browser auth could not be reopened here.`,
          now
        ),
        now
      );
    }

    return openModelPickerForProvider(connectedState, now);
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

    return openModelPickerForProvider(persistedState, now);
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

    if (outcome.nextConfig.connection) {
      primeConnectionForRun(outcome.nextConfig.connection);
    }

    const nextState = applyConfigAndNotice(
      {
        ...closeModal(currentState),
        latestExchange:
          getLatestTranscriptEntry(currentState.transcript) ?? currentState.latestExchange,
        chatSessionId: null
      },
      outcome.nextConfig,
      outcome.message,
      now
    );

    return persistConfig(nextState, outcome.nextConfig);
  };

  const handleProjectPickerSubmit = (currentState: AppState, now: number): AppState => {
    if (!currentState.modal || currentState.modal.kind !== "project-picker") {
      return currentState;
    }

    const selectedProject =
      currentState.storyProjects[
        Math.min(currentState.modal.selectedIndex, currentState.storyProjects.length - 1)
      ];

    if (!selectedProject) {
      return setTransientNotice(closeModal(currentState), "No saved story projects yet.", now);
    }

    const submission = executeParsedCommand(
      closeModal(currentState),
      {
        command: "/projects",
        args: ["open", String(currentState.modal.selectedIndex + 1)]
      },
      now
    );

    return submission.nextState;
  };

  const handleCommandSubmit = (currentState: AppState, now: number): { nextState: AppState; shouldExit: boolean } => {
    const parsedCommand = parseCommandInput(currentState.inputValue);

    if (
      (parsedCommand?.command === "/project" && parsedCommand.args.length === 0) ||
      (parsedCommand?.command === "/projects" && parsedCommand.args.length === 0)
    ) {
      return executeParsedCommand(currentState, parsedCommand, now);
    }

    if (shouldShowCommandPreview(currentState.inputValue)) {
      return executePaletteAction(currentState, now);
    }

    if (!parsedCommand) {
      return {
        nextState: handlePlainPromptSubmit(currentState, now),
        shouldExit: false
      };
    }

    return executeParsedCommand(currentState, parsedCommand, now);
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

  const isModelPickerOpen = state.modal?.kind === "model-picker";

  useEffect(() => {
    if (!isModelPickerOpen) {
      return;
    }

    const providerIds = new Set<string>();
    const history = stateRef.current.config.connectionHistory;
    const activeProviderId = stateRef.current.config.connection?.provider;

    if (history) {
      for (const providerId of Object.keys(history)) {
        providerIds.add(providerId);
      }
    }

    if (activeProviderId) {
      providerIds.add(activeProviderId);
    }

    if (providerIds.size === 0) {
      return;
    }

    for (const providerId of providerIds) {
      if (modelCacheRef.current.has(providerId) || modelFetchingRef.current.has(providerId)) {
        continue;
      }

      modelFetchingRef.current.add(providerId);

      fetchModelIdsAsync(providerId, (fetchedModelIds) => {
        modelFetchingRef.current.delete(providerId);
        modelCacheRef.current.set(providerId, fetchedModelIds);

        applyStateUpdate((currentState) => {
          if (!currentState.modal || currentState.modal.kind !== "model-picker") {
            return currentState;
          }

          return rebuildModelPickerWithCache(currentState, modelCacheRef.current);
        });
      });
    }
  }, [isModelPickerOpen]);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }

    // Ignore mouse escape sequences that leak through from SGR reporting
    if (input.includes("[<") || /^\d+;\d+[Mm]/.test(input)) {
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
          commitState(moveConnectAuthModeSelection(currentState, 3, -1));
          return;
        }

        if (key.downArrow) {
          commitState(moveConnectAuthModeSelection(currentState, 3, 1));
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
          const hasSavedOauthCredentialForProvider =
            currentState.config.connection?.provider === currentState.modal.providerId &&
            currentState.config.connection.authMode === "oauth" &&
            Boolean(currentState.config.connection.apiKey);

          if (
            currentState.modal.providerId === "openai" &&
            !hasSavedOauthCredentialForProvider
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

          if (
            currentState.modal.providerId === "github-copilot" &&
            !hasSavedOauthCredentialForProvider
          ) {
            if (
              currentState.modal.flowPhase === "launching" ||
              currentState.modal.flowPhase === "waiting"
            ) {
              return;
            }

            void beginNativeGitHubCopilotOauthFlow(currentState);
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

      if (currentState.modal.kind === "project-picker") {
        if (key.upArrow) {
          commitState(moveProjectPickerSelection(currentState, currentState.storyProjects.length, -1));
          return;
        }

        if (key.downArrow) {
          commitState(moveProjectPickerSelection(currentState, currentState.storyProjects.length, 1));
          return;
        }

        if (key.return) {
          commitState(handleProjectPickerSubmit(currentState, Date.now()));
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

    if (currentState.pendingTask) {
      if (key.upArrow) {
        commitState(moveTranscriptScroll(currentState, 1));
        return;
      }

      if (key.downArrow) {
        commitState(moveTranscriptScroll(currentState, -1));
        return;
      }

      if (key.escape && currentState.pendingTask.kind === "chat") {
        stopStreamingProcess();
        const nextState = updateLatestTranscriptEntry(currentState, (latestEntry) => ({
          ...latestEntry,
          failed: true,
          streaming: false,
          completedAt: Date.now(),
          response: latestEntry.response || "Generation cancelled.",
          rawResponse: latestEntry.rawResponse || "Generation cancelled."
        }));
        commitState({
          ...nextState,
          pendingTask: null,
          transientNotice: {
            message: "Generation cancelled.",
            expiresAt: Date.now() + 2_500
          }
        });
        return;
      }

      if (
        key.return &&
        parseCommandInput(currentState.inputValue)?.command === "/cancel"
      ) {
        const submission = handleCommandSubmit(currentState, Date.now());
        commitState(submission.nextState);
        return;
      }

      if (key.escape && storyAbortControllerRef.current) {
        storyAbortControllerRef.current.abort("Cancelled by user.");
        commitState(
          setTransientNotice(
            currentState,
            "Cancellation requested; checkpoint preserved.",
            Date.now()
          )
        );
        return;
      }

      // Allow typing in the input while a task is running,
      // so the user can prepare their next prompt.
      if (key.backspace || key.delete) {
        applyStateUpdate((s) => deleteInputCharacter(s));
        return;
      }

      if (key.leftArrow) {
        applyStateUpdate((s) => key.ctrl || key.meta ? moveInputCursorToStart(s) : moveInputCursor(s, -1));
        return;
      }

      if (key.rightArrow) {
        applyStateUpdate((s) => key.ctrl || key.meta ? moveInputCursorToEnd(s) : moveInputCursor(s, 1));
        return;
      }

      if (!key.ctrl && !key.meta && !key.tab && !key.return && !key.escape && input) {
        applyStateUpdate((s) => appendInputCharacter(s, input));
      }

      return;
    }

    const showCommandPreview = shouldShowCommandPreview(currentState.inputValue);

    if (key.escape) {
      if (showCommandPreview) {
        commitState(clearInputValue(currentState));
        return;
      }

      exit();
      return;
    }

    if (!showCommandPreview && key.upArrow) {
      commitState(moveTranscriptScroll(currentState, 1));
      return;
    }

    if (!showCommandPreview && key.downArrow) {
      commitState(moveTranscriptScroll(currentState, -1));
      return;
    }

    if (showCommandPreview && key.upArrow) {
      commitState(
        moveCommandSelection(
          currentState,
          getCommandPreviewItems(currentState.inputValue).length,
          -1
        )
      );
      return;
    }

    if (showCommandPreview && key.downArrow) {
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

    if (key.tab && showCommandPreview) {
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

    if (key.leftArrow) {
      if (key.ctrl || key.meta) {
        applyStateUpdate((nextState) => moveInputCursorToStart(nextState));
      } else {
        applyStateUpdate((nextState) => moveInputCursor(nextState, -1));
      }

      return;
    }

    if (key.rightArrow) {
      if (key.ctrl || key.meta) {
        applyStateUpdate((nextState) => moveInputCursorToEnd(nextState));
      } else {
        applyStateUpdate((nextState) => moveInputCursor(nextState, 1));
      }

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
