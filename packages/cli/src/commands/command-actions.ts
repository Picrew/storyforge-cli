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

export function addToConnectionHistory(
  config: SessionConfig,
  connection: SessionConnection
): Record<string, SessionConnection> {
  const history = { ...(config.connectionHistory ?? {}) };
  history[connection.provider] = connection;

  return history;
}

export function addToRecentModels(config: SessionConfig, model: string): string[] {
  const existing = config.recentModels ?? [];
  const filtered = existing.filter((m) => m !== model);

  return [model, ...filtered].slice(0, 20);
}

export function applyConnectCommand(
  config: SessionConfig,
  connection: SessionConnection
): CommandConfigResult {
  const currentModelProvider = getModelProvider(config.model);
  const nextModel =
    config.model && currentModelProvider !== connection.provider ? null : config.model;

  const nextHistory = { ...(config.connectionHistory ?? {}) };

  if (config.connection) {
    nextHistory[config.connection.provider] = config.connection;
  }

  nextHistory[connection.provider] = connection;

  const nextConfig: SessionConfig = {
    ...config,
    connection,
    model: nextModel,
    connectionHistory: nextHistory,
    recentModels: config.recentModels
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

  const isSameProvider = config.connection.provider === provider;

  if (!isSameProvider) {
    const historicalConnection = config.connectionHistory?.[provider];

    if (!historicalConnection) {
      return {
        error: `No saved credentials for ${provider}. Run /connect ${provider} first.`
      };
    }

    const nextHistory = addToConnectionHistory(config, config.connection);

    return {
      nextConfig: {
        ...config,
        connection: historicalConnection,
        model,
        connectionHistory: nextHistory,
        recentModels: addToRecentModels(config, model)
      },
      message: `Switched to ${provider}. Model set to ${model}. Saved for next launch.`
    };
  }

  return {
    nextConfig: {
      ...config,
      model,
      recentModels: addToRecentModels(config, model)
    },
    message: `Model set to ${model}. Saved for next launch.`
  };
}
