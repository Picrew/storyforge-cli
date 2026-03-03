import type { SessionConfig, SessionConnection } from "../types.js";

export interface CommandConfigResult {
  nextConfig: SessionConfig;
  message: string;
}

export interface CommandConfigError {
  error: string;
}

export type CommandConfigOutcome = CommandConfigResult | CommandConfigError;

function getModelProvider(model: string | null): string | null {
  if (!model) {
    return null;
  }

  const separatorIndex = model.indexOf("/");

  if (separatorIndex <= 0) {
    return null;
  }

  return model.slice(0, separatorIndex);
}

export function applyConnectCommand(
  config: SessionConfig,
  connection: SessionConnection
): CommandConfigResult {
  const currentModelProvider = getModelProvider(config.model);
  const nextModel =
    config.model && currentModelProvider !== connection.provider ? null : config.model;
  const nextConfig: SessionConfig = {
    connection,
    model: nextModel
  };

  let message = `Connected ${connection.provider}. Saved for next launch.`;

  if (config.model && !nextModel) {
    message = `Connected ${connection.provider}. Previous model was cleared. Saved for next launch.`;
  } else if (!nextModel) {
    message = `Connected ${connection.provider}. Saved for next launch. Open /models next.`;
  }

  return {
    nextConfig,
    message
  };
}

export function applyModelCommand(config: SessionConfig, model: string): CommandConfigOutcome {
  const provider = getModelProvider(model);

  if (!provider) {
    return {
      error: "Usage: /model <provider/model>"
    };
  }

  if (!config.connection) {
    return {
      error: `Run /connect first, then choose ${provider}.`
    };
  }

  if (config.connection.provider !== provider) {
    return {
      error: `Connected provider is ${config.connection.provider}. Reconnect before switching to ${provider}.`
    };
  }

  return {
    nextConfig: {
      ...config,
      model
    },
    message: `Model set to ${model}. Saved for next launch.`
  };
}
