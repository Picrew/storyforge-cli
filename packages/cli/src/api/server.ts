import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  ApiServiceError,
  executeStoryCiRequest,
  executeStoryCommitRequest,
  executeStoryCompileRequest,
  executeStoryEditRequest,
  executeStoryInitRequest,
  executeStoryRefreshRequest,
  executeStoryRenderRequest,
  executeStoryRunRequest,
  formatStageError,
  validateStoryRunRequest,
  type StoryRunProgress,
  type StoryRunRequest,
  type StoryRunResult
} from "./service.js";

export interface StoryforgeApiServerOptions {
  host?: string;
  port?: number;
  bodyLimitBytes?: number;
  taskTtlMs?: number;
  taskCleanupIntervalMs?: number;
  taskMaxEntries?: number;
  asyncRunConcurrency?: number;
  asyncRunQueueLimit?: number;
  asyncRunTimeoutMs?: number;
  apiToken?: string;
}

type ApiTaskStatus = "queued" | "running" | "succeeded" | "failed";

interface StoryRunTask {
  id: string;
  status: ApiTaskStatus;
  created_at: string;
  updated_at: string;
  progress: StoryRunProgress | null;
  result: StoryRunResult | null;
  error: string | null;
  request_summary: {
    workspace_dir: string | null;
    output_root: string | null;
    model: string | null;
    prompt_length: number;
  };
}

interface ApiEnvelope {
  code: number;
  msg: string;
  request_id: string;
  data: unknown;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3210;
const DEFAULT_BODY_LIMIT_BYTES = 10 * 1024 * 1024;
const DEFAULT_TASK_TTL_MS = 6 * 60 * 60 * 1_000;
const DEFAULT_TASK_CLEANUP_INTERVAL_MS = 30_000;
const DEFAULT_TASK_MAX_ENTRIES = 1_000;
const DEFAULT_ASYNC_RUN_CONCURRENCY = 2;
const DEFAULT_ASYNC_RUN_QUEUE_LIMIT = 200;
const DEFAULT_ASYNC_RUN_TIMEOUT_MS = 30 * 60 * 1_000;
const TERMINAL_TASK_STATUS = new Set<ApiTaskStatus>(["succeeded", "failed"]);

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}

function readPositiveIntegerEnv(name: string): number | undefined {
  const raw = process.env[name];

  if (typeof raw !== "string") {
    return undefined;
  }

  const parsed = Number.parseInt(raw.trim(), 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return undefined;
  }

  return parsed;
}

function nowIso(): string {
  return new Date().toISOString();
}

function cleanPathname(value: string): string {
  if (!value) {
    return "/";
  }

  if (value.length > 1 && value.endsWith("/")) {
    return value.slice(0, -1);
  }

  return value;
}

function setCommonHeaders(response: ServerResponse): void {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Cache-Control", "no-store");
}

function isAuthorized(request: IncomingMessage, apiToken: string | null): boolean {
  if (!apiToken) {
    return true;
  }

  const authorization = request.headers.authorization ?? "";
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  const expectedBuffer = Buffer.from(apiToken);
  const suppliedBuffer = Buffer.from(supplied);

  return expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function canWriteResponse(response: ServerResponse): boolean {
  return !response.writableEnded && !response.destroyed;
}

function sendEnvelope(response: ServerResponse, statusCode: number, envelope: ApiEnvelope): void {
  if (!canWriteResponse(response)) {
    return;
  }

  setCommonHeaders(response);
  response.statusCode = statusCode;
  response.end(`${JSON.stringify(envelope)}\n`);
}

function sendSuccess(response: ServerResponse, requestId: string, data: unknown, msg: string = "ok"): void {
  sendEnvelope(response, 200, {
    code: 0,
    msg,
    request_id: requestId,
    data
  });
}

function sendError(response: ServerResponse, requestId: string, error: unknown): void {
  if (error instanceof ApiServiceError) {
    sendEnvelope(response, error.status, {
      code: error.code,
      msg: error.message,
      request_id: requestId,
      data: null
    });
    return;
  }

  const message = error instanceof Error ? error.message : String(error);

  sendEnvelope(response, 500, {
    code: 5000,
    msg: message,
    request_id: requestId,
    data: null
  });
}

async function readJsonBody(request: IncomingMessage, bodyLimitBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    totalBytes += buffer.length;

    if (totalBytes > bodyLimitBytes) {
      throw new ApiServiceError("Request body is too large.", 4002, 413);
    }

    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();

  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiServiceError("Request body must be valid JSON.", 4003, 400);
  }
}

