import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface ApiCredentialRecord {
  type: "api";
  key: string;
}

interface OauthCredentialRecord {
  type: "oauth";
  access?: string;
  refresh?: string;
  expires?: number;
  accountId?: string;
}

type CredentialRecord = ApiCredentialRecord | OauthCredentialRecord | Record<string, unknown>;
type AuthStore = Record<string, CredentialRecord>;

export interface StoredOauthCredential {
  access: string;
  refresh: string | null;
  expires: number;
  accountId: string | null;
}

function isWritableDirectory(directoryPath: string): boolean {
  try {
    fs.mkdirSync(directoryPath, { recursive: true });
    fs.accessSync(directoryPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveStoryforgeOpencodeDataDir(
  homeDir: string = os.homedir(),
  tempDir: string = os.tmpdir()
): string {
  const preferredPath = path.join(homeDir, ".storyforge", "xdg-data");

  if (isWritableDirectory(preferredPath)) {
    return preferredPath;
  }

  const fallbackPath = path.join(tempDir, "storyforge", "xdg-data");
  fs.mkdirSync(fallbackPath, { recursive: true });
  return fallbackPath;
}

export function getStoryforgeOpencodeDataDir(): string {
  return resolveStoryforgeOpencodeDataDir();
}

export function getSystemOpencodeAuthPath(): string {
  return path.join(os.homedir(), ".local", "share", "opencode", "auth.json");
}

export function getDefaultOpencodeAuthPath(): string {
  return path.join(getStoryforgeOpencodeDataDir(), "opencode", "auth.json");
}

function readAuthStore(authPath: string = getDefaultOpencodeAuthPath()): AuthStore {
  try {
    const raw = fs.readFileSync(authPath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as AuthStore) : {};
  } catch {
    return {};
  }
}

function writeAuthStore(store: AuthStore, authPath: string = getDefaultOpencodeAuthPath()): string | null {
  try {
    fs.mkdirSync(path.dirname(authPath), { recursive: true });
    fs.writeFileSync(authPath, `${JSON.stringify(store, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    fs.chmodSync(authPath, 0o600);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function normalizeOauthCredential(record: CredentialRecord | undefined): StoredOauthCredential | null {
  if (!record || typeof record !== "object") {
    return null;
  }

  const candidate = record as Partial<OauthCredentialRecord>;

  if (candidate.type !== "oauth" || typeof candidate.access !== "string") {
    return null;
  }

  return {
    access: candidate.access,
    refresh: typeof candidate.refresh === "string" ? candidate.refresh : null,
    expires: typeof candidate.expires === "number" ? candidate.expires : 0,
    accountId: typeof candidate.accountId === "string" ? candidate.accountId : null
  };
}

export function hasOauthCredential(providerId: string, authPath: string = getDefaultOpencodeAuthPath()): boolean {
  return getOauthCredential(providerId, authPath) !== null;
}

export function getOauthCredential(
  providerId: string,
  authPath: string = getDefaultOpencodeAuthPath()
): StoredOauthCredential | null {
  return normalizeOauthCredential(readAuthStore(authPath)[providerId]);
}

export function getOauthAccessToken(
  providerId: string,
  authPath: string = getDefaultOpencodeAuthPath()
): string | null {
  return getOauthCredential(providerId, authPath)?.access ?? null;
}

export function syncApiCredential(
  providerId: string,
  apiKey: string,
  authPath: string = getDefaultOpencodeAuthPath()
): string | null {
  const trimmedKey = apiKey.trim();

  if (!trimmedKey) {
    return "API key is required.";
  }

  const store = readAuthStore(authPath);
  store[providerId] = {
    type: "api",
    key: trimmedKey
  };

  return writeAuthStore(store, authPath);
}

export function syncOauthCredential(
  providerId: string,
  accessToken: string,
  authPath: string = getDefaultOpencodeAuthPath()
): string | null {
  const trimmedToken = accessToken.trim();

  if (!trimmedToken) {
    return "OAuth token is required.";
  }

  const store = readAuthStore(authPath);
  const currentOauth = normalizeOauthCredential(store[providerId]);

  store[providerId] = {
    type: "oauth",
    access: trimmedToken,
    refresh: currentOauth?.refresh ?? undefined,
    expires: currentOauth?.expires ?? 0,
    accountId: currentOauth?.accountId ?? undefined
  };

  return writeAuthStore(store, authPath);
}

export function syncOauthCredentialRecord(
  providerId: string,
  credential: StoredOauthCredential,
  authPath: string = getDefaultOpencodeAuthPath()
): string | null {
  const trimmedAccess = credential.access.trim();

  if (!trimmedAccess) {
    return "OAuth token is required.";
  }

  const store = readAuthStore(authPath);
  store[providerId] = {
    type: "oauth",
    access: trimmedAccess,
    refresh: credential.refresh?.trim() || undefined,
    expires: Number.isFinite(credential.expires) ? credential.expires : 0,
    accountId: credential.accountId?.trim() || undefined
  };

  return writeAuthStore(store, authPath);
}

export function getConnectedProviderIds(authPath: string = getDefaultOpencodeAuthPath()): readonly string[] {
  const store = readAuthStore(authPath);

  return Object.keys(store).filter((key) => {
    const record = store[key];

    if (!record || typeof record !== "object") {
      return false;
    }

    const candidate = record as Partial<CredentialRecord>;

    if (candidate.type === "api" && typeof (candidate as ApiCredentialRecord).key === "string") {
      return true;
    }

    if (candidate.type === "oauth" && typeof (candidate as OauthCredentialRecord).access === "string") {
      return true;
    }

    return false;
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function launchOauthLogin(providerId: string): string | null {
  return "OAuth login via opencode is no longer supported. Please use an API key instead: /connect <provider> <api-key>.";
}
