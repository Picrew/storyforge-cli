import { describe, expect, it } from "vitest";
import {
  applyConnectCommand,
  applyModelCommand
} from "../packages/cli/src/commands/command-actions.js";
import type { SessionConfig } from "../packages/cli/src/types.js";

function baseConfig(): SessionConfig {
  return {
    connection: {
      provider: "openrouter",
      authMode: "api",
      apiKey: "sk-openrouter",
      baseUrl: null,
      authLabel: "Saved in .storyforge"
    },
    model: "openrouter/stepfun/step-3.5-flash:free",
    connectionHistory: {
      openrouter: {
        provider: "openrouter",
        authMode: "api",
        apiKey: "sk-openrouter",
        baseUrl: null,
        authLabel: "Saved in .storyforge"
      },
      deepseek: {
        provider: "deepseek",
        authMode: "api",
        apiKey: "sk-deepseek",
        baseUrl: null,
        authLabel: "Saved in .storyforge"
      }
    },
    recentModels: ["openrouter/stepfun/step-3.5-flash:free"],
    tavilyApiKey: "tvly-dev-test-key"
  };
}

describe("command actions preserve additional config fields", () => {
  it("keeps tavilyApiKey when applying /connect", () => {
    const config = baseConfig();
    const result = applyConnectCommand(config, {
      provider: "deepseek",
      authMode: "api",
      apiKey: "sk-new-deepseek",
      baseUrl: null,
      authLabel: "Saved in .storyforge"
    });

    expect(result.nextConfig.tavilyApiKey).toBe("tvly-dev-test-key");
  });

  it("keeps tavilyApiKey when /model switches to another provider", () => {
    const config = baseConfig();
    const result = applyModelCommand(config, "deepseek/deepseek-chat");

    if ("error" in result) {
      throw new Error(result.error);
    }

    expect(result.nextConfig.tavilyApiKey).toBe("tvly-dev-test-key");
  });
});