function parseTaskId(pathname: string): string | null {
  const match = /^\/api\/v1\/tasks\/([^/]+)$/.exec(pathname);

  if (!match) {
    return null;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    throw new ApiServiceError("Task id is not valid URL encoding.", 4007, 400);
  }
}

export interface InMemoryRunTaskStoreOptions {
  taskTtlMs: number;
  taskMaxEntries: number;
}

function isoToEpochMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export class InMemoryRunTaskStore {
  private readonly taskMap = new Map<string, StoryRunTask>();
  private readonly taskTtlMs: number;
  private readonly taskMaxEntries: number;

  constructor(options: InMemoryRunTaskStoreOptions) {
    this.taskTtlMs = normalizePositiveInteger(options.taskTtlMs, DEFAULT_TASK_TTL_MS);
    this.taskMaxEntries = normalizePositiveInteger(options.taskMaxEntries, DEFAULT_TASK_MAX_ENTRIES);
  }

  create(request: StoryRunRequest): StoryRunTask {
    this.cleanupExpired();
    this.evictTerminalTasksUntilSize(this.taskMaxEntries - 1);

    if (this.taskMap.size >= this.taskMaxEntries) {
      throw new ApiServiceError(
        `Task capacity reached (${this.taskMaxEntries}). Try again later.`,
        4290,
        429
      );
    }

    const taskId = randomUUID();
    const now = nowIso();
    const task: StoryRunTask = {
      id: taskId,
      status: "queued",
      created_at: now,
      updated_at: now,
      progress: null,
      result: null,
      error: null,
      request_summary: {
        workspace_dir:
          typeof request.workspace_dir === "string" && request.workspace_dir.trim()
            ? request.workspace_dir.trim()
            : null,
        output_root:
          typeof request.output_root === "string" && request.output_root.trim()
            ? request.output_root.trim()
            : null,
        model:
          typeof request.model_config?.model === "string" && request.model_config.model.trim()
            ? request.model_config.model.trim()
            : null,
        prompt_length: typeof request.prompt === "string" ? request.prompt.length : 0
      }
    };

    this.taskMap.set(taskId, task);

    return task;
  }

  get(taskId: string): StoryRunTask | null {
    this.cleanupExpired();
    return this.taskMap.get(taskId) ?? null;
  }

  delete(taskId: string): void {
    this.taskMap.delete(taskId);
  }

  update(taskId: string, updater: (task: StoryRunTask) => void): StoryRunTask | null {
    const task = this.taskMap.get(taskId);

    if (!task) {
      return null;
    }

    updater(task);
    task.updated_at = nowIso();

    return task;
  }

  cleanupExpired(nowMs: number = Date.now()): number {
    let removed = 0;

    for (const [taskId, task] of this.taskMap.entries()) {
      if (!TERMINAL_TASK_STATUS.has(task.status)) {
        continue;
      }

      const ageMs = nowMs - isoToEpochMs(task.updated_at);

      if (ageMs < this.taskTtlMs) {
        continue;
      }

      this.taskMap.delete(taskId);
      removed += 1;
    }

    return removed;
  }

  private evictTerminalTasksUntilSize(targetSize: number): void {
    if (this.taskMap.size <= targetSize) {
      return;
    }

    const ordered = [...this.taskMap.values()].sort((left, right) => {
      return isoToEpochMs(left.updated_at) - isoToEpochMs(right.updated_at);
    });

    for (const task of ordered) {
      if (this.taskMap.size <= targetSize) {
        break;
      }

      if (!TERMINAL_TASK_STATUS.has(task.status)) {
        continue;
      }

      this.taskMap.delete(task.id);
    }
  }
}

