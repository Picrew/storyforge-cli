import fs from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { InMemoryRunTaskStore, createStoryforgeApiServer } from "../packages/cli/src/api/server.js";
import { ApiServiceError, DEFAULT_API_OUTPUT_ROOT } from "../packages/cli/src/api/service.js";

interface JsonEnvelope<T = unknown> {
  code: number;
  msg: string;
  request_id: string;
  data: T;
}

const API_TEST_TIMEOUT_MS = 20_000;
let fakeProviderCallCount = 0;
let fakeProviderDelayMs = 0;

function setFakeProviderDelayMs(value: number): void {
  fakeProviderDelayMs = Math.max(0, Math.floor(value));
}

function resetFakeProviderCallCount(): void {
  fakeProviderCallCount = 0;
}

function parsePromptFromRequestBody(body: unknown): string {
  if (!body || typeof body !== "object") {
    return "";
  }

  const messages = (body as Record<string, unknown>).messages;

  if (!Array.isArray(messages) || messages.length === 0) {
    return "";
  }

  const last = messages[messages.length - 1];

  if (!last || typeof last !== "object") {
    return "";
  }

  const content = (last as Record<string, unknown>).content;

  return typeof content === "string" ? content : "";
}

function fakeModelResponse(prompt: string): string {
  if (prompt.includes("Create a structured story foundation")) {
    return JSON.stringify({
      title: "API Test Story",
      genre: "Sci-Fi",
      targetWords: 1200,
      language: "English",
      tone: "tense",
      premise: "A memory engineer uncovers a hidden archive.",
      world: {
        premise: "Memory restoration is controlled by a corporate cartel.",
        setting: "Near-future Shanghai",
        tone: "tense",
        rules: "Memory edits require licensed vault access.",
        stakes: "Identity collapse and state surveillance.",
        resolutionShape: "bittersweet"
      }
    });
  }

  if (prompt.includes("Create 3 to 6 character profiles")) {
    return JSON.stringify({
      characters: [
        {
          name: "Lin",
          role: "Protagonist",
          age: "30",
          description: "Memory engineer",
          motivation: "Recover erased truth",
          conflict: "Haunted by altered memories",
          arc: "From compliance to resistance",
          relationships: "Mentor of Rui",
          tags: "memory,investigator"
        },
        {
          name: "Rui",
          role: "Ally",
          age: "24",
          description: "Forensic intern",
          motivation: "Expose corruption",
          conflict: "Fears retaliation",
          arc: "Learns to act decisively",
          relationships: "Assists Lin",
          tags: "ally,forensics"
        },
        {
          name: "Director Han",
          role: "Antagonist",
          age: "47",
          description: "Vault authority",
          motivation: "Protect control",
          conflict: "Past crimes resurfacing",
          arc: "Falls from power",
          relationships: "Opposes Lin",
          tags: "authority,villain"
        }
      ]
    });
  }

  if (prompt.includes("Create 5 to 9 ordered story beats")) {
    return JSON.stringify({
      timeline: [
        {
          label: "Inciting Incident",
          summary: "Lin finds an unauthorized memory fragment.",
          chapterRef: "ch01",
          stakes: "Professional ruin",
          notes: "Set tone quickly"
        },
        {
          label: "Archive Break-in",
          summary: "Lin and Rui enter an off-grid vault.",
          chapterRef: "ch02",
          stakes: "Arrest",
          notes: "Escalate tension"
        },
        {
          label: "Confrontation",
          summary: "Han attempts to erase Lin's identity record.",
          chapterRef: "ch03",
          stakes: "Identity loss",
          notes: "Reveal motive"
        }
      ]
    });
  }

  if (prompt.includes("Create 1 to 8 chapter plans")) {
    return JSON.stringify({
      outline: [
        {
          number: 1,
          title: "The Fragment",
          purpose: "Introduce hidden memory",
          summary: "Lin discovers a suspicious fragment in a client repair.",
          hook: "A missing child appears in the footage.",
          targetWords: 600
        },
        {
          number: 2,
          title: "Vault Zero",
          purpose: "Break into archive",
          summary: "Lin and Rui bypass a sealed archive stack.",
          hook: "Han triggers a kill-switch for identity records.",
          targetWords: 600
        }
      ]
    });
  }

  if (prompt.includes("event-patch planner")) {
    const match = /"chapterId":\s*"(ch\d{2})"/i.exec(prompt);
    const chapterId = match?.[1] ?? "ch01";

    return JSON.stringify({
      patchOps: [
        {
          op: "timeline.add",
          target: "timeline",
          payload: {
            label: `Event ${chapterId}`,
            summary: `Major event for ${chapterId}`,
            chapterRef: chapterId,
            stakes: "High",
            notes: ""
          }
        }
      ],
      reads: ["world:premise"],
      writes: ["timeline"]
    });
  }

  if (prompt.includes("You are a fiction renderer.")) {
    const match = /- Chapter id:\s*(ch\d{2})/i.exec(prompt);
    const chapterId = match?.[1] ?? "ch01";

    return `# ${chapterId.toUpperCase()}\n\nRendered prose for ${chapterId}.`;
  }

  return "ok";
}

