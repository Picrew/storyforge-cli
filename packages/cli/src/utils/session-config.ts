import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SessionConfig, SessionConnection } from "../types.js";

function createEmptySessionConfig(): SessionConfig {
  return {
    connection: null,
    model: null
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeConnection(value: unknown): SessionConnection | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;

  if (!isNonEmptyString(candidate.provider)) {
    return null;
  }

  const authMode = candidate.authMode === "oauth" ? "oauth" : "api";
  const apiKey = isNonEmptyString(candidate.apiKey) ? candidate.apiKey.trim() : null;

  return {
    provider: candidate.provider.trim(),
    authMode,
    apiKey,
    baseUrl: isNonEmptyString(candidate.baseUrl) ? candidate.baseUrl.trim() : null,
    authLabel: isNonEmptyString(candidate.authLabel)
      ? candidate.authLabel.trim()
      : authMode === "oauth"
        ? "Connected via browser auth"
        : apiKey
          ? "Saved in .storyforge"
          : "Saved in .storyforge"
  };
}

function normalizeConnectionHistory(value: unknown): Record<string, SessionConnection> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const result: Record<string, SessionConnection> = {};

  for (const [key, entry] of Object.entries(candidate)) {
    const normalized = normalizeConnection(entry);

    if (normalized) {
      result[key] = normalized;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeRecentModels(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const result = value.filter((item): item is string => isNonEmptyString(item)).slice(0, 20);

  return result.length > 0 ? result : undefined;
}

function normalizeSessionConfig(value: unknown): SessionConfig {
  if (!value || typeof value !== "object") {
    return createEmptySessionConfig();
  }

  const candidate = value as Record<string, unknown>;

  return {
    connection: normalizeConnection(candidate.connection),
    model: isNonEmptyString(candidate.model) ? candidate.model.trim() : null,
    connectionHistory: normalizeConnectionHistory(candidate.connectionHistory),
    recentModels: normalizeRecentModels(candidate.recentModels),
    tavilyApiKey: isNonEmptyString(candidate.tavilyApiKey) ? candidate.tavilyApiKey.trim() : undefined
  };
}

export function getDefaultSessionConfigPath(): string {
  return path.join(os.homedir(), ".storyforge", "config.json");
}

export function loadSessionConfig(configPath: string = getDefaultSessionConfigPath()): SessionConfig {
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    return normalizeSessionConfig(JSON.parse(raw));
  } catch {
    return createEmptySessionConfig();
  }
}

export function saveSessionConfig(
  config: SessionConfig,
  configPath: string = getDefaultSessionConfigPath()
): string | null {
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    fs.chmodSync(configPath, 0o600);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
