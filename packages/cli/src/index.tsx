#!/usr/bin/env node

import { startStoryforge } from "./bootstrap.js";

startStoryforge().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

