import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import type { OauthFlowMode } from "../types.js";

const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_ISSUER = "https://auth.openai.com";
const OPENAI_CALLBACK_PORT = 1455;
const OPENAI_CALLBACK_PATH = "/auth/callback";
const OPENAI_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
const OPENAI_POLLING_SAFETY_MARGIN_MS = 3_000;
const CURL_STATUS_MARKER = "__STORYFORGE_HTTP_STATUS__";

interface PkcePair {
  verifier: string;
  challenge: string;
}

interface OpenAITokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
}

interface OpenAIDeviceAuthResponse {
  device_auth_id?: string;
  user_code?: string;
  interval?: number | string;
}

interface OpenAIDeviceTokenResponse {
  authorization_code?: string;
  code_verifier?: string;
}

interface HttpTextResponse {
  status: number;
  body: string;
}

interface JwtClaims {
  chatgpt_account_id?: string;
  organizations?: Array<{ id?: string }>;
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string;
  };
}

export interface OpenAIOauthCredential {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  accountId: string | null;
}

export interface OpenAIOauthSession {
  mode: OauthFlowMode;
  authUrl: string;
  userCode: string | null;
  browserOpened: boolean;
  waitForCompletion: () => Promise<OpenAIOauthCredential>;
  cancel: () => void;
}

function toBase64Url(value: Buffer): string {
  return value
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

function generatePkcePair(): PkcePair {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = randomBytes(43);
  let verifier = "";

  for (const byte of bytes) {
    verifier += alphabet[byte % alphabet.length];
  }

  const challenge = toBase64Url(createHash("sha256").update(verifier, "utf8").digest());

  return {
    verifier,
    challenge
  };
}

function generateState(): string {
  return toBase64Url(randomBytes(32));
}

function parseJwtClaims(token: string | undefined): JwtClaims | null {
  if (!token) {
    return null;
  }

  const parts = token.split(".");

  if (parts.length !== 3) {
    return null;
  }

  try {
    const payload = Buffer.from(parts[1], "base64url").toString("utf8");
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === "object" ? (parsed as JwtClaims) : null;
  } catch {
    return null;
  }
}

function extractAccountIdFromClaims(claims: JwtClaims | null): string | null {
  if (!claims) {
    return null;
  }

  return (
    claims.chatgpt_account_id ??
    claims["https://api.openai.com/auth"]?.chatgpt_account_id ??
    claims.organizations?.[0]?.id ??
    null
  );
}

function extractAccountId(tokens: OpenAITokenResponse): string | null {
  return (
    extractAccountIdFromClaims(parseJwtClaims(tokens.id_token)) ??
    extractAccountIdFromClaims(parseJwtClaims(tokens.access_token)) ??
    null
  );
}

function normalizeCredential(tokens: OpenAITokenResponse): OpenAIOauthCredential {
  if (!tokens.access_token) {
    throw new Error("OpenAI did not return an access token.");
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: Date.now() + Math.max(1, tokens.expires_in ?? 3_600) * 1_000,
    accountId: extractAccountId(tokens)
  };
}

function buildAuthorizeUrl(redirectUri: string, pkce: PkcePair, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: OPENAI_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access",
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    // OpenAI's public client registration is tied to the opencode originator.
    originator: "opencode"
  });

  return `${OPENAI_ISSUER}/oauth/authorize?${params.toString()}`;
}

