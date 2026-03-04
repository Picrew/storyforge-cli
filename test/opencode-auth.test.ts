import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveStoryforgeOpencodeDataDir } from "../packages/cli/src/utils/opencode-auth.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "storyforge-auth-"));
}

describe("opencode auth paths", () => {
  it("uses the home-scoped storyforge data directory when it is writable", () => {
    const homeDir = makeTempDir();
    const tempDir = makeTempDir();
    const resolved = resolveStoryforgeOpencodeDataDir(homeDir, tempDir);

    expect(resolved).toBe(path.join(homeDir, ".storyforge", "xdg-data"));
    expect(fs.existsSync(resolved)).toBe(true);
  });

  it("falls back to the temp directory when the home-scoped path cannot be created", () => {
    const homeDir = makeTempDir();
    const tempDir = makeTempDir();
    const blockingPath = path.join(homeDir, ".storyforge");

    fs.writeFileSync(blockingPath, "blocked\n", "utf8");

    const resolved = resolveStoryforgeOpencodeDataDir(homeDir, tempDir);

    expect(resolved).toBe(path.join(tempDir, "storyforge", "xdg-data"));
    expect(fs.existsSync(resolved)).toBe(true);
  });
});
