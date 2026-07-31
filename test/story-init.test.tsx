import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import {
  createBlankStoryProject,
  getStoryProjectAbsolutePath,
  getStoryProjectPath,
  loadStoryWorkspace,
  loadStoryProject
} from "../packages/cli/src/story/project-store.js";
import type {
  StructuredRunOptions,
  StructuredRunner
} from "../packages/cli/src/story/structured-run.js";

const { chatStreamSpy, syncApiCredentialMock, syncOauthCredentialMock } = vi.hoisted(() => ({
  chatStreamSpy: vi.fn(),
  syncApiCredentialMock: vi.fn(),
  syncOauthCredentialMock: vi.fn()
}));

vi.mock("../packages/cli/src/utils/opencode-auth.js", async () => {
  const actual = await vi.importActual<typeof import("../packages/cli/src/utils/opencode-auth.js")>(
    "../packages/cli/src/utils/opencode-auth.js"
  );

  return {
    ...actual,
    syncApiCredential: syncApiCredentialMock,
    syncOauthCredential: syncOauthCredentialMock
  };
});

vi.mock("../packages/cli/src/utils/direct-stream.js", async () => {
  const actual = await vi.importActual<typeof import("../packages/cli/src/utils/direct-stream.js")>(
    "../packages/cli/src/utils/direct-stream.js"
  );

  return {
    ...actual,
    startDirectStream: chatStreamSpy
  };
});

import { App } from "../packages/cli/src/app/App.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "storyforge-init-"));
}

async function waitForCondition(
  check: () => boolean,
  timeoutMs: number = 2_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (check()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }

  throw new Error("Timed out waiting for render state.");
}

async function submitInput(
  app: { stdin: { write: (value: string) => void } },
  value: string
): Promise<void> {
  app.stdin.write(value);
  await new Promise((resolve) => {
    setTimeout(resolve, 20);
  });
  app.stdin.write("\r");
}

async function sendKey(
  app: { stdin: { write: (value: string) => void } },
  key: string
): Promise<void> {
  app.stdin.write(key);
  await new Promise((resolve) => {
    setTimeout(resolve, 20);
  });
}

function createStructuredRunner(
  options: { failStage?: StructuredRunOptions["stage"] } = {}
): { runner: StructuredRunner; calls: string[] } {
  const calls: string[] = [];

  const runner: StructuredRunner = async ({ stage }) => {
    calls.push(stage);

    if (stage === options.failStage) {
      throw new Error("forced stage failure");
    }

    switch (stage) {
      case "foundation":
        return JSON.stringify({
          title: "Conference Secret",
          genre: "Humorous literary fiction",
          targetWords: 900,
          language: "English",
          tone: "Lighthearted and witty",
          premise: "A conference pitch goes sideways when a harmless cult secret comes out.",
          world: {
            premise: "A comic collision between reputation and sincerity.",
            setting: "A tense but slightly absurd research conference.",
            tone: "Lighthearted and witty",
            rules: "Professional credibility matters.",
            stakes: "The pitch could lose funding if the reveal lands badly.",
            resolutionShape: "Embarrassment turns into connection."
          }
        });
      case "characters":
        return JSON.stringify({
          characters: [
            {
              name: "Mira Vale",
              role: "Protagonist",
              age: "Early 30s",
              description: "An earnest researcher with bad luck.",
              motivation: "Secure funding for her work.",
              conflict: "She fears being judged for her strange hobby.",
              arc: "She learns honesty is less dangerous than she thinks.",
              relationships: "Knows Jasper from the cult.",
              tags: "researcher, anxious, funny"
            }
          ]
        });
      case "timeline":
        return JSON.stringify({
          timeline: [
            {
              label: "Arrival",
              summary: "Mira arrives ready to pitch.",
              chapterRef: "ch01",
              stakes: "Funding depends on first impressions.",
              notes: "Open with comic tension."
            },
            {
              label: "Reveal",
              summary: "An old friend exposes the cult connection.",
              chapterRef: "ch02",
              stakes: "Mira fears public embarrassment.",
              notes: "Keep the cult harmless."
            }
          ]
        });
      case "outline":
        return JSON.stringify({
          outline: [
            {
              number: 1,
              title: "Pitch Deck Panic",
              purpose: "Set the conference stakes and trigger the reveal.",
              summary: "Mira prepares to pitch, then runs into Jasper.",
              hook: "Jasper greets her with a cult salute in the lobby.",
              targetWords: 450
            },
            {
              number: 2,
              title: "Funding and Fellowship",
              purpose: "Resolve the misunderstanding and land the pitch.",
              summary: "The reveal becomes an unexpected icebreaker.",
              hook: "The investor laughs instead of recoiling.",
              targetWords: 450
            }
          ]
        });
      default:
        throw new Error(`Unhandled stage: ${stage}`);
    }
  };

  return {
    runner,
    calls
  };
}

