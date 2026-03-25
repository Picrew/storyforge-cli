import { spawn, spawnSync } from "node:child_process";
import { getFallbackModels, type ModelOption } from "../data/provider-catalog.js";
import {
  getProviderApiKey,
  getProviderModelsUrl
} from "./provider-api.js";
import { hasOpenAIOauthRuntimeContext } from "./openai-oauth-runtime.js";

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

function fetchModelsFromApiSync(
  providerId: string,
  filterFn?: (modelId: string) => boolean
): readonly ModelOption[] | null {
  const apiKey = getProviderApiKey(providerId);

  if (!apiKey) {
    return null;
  }

  if (providerId === "openai" && hasOpenAIOauthRuntimeContext(apiKey)) {
    return getFallbackModels(providerId);
  }

  const modelsUrl = getProviderModelsUrl(providerId);

  if (!modelsUrl) {
    return null;
  }

  try {
    const result = spawnSync(
      "curl",
      ["-sS", "-H", `Authorization: Bearer ${apiKey}`, modelsUrl],
      { encoding: "utf8", timeout: 10_000 }
    );

    if (result.error || result.status !== 0) {
      return null;
    }

    const response = JSON.parse(result.stdout) as { data?: Array<{ id?: string }> };

    if (!response?.data || !Array.isArray(response.data)) {
      return null;
    }

    let modelIds = response.data
      .map((entry) => (typeof entry?.id === "string" ? entry.id : ""))
      .filter((id) => id.length > 0);

    if (filterFn) {
      modelIds = modelIds.filter(filterFn);
    }

    const models = modelIds
      .sort(compareModelIds)
      .map((id) => ({
        id: `${providerId}/${id}`,
        title: id,
        subtitle: `From ${providerId} API`
      }));

    return models.length > 0 ? models : null;
  } catch {
    return null;
  }
}

function fetchModelsFromApiAsync(
  providerId: string,
  callback: (modelIds: readonly string[]) => void,
  filterFn?: (modelId: string) => boolean
): void {
  const apiKey = getProviderApiKey(providerId);

  if (!apiKey) {
    callback(getFallbackModels(providerId).map((m) => m.id));
    return;
  }

  if (providerId === "openai" && hasOpenAIOauthRuntimeContext(apiKey)) {
    callback(getFallbackModels(providerId).map((m) => m.id));
    return;
  }

  const modelsUrl = getProviderModelsUrl(providerId);

  if (!modelsUrl) {
    callback(getFallbackModels(providerId).map((m) => m.id));
    return;
  }

  const proc = spawn(
    "curl",
    ["-sS", "-H", `Authorization: Bearer ${apiKey}`, modelsUrl],
    { stdio: ["ignore", "pipe", "ignore"] }
  );

  let output = "";
  const timeout = setTimeout(() => {
    proc.kill();
  }, 8_000);

  proc.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });

  proc.on("close", () => {
    clearTimeout(timeout);

    try {
      const response = JSON.parse(output) as { data?: Array<{ id?: string }> };

      if (!response?.data || !Array.isArray(response.data)) {
        callback(getFallbackModels(providerId).map((m) => m.id));
        return;
      }

      let modelIds = response.data
        .map((entry) => (typeof entry?.id === "string" ? entry.id : ""))
        .filter((id) => id.length > 0);

      if (filterFn) {
        modelIds = modelIds.filter(filterFn);
      }

      const models = modelIds
        .sort(compareModelIds)
        .map((id) => (id.includes("/") ? id : `${providerId}/${id}`));

      if (models.length > 0) {
        callback(models);
        return;
      }
    } catch {
      // Fall through to fallback.
    }

    callback(getFallbackModels(providerId).map((m) => m.id));
  });

  proc.on("error", () => {
    clearTimeout(timeout);
    callback(getFallbackModels(providerId).map((m) => m.id));
  });
}

export function fetchModelIdsAsync(
  providerId: string,
  callback: (modelIds: readonly string[]) => void
): void {
  const filterFn = providerId === "openai" ? isRelevantOpenAIModel : undefined;
  fetchModelsFromApiAsync(providerId, callback, filterFn);
}

export function getModelOptionsForProvider(providerId: string): readonly ModelOption[] {
  const filterFn = providerId === "openai" ? isRelevantOpenAIModel : undefined;
  const apiModels = fetchModelsFromApiSync(providerId, filterFn);

  if (apiModels) {
    return apiModels;
  }

  return getFallbackModels(providerId);
}
