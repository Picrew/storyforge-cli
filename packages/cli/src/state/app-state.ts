import { copy } from "../content/copy.js";
import { resolveViewportMode } from "../layout/viewport.js";
import type { StoryLibraryEntry, StoryProject, StoryView } from "../story/types.js";
import type {
  AppState,
  ConnectCredentialsModal,
  ConnectOauthModal,
  ModalState,
  OauthFlowMode,
  OauthFlowPhase,
  SessionConfig
} from "../types.js";

const NOTICE_TTL_MS = 2500;

function createEmptySessionConfig(): SessionConfig {
  return {
    connection: null,
    model: null
  };
}

function getInitialStoryView(project: StoryProject | null): StoryView | null {
  if (!project) {
    return null;
  }

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
}

function clampIndex(value: number, itemCount: number): number {
  if (itemCount <= 0) {
    return 0;
  }

  if (value < 0) {
    return itemCount - 1;
  }

  if (value >= itemCount) {
    return 0;
  }

  return value;
}

function createTransientNotice(message: string, now: number): AppState["transientNotice"] {
  return {
    message,
    expiresAt: now + NOTICE_TTL_MS
  };
}

function updateCredentialsModal(
  modal: ConnectCredentialsModal,
  updater: (currentModal: ConnectCredentialsModal) => ConnectCredentialsModal
): ModalState {
  return updater(modal);
}

function updateOauthModal(
  modal: ConnectOauthModal,
  updater: (currentModal: ConnectOauthModal) => ConnectOauthModal
): ModalState {
  return updater(modal);
}

export function createInitialAppState(
  terminalWidth: number,
  config: SessionConfig = createEmptySessionConfig(),
  storyProject: StoryProject | null = null,
  storyProjectId: string | null = null,
  storyProjects: readonly StoryLibraryEntry[] = []
): AppState {
  return {
    inputValue: "",
    transientNotice: null,
    viewportMode: resolveViewportMode(terminalWidth),
    config,
    storyProject,
    storyProjectId,
    storyProjects,
    activeStoryView: getInitialStoryView(storyProject),
    commandSelectionIndex: 0,
    modal: null,
    latestExchange: null,
    transcript: [],
    transcriptScrollOffset: 0,
    pendingTask: null,
    opencodeSessionId: null
  };
}

export function syncViewportMode(state: AppState, terminalWidth: number): AppState {
  const nextMode = resolveViewportMode(terminalWidth);

  if (state.viewportMode === nextMode) {
    return state;
  }

  return {
    ...state,
    viewportMode: nextMode
  };
}

export function appendInputCharacter(state: AppState, input: string): AppState {
  if (!input) {
    return state;
  }

  return {
    ...state,
    inputValue: `${state.inputValue}${input}`,
    commandSelectionIndex: 0
  };
}

export function deleteInputCharacter(state: AppState): AppState {
  if (!state.inputValue) {
    return state;
  }

  return {
    ...state,
    inputValue: state.inputValue.slice(0, -1),
    commandSelectionIndex: 0
  };
}

export function replaceInputValue(state: AppState, inputValue: string): AppState {
  return {
    ...state,
    inputValue,
    commandSelectionIndex: 0
  };
}

export function clearInputValue(state: AppState): AppState {
  if (!state.inputValue) {
    return state;
  }

  return {
    ...state,
    inputValue: "",
    commandSelectionIndex: 0
  };
}

export function moveCommandSelection(state: AppState, itemCount: number, delta: number): AppState {
  if (itemCount <= 0) {
    return state;
  }

  return {
    ...state,
    commandSelectionIndex: clampIndex(state.commandSelectionIndex + delta, itemCount)
  };
}

export function setTransientNotice(state: AppState, message: string, now: number = Date.now()): AppState {
  return {
    ...state,
    transientNotice: createTransientNotice(message, now)
  };
}

export function clearExpiredNotice(state: AppState, now: number = Date.now()): AppState {
  if (!state.transientNotice) {
    return state;
  }

  if (state.transientNotice.expiresAt > now) {
    return state;
  }

  return {
    ...state,
    transientNotice: null
  };
}

export function submitPlainPrompt(state: AppState, now: number = Date.now()): AppState {
  if (!state.inputValue.trim()) {
    return state;
  }

  return {
    ...state,
    inputValue: "",
    commandSelectionIndex: 0,
    transientNotice: createTransientNotice(copy.previewNotice, now)
  };
}

export function applyConfigAndNotice(
  state: AppState,
  config: SessionConfig,
  message: string,
  now: number = Date.now()
): AppState {
  return {
    ...state,
    config,
    inputValue: "",
    commandSelectionIndex: 0,
    transientNotice: createTransientNotice(message, now)
  };
}

export function openConnectProviderModal(state: AppState): AppState {
  return {
    ...state,
    inputValue: "",
    commandSelectionIndex: 0,
    modal: {
      kind: "connect-provider",
      searchValue: "",
      selectedIndex: 0
    }
  };
}

export function openConnectOauthModal(state: AppState, providerId: string): AppState {
  return {
    ...state,
    modal: {
      kind: "connect-oauth",
      providerId,
      flowMode: "browser",
      flowPhase: "idle",
      authUrl: null,
      userCode: null,
      statusMessage: null,
      errorMessage: null
    }
  };
}

