import React from "react";
import { render } from "ink";
import { App } from "./app/App.js";

const ALT_SCREEN_ENABLE = "\x1b[?1049h";
const ALT_SCREEN_DISABLE = "\x1b[?1049l";

export async function startStoryforge(): Promise<void> {
  if (process.stdout.isTTY) {
    process.stdout.write(ALT_SCREEN_ENABLE);
  }

  const instance = render(<App />);
  const handleSigint = (): void => {
    instance.unmount();
  };

  process.once("SIGINT", handleSigint);

  try {
    await instance.waitUntilExit();
  } finally {
    process.off("SIGINT", handleSigint);

    if (process.stdout.isTTY) {
      process.stdout.write(ALT_SCREEN_DISABLE);
    }
  }
}