interface AsyncRunWorkItem {
  onStart: () => void;
  run: () => Promise<void>;
}

class AsyncRunScheduler {
  private readonly maxConcurrency: number;
  private readonly maxQueued: number;
  private running = 0;
  private readonly queue: AsyncRunWorkItem[] = [];

  constructor(maxConcurrency: number, maxQueued: number) {
    this.maxConcurrency = normalizePositiveInteger(maxConcurrency, DEFAULT_ASYNC_RUN_CONCURRENCY);
    this.maxQueued = normalizePositiveInteger(maxQueued, DEFAULT_ASYNC_RUN_QUEUE_LIMIT);
  }

  schedule(item: AsyncRunWorkItem): "running" | "queued" | "rejected" {
    if (this.running < this.maxConcurrency) {
      this.start(item);
      return "running";
    }

    if (this.queue.length >= this.maxQueued) {
      return "rejected";
    }

    this.queue.push(item);
    return "queued";
  }

  private start(item: AsyncRunWorkItem): void {
    this.running += 1;
    item.onStart();
    void item.run().finally(() => {
      this.running = Math.max(0, this.running - 1);
      this.drainQueue();
    });
  }

  private drainQueue(): void {
    while (this.running < this.maxConcurrency && this.queue.length > 0) {
      const next = this.queue.shift();

      if (!next) {
        break;
      }

      this.start(next);
    }
  }
}

