import type {
  PendingTask,
  StoryLibraryEntry,
  StoryProject,
  StoryView
} from "./story/types.js";

export type ViewportMode = "hero" | "compact" | "minimal";

export interface ThemeTokens {
  accent: string;
  accentSecondary: string;
  textPrimary: string;
  textSecondary: string;
  border: string;
  notice: string;
  success: string;
  gradient: readonly string[];
}

export interface TransientNotice {
  message: string;
  expiresAt: number;
}

export type ConnectionAuthMode = "api" | "oauth";

export interface SessionConnection {
  provider: string;
  authMode: ConnectionAuthMode;
  apiKey: string | null;
  baseUrl: string | null;
  authLabel: string | null;
}

export interface SessionConfig {
  connection: SessionConnection | null;
  model: string | null;
}

export interface ProviderPickerModal {
  kind: "connect-provider";
  searchValue: string;
  selectedIndex: number;
}

export interface ConnectAuthModeModal {
  kind: "connect-auth-mode";
  providerId: string;
  selectedIndex: number;
}

export type OauthFlowMode = "browser" | "headless";
export type OauthFlowPhase = "idle" | "launching" | "waiting" | "failed";

export interface ConnectOauthModal {
  kind: "connect-oauth";
  providerId: string;
  flowMode: OauthFlowMode;
  flowPhase: OauthFlowPhase;
  authUrl: string | null;
  userCode: string | null;
  statusMessage: string | null;
  errorMessage: string | null;
}

export interface ConnectCredentialsModal {
  kind: "connect-credentials";
  providerId: string;
  fieldLabel: string;
  helperText: string;
  apiKeyValue: string;
}

export interface ModelPickerModal {
  kind: "model-picker";
  providerId: string;
  searchValue: string;
  selectedIndex: number;
  modelIds: readonly string[];
}

export type ModalState =
  | ProviderPickerModal
  | ConnectAuthModeModal
  | ConnectOauthModal
  | ConnectCredentialsModal
  | ModelPickerModal;

export interface LatestExchange {
  prompt: string;
  response: string;
  provider: string;
  model: string;
  failed: boolean;
  rawResponse?: string;
  streaming?: boolean;
}

export interface TranscriptEntry extends LatestExchange {
  id: string;
}

export interface AppState {
  inputValue: string;
  inputCursorPosition: number;
  transientNotice: TransientNotice | null;
  viewportMode: ViewportMode;
  config: SessionConfig;
  storyProject: StoryProject | null;
  storyProjectId: string | null;
  storyProjects: readonly StoryLibraryEntry[];
  activeStoryView: StoryView | null;
  commandSelectionIndex: number;
  modal: ModalState | null;
  latestExchange: LatestExchange | null;
  transcript: readonly TranscriptEntry[];
  transcriptScrollOffset: number;
  pendingTask: PendingTask | null;
  opencodeSessionId: string | null;
}

export interface InputSubmissionResult {
  nextState: AppState;
  configToPersist: SessionConfig | null;
  shouldExit: boolean;
}

export type HeaderVariantMap = Record<ViewportMode, readonly string[]>;