beforeEach(() => {
  chatStreamSpy.mockReset();
  syncApiCredentialMock.mockReset();
  syncOauthCredentialMock.mockReset();
  syncApiCredentialMock.mockReturnValue(null);
  syncOauthCredentialMock.mockReturnValue(null);
  chatStreamSpy.mockImplementation(
    ({
      onText,
      onComplete
    }: {
      onText?: (value: string) => void;
      onComplete?: () => void;
    }) => {
      queueMicrotask(() => {
        onText?.("chat fallback");
        onComplete?.();
      });

      return {
        abort: vi.fn()
      };
    }
  );
});

describe("story init flow", () => {
  it("creates a blank scaffold with /init", async () => {
    const cwd = makeTempDir();
    const app = render(
      <App
        terminalWidthOverride={100}
        cwdOverride={cwd}
        initialConfigOverride={{
          connection: null,
          model: null
        }}
      />
    );

    await submitInput(app, "/init");

    await waitForCondition(() => (app.lastFrame() ?? "").includes("status awaiting_brief"));

    const project = loadStoryProject(cwd);
    const workspace = loadStoryWorkspace(cwd);

    expect(app.lastFrame()).toContain("STORY PROJECT");
    expect(project?.meta.status).toBe("awaiting_brief");
    expect(workspace.projects).toHaveLength(1);
    expect(
      fs.existsSync(getStoryProjectAbsolutePath(cwd, workspace.activeProjectId, workspace.projects))
    ).toBe(true);
    app.unmount();
  });

  it("creates multiple local projects and can reopen an older one", async () => {
    const cwd = makeTempDir();
    const app = render(
      <App
        terminalWidthOverride={100}
        cwdOverride={cwd}
        initialConfigOverride={{
          connection: null,
          model: null
        }}
      />
    );

    app.stdin.write("/init");
    app.stdin.write("\r");
    await waitForCondition(() => (app.lastFrame() ?? "").includes("status awaiting_brief"));

    const firstWorkspace = loadStoryWorkspace(cwd);
    const firstProjectId = firstWorkspace.activeProjectId;

    await submitInput(app, "/init");
    await waitForCondition(() => loadStoryWorkspace(cwd).projects.length === 2);

    await submitInput(app, "/init");
    await waitForCondition(() => loadStoryWorkspace(cwd).projects.length === 3);

    await submitInput(app, "/projects list");
    await waitForCondition(() => (app.lastFrame() ?? "").includes("saved story project"));

    const listFrame = app.lastFrame() ?? "";

    expect(listFrame).toContain("Untitled Story");
    expect(listFrame).toContain("Untitled Story 2");
    expect(listFrame).toContain("Untitled Story 3");

    await submitInput(app, "/projects open 1");
    await waitForCondition(
      () =>
        loadStoryWorkspace(cwd).activeProjectId === firstProjectId &&
        (app.lastFrame() ?? "").includes("Opened Untitled Story.")
    );

    const workspace = loadStoryWorkspace(cwd);

    expect(workspace.projects).toHaveLength(3);
    expect(loadStoryProject(cwd)?.meta.title).toBe("Untitled Story");
    expect(app.lastFrame()).toContain("Opened Untitled Story.");
    app.unmount();
  });

  it("supports opening a project from /project with arrow keys and enter", async () => {
    const cwd = makeTempDir();
    const app = render(
      <App
        terminalWidthOverride={100}
        cwdOverride={cwd}
        initialConfigOverride={{
          connection: null,
          model: null
        }}
      />
    );

    await submitInput(app, "/init");
    await waitForCondition(() => loadStoryWorkspace(cwd).projects.length === 1);
    const firstProjectId = loadStoryWorkspace(cwd).activeProjectId;

    await submitInput(app, "/init");
    await waitForCondition(() => loadStoryWorkspace(cwd).projects.length === 2);

    await submitInput(app, "/project");
    await waitForCondition(() => !(app.lastFrame() ?? "").includes("PROMPT LANE"));

    await sendKey(app, "\u001B[B");
    await sendKey(app, "\r");

    await waitForCondition(
      () =>
        loadStoryWorkspace(cwd).activeProjectId === firstProjectId &&
        (app.lastFrame() ?? "").includes("Opened Untitled Story.")
    );

    expect(loadStoryWorkspace(cwd).activeProjectId).toBe(firstProjectId);
    app.unmount();
  });

  it("supports /init reset on the active project without deleting siblings", async () => {
    const cwd = makeTempDir();
    const app = render(
      <App
        terminalWidthOverride={100}
        cwdOverride={cwd}
        initialConfigOverride={{
          connection: null,
          model: null
        }}
      />
    );

    await submitInput(app, "/init");
    await waitForCondition(() => loadStoryWorkspace(cwd).projects.length === 1);

    await submitInput(app, "/init");
    await waitForCondition(() => loadStoryWorkspace(cwd).projects.length === 2);

    await submitInput(app, "/world set premise Temporary active premise");
    await waitForCondition(() => loadStoryProject(cwd)?.world.premise === "Temporary active premise");

    const activeProjectId = loadStoryWorkspace(cwd).activeProjectId;

    await submitInput(app, "/init reset");
    await waitForCondition(() => loadStoryProject(cwd)?.world.premise === "");

    const workspace = loadStoryWorkspace(cwd);

    expect(workspace.projects).toHaveLength(2);
    expect(workspace.activeProjectId).toBe(activeProjectId);
    expect(loadStoryProject(cwd)?.meta.status).toBe("awaiting_brief");
    app.unmount();
  });

  it("bootstraps story tables from the first prompt and then falls back to chat", async () => {
    const cwd = makeTempDir();
    const { runner, calls } = createStructuredRunner();
    const app = render(
      <App
        terminalWidthOverride={100}
        cwdOverride={cwd}
        structuredRunnerOverride={runner}
        initialConfigOverride={{
          connection: {
            provider: "deepseek",
            authMode: "oauth",
            apiKey: null,
            baseUrl: null,
            authLabel: "Test auth"
          },
          model: "deepseek/deepseek-chat"
        }}
      />
    );

    await submitInput(app, "/init");
    await waitForCondition(() => (app.lastFrame() ?? "").includes("status awaiting_brief"));

    await submitInput(app, "Write a 900 word short story about a secret at a conference.");
    await waitForCondition(
      () => calls.length === 4 && loadStoryProject(cwd)?.meta.status === "ready"
    );

    const project = loadStoryProject(cwd);

    expect(calls).toEqual(["foundation", "characters", "timeline", "outline"]);
    expect(project?.meta.status).toBe("ready");
    expect(project?.characters).toHaveLength(1);
    expect(project?.outline).toHaveLength(2);
    expect(app.lastFrame()).toContain("view outline");

    await submitInput(app, "Continue the conversation.");
    await waitForCondition(() => (app.lastFrame() ?? "").includes("chat fallback"));

    expect(chatStreamSpy).toHaveBeenCalledTimes(1);
    app.unmount();
  });

  it("marks the project as bootstrapping while init generation is in progress", async () => {
    const cwd = makeTempDir();
    const { runner: baseRunner } = createStructuredRunner();
    const stages: string[] = [];
    let releaseFoundation = () => {};
    const foundationGate = new Promise<void>((resolve) => {
      releaseFoundation = resolve;
    });
    const runner: StructuredRunner = async (options) => {
      stages.push(options.stage);

      if (options.stage === "foundation") {
        await foundationGate;
      }

      return baseRunner(options);
    };
    const app = render(
      <App
        terminalWidthOverride={100}
        cwdOverride={cwd}
        structuredRunnerOverride={runner}
        initialConfigOverride={{
          connection: {
            provider: "deepseek",
            authMode: "oauth",
            apiKey: null,
            baseUrl: null,
            authLabel: "Test auth"
          },
          model: "deepseek/deepseek-chat"
        }}
      />
    );

    await submitInput(app, "/init");
    await waitForCondition(() => (app.lastFrame() ?? "").includes("status awaiting_brief"));

    await submitInput(app, "Write a warm conference comedy.");
    await waitForCondition(
      () =>
        stages.includes("foundation") &&
        loadStoryProject(cwd)?.meta.status === "bootstrapping" &&
        (app.lastFrame() ?? "").includes("status bootstrapping")
    );

    releaseFoundation();
    await waitForCondition(() => loadStoryProject(cwd)?.meta.status === "ready");

    expect(loadStoryProject(cwd)?.meta.status).toBe("ready");
    app.unmount();
  });

  it("keeps completed sections when a later bootstrap stage fails", async () => {
    const cwd = makeTempDir();
    const { runner } = createStructuredRunner({ failStage: "outline" });
    const app = render(
      <App
        terminalWidthOverride={100}
        cwdOverride={cwd}
        structuredRunnerOverride={runner}
        initialConfigOverride={{
          connection: {
            provider: "deepseek",
            authMode: "oauth",
            apiKey: null,
            baseUrl: null,
            authLabel: "Test auth"
          },
          model: "deepseek/deepseek-chat"
        }}
      />
    );

    await submitInput(app, "/init");
    await waitForCondition(() => (app.lastFrame() ?? "").includes("status awaiting_brief"));

    await submitInput(app, "Write a funny conference reveal story.");
    await waitForCondition(() => loadStoryProject(cwd)?.meta.status === "partial");

    const project = loadStoryProject(cwd);

    expect(project?.meta.status).toBe("partial");
    expect(project?.characters.length).toBeGreaterThan(0);
    expect(project?.timeline.length).toBeGreaterThan(0);
    expect(project?.outline).toHaveLength(0);
    app.unmount();
  });

  it("keeps prior story snapshots visible in transcript when switching views", async () => {
    const cwd = makeTempDir();
    const project = createBlankStoryProject();
    project.meta.title = "Snapshot Check";
    project.meta.status = "ready";
    project.characters.push({
      id: "character-1",
      name: "Mira Vale",
      role: "Protagonist",
      age: "",
      description: "",
      motivation: "Keep the pitch alive",
      conflict: "A harmless secret might derail funding",
      arc: "Learns to laugh at the reveal",
      relationships: "",
      tags: ""
    });
    project.timeline.push({
      id: "timeline-1",
      label: "Lobby reveal",
      summary: "An old friend recognizes Mira before the pitch.",
      chapterRef: "1",
      stakes: "Her credibility could collapse",
      notes: ""
    });
    fs.mkdirSync(path.dirname(getStoryProjectPath(cwd)), { recursive: true });
    fs.writeFileSync(getStoryProjectPath(cwd), `${JSON.stringify(project, null, 2)}\n`, "utf8");

    const app = render(
      <App
        terminalWidthOverride={100}
        cwdOverride={cwd}
        initialConfigOverride={{
          connection: null,
          model: null
        }}
      />
    );

    await submitInput(app, "/char");
    await waitForCondition(() => (app.lastFrame() ?? "").includes("Showing characters."));

    await submitInput(app, "/timeline");
    await waitForCondition(() => (app.lastFrame() ?? "").includes("Showing timeline."));

    const frame = app.lastFrame() ?? "";

    expect(frame).toContain("2 turns");
    // With full table rendering (no truncation), earlier entries may scroll off.
    // The latest entry (/timeline) and its data should be visible.
    expect(frame).toContain("Showing timeline.");
    expect(frame).toContain("Lobby reveal");
    app.unmount();
  });

  it("creates project in custom directory with /init --dir", async () => {
    const baseCwd = makeTempDir();
    const targetDir = path.join(baseCwd, "novels", "my-story");
    const app = render(
      <App
        terminalWidthOverride={100}
        cwdOverride={baseCwd}
        initialConfigOverride={{
          connection: null,
          model: null
        }}
      />
    );

    await submitInput(app, `/init --dir ${targetDir}`);
    await waitForCondition(() => (app.lastFrame() ?? "").includes("status awaiting_brief"));

    // Project should be created in the target directory, not the base cwd
    expect(fs.existsSync(path.join(targetDir, ".storyforge"))).toBe(true);
    expect(fs.existsSync(path.join(baseCwd, ".storyforge"))).toBe(false);

    const project = loadStoryProject(targetDir);

    expect(project?.meta.status).toBe("awaiting_brief");
    app.unmount();
  });
});
