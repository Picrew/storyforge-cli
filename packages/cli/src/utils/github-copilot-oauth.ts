import { spawn, spawnSync } from "node:child_process";
import type { OauthFlowMode } from "../types.js";

const GITHUB_OAUTH_CLIENT_ID = "Iv1.b507a08c87ecfe98";
const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_DEVICE_TOKEN_URL = "https://github.com/login/oauth/access_token";
const DEVICE_FLOW_TIMEOUT_MS = 15 * 60 * 1_000;
const CURL_STATUS_MARKER = "__STORYFORGE_HTTP_STATUS__";

interface HttpTextResponse {
  status: number;
  body: string;
}

interface GitHubDeviceCodeResponse {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  expires_in?: number;
  interval?: number;
}

interface GitHubDeviceTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
  interval?: number;
}

export interface GitHubCopilotOauthCredential {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
}

export interface GitHubCopilotOauthSession {
  mode: OauthFlowMode;
  authUrl: string;
  userCode: string | null;
  browserOpened: boolean;
  waitForCompletion: () => Promise<GitHubCopilotOauthCredential>;
  cancel: () => void;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asPositiveNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);

    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return fallback;
}

function openExternalUrl(url: string): boolean {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];

  const normalizedArgs = args as string[];

  try {
    const child = spawn(command, normalizedArgs, {
      detached: true,
      stdio: "ignore"
    });

    child.unref();
    return true;
  } catch {
    return false;
  }
}

function hasProxyEnvironment(): boolean {
  return Boolean(
    process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy ||
      process.env.ALL_PROXY ||
      process.env.all_proxy
  );
}

function requestViaCurl(
  url: string,
  options: {
    method: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
): HttpTextResponse | null {
  if (options.signal?.aborted) {
    throw new Error("Request cancelled.");
  }

  const args = ["-sS", "-X", options.method];

  for (const [key, value] of Object.entries(options.headers ?? {})) {
    args.push("-H", `${key}: ${value}`);
  }

  if (options.body !== undefined) {
    args.push("--data-raw", options.body);
  }

  args.push("-w", `\n${CURL_STATUS_MARKER}:%{http_code}`, url);

  const result = spawnSync("curl", args, {
    encoding: "utf8",
    env: process.env
  });

  if (result.error) {
    if ("code" in result.error && result.error.code === "ENOENT") {
      return null;
    }

    throw result.error;
  }

  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || "curl request failed").trim();
    throw new Error(message);
  }

  const output = result.stdout ?? "";
  const marker = `\n${CURL_STATUS_MARKER}:`;
  const markerIndex = output.lastIndexOf(marker);

  if (markerIndex === -1) {
    throw new Error("curl response was missing an HTTP status marker.");
  }

  const body = output.slice(0, markerIndex);
  const statusText = output.slice(markerIndex + marker.length).trim();
  const status = Number.parseInt(statusText, 10);

  if (!Number.isFinite(status)) {
    throw new Error("curl response returned an invalid HTTP status.");
  }

  return {
    status,
    body
  };
}

async function requestText(
  url: string,
  options: {
    method: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
): Promise<HttpTextResponse> {
  if (options.signal?.aborted) {
    throw new Error("Request cancelled.");
  }

  if (hasProxyEnvironment()) {
    const curlResponse = requestViaCurl(url, options);

    if (curlResponse) {
      return curlResponse;
    }
  }

  const response = await fetch(url, {
    method: options.method,
    headers: options.headers,
    body: options.body,
    signal: options.signal
  });

  return {
    status: response.status,
    body: await response.text()
  };
}

function parseJsonResponse<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${label} returned an unreadable response.`);
  }
}

async function requestDeviceCode(signal: AbortSignal): Promise<{
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  intervalSeconds: number;
}> {
  const response = await requestText(GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: GITHUB_OAUTH_CLIENT_ID,
      scope: "read:user"
    }).toString(),
    signal
  });

  if (response.status < 200 || response.status >= 300) {
    const suffix = response.body.trim() ? ` ${response.body.trim().slice(0, 240)}` : "";
    throw new Error(`GitHub device flow setup failed (${response.status}).${suffix}`);
  }

  const parsed = parseJsonResponse<GitHubDeviceCodeResponse>(response.body, "GitHub device-code");
  const deviceCode = asNonEmptyString(parsed.device_code);
  const userCode = asNonEmptyString(parsed.user_code);
  const verificationUrl = asNonEmptyString(parsed.verification_uri);

  if (!deviceCode || !userCode || !verificationUrl) {
    throw new Error("GitHub device flow did not return a usable verification code.");
  }

  return {
    deviceCode,
    userCode,
    verificationUrl,
    intervalSeconds: asPositiveNumber(parsed.interval, 5)
  };
}

async function pollForGitHubAccessToken(
  input: {
    deviceCode: string;
    intervalSeconds: number;
  },
  signal: AbortSignal
): Promise<GitHubCopilotOauthCredential> {
  const deadline = Date.now() + DEVICE_FLOW_TIMEOUT_MS;
  let intervalSeconds = Math.max(1, input.intervalSeconds);

  while (Date.now() < deadline) {
    if (signal.aborted) {
      throw new Error("GitHub browser auth cancelled.");
    }

    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1_000));

    if (signal.aborted) {
      throw new Error("GitHub browser auth cancelled.");
    }

    const response = await requestText(GITHUB_DEVICE_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        client_id: GITHUB_OAUTH_CLIENT_ID,
        device_code: input.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code"
      }).toString(),
      signal
    });

    if (response.status < 200 || response.status >= 300) {
      const suffix = response.body.trim() ? ` ${response.body.trim().slice(0, 240)}` : "";
      throw new Error(`GitHub token exchange failed (${response.status}).${suffix}`);
    }

    const parsed = parseJsonResponse<GitHubDeviceTokenResponse>(response.body, "GitHub token");
    const accessToken = asNonEmptyString(parsed.access_token);

    if (accessToken) {
      return {
        accessToken,
        refreshToken: accessToken,
        // GitHub OAuth tokens are long-lived until revoked.
        expiresAt: 0
      };
    }

    const errorCode = asNonEmptyString(parsed.error);

    if (errorCode === "authorization_pending") {
      continue;
    }

    if (errorCode === "slow_down") {
      intervalSeconds = Math.max(intervalSeconds + 5, asPositiveNumber(parsed.interval, intervalSeconds + 5));
      continue;
    }

    const description = asNonEmptyString(parsed.error_description) ?? "Unknown device-flow error.";
    throw new Error(`GitHub browser auth failed: ${description}`);
  }

  throw new Error("GitHub browser auth timed out. Please retry and finish the browser step within 15 minutes.");
}

export async function startGitHubCopilotOauthSession(
  mode: OauthFlowMode = "browser"
): Promise<GitHubCopilotOauthSession> {
  const controller = new AbortController();
  const deviceCode = await requestDeviceCode(controller.signal);
  const browserOpened = mode === "headless" ? false : openExternalUrl(deviceCode.verificationUrl);

  return {
    mode,
    authUrl: deviceCode.verificationUrl,
    userCode: deviceCode.userCode,
    browserOpened,
    waitForCompletion: async () =>
      pollForGitHubAccessToken(
        {
          deviceCode: deviceCode.deviceCode,
          intervalSeconds: deviceCode.intervalSeconds
        },
        controller.signal
      ),
    cancel: () => {
      controller.abort();
    }
  };
}