export function createStoryforgeApiServer(
  options: Pick<
    StoryforgeApiServerOptions,
    | "bodyLimitBytes"
    | "taskTtlMs"
    | "taskCleanupIntervalMs"
    | "taskMaxEntries"
    | "asyncRunConcurrency"
    | "asyncRunQueueLimit"
    | "asyncRunTimeoutMs"
    | "apiToken"
  > = {}
): http.Server {
  const bodyLimitBytes = normalizePositiveInteger(options.bodyLimitBytes, DEFAULT_BODY_LIMIT_BYTES);
  const taskCleanupIntervalMs = normalizePositiveInteger(
    options.taskCleanupIntervalMs,
    DEFAULT_TASK_CLEANUP_INTERVAL_MS
  );
  const taskStore = new InMemoryRunTaskStore({
    taskTtlMs: normalizePositiveInteger(options.taskTtlMs, DEFAULT_TASK_TTL_MS),
    taskMaxEntries: normalizePositiveInteger(options.taskMaxEntries, DEFAULT_TASK_MAX_ENTRIES)
  });
  const asyncRunScheduler = new AsyncRunScheduler(
    normalizePositiveInteger(options.asyncRunConcurrency, DEFAULT_ASYNC_RUN_CONCURRENCY),
    normalizePositiveInteger(options.asyncRunQueueLimit, DEFAULT_ASYNC_RUN_QUEUE_LIMIT)
  );
  const asyncRunTimeoutMs = normalizePositiveInteger(
    options.asyncRunTimeoutMs,
    DEFAULT_ASYNC_RUN_TIMEOUT_MS
  );
  const apiToken = options.apiToken?.trim() || null;
  const cleanupTimer = setInterval(() => {
    taskStore.cleanupExpired();
  }, taskCleanupIntervalMs);

  cleanupTimer.unref();

  const server = http.createServer(async (request, response) => {
    const requestId = randomUUID();
    request.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code !== "ECONNRESET") {
        console.error(error);
      }
    });

    try {
      if (!request.url) {
        throw new ApiServiceError("Request URL is missing.", 4004, 400);
      }

      const method = request.method?.toUpperCase() ?? "GET";
      const parsedUrl = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
      const pathname = cleanPathname(parsedUrl.pathname);

      if (method === "OPTIONS") {
        setCommonHeaders(response);
        response.statusCode = 204;
        response.end();
        return;
      }

      if (method === "GET" && pathname === "/api/v1/health") {
        sendSuccess(response, requestId, {
          status: "ok",
          timestamp: nowIso()
        });
        return;
      }

      if (!isAuthorized(request, apiToken)) {
        throw new ApiServiceError("Unauthorized.", 4010, 401);
      }

      if (method === "GET") {
        const taskId = parseTaskId(pathname);

        if (taskId) {
          const task = taskStore.get(taskId);

          if (!task) {
            throw new ApiServiceError(`Task not found: ${taskId}`, 4041, 404);
          }

          sendSuccess(response, requestId, task);
          return;
        }
      }

      if (method !== "POST") {
        throw new ApiServiceError(`Unsupported method: ${method}`, 4005, 405);
      }

      const payload = await readJsonBody(request, bodyLimitBytes);

      if (!payload || typeof payload !== "object") {
        throw new ApiServiceError("Request body must be a JSON object.", 4006, 400);
      }

      const body = payload as Record<string, unknown>;

      if (pathname === "/api/v1/story/run") {
        const modeInput = body.mode;
        let mode: "sync" | "async" = "sync";

        if (modeInput !== undefined) {
          if (typeof modeInput !== "string") {
            throw new ApiServiceError("mode must be either 'sync' or 'async'.", 4001, 400);
          }

          const normalizedMode = modeInput.trim().toLowerCase();

          if (normalizedMode !== "sync" && normalizedMode !== "async") {
            throw new ApiServiceError("mode must be either 'sync' or 'async'.", 4001, 400);
          }

          mode = normalizedMode;
        }

        const requestBody = body as unknown as StoryRunRequest;

        if (mode === "async") {
          validateStoryRunRequest(requestBody);
          const task = taskStore.create(requestBody);
          const scheduleResult = asyncRunScheduler.schedule({
            onStart: () => {
              const updated = taskStore.update(task.id, (target) => {
                target.status = "running";
                target.progress = {
                  stage: "running",
                  message: "Task is running."
                };
              });

              if (!updated) {
                process.stderr.write(`[storyforge-api] failed to mark task as running: ${task.id}\n`);
              }
            },
            run: async () => {
              const runAbortController = new AbortController();
              const runTimeout = setTimeout(() => {
                runAbortController.abort(
                  new Error(`Async run timed out after ${asyncRunTimeoutMs}ms.`)
                );
              }, asyncRunTimeoutMs);

              runTimeout.unref();

              try {
                const result = await executeStoryRunRequest(
                  requestBody,
                  (progress) => {
                    const updated = taskStore.update(task.id, (target) => {
                      target.progress = progress;
                    });

                    if (!updated) {
                      process.stderr.write(`[storyforge-api] failed to update task progress: ${task.id}\n`);
                    }
                  },
                  { abortSignal: runAbortController.signal }
                );

                const updated = taskStore.update(task.id, (target) => {
                  target.status = "succeeded";
                  target.result = result;
                  target.error = null;
                  target.progress = {
                    stage: "done",
                    message: "Task completed."
                  };
                });

                if (!updated) {
                  process.stderr.write(`[storyforge-api] failed to mark task as succeeded: ${task.id}\n`);
                }
              } catch (error) {
                const updated = taskStore.update(task.id, (target) => {
                  target.status = "failed";
                  target.error = formatStageError(error);
                  target.result = null;
                  target.progress = {
                    stage: "failed",
                    message: formatStageError(error)
                  };
                });

                if (!updated) {
                  process.stderr.write(`[storyforge-api] failed to mark task as failed: ${task.id}\n`);
                }
              } finally {
                clearTimeout(runTimeout);
              }
            }
          });

          if (scheduleResult === "rejected") {
            taskStore.delete(task.id);
            throw new ApiServiceError(
              "Async queue is full. Please retry later.",
              4291,
              429
            );
          }

          sendSuccess(
            response,
            requestId,
            {
              task_id: task.id,
              status: scheduleResult === "running" ? "running" : "queued",
              created_at: task.created_at
            },
            "accepted"
          );

          return;
        }

        const abortController = new AbortController();
        const onClientDisconnect = (): void => {
          if (!abortController.signal.aborted && !response.writableEnded) {
            abortController.abort(new Error("Client disconnected."));
          }
        };

        request.once("aborted", onClientDisconnect);
        response.once("close", onClientDisconnect);

        try {
          const result = await executeStoryRunRequest(
            requestBody,
            undefined,
            { abortSignal: abortController.signal }
          );

          if (!abortController.signal.aborted) {
            sendSuccess(response, requestId, result);
          }
        } finally {
          request.off("aborted", onClientDisconnect);
          response.off("close", onClientDisconnect);
        }

        return;
      }

      if (pathname === "/api/v1/story/init") {
        const result = await executeStoryInitRequest(body as never);
        sendSuccess(response, requestId, result);
        return;
      }

      if (pathname === "/api/v1/story/refresh") {
        const result = await executeStoryRefreshRequest(body as never);
        sendSuccess(response, requestId, result);
        return;
      }

      if (pathname === "/api/v1/story/edit") {
        const result = executeStoryEditRequest(body as never);
        sendSuccess(response, requestId, result);
        return;
      }

      if (pathname === "/api/v1/story/commit") {
        const result = await executeStoryCommitRequest(body as never);
        sendSuccess(response, requestId, result);
        return;
      }

      if (pathname === "/api/v1/story/ci") {
        const result = await executeStoryCiRequest(body as never);
        sendSuccess(response, requestId, result);
        return;
      }

      if (pathname === "/api/v1/story/render") {
        const result = await executeStoryRenderRequest(body as never);
        sendSuccess(response, requestId, result);
        return;
      }

      if (pathname === "/api/v1/story/compile") {
        const result = executeStoryCompileRequest(body as never);
        sendSuccess(response, requestId, result);
        return;
      }

      throw new ApiServiceError(`Unknown endpoint: ${pathname}`, 4042, 404);
    } catch (error) {
      sendError(response, requestId, error);
    }
  });

  server.on("clientError", (error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");

    if (error && (error as NodeJS.ErrnoException).code !== "ECONNRESET") {
      console.error(error);
    }
  });

  server.on("close", () => {
    clearInterval(cleanupTimer);
  });

  return server;
}

