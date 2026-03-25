import {
  getDefaultSessionConfigPath,
  loadSessionConfig
} from "./session-config.js";

/**
 * Default base URLs for each provider (OpenAI-compatible /chat/completions).
 */
const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com",
  google: "https://generativelanguage.googleapis.com/v1beta/openai",
  "siliconflow-cn": "https://api.siliconflow.cn/v1",
  "kimi-for-coding": "https://api.moonshot.cn/v1",
  openrouter: "https://openrouter.ai/api/v1",
  mixapi: "https://api.mixapi.net/v1",
  "github-copilot": "https://api.githubcopilot.com"
};

export function getProviderBaseUrl(providerId: string): string | null {
  const config = loadSessionConfig(getDefaultSessionConfigPath());
  const connection = config.connection;

  if (connection?.provider === providerId && connection.baseUrl) {
    return connection.baseUrl;
  }

  const historyConnection = config.connectionHistory?.[providerId];

  if (historyConnection?.baseUrl) {
    return historyConnection.baseUrl;
  }

  return PROVIDER_BASE_URLS[providerId] ?? null;
}

export function getProviderApiKey(providerId: string): string | null {
  const envKeyMap: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    google: "GOOGLE_API_KEY",
    "siliconflow-cn": "SILICONFLOW_API_KEY",
    "kimi-for-coding": "KIMI_API_KEY",
    mixapi: "MIXAPI_API_KEY",
    "github-copilot": "GITHUB_COPILOT_API_KEY"
  };

  const envVar = envKeyMap[providerId];

  if (envVar) {
    const envValue = process.env[envVar]?.trim();

    if (envValue) {
      return envValue;
    }
  }

  const config = loadSessionConfig(getDefaultSessionConfigPath());
  const connection = config.connection;

  if (connection?.provider === providerId && connection.apiKey) {
    return connection.apiKey.trim() || null;
  }

  const historyConnection = config.connectionHistory?.[providerId];

  if (historyConnection?.apiKey) {
    return historyConnection.apiKey.trim() || null;
  }

  return null;
}

export function getProviderCompletionUrl(providerId: string): string | null {
  const baseUrl = getProviderBaseUrl(providerId);

  if (!baseUrl) {
    return null;
  }

  const normalized = baseUrl.replace(/\/+$/, "");

  if (normalized.endsWith("/chat/completions")) {
    return normalized;
  }

  return `${normalized}/chat/completions`;
}

export function getProviderModelsUrl(providerId: string): string | null {
  const baseUrl = getProviderBaseUrl(providerId);

  if (!baseUrl) {
    return null;
  }

  const normalized = baseUrl.replace(/\/+$/, "");

  return `${normalized}/models`;
}

export function stripProviderPrefix(model: string): string {
  const slashIndex = model.indexOf("/");

  if (slashIndex <= 0) {
    return model.trim();
  }

  const prefix = model.slice(0, slashIndex).toLowerCase();

  if (prefix in PROVIDER_BASE_URLS) {
    return model.slice(slashIndex + 1).trim();
  }

  return model.trim();
}

export function getModelProvider(model: string): string | null {
  const separatorIndex = model.indexOf("/");

  if (separatorIndex <= 0) {
    return null;
  }

  return model.slice(0, separatorIndex).trim().toLowerCase();
}
