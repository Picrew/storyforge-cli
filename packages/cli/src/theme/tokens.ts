import type { ThemeTokens } from "../types.js";

export const themeTokens: ThemeTokens = {
  accent: "#ff7a1a",
  accentSecondary: "#ffb24c",
  textPrimary: "blackBright",
  textSecondary: "blackBright",
  border: "#c2410c",
  notice: "#dc2626",
  success: "#22c55e",
  gradient: ["#ff5a1f", "#ff7a1a", "#ff9f1c", "#ffd17a"]
};

export function shouldUseGradient(): boolean {
  if (process.env.NO_COLOR) {
    return false;
  }

  const colorDepth = process.stdout.getColorDepth?.() ?? 1;
  return colorDepth >= 8;
}