export async function startStoryforgeApiServer(
  options: StoryforgeApiServerOptions = {}
): Promise<http.Server> {
  const host = options.host?.trim() || DEFAULT_HOST;
  const port = Number.isFinite(options.port) && options.port
    ? Math.floor(options.port)
    : DEFAULT_PORT;
  const bodyLimitBytes = options.bodyLimitBytes ?? readPositiveIntegerEnv("STORYFORGE_API_BODY_LIMIT_BYTES");
  const taskTtlMs = options.taskTtlMs ?? readPositiveIntegerEnv("STORYFORGE_API_TASK_TTL_MS");
  const taskCleanupIntervalMs =
    options.taskCleanupIntervalMs ?? readPositiveIntegerEnv("STORYFORGE_API_TASK_CLEANUP_INTERVAL_MS");
  const taskMaxEntries = options.taskMaxEntries ?? readPositiveIntegerEnv("STORYFORGE_API_TASK_MAX_ENTRIES");
  const asyncRunConcurrency =
    options.asyncRunConcurrency ?? readPositiveIntegerEnv("STORYFORGE_API_ASYNC_RUN_CONCURRENCY");
  const asyncRunQueueLimit =
    options.asyncRunQueueLimit ?? readPositiveIntegerEnv("STORYFORGE_API_ASYNC_RUN_QUEUE_LIMIT");
  const asyncRunTimeoutMs =
    options.asyncRunTimeoutMs ?? readPositiveIntegerEnv("STORYFORGE_API_ASYNC_RUN_TIMEOUT_MS");
  const apiToken = options.apiToken?.trim() || process.env.STORYFORGE_API_TOKEN?.trim();

  if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost" && !apiToken) {
    throw new Error("STORYFORGE_API_TOKEN is required when binding the API server beyond localhost.");
  }

  const server = createStoryforgeApiServer({
    bodyLimitBytes,
    taskTtlMs,
    taskCleanupIntervalMs,
    taskMaxEntries,
    asyncRunConcurrency,
    asyncRunQueueLimit,
    asyncRunTimeoutMs,
    apiToken
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  process.stdout.write(`Storyforge API server listening on http://${host}:${port}\n`);

  return server;
}