function createFakeProviderServer(): http.Server {
  return http.createServer(async (request: IncomingMessage, response: ServerResponse) => {
    request.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code !== "ECONNRESET") {
        console.error(error);
      }
    });
    response.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code !== "ECONNRESET") {
        console.error(error);
      }
    });

    if (request.method !== "POST") {
      response.statusCode = 405;
      response.end("method not allowed");
      return;
    }

    fakeProviderCallCount += 1;

    if (fakeProviderDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, fakeProviderDelayMs));
    }

    const chunks: Buffer[] = [];

    try {
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ECONNRESET") {
        throw error;
      }

      return;
    }

    const raw = Buffer.concat(chunks).toString("utf8");

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }

    const prompt = parsePromptFromRequestBody(parsed);
    const content = fakeModelResponse(prompt);

    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        id: "fake-response",
        choices: [
          {
            message: {
              role: "assistant",
              content
            }
          }
        ]
      })
    );
  });
}

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Unable to resolve listening port.");
  }

  return address.port;
}

async function postJson<T = unknown>(baseUrl: string, pathname: string, body: unknown): Promise<{
  status: number;
  payload: JsonEnvelope<T>;
}> {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json() as JsonEnvelope<T>;

  return {
    status: response.status,
    payload
  };
}

async function getJson<T = unknown>(baseUrl: string, pathname: string): Promise<{
  status: number;
  payload: JsonEnvelope<T>;
}> {
  const response = await fetch(`${baseUrl}${pathname}`);
  const payload = await response.json() as JsonEnvelope<T>;

  return {
    status: response.status,
    payload
  };
}

