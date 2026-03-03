import React from "react";
import { render } from "ink";
import { App } from "./app/App.js";

export async function startStoryforge(): Promise<void> {
  const instance = render(<App />);
  const handleSigint = (): void => {
    instance.unmount();
  };

  process.once("SIGINT", handleSigint);

  try {
    await instance.waitUntilExit();
  } finally {
    process.off("SIGINT", handleSigint);
  }
}

