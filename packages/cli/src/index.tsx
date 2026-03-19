#!/usr/bin/env node

import { startStoryforge } from "./bootstrap.js";
import { startStoryforgeApiServer } from "./api/server.js";

interface ApiServeCliOptions {
  host?: string;
  port?: number;
}

function parseApiServeCliOptions(rawArgs: readonly string[]): ApiServeCliOptions {
  const options: ApiServeCliOptions = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = rawArgs[index];

    if (token === "--host") {
      const value = rawArgs[index + 1];

      if (!value || value.startsWith("-")) {
        throw new Error("Usage: storyforge api serve [--host <host>] [--port <port>]");
      }

      options.host = value.trim();
      index += 1;
      continue;
    }

    if (token === "--port") {
      const value = rawArgs[index + 1];
      const parsedPort = Number.parseInt(value ?? "", 10);

      if (!Number.isFinite(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
        throw new Error("Port must be an integer between 1 and 65535.");
      }

      options.port = parsedPort;
      index += 1;
      continue;
    }

    throw new Error(`Unknown API option: ${token}`);
  }

  return options;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args[0] === "api" && args[1] === "serve") {
    const options = parseApiServeCliOptions(args.slice(2));
    await startStoryforgeApiServer(options);
    return;
  }

  await startStoryforge();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