async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
  codeVerifier: string,
  signal?: AbortSignal
): Promise<OpenAITokenResponse> {
  const response = await requestText(`${OPENAI_ISSUER}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: OPENAI_CLIENT_ID,
      code_verifier: codeVerifier
    }).toString(),
    signal
  });

  if (response.status < 200 || response.status >= 300) {
    const responseBody = response.body.trim();
    const suffix = responseBody ? ` ${responseBody.slice(0, 240)}` : "";
    throw new Error(`OpenAI token exchange failed (${response.status}).${suffix}`);
  }

  return JSON.parse(response.body) as OpenAITokenResponse;
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
  }
): HttpTextResponse | null {
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

function renderSuccessPage(): string {
  return `<!doctype html>
<html>
  <head>
    <title>Storyforge Authorization Successful</title>
    <style>
      body {
        font-family: system-ui, -apple-system, sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
        background: #131010;
        color: #f1ecec;
      }

      .container {
        text-align: center;
        padding: 2rem;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Authorization Successful</h1>
      <p>You can close this window and return to Storyforge.</p>
    </div>
    <script>
      setTimeout(() => window.close(), 1500);
    </script>
  </body>
</html>`;
}

function renderErrorPage(errorMessage: string): string {
  return `<!doctype html>
<html>
  <head>
    <title>Storyforge Authorization Failed</title>
    <style>
      body {
        font-family: system-ui, -apple-system, sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
        background: #131010;
        color: #f1ecec;
      }

      .container {
        text-align: center;
        padding: 2rem;
      }

      .error {
        color: #ff917b;
        font-family: ui-monospace, SFMono-Regular, monospace;
        margin-top: 1rem;
        padding: 1rem;
        background: #3c140d;
        border-radius: 0.5rem;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Authorization Failed</h1>
      <p>The browser returned an error.</p>
      <div class="error">${errorMessage}</div>
    </div>
  </body>
</html>`;
}

async function startBrowserSession(): Promise<OpenAIOauthSession> {
  const pkce = generatePkcePair();
  const state = generateState();
  const redirectUri = `http://localhost:${OPENAI_CALLBACK_PORT}${OPENAI_CALLBACK_PATH}`;
  const authUrl = buildAuthorizeUrl(redirectUri, pkce, state);
  const abortController = new AbortController();
  let finished = false;
  let server: http.Server | null = null;
  let rejectPending: ((error: Error) => void) | null = null;
  let timeout: NodeJS.Timeout | null = null;

  const cleanup = (): void => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }

    if (server) {
      server.close();
      server = null;
    }
  };

  const fail = (message: string, reject: (error: Error) => void): void => {
    if (finished) {
      return;
    }

    finished = true;
    cleanup();
    reject(new Error(message));
  };

  const completion = new Promise<OpenAIOauthCredential>((resolve, reject) => {
    rejectPending = reject;

    server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", redirectUri);

      if (requestUrl.pathname !== OPENAI_CALLBACK_PATH) {
        response.statusCode = 404;
        response.end("Not found");
        return;
      }

      const error = requestUrl.searchParams.get("error");
      const errorDescription = requestUrl.searchParams.get("error_description");
      const returnedState = requestUrl.searchParams.get("state");
      const code = requestUrl.searchParams.get("code");

      if (error) {
        const message = errorDescription || error;
        response.setHeader("Content-Type", "text/html");
        response.end(renderErrorPage(message));
        fail(message, reject);
        return;
      }

      if (!code) {
        const message = "Missing authorization code.";
        response.statusCode = 400;
        response.setHeader("Content-Type", "text/html");
        response.end(renderErrorPage(message));
        fail(message, reject);
        return;
      }

      if (returnedState !== state) {
        const message = "State mismatch during OpenAI login.";
        response.statusCode = 400;
        response.setHeader("Content-Type", "text/html");
        response.end(renderErrorPage(message));
        fail(message, reject);
        return;
      }

      void exchangeCodeForTokens(code, redirectUri, pkce.verifier, abortController.signal)
        .then((tokens) => {
          if (finished) {
            return;
          }

          finished = true;
          cleanup();
          response.setHeader("Content-Type", "text/html");
          response.end(renderSuccessPage());
          resolve(normalizeCredential(tokens));
        })
        .catch((exchangeError) => {
          const message =
            exchangeError instanceof Error ? exchangeError.message : String(exchangeError);

          response.statusCode = 500;
          response.setHeader("Content-Type", "text/html");
          response.end(renderErrorPage(message));
          fail(message, reject);
        });
    });

    server.once("error", (listenError) => {
      const message =
        listenError instanceof Error ? listenError.message : String(listenError);
      fail(message, reject);
    });

    server.listen(OPENAI_CALLBACK_PORT, () => {
      timeout = setTimeout(() => {
        fail("OpenAI login timed out before the browser finished.", reject);
      }, OPENAI_CALLBACK_TIMEOUT_MS);
    });
  });

  return {
    mode: "browser",
    authUrl,
    userCode: null,
    browserOpened: openExternalUrl(authUrl),
    waitForCompletion: () => completion,
    cancel: () => {
      if (finished) {
        return;
      }

      abortController.abort();
      finished = true;
      cleanup();
      rejectPending?.(new Error("OpenAI login cancelled."));
      rejectPending = null;
    }
  };
}

