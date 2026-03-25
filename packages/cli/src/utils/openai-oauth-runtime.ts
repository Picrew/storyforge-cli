import type { SessionConnection } from "../types.js";
import { getOauthCredential } from "./opencode-auth.js";
import { getDefaultSessionConfigPath, loadSessionConfig } from "./session-config.js";

interface JwtClaims {
  chatgpt_account_id?: unknown;
  organizations?: unknown;
  "https://api.openai.com/auth"?: unknown;
}

interface JwtAuthClaims {
  chatgpt_account_id?: unknown;
}

export interface OpenAIOauthRuntimeContext {
  accessToken: string;
  accountId: string | null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getOpenAISessionConnection(): SessionConnection | null {
  const config = loadSessionConfig(getDefaultSessionConfigPath());

  if (config.connection?.provider === "openai") {
    return config.connection;
  }

  return config.connectionHistory?.openai ?? null;
}

function extractAccountIdFromToken(token: string): string | null {
  const parts = token.split(".");

  if (parts.length !== 3) {
    return null;
  }

  try {
    const payloadRaw = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(payloadRaw) as JwtClaims;
    const directAccountId = asNonEmptyString(payload.chatgpt_account_id);

    if (directAccountId) {
      return directAccountId;
    }

    if (payload["https://api.openai.com/auth"] && typeof payload["https://api.openai.com/auth"] === "object") {
      const authClaims = payload["https://api.openai.com/auth"] as JwtAuthClaims;
      const nestedAccountId = asNonEmptyString(authClaims.chatgpt_account_id);

      if (nestedAccountId) {
        return nestedAccountId;
      }
    }

    if (Array.isArray(payload.organizations)) {
      for (const org of payload.organizations) {
        if (!org || typeof org !== "object") {
          continue;
        }

        const orgAccountId = asNonEmptyString((org as Record<string, unknown>).id);

        if (orgAccountId) {
          return orgAccountId;
        }
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function resolveOpenAIOauthRuntimeContext(apiKey: string): OpenAIOauthRuntimeContext | null {
  const trimmedApiKey = apiKey.trim();

  if (!trimmedApiKey) {
    return null;
  }

  const connection = getOpenAISessionConnection();

  if (!connection || connection.authMode !== "oauth") {
    return null;
  }

  if (!connection.apiKey || connection.apiKey.trim() !== trimmedApiKey) {
    return null;
  }

  const cachedCredential = getOauthCredential("openai");
  const cachedAccountId =
    cachedCredential && cachedCredential.access.trim() === trimmedApiKey
      ? asNonEmptyString(cachedCredential.accountId)
      : null;

  return {
    accessToken: trimmedApiKey,
    accountId: cachedAccountId ?? extractAccountIdFromToken(trimmedApiKey)
  };
}

export function hasOpenAIOauthRuntimeContext(apiKey: string | null): boolean {
  if (!apiKey) {
    return false;
  }

  return resolveOpenAIOauthRuntimeContext(apiKey) !== null;
}