async function closeServer(server: http.Server): Promise<void> {
  (server as http.Server & { closeIdleConnections?: () => void }).closeIdleConnections?.();
  (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

describe("storyforge api server", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "storyforge-api-test-"));
  const fakeProviderServer = createFakeProviderServer();
  const apiServer = createStoryforgeApiServer();
  let providerBaseUrl = "";
  let apiBaseUrl = "";

  beforeAll(async () => {
    const providerPort = await listen(fakeProviderServer);
    const apiPort = await listen(apiServer);

    providerBaseUrl = `http://127.0.0.1:${providerPort}`;
    apiBaseUrl = `http://127.0.0.1:${apiPort}`;
  });

  beforeEach(() => {
    setFakeProviderDelayMs(0);
    resetFakeProviderCallCount();
  });

  afterAll(async () => {
    await closeServer(apiServer);
    await closeServer(fakeProviderServer);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("runs sync story pipeline and outputs manuscript artifacts", async () => {
    const outputRoot = path.join(tempRoot, "sync-output");
    const { status, payload } = await postJson<{
      manuscript_path: string;
      project_path: string;
      summary_path: string;
      workspace_dir: string;
      metrics: {
        elapsed_ms: number;
        llm_calls: number;
      };
      render: { rendered: string[] };
    }>(apiBaseUrl, "/api/v1/story/run", {
      mode: "sync",
      output_root: outputRoot,
      title: "Sync API Story",
      prompt: "Write a concise two-chapter sci-fi thriller.",
      model_config: {
        api_url: providerBaseUrl,
        api_key: "test-key",
        model: "deepseek-chat"
      }
    });

    expect(status).toBe(200);
    expect(payload.code).toBe(0);
    expect(payload.data.workspace_dir.startsWith(outputRoot)).toBe(true);
    expect(fs.existsSync(payload.data.manuscript_path)).toBe(true);
    expect(fs.existsSync(payload.data.project_path)).toBe(true);
    expect(fs.existsSync(payload.data.summary_path)).toBe(true);
    expect(payload.data.metrics.elapsed_ms).toBeGreaterThanOrEqual(0);
    expect(payload.data.metrics.llm_calls).toBeGreaterThan(0);
    expect(payload.data.render.rendered.length).toBeGreaterThan(0);
  }, API_TEST_TIMEOUT_MS);

  it("supports async run mode with task polling", async () => {
    const outputRoot = path.join(tempRoot, "async-output");
    const submit = await postJson<{ task_id: string; status: string }>(
      apiBaseUrl,
      "/api/v1/story/run",
      {
        mode: "async",
        output_root: outputRoot,
        title: "Async API Story",
        prompt: "Write a compact mystery novella.",
        model_config: {
          api_url: providerBaseUrl,
          api_key: "test-key",
          model: "deepseek-chat"
        }
      }
    );

    expect(submit.status).toBe(200);
    expect(submit.payload.code).toBe(0);
    expect(submit.payload.data.task_id).toBeTruthy();

    let taskPayload: JsonEnvelope<{
      status: string;
      result: {
        manuscript_path: string;
        metrics: {
          elapsed_ms: number;
          llm_calls: number;
        };
      } | null;
      error: string | null;
    }> | null = null;

    for (let index = 0; index < 80; index += 1) {
      const task = await getJson<{
        status: string;
        result: {
          manuscript_path: string;
          metrics: {
            elapsed_ms: number;
            llm_calls: number;
          };
        } | null;
        error: string | null;
      }>(apiBaseUrl, `/api/v1/tasks/${submit.payload.data.task_id}`);

      expect(task.status).toBe(200);
      taskPayload = task.payload;

      if (task.payload.data.status === "succeeded" || task.payload.data.status === "failed") {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 80));
    }

    expect(taskPayload).not.toBeNull();
    expect(taskPayload?.data.status).toBe("succeeded");
    expect(taskPayload?.data.error).toBeNull();
    expect(taskPayload?.data.result?.manuscript_path).toBeTruthy();
    expect(taskPayload?.data.result?.metrics.elapsed_ms).toBeGreaterThanOrEqual(0);
    expect(taskPayload?.data.result?.metrics.llm_calls).toBeGreaterThan(0);
    expect(fs.existsSync(taskPayload?.data.result?.manuscript_path ?? "")).toBe(true);
  }, API_TEST_TIMEOUT_MS);

  it("supports step-by-step API workflow", async () => {
    const workspaceDir = path.join(tempRoot, "step-workflow");
    const init = await postJson<{ workspace_dir: string; project_id: string }>(
      apiBaseUrl,
      "/api/v1/story/init",
      {
        workspace_dir: workspaceDir,
        title: "Step Story",
        prompt: "Write a short cyberpunk story with two chapters.",
        model_config: {
          api_url: providerBaseUrl,
          api_key: "test-key",
          model: "deepseek-chat"
        }
      }
    );

    expect(init.payload.code).toBe(0);

    const common = {
      workspace_dir: init.payload.data.workspace_dir,
      project_id: init.payload.data.project_id
    };

    const edit = await postJson<{ applied: string[] }>(apiBaseUrl, "/api/v1/story/edit", {
      ...common,
      table: "world",
      action: "set",
      field: "setting",
      value: "Neo-Shanghai"
    });

    expect(edit.payload.code).toBe(0);
    expect(edit.payload.data.applied.length).toBe(1);

    const commit = await postJson<{ ok: boolean }>(apiBaseUrl, "/api/v1/story/commit", {
      ...common,
      chapter_id: "ch01",
      event_text: "Lin discovers a hidden archive key.",
      force: true,
      model_config: {
        api_url: providerBaseUrl,
        api_key: "test-key",
        model: "deepseek-chat"
      }
    });

    expect(commit.payload.code).toBe(0);
    expect(commit.payload.data.ok).toBe(true);

    const ci = await postJson(apiBaseUrl, "/api/v1/story/ci", {
      ...common,
      scope: "all"
    });

    expect(ci.payload.code).toBe(0);

    const render = await postJson<{ rendered: string[] }>(apiBaseUrl, "/api/v1/story/render", {
      ...common,
      chapter_range: "all",
      force: true,
      model_config: {
        api_url: providerBaseUrl,
        api_key: "test-key",
        model: "deepseek-chat"
      }
    });

    expect(render.payload.code).toBe(0);
    expect(render.payload.data.rendered.length).toBeGreaterThan(0);

    const compilePath = path.join(workspaceDir, "final-story.md");
    const compile = await postJson<{ output_path: string }>(apiBaseUrl, "/api/v1/story/compile", {
      ...common,
      chapter_range: "all",
      output_path: compilePath
    });

    expect(compile.payload.code).toBe(0);
    expect(fs.existsSync(compile.payload.data.output_path)).toBe(true);
  }, API_TEST_TIMEOUT_MS);

  it("returns validation errors for invalid edit payload", async () => {
    const workspaceDir = path.join(tempRoot, "invalid-edit");
    const init = await postJson<{ workspace_dir: string; project_id: string }>(
      apiBaseUrl,
      "/api/v1/story/init",
      {
        workspace_dir: workspaceDir,
        title: "Invalid Edit Story"
      }
    );

    expect(init.payload.code).toBe(0);

    const invalidEdit = await postJson(apiBaseUrl, "/api/v1/story/edit", {
      workspace_dir: init.payload.data.workspace_dir,
      project_id: init.payload.data.project_id
    });

    expect(invalidEdit.status).toBe(400);
    expect(invalidEdit.payload.code).toBe(4001);
  }, API_TEST_TIMEOUT_MS);

  it("returns validation errors for invalid run mode", async () => {
    const invalidMode = await postJson(apiBaseUrl, "/api/v1/story/run", {
      mode: "asnyc",
      title: "Invalid Mode Story",
      prompt: "Write a tiny suspense story.",
      model_config: {
        api_url: providerBaseUrl,
        api_key: "test-key",
        model: "deepseek-chat"
      }
    });

    expect(invalidMode.status).toBe(400);
    expect(invalidMode.payload.code).toBe(4001);
  }, API_TEST_TIMEOUT_MS);

  it("cancels sync run work when the client disconnects", async () => {
    setFakeProviderDelayMs(1_200);
    const controller = new AbortController();
    const runPromise = fetch(`${apiBaseUrl}/api/v1/story/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        mode: "sync",
        output_root: path.join(tempRoot, "abort-output"),
        title: "Abort Story",
        prompt: "Write a compact mystery novella.",
        model_config: {
          api_url: providerBaseUrl,
          api_key: "test-key",
          model: "deepseek-chat"
        }
      }),
      signal: controller.signal
    });

    await new Promise((resolve) => setTimeout(resolve, 120));
    controller.abort();

    await expect(runPromise).rejects.toBeTruthy();

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(fakeProviderCallCount).toBeLessThanOrEqual(1);

    const health = await getJson(apiBaseUrl, "/api/v1/health");
    expect(health.status).toBe(200);
    expect(health.payload.code).toBe(0);
  }, API_TEST_TIMEOUT_MS);

  it("uses generated-novels as default output root when output_root is omitted", async () => {
    const run = await postJson<{ workspace_dir: string }>(apiBaseUrl, "/api/v1/story/run", {
      mode: "sync",
      title: "Default Root Story",
      prompt: "Write a tiny suspense story.",
      model_config: {
        api_url: providerBaseUrl,
        api_key: "test-key",
        model: "deepseek-chat"
      }
    });

    expect(run.payload.code).toBe(0);
    expect(run.payload.data.workspace_dir.startsWith(DEFAULT_API_OUTPUT_ROOT)).toBe(true);

    fs.rmSync(run.payload.data.workspace_dir, { recursive: true, force: true });
  }, API_TEST_TIMEOUT_MS);

  it("expires completed async tasks based on TTL policy", async () => {
    const ttlServer = createStoryforgeApiServer({
      taskTtlMs: 150,
      taskCleanupIntervalMs: 30
    });

    try {
      const ttlPort = await listen(ttlServer);
      const ttlBaseUrl = `http://127.0.0.1:${ttlPort}`;
      const submit = await postJson<{ task_id: string }>(ttlBaseUrl, "/api/v1/story/run", {
        mode: "async",
        output_root: path.join(tempRoot, "ttl-output"),
        title: "TTL Story",
        prompt: "Write a compact suspense story.",
        model_config: {
          api_url: providerBaseUrl,
          api_key: "test-key",
          model: "deepseek-chat"
        }
      });

      expect(submit.status).toBe(200);
      expect(submit.payload.code).toBe(0);

      let completed = false;

      for (let index = 0; index < 100; index += 1) {
        const task = await getJson<{ status: string }>(ttlBaseUrl, `/api/v1/tasks/${submit.payload.data.task_id}`);

        if (task.status === 200 && task.payload.data.status === "succeeded") {
          completed = true;
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      expect(completed).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 260));

      const expired = await getJson(ttlBaseUrl, `/api/v1/tasks/${submit.payload.data.task_id}`);
      expect(expired.status).toBe(404);
      expect(expired.payload.code).toBe(4041);
    } finally {
      await closeServer(ttlServer);
    }
  }, API_TEST_TIMEOUT_MS);

  it("keeps active tasks when capacity is full and rejects new tasks", () => {
    const store = new InMemoryRunTaskStore({
      taskTtlMs: 60_000,
      taskMaxEntries: 2
    });
    const request = {
      prompt: "Write a short story.",
      model_config: {
        api_url: "https://api.deepseek.com",
        api_key: "test-key",
        model: "deepseek-chat"
      }
    };

    const first = store.create(request);
    const second = store.create(request);

    expect(store.get(first.id)).not.toBeNull();
    expect(store.get(second.id)).not.toBeNull();

    let captured: unknown;

    try {
      store.create(request);
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(ApiServiceError);
    expect((captured as ApiServiceError).status).toBe(429);
    expect((captured as ApiServiceError).code).toBe(4290);
    expect(store.get(first.id)).not.toBeNull();
    expect(store.get(second.id)).not.toBeNull();
  });

  it("applies async queue backpressure when scheduler is saturated", async () => {
    const queueServer = createStoryforgeApiServer({
      asyncRunConcurrency: 1,
      asyncRunQueueLimit: 1
    });

    try {
      const queuePort = await listen(queueServer);
      const queueBaseUrl = `http://127.0.0.1:${queuePort}`;
      const requestBody = {
        mode: "async",
        output_root: path.join(tempRoot, "queue-output"),
        title: "Queue Saturation Story",
        prompt: "Write a compact suspense story.",
        model_config: {
          api_url: providerBaseUrl,
          api_key: "test-key",
          model: "deepseek-chat"
        }
      };

      const first = await postJson<{ status: string }>(queueBaseUrl, "/api/v1/story/run", requestBody);
      const second = await postJson<{ status: string }>(queueBaseUrl, "/api/v1/story/run", requestBody);
      const third = await postJson(queueBaseUrl, "/api/v1/story/run", requestBody);

      expect(first.status).toBe(200);
      expect(first.payload.code).toBe(0);
      expect(first.payload.data.status === "running" || first.payload.data.status === "queued").toBe(true);

      expect(second.status).toBe(200);
      expect(second.payload.code).toBe(0);
      expect(second.payload.data.status === "running" || second.payload.data.status === "queued").toBe(true);

      expect(third.status).toBe(429);
      expect(third.payload.code).toBe(4291);
    } finally {
      await closeServer(queueServer);
    }
  }, API_TEST_TIMEOUT_MS);

  it("fails async tasks when watchdog timeout is reached", async () => {
    setFakeProviderDelayMs(1_200);
    const timeoutServer = createStoryforgeApiServer({
      asyncRunTimeoutMs: 300
    });

    try {
      const timeoutPort = await listen(timeoutServer);
      const timeoutBaseUrl = `http://127.0.0.1:${timeoutPort}`;
      const submit = await postJson<{ task_id: string }>(timeoutBaseUrl, "/api/v1/story/run", {
        mode: "async",
        output_root: path.join(tempRoot, "watchdog-output"),
        title: "Watchdog Story",
        prompt: "Write a compact suspense story.",
        model_config: {
          api_url: providerBaseUrl,
          api_key: "test-key",
          model: "deepseek-chat"
        }
      });

      expect(submit.status).toBe(200);
      expect(submit.payload.code).toBe(0);

      let terminal: JsonEnvelope<{ status: string; error: string | null }> | null = null;

      for (let index = 0; index < 80; index += 1) {
        const task = await getJson<{ status: string; error: string | null }>(
          timeoutBaseUrl,
          `/api/v1/tasks/${submit.payload.data.task_id}`
        );

        if (task.payload.data.status === "succeeded" || task.payload.data.status === "failed") {
          terminal = task.payload;
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 60));
      }

      expect(terminal).not.toBeNull();
      expect(terminal?.data.status).toBe("failed");
      expect(terminal?.data.error?.toLowerCase()).toContain("timed out");
    } finally {
      await closeServer(timeoutServer);
    }
  }, API_TEST_TIMEOUT_MS);
});
