import { execFileSync, spawn, spawnSync } from "node:child_process";
import { getFallbackModels, type ModelOption } from "../data/provider-catalog.js";
import { getOauthAccessToken } from "./opencode-auth.js";
import { getDefaultSessionConfigPath, loadSessionConfig } from "./session-config.js";

function createModelOption(modelId: string): ModelOption {
  const title = modelId.includes("/") ? modelId.slice(modelId.indexOf("/") + 1) : modelId;

  return {
    id: modelId,
    title,
    subtitle: "Loaded from local opencode"
  };
}

function getOpenAIBearerToken(): string | null {
  const oauthToken = getOauthAccessToken("openai");

  if (oauthToken) {
    return oauthToken;
  }

  const config = loadSessionConfig(getDefaultSessionConfigPath());

  if (config.connection?.provider === "openai" && config.connection.apiKey) {
    return config.connection.apiKey.trim() || null;
  }

  return null;
}

function isRelevantOpenAIModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();

  if (lower.includes(":")) {
    return false;
  }

  if (/\d{4}-\d{2}-\d{2}/.test(lower)) {
    return false;
  }

  return (
    lower.startsWith("gpt-5") ||
    lower.startsWith("gpt-4o") ||
    lower.startsWith("gpt-4.") ||
    lower.startsWith("o1") ||
    lower.startsWith("o3") ||
    lower.startsWith("o4") ||
    lower.startsWith("chatgpt-")
  );
}

function compareModelIds(left: string, right: string): number {
  const isCodex = (id: string): boolean => id.includes("codex");
  const leftCodex = isCodex(left);
  const rightCodex = isCodex(right);

  if (leftCodex !== rightCodex) {
    return leftCodex ? -1 : 1;
  }

  return right.localeCompare(left);
}

function fetchOpenAIModelsSync(): readonly ModelOption[] | null {
  const token = getOpenAIBearerToken();

  if (!token) {
    return null;
  }

  try {
    const result = spawnSync(
      "curl",
      ["-sS", "-H", `Authorization: Bearer ${token}`, "https://api.openai.com/v1/models"],
      { encoding: "utf8", timeout: 10_000 }
    );

    if (result.error || result.status !== 0) {
      return null;
    }

    const response = JSON.parse(result.stdout) as { data?: Array<{ id?: string }> };

    if (!response?.data || !Array.isArray(response.data)) {
      return null;
    }

    const models = response.data
      .map((entry) => (typeof entry?.id === "string" ? entry.id : ""))
      .filter((id) => id && isRelevantOpenAIModel(id))
      .sort(compareModelIds)
      .map((id) => ({
        id: `openai/${id}`,
        title: id,
        subtitle: "From OpenAI API"
      }));

    return models.length > 0 ? models : null;
  } catch {
    return null;
  }
}

export function fetchModelIdsAsync(
  providerId: string,
  callback: (modelIds: readonly string[]) => void
): void {
  const proc = spawn("opencode", ["models", providerId], {
    stdio: ["ignore", "pipe", "ignore"]
  });

  let output = "";
  const timeout = setTimeout(() => {
    proc.kill();
  }, 8_000);

  proc.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });

  proc.on("close", () => {
    clearTimeout(timeout);
    const models = output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((id) => (id.includes("/") ? id : `${providerId}/${id}`));

    if (models.length > 0) {
      callback(models);

      return;
    }

    callback(getFallbackModels(providerId).map((m) => m.id));
  });

  proc.on("error", () => {
    clearTimeout(timeout);
    callback(getFallbackModels(providerId).map((m) => m.id));
  });
}

export function getModelOptionsForProvider(providerId: string): readonly ModelOption[] {
  try {
    const output = execFileSync("opencode", ["models", providerId], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const models = output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((modelId) => createModelOption(modelId));

    if (models.length > 0) {
      return models;
    }
  } catch {
    // Fall back to direct API fetch or built-in catalog if opencode is unavailable.
  }

  if (providerId === "openai") {
    const apiModels = fetchOpenAIModelsSync();

    if (apiModels) {
      return apiModels;
    }
  }

  return getFallbackModels(providerId);
}