export function toggleConnectOauthFlowMode(state: AppState): AppState {
  if (!state.modal || state.modal.kind !== "connect-oauth") {
    return state;
  }

  return {
    ...state,
    modal: updateOauthModal(state.modal, (currentModal) => ({
      ...currentModal,
      flowMode: currentModal.flowMode === "browser" ? "headless" : "browser",
      flowPhase: "idle",
      authUrl: null,
      userCode: null,
      statusMessage: null,
      errorMessage: null
    }))
  };
}

export function setConnectOauthFlowState(
  state: AppState,
  updates: Partial<
    Pick<
      ConnectOauthModal,
      "flowMode" | "flowPhase" | "authUrl" | "userCode" | "statusMessage" | "errorMessage"
    >
  >
): AppState {
  if (!state.modal || state.modal.kind !== "connect-oauth") {
    return state;
  }

  return {
    ...state,
    modal: updateOauthModal(state.modal, (currentModal) => ({
      ...currentModal,
      ...updates
    }))
  };
}

export function resetConnectOauthFlowState(
  state: AppState,
  flowMode?: OauthFlowMode,
  flowPhase: OauthFlowPhase = "idle"
): AppState {
  if (!state.modal || state.modal.kind !== "connect-oauth") {
    return state;
  }

  return {
    ...state,
    modal: updateOauthModal(state.modal, (currentModal) => ({
      ...currentModal,
      flowMode: flowMode ?? currentModal.flowMode,
      flowPhase,
      authUrl: null,
      userCode: null,
      statusMessage: null,
      errorMessage: null
    }))
  };
}

export function openConnectAuthModeModal(state: AppState, providerId: string): AppState {
  return {
    ...state,
    modal: {
      kind: "connect-auth-mode",
      providerId,
      selectedIndex: 0
    }
  };
}

export function closeModal(state: AppState): AppState {
  if (!state.modal) {
    return state;
  }

  return {
    ...state,
    modal: null
  };
}

export function setConnectProviderSearch(state: AppState, searchValue: string): AppState {
  if (!state.modal || state.modal.kind !== "connect-provider") {
    return state;
  }

  return {
    ...state,
    modal: {
      ...state.modal,
      searchValue,
      selectedIndex: 0
    }
  };
}

export function moveConnectProviderSelection(
  state: AppState,
  itemCount: number,
  delta: number
): AppState {
  if (!state.modal || state.modal.kind !== "connect-provider") {
    return state;
  }

  return {
    ...state,
    modal: {
      ...state.modal,
      selectedIndex: clampIndex(state.modal.selectedIndex + delta, itemCount)
    }
  };
}

export function moveConnectAuthModeSelection(
  state: AppState,
  itemCount: number,
  delta: number
): AppState {
  if (!state.modal || state.modal.kind !== "connect-auth-mode") {
    return state;
  }

  return {
    ...state,
    modal: {
      ...state.modal,
      selectedIndex: clampIndex(state.modal.selectedIndex + delta, itemCount)
    }
  };
}

export function openConnectCredentialsModal(
  state: AppState,
  providerId: string,
  fieldLabel: string,
  helperText: string
): AppState {
  return {
    ...state,
    modal: {
      kind: "connect-credentials",
      providerId,
      fieldLabel,
      helperText,
      apiKeyValue: ""
    }
  };
}

export function reopenConnectProviderModal(state: AppState, providerId: string): AppState {
  return {
    ...state,
    modal: {
      kind: "connect-provider",
      searchValue: providerId,
      selectedIndex: 0
    }
  };
}

export function appendConnectCredentialsCharacter(state: AppState, input: string): AppState {
  if (!state.modal || state.modal.kind !== "connect-credentials" || !input) {
    return state;
  }

  return {
    ...state,
    modal: updateCredentialsModal(state.modal, (currentModal) =>
      ({ ...currentModal, apiKeyValue: `${currentModal.apiKeyValue}${input}` })
    )
  };
}

export function deleteConnectCredentialsCharacter(state: AppState): AppState {
  if (!state.modal || state.modal.kind !== "connect-credentials") {
    return state;
  }

  return {
    ...state,
    modal: updateCredentialsModal(state.modal, (currentModal) =>
      ({ ...currentModal, apiKeyValue: currentModal.apiKeyValue.slice(0, -1) })
    )
  };
}

export function openModelPickerModal(
  state: AppState,
  providerId: string,
  modelIds: readonly string[],
  selectedIndex: number = 0
): AppState {
  return {
    ...state,
    inputValue: "",
    commandSelectionIndex: 0,
    modal: {
      kind: "model-picker",
      providerId,
      searchValue: "",
      selectedIndex,
      modelIds
    }
  };
}

export function setModelPickerSearch(state: AppState, searchValue: string): AppState {
  if (!state.modal || state.modal.kind !== "model-picker") {
    return state;
  }

  return {
    ...state,
    modal: {
      ...state.modal,
      searchValue,
      selectedIndex: 0
    }
  };
}

export function moveModelPickerSelection(
  state: AppState,
  itemCount: number,
  delta: number
): AppState {
  if (!state.modal || state.modal.kind !== "model-picker") {
    return state;
  }

  return {
    ...state,
    modal: {
      ...state.modal,
      selectedIndex: clampIndex(state.modal.selectedIndex + delta, itemCount)
    }
  };
}

export function moveTranscriptScroll(state: AppState, delta: number): AppState {
  if (delta === 0) {
    return state;
  }

  return {
    ...state,
    transcriptScrollOffset: Math.max(0, state.transcriptScrollOffset + delta)
  };
}

export function resetTranscriptScroll(state: AppState): AppState {
  if (state.transcriptScrollOffset === 0) {
    return state;
  }

  return {
    ...state,
    transcriptScrollOffset: 0
  };
}