async function startHeadlessSession(): Promise<OpenAIOauthSession> {
  const abortController = new AbortController();
  const deviceResponse = await requestText(`${OPENAI_ISSUER}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "storyforge/preview"
    },
    body: JSON.stringify({
      client_id: OPENAI_CLIENT_ID
    }),
    signal: abortController.signal
  });

  if (deviceResponse.status < 200 || deviceResponse.status >= 300) {
    const responseBody = deviceResponse.body.trim();
    const suffix = responseBody ? ` ${responseBody.slice(0, 240)}` : "";
    throw new Error(`OpenAI device authorization failed (${deviceResponse.status}).${suffix}`);
  }

  const deviceData = JSON.parse(deviceResponse.body) as OpenAIDeviceAuthResponse;

  if (!deviceData.device_auth_id || !deviceData.user_code) {
    throw new Error("OpenAI device authorization returned incomplete data.");
  }

  const intervalMs =
    Math.max(Number.parseInt(String(deviceData.interval ?? "5"), 10) || 5, 1) * 1_000 +
    OPENAI_POLLING_SAFETY_MARGIN_MS;

  const completion = (async (): Promise<OpenAIOauthCredential> => {
    while (!abortController.signal.aborted) {
      const response = await requestText(`${OPENAI_ISSUER}/api/accounts/deviceauth/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "storyforge/preview"
        },
        body: JSON.stringify({
          device_auth_id: deviceData.device_auth_id,
          user_code: deviceData.user_code
        }),
        signal: abortController.signal
      });

      if (response.status >= 200 && response.status < 300) {
        const payload = JSON.parse(response.body) as OpenAIDeviceTokenResponse;

        if (!payload.authorization_code || !payload.code_verifier) {
          throw new Error("OpenAI device flow returned incomplete authorization data.");
        }

        const tokens = await exchangeCodeForTokens(
          payload.authorization_code,
          `${OPENAI_ISSUER}/deviceauth/callback`,
          payload.code_verifier,
          abortController.signal
        );

        return normalizeCredential(tokens);
      }

      if (response.status !== 403 && response.status !== 404) {
        const responseBody = response.body.trim();
        const suffix = responseBody ? ` ${responseBody.slice(0, 240)}` : "";
        throw new Error(`OpenAI device login failed (${response.status}).${suffix}`);
      }

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, intervalMs);

        abortController.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new Error("OpenAI login cancelled."));
          },
          { once: true }
        );
      });
    }

    throw new Error("OpenAI login cancelled.");
  })();

  return {
    mode: "headless",
    authUrl: `${OPENAI_ISSUER}/codex/device`,
    userCode: deviceData.user_code,
    browserOpened: openExternalUrl(`${OPENAI_ISSUER}/codex/device`),
    waitForCompletion: () => completion,
    cancel: () => {
      abortController.abort();
    }
  };
}

export async function startOpenAIOauthSession(
  mode: OauthFlowMode
): Promise<OpenAIOauthSession> {
  return mode === "headless" ? startHeadlessSession() : startBrowserSession();
}
