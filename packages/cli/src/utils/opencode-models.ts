import { execFileSync } from "node:child_process";
import { getFallbackModels, type ModelOption } from "../data/provider-catalog.js";

function createModelOption(modelId: string): ModelOption {
  const title = modelId.includes("/") ? modelId.slice(modelId.indexOf("/") + 1) : modelId;

  return {
    id: modelId,
    title,
    subtitle: "Loaded from local opencode"
  };
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
    // Fall back to a small built-in catalog if opencode is unavailable.
  }

  return getFallbackModels(providerId);
}
