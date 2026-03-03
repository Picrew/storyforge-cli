export type ViewportMode = "hero" | "compact" | "minimal";

export interface ThemeTokens {
  accent: string;
  accentSecondary: string;
  textPrimary: string;
  textSecondary: string;
  border: string;
  notice: string;
  gradient: readonly string[];
}

export interface TransientNotice {
  message: string;
  expiresAt: number;
}

export interface AppState {
  inputValue: string;
  transientNotice: TransientNotice | null;
  viewportMode: ViewportMode;
}

export type HeaderVariantMap = Record<ViewportMode, readonly string[]>;
