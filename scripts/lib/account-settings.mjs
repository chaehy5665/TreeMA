import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { loadRepoEnvFiles } from "./env-loader.mjs";

const SETTINGS_VERSION = 1;
const SETTINGS_DIR = path.join(os.homedir(), ".treema", "settings");
const SETTINGS_FILE = path.join(SETTINGS_DIR, "accounts.json");
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";
const DEFAULT_GITHUB_API_BASE_URL = "https://api.github.com";
const DEFAULT_GITHUB_MODELS_BASE_URL = "https://models.github.ai/inference";
const DEFAULT_GITHUB_MODELS_MODEL = "github-copilot/gpt-5.4-mini";
const GITHUB_API_VERSION = "2022-11-28";
export const GITHUB_OAUTH_CALLBACK_PATH = "/auth/github/callback";
export const GITHUB_OAUTH_DESKTOP_PORT = 48152;
export const GITHUB_OAUTH_HOSTED_CALLBACK_URL = "https://treesma.com/auth/github/callback";
export const GITHUB_OAUTH_APP_ORIGIN = "https://app.treesma.com";
export const GITHUB_OAUTH_START_URL = "https://treesma.com/api/auth/github/start";
export const GITHUB_OAUTH_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
export const GITHUB_OAUTH_TOKEN_URL = "https://github.com/login/oauth/access_token";
const DEFAULT_GITHUB_OAUTH_SCOPE = "read:user user:email";
const DEFAULT_GITHUB_OAUTH_RETURN_PATH = "/settings/accounts";
const GITHUB_OAUTH_STATE_VERSION = 1;
const GITHUB_OAUTH_STATE_MAX_AGE_MS = 15 * 60 * 1000;
const GITHUB_OAUTH_PKCE_VERSION = 1;
const GITHUB_OAUTH_PKCE_MAX_AGE_SECONDS = 15 * 60;

loadRepoEnvFiles();

function safeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function maskSecret(secret) {
  const value = safeString(secret);
  if (!value) return "";
  if (value.length <= 8) {
    return `${value.slice(0, 2)}••••`;
  }
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

function detectGitHubTokenType(token) {
  const value = safeString(token);
  if (!value) return "";
  if (value.startsWith("gho_")) return "oauth_user_token";
  if (value.startsWith("ghu_")) return "github_app_user_token";
  if (value.startsWith("github_pat_")) return "fine_grained_pat";
  if (value.startsWith("ghp_")) return "classic_pat";
  return "unknown";
}

function sanitizeVerification(value) {
  if (!value || typeof value !== "object") return null;
  const message = safeString(value.message);
  if (!message) return null;
  return {
    ok: value.ok === true,
    tone: value.tone === "error" || value.tone === "warning" ? value.tone : "success",
    message,
    detail: safeString(value.detail),
    checkedAt: safeString(value.checkedAt)
  };
}

function sanitizeGithubOAuthReceipt(value) {
  if (!value || typeof value !== "object") return null;
  const status = value.status === "success" ? "success" : "error";
  const receivedAt = safeString(value.receivedAt);
  if (!receivedAt) return null;
  return {
    status,
    message: safeString(value.message),
    codePreview: safeString(value.codePreview),
    statePreview: safeString(value.statePreview),
    error: safeString(value.error),
    errorDescription: safeString(value.errorDescription),
    receivedAt
  };
}

function isGitHubOAuthTarget(value) {
  return value === "web" || value === "desktop";
}

function normalizeGitHubOAuthReturnPath(value) {
  const normalized = safeString(value);
  if (!normalized.startsWith("/")) return "";
  if (normalized.startsWith("//")) return "";
  if (normalized.includes("://") || normalized.includes("\\") || normalized.includes("..")) return "";
  return normalized;
}

function sanitizeGithubOAuthPendingSession(value) {
  if (!value || typeof value !== "object") return null;
  const target = safeString(value.target);
  const returnPath = normalizeGitHubOAuthReturnPath(value.returnPath);
  const nonce = safeString(value.nonce);
  const sessionHint = safeString(value.sessionHint);
  const issuedAt = safeString(value.issuedAt);

  if (!isGitHubOAuthTarget(target) || !returnPath || !nonce || !sessionHint || !issuedAt) {
    return null;
  }

  return {
    target,
    returnPath,
    nonce,
    sessionHint,
    issuedAt
  };
}

function encodeBase64Url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function normalizeOpenAiBaseUrl(value) {
  const normalized = safeString(value).replace(/\/+$/, "");
  return normalized || DEFAULT_OPENAI_BASE_URL;
}

function normalizeGitHubApiBaseUrl(value) {
  const normalized = safeString(value).replace(/\/+$/, "");
  return normalized || DEFAULT_GITHUB_API_BASE_URL;
}

function createSha256Base64Url(value) {
  return createHash("sha256").update(value).digest("base64url");
}

function createDefaultRawSettings() {
  return {
    version: SETTINGS_VERSION,
    updatedAt: "",
    providers: {
      openai: {
        apiKey: "",
        baseUrl: DEFAULT_OPENAI_BASE_URL,
        defaultModel: DEFAULT_OPENAI_MODEL,
        accountLabel: "",
        lastVerifiedAt: "",
        lastVerification: null
      },
      githubCopilot: {
        githubToken: "",
        apiBaseUrl: DEFAULT_GITHUB_API_BASE_URL,
        accountLogin: "",
        accountLabel: "",
        tokenType: "",
        copilotBillingStatus: "unknown",
        oauth: {
          lastCallback: null,
          pendingDesktopSession: null
        },
        lastVerifiedAt: "",
        lastVerification: null
      }
    }
  };
}

function sanitizeRawSettings(raw) {
  const defaults = createDefaultRawSettings();
  const providers = raw?.providers ?? {};
  const openai = providers.openai ?? {};
  const githubCopilot = providers.githubCopilot ?? {};

  return {
    version: SETTINGS_VERSION,
    updatedAt: safeString(raw?.updatedAt),
    providers: {
      openai: {
        apiKey: safeString(openai.apiKey),
        baseUrl: normalizeOpenAiBaseUrl(openai.baseUrl),
        defaultModel: safeString(openai.defaultModel) || DEFAULT_OPENAI_MODEL,
        accountLabel: safeString(openai.accountLabel),
        lastVerifiedAt: safeString(openai.lastVerifiedAt),
        lastVerification: sanitizeVerification(openai.lastVerification)
      },
      githubCopilot: {
        githubToken: safeString(githubCopilot.githubToken),
        apiBaseUrl: normalizeGitHubApiBaseUrl(githubCopilot.apiBaseUrl),
        accountLogin: safeString(githubCopilot.accountLogin),
        accountLabel: safeString(githubCopilot.accountLabel),
        tokenType: safeString(githubCopilot.tokenType),
        copilotBillingStatus:
          githubCopilot.copilotBillingStatus === "verified" || githubCopilot.copilotBillingStatus === "unverified"
            ? githubCopilot.copilotBillingStatus
            : defaults.providers.githubCopilot.copilotBillingStatus,
        oauth: {
          lastCallback: sanitizeGithubOAuthReceipt(githubCopilot.oauth?.lastCallback),
          pendingDesktopSession: sanitizeGithubOAuthPendingSession(githubCopilot.oauth?.pendingDesktopSession)
        },
        lastVerifiedAt: safeString(githubCopilot.lastVerifiedAt),
        lastVerification: sanitizeVerification(githubCopilot.lastVerification)
      }
    }
  };
}

function normalizeGitHubOAuthRuntime(value = {}) {
  const callbackPath = safeString(value.callbackPath) || GITHUB_OAUTH_CALLBACK_PATH;
  const callbackUrl = safeString(value.callbackUrl);
  const hostedCallbackUrl = safeString(value.hostedCallbackUrl) || GITHUB_OAUTH_HOSTED_CALLBACK_URL;
  return {
    available: Boolean(value.available && callbackUrl),
    callbackPath,
    callbackUrl,
    hostedCallbackUrl
  };
}

function buildPublicSettings(raw, options = {}) {
  const settings = sanitizeRawSettings(raw);
  const openai = settings.providers.openai;
  const githubCopilot = settings.providers.githubCopilot;
  const githubOAuth = normalizeGitHubOAuthRuntime(options.githubOAuth);

  return {
    version: settings.version,
    updatedAt: settings.updatedAt,
    storagePath: SETTINGS_FILE,
    providers: {
      openai: {
        connected: Boolean(openai.apiKey),
        secretPreview: maskSecret(openai.apiKey),
        baseUrl: openai.baseUrl,
        defaultModel: openai.defaultModel,
        accountLabel: openai.accountLabel || (openai.apiKey ? `Key ${maskSecret(openai.apiKey)}` : ""),
        lastVerifiedAt: openai.lastVerifiedAt,
        lastVerification: openai.lastVerification
      },
      githubCopilot: {
        connected: Boolean(githubCopilot.githubToken),
        secretPreview: maskSecret(githubCopilot.githubToken),
        apiBaseUrl: githubCopilot.apiBaseUrl,
        accountLogin: githubCopilot.accountLogin,
        accountLabel:
          githubCopilot.accountLabel ||
          githubCopilot.accountLogin ||
          (githubCopilot.githubToken ? `Token ${maskSecret(githubCopilot.githubToken)}` : ""),
        tokenType: githubCopilot.tokenType || detectGitHubTokenType(githubCopilot.githubToken),
        copilotBillingStatus: githubCopilot.copilotBillingStatus,
        oauth: {
          available: githubOAuth.available,
          callbackPath: githubOAuth.callbackPath,
          callbackUrl: githubOAuth.callbackUrl,
          hostedCallbackUrl: githubOAuth.hostedCallbackUrl,
          webAppOrigin: GITHUB_OAUTH_APP_ORIGIN,
          lastCallback: githubCopilot.oauth.lastCallback
        },
        lastVerifiedAt: githubCopilot.lastVerifiedAt,
        lastVerification: githubCopilot.lastVerification
      }
    }
  };
}

async function ensureSettingsDir() {
  await mkdir(SETTINGS_DIR, { recursive: true, mode: 0o700 });
}

async function readRawSettings() {
  try {
    const content = await readFile(SETTINGS_FILE, "utf8");
    return sanitizeRawSettings(JSON.parse(content));
  } catch {
    return createDefaultRawSettings();
  }
}

async function writeRawSettings(nextSettings) {
  await ensureSettingsDir();
  const payload = sanitizeRawSettings({
    ...nextSettings,
    updatedAt: new Date().toISOString()
  });
  const tempPath = `${SETTINGS_FILE}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  await rename(tempPath, SETTINGS_FILE);
  try {
    await chmod(SETTINGS_FILE, 0o600);
  } catch {}
  return payload;
}

async function readJsonSafely(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractOpenAiError(payload, fallback) {
  const detail = safeString(payload?.error?.message || payload?.message || payload?.error);
  return detail || fallback;
}

function extractGitHubError(payload, fallback) {
  const detail = safeString(payload?.message || payload?.error || payload?.errors?.[0]?.message);
  return detail || fallback;
}

async function verifyOpenAiProvider(settings) {
  const apiKey = safeString(settings.apiKey);
  const baseUrl = normalizeOpenAiBaseUrl(settings.baseUrl);
  const defaultModel = safeString(settings.defaultModel) || DEFAULT_OPENAI_MODEL;

  if (!apiKey) {
    throw new Error("OpenAI API key is required.");
  }

  const response = await fetch(`${baseUrl}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });
  const payload = await readJsonSafely(response);

  if (!response.ok) {
    throw new Error(extractOpenAiError(payload, `OpenAI request failed with status ${response.status}.`));
  }

  const models = Array.isArray(payload?.data) ? payload.data : [];
  const matchedModel = models.find((model) => safeString(model?.id) === defaultModel);

  return {
    ok: true,
    tone: "success",
    message: matchedModel
      ? `Connected. ${defaultModel} is available.`
      : `Connected. Retrieved ${models.length} models from the API.`,
    detail: matchedModel
      ? `The saved default model matched the provider response.`
      : `The saved default model was not found in the returned model list.`,
    checkedAt: new Date().toISOString()
  };
}

async function verifyGitHubCopilotProvider(settings) {
  const githubToken = safeString(settings.githubToken);
  const apiBaseUrl = normalizeGitHubApiBaseUrl(settings.apiBaseUrl);
  const tokenType = detectGitHubTokenType(githubToken);

  if (!githubToken) {
    throw new Error("GitHub token is required.");
  }

  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${githubToken}`,
    "X-GitHub-Api-Version": GITHUB_API_VERSION
  };

  const userResponse = await fetch(`${apiBaseUrl}/user`, { headers });
  const userPayload = await readJsonSafely(userResponse);
  if (!userResponse.ok) {
    throw new Error(extractGitHubError(userPayload, `GitHub request failed with status ${userResponse.status}.`));
  }

  const accountLogin = safeString(userPayload?.login);
  const accountLabel = safeString(userPayload?.name) || accountLogin;
  if (!accountLogin) {
    throw new Error("GitHub returned no account login for this token.");
  }

  if (tokenType === "classic_pat") {
    return {
      ok: false,
      tone: "warning",
      message: `Connected as ${accountLogin}, but classic PATs are not supported for Copilot SDK.`,
      detail: "Use a fine-grained personal access token or a GitHub user access token instead.",
      checkedAt: new Date().toISOString(),
      accountLogin,
      accountLabel,
      tokenType,
      copilotBillingStatus: "unverified"
    };
  }

  const usageResponse = await fetch(`${apiBaseUrl}/users/${accountLogin}/settings/billing/premium_request/usage`, {
    headers
  });

  if (usageResponse.ok) {
    const usagePayload = await readJsonSafely(usageResponse);
    const usageItems = Array.isArray(usagePayload?.usageItems) ? usagePayload.usageItems : [];
    const copilotLines = usageItems.filter((item) => /copilot/i.test(`${item?.product || ""} ${item?.sku || ""}`));
    return {
      ok: true,
      tone: "success",
      message: `Connected as ${accountLogin}. Copilot billing access is available.`,
      detail: copilotLines.length
        ? `${copilotLines.length} Copilot premium-request usage rows were returned.`
        : "The billing endpoint responded, but there are no Copilot usage rows yet.",
      checkedAt: new Date().toISOString(),
      accountLogin,
      accountLabel,
      tokenType,
      copilotBillingStatus: "verified"
    };
  }

  const usagePayload = await readJsonSafely(usageResponse);
  return {
    ok: true,
    tone: "warning",
    message: `Connected as ${accountLogin}, but Copilot billing could not be verified with this token.`,
    detail: extractGitHubError(
      usagePayload,
      "The token may lack Plan read permission, or this account may not expose the billing endpoint."
    ),
    checkedAt: new Date().toISOString(),
    accountLogin,
    accountLabel,
    tokenType,
    copilotBillingStatus: "unverified"
  };
}

export async function fetchGitHubAuthenticatedUser(accessToken, options = {}) {
  const githubToken = safeString(accessToken);
  if (!githubToken) {
    throw new Error("GitHub access token is required.");
  }

  const apiBaseUrl = normalizeGitHubApiBaseUrl(options.apiBaseUrl);
  const response = await fetch(`${apiBaseUrl}/user`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION
    }
  });
  const payload = await readJsonSafely(response);

  if (!response.ok) {
    throw new Error(extractGitHubError(payload, `GitHub request failed with status ${response.status}.`));
  }

  const accountLogin = safeString(payload?.login);
  if (!accountLogin) {
    throw new Error("GitHub returned no account login for this token.");
  }

  return {
    accountLogin,
    accountLabel: safeString(payload?.name) || accountLogin
  };
}

async function buildGitHubCopilotProviderState(current, nextSettings) {
  let verification;
  try {
    verification = await verifyGitHubCopilotProvider(nextSettings);
  } catch (error) {
    verification = {
      ok: false,
      tone: "error",
      message: safeString(error.message) || "Failed to verify GitHub settings.",
      detail: "",
      checkedAt: new Date().toISOString(),
      accountLogin: current.accountLogin,
      accountLabel: current.accountLabel,
      tokenType: detectGitHubTokenType(nextSettings.githubToken),
      copilotBillingStatus: "unverified"
    };
  }

  return {
    verification,
    provider: {
      githubToken: nextSettings.githubToken,
      apiBaseUrl: nextSettings.apiBaseUrl,
      accountLogin: safeString(verification.accountLogin) || current.accountLogin,
      accountLabel:
        safeString(verification.accountLabel) ||
        safeString(verification.accountLogin) ||
        current.accountLabel ||
        `Token ${maskSecret(nextSettings.githubToken)}`,
      tokenType: safeString(verification.tokenType) || detectGitHubTokenType(nextSettings.githubToken),
      copilotBillingStatus:
        verification.copilotBillingStatus === "verified" || verification.copilotBillingStatus === "unverified"
          ? verification.copilotBillingStatus
          : "unknown",
      oauth: current.oauth,
      lastVerifiedAt: verification.checkedAt,
      lastVerification: {
        ok: verification.ok === true,
        tone: verification.tone === "error" || verification.tone === "warning" ? verification.tone : "success",
        message: verification.message,
        detail: safeString(verification.detail),
        checkedAt: verification.checkedAt
      }
    }
  };
}

export async function loadAccountSettings(options = {}) {
  const settings = await readRawSettings();
  return buildPublicSettings(settings, options);
}

export async function loadAnalysisProviderSettings(provider = "openai") {
  const settings = await readRawSettings();
  const openai = settings.providers.openai;
  const githubCopilot = settings.providers.githubCopilot;

  if (provider === "auto") {
    if (openai.apiKey) {
      return {
        provider: "openai",
        connected: true,
        apiKey: openai.apiKey,
        baseUrl: openai.baseUrl,
        defaultModel: openai.defaultModel || DEFAULT_OPENAI_MODEL,
        accountLabel: openai.accountLabel,
        lastVerifiedAt: openai.lastVerifiedAt,
        lastVerification: openai.lastVerification
      };
    }

    if (githubCopilot.githubToken) {
      return {
        provider: "github-copilot",
        connected: true,
        githubToken: githubCopilot.githubToken,
        chatBaseUrl: DEFAULT_GITHUB_MODELS_BASE_URL,
        defaultModel: DEFAULT_GITHUB_MODELS_MODEL,
        accountLabel: githubCopilot.accountLabel || githubCopilot.accountLogin,
        accountLogin: githubCopilot.accountLogin,
        tokenType: githubCopilot.tokenType || detectGitHubTokenType(githubCopilot.githubToken),
        lastVerifiedAt: githubCopilot.lastVerifiedAt,
        lastVerification: githubCopilot.lastVerification
      };
    }

    return {
      provider: "",
      connected: false,
      apiKey: "",
      githubToken: "",
      baseUrl: "",
      chatBaseUrl: DEFAULT_GITHUB_MODELS_BASE_URL,
      defaultModel: "",
      accountLabel: "",
      lastVerifiedAt: "",
      lastVerification: null
    };
  }

  if (provider === "openai") {
    return {
      provider: "openai",
      connected: Boolean(openai.apiKey),
      apiKey: openai.apiKey,
      baseUrl: openai.baseUrl,
      defaultModel: openai.defaultModel || DEFAULT_OPENAI_MODEL,
      accountLabel: openai.accountLabel,
      lastVerifiedAt: openai.lastVerifiedAt,
      lastVerification: openai.lastVerification
    };
  }

  if (provider === "github-copilot") {
    return {
      provider: "github-copilot",
      connected: Boolean(githubCopilot.githubToken),
      githubToken: githubCopilot.githubToken,
      chatBaseUrl: DEFAULT_GITHUB_MODELS_BASE_URL,
      defaultModel: DEFAULT_GITHUB_MODELS_MODEL,
      accountLabel: githubCopilot.accountLabel || githubCopilot.accountLogin,
      accountLogin: githubCopilot.accountLogin,
      tokenType: githubCopilot.tokenType || detectGitHubTokenType(githubCopilot.githubToken),
      lastVerifiedAt: githubCopilot.lastVerifiedAt,
      lastVerification: githubCopilot.lastVerification
    };
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

export async function saveAccountSettings(provider, payload = {}) {
  const settings = await readRawSettings();

  if (provider === "openai") {
    const current = settings.providers.openai;
    const nextApiKey = safeString(payload.apiKey) || current.apiKey;
    if (!nextApiKey) {
      throw new Error("OpenAI API key is required.");
    }

    settings.providers.openai = {
      apiKey: nextApiKey,
      baseUrl: normalizeOpenAiBaseUrl(payload.baseUrl || current.baseUrl),
      defaultModel: safeString(payload.defaultModel) || current.defaultModel || DEFAULT_OPENAI_MODEL,
      accountLabel: `Key ${maskSecret(nextApiKey)}`,
      lastVerifiedAt: "",
      lastVerification: null
    };
    const saved = await writeRawSettings(settings);
    return buildPublicSettings(saved);
  }

  if (provider === "github-copilot") {
    const current = settings.providers.githubCopilot;
    const nextToken = safeString(payload.githubToken) || current.githubToken;
    if (!nextToken) {
      throw new Error("GitHub token is required.");
    }

    settings.providers.githubCopilot = {
      githubToken: nextToken,
      apiBaseUrl: normalizeGitHubApiBaseUrl(payload.apiBaseUrl || current.apiBaseUrl),
      accountLogin: current.accountLogin,
      accountLabel: current.accountLabel || `Token ${maskSecret(nextToken)}`,
      tokenType: detectGitHubTokenType(nextToken),
      copilotBillingStatus: "unknown",
      oauth: current.oauth,
      lastVerifiedAt: "",
      lastVerification: null
    };
    const saved = await writeRawSettings(settings);
    return buildPublicSettings(saved);
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

export async function testAccountSettings(provider, payload = {}) {
  const settings = await readRawSettings();

  if (provider === "openai") {
    const current = settings.providers.openai;
    const nextSettings = {
      apiKey: safeString(payload.apiKey) || current.apiKey,
      baseUrl: normalizeOpenAiBaseUrl(payload.baseUrl || current.baseUrl),
      defaultModel: safeString(payload.defaultModel) || current.defaultModel || DEFAULT_OPENAI_MODEL
    };

    let verification;
    try {
      verification = await verifyOpenAiProvider(nextSettings);
    } catch (error) {
      verification = {
        ok: false,
        tone: "error",
        message: safeString(error.message) || "Failed to verify OpenAI settings.",
        detail: "",
        checkedAt: new Date().toISOString()
      };
    }

    settings.providers.openai = {
      apiKey: nextSettings.apiKey,
      baseUrl: nextSettings.baseUrl,
      defaultModel: nextSettings.defaultModel,
      accountLabel: `Key ${maskSecret(nextSettings.apiKey)}`,
      lastVerifiedAt: verification.checkedAt,
      lastVerification: verification
    };

    const saved = await writeRawSettings(settings);
    return buildPublicSettings(saved);
  }

  if (provider === "github-copilot") {
    const current = settings.providers.githubCopilot;
    const nextSettings = {
      githubToken: safeString(payload.githubToken) || current.githubToken,
      apiBaseUrl: normalizeGitHubApiBaseUrl(payload.apiBaseUrl || current.apiBaseUrl)
    };
    const { provider: nextProvider } = await buildGitHubCopilotProviderState(current, nextSettings);
    settings.providers.githubCopilot = nextProvider;

    const saved = await writeRawSettings(settings);
    return buildPublicSettings(saved);
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

export async function disconnectAccountSettings(provider) {
  const settings = await readRawSettings();

  if (provider === "openai") {
    settings.providers.openai = createDefaultRawSettings().providers.openai;
    const saved = await writeRawSettings(settings);
    return buildPublicSettings(saved);
  }

  if (provider === "github-copilot") {
    settings.providers.githubCopilot = createDefaultRawSettings().providers.githubCopilot;
    const saved = await writeRawSettings(settings);
    return buildPublicSettings(saved);
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

export function buildGitHubOAuthCallbackRuntime(callbackUrl = "") {
  const normalizedUrl = safeString(callbackUrl);
  return {
    available: Boolean(normalizedUrl),
    callbackPath: GITHUB_OAUTH_CALLBACK_PATH,
    callbackUrl: normalizedUrl,
    hostedCallbackUrl: GITHUB_OAUTH_HOSTED_CALLBACK_URL
  };
}

export function buildGitHubOAuthCallbackUrl(origin) {
  const normalizedOrigin = safeString(origin).replace(/\/+$/, "");
  if (!normalizedOrigin) return "";
  return `${normalizedOrigin}${GITHUB_OAUTH_CALLBACK_PATH}`;
}

export function resolveGitHubOAuthClientConfig(overrides = {}) {
  const clientId = safeString(overrides.clientId || process.env.TREEMA_GITHUB_OAUTH_CLIENT_ID || process.env.GITHUB_OAUTH_CLIENT_ID);
  const clientSecret = safeString(
    overrides.clientSecret || process.env.TREEMA_GITHUB_OAUTH_CLIENT_SECRET || process.env.GITHUB_OAUTH_CLIENT_SECRET
  );
  const scope = safeString(overrides.scope || process.env.TREEMA_GITHUB_OAUTH_SCOPE || process.env.GITHUB_OAUTH_SCOPE) || DEFAULT_GITHUB_OAUTH_SCOPE;
  const callbackUrl =
    safeString(overrides.callbackUrl || process.env.TREEMA_GITHUB_OAUTH_CALLBACK_URL) || GITHUB_OAUTH_HOSTED_CALLBACK_URL;

  return {
    available: Boolean(clientId),
    clientId,
    clientSecret,
    canExchange: Boolean(clientId && clientSecret),
    scope,
    authorizeUrl: GITHUB_OAUTH_AUTHORIZE_URL,
    tokenUrl: GITHUB_OAUTH_TOKEN_URL,
    callbackUrl
  };
}

export function createGitHubOAuthPkceSession(options = {}) {
  const state = safeString(options.state);
  if (!state) {
    throw new Error("GitHub OAuth state is required to create a PKCE session.");
  }

  const issuedAt = safeString(options.issuedAt) || new Date().toISOString();
  const codeVerifier = safeString(options.codeVerifier) || randomBytes(32).toString("base64url");
  const payload = {
    version: GITHUB_OAUTH_PKCE_VERSION,
    state,
    codeVerifier,
    issuedAt
  };

  return {
    payload,
    cookieValue: encodeBase64Url(JSON.stringify(payload)),
    codeVerifier,
    codeChallenge: createSha256Base64Url(codeVerifier)
  };
}

export function decodeGitHubOAuthPkceSession(cookieValue = "") {
  const encoded = safeString(cookieValue);
  if (!encoded) {
    return { ok: false, error: "missing_pkce_cookie", payload: null };
  }

  let parsed;
  try {
    parsed = JSON.parse(decodeBase64Url(encoded));
  } catch {
    return { ok: false, error: "invalid_pkce_cookie", payload: null };
  }

  const version = Number(parsed?.version);
  const state = safeString(parsed?.state);
  const codeVerifier = safeString(parsed?.codeVerifier);
  const issuedAt = safeString(parsed?.issuedAt);
  const issuedAtMs = Date.parse(issuedAt);

  if (version !== GITHUB_OAUTH_PKCE_VERSION || !state || !codeVerifier) {
    return { ok: false, error: "invalid_pkce_payload", payload: null };
  }

  if (!Number.isFinite(issuedAtMs) || Date.now() - issuedAtMs > GITHUB_OAUTH_PKCE_MAX_AGE_SECONDS * 1000) {
    return { ok: false, error: "expired_pkce_cookie", payload: null };
  }

  return {
    ok: true,
    error: "",
    payload: {
      version,
      state,
      codeVerifier,
      issuedAt
    }
  };
}

export function createGitHubOAuthState(options = {}) {
  const target = isGitHubOAuthTarget(options.target) ? options.target : "web";
  const returnPath = normalizeGitHubOAuthReturnPath(options.returnPath) || DEFAULT_GITHUB_OAUTH_RETURN_PATH;
  const nonce = safeString(options.nonce) || randomBytes(16).toString("hex");
  const sessionHint = safeString(options.sessionHint) || randomBytes(8).toString("hex");
  const issuedAt = safeString(options.issuedAt) || new Date().toISOString();
  const payload = {
    version: GITHUB_OAUTH_STATE_VERSION,
    target,
    returnPath,
    nonce,
    sessionHint,
    issuedAt
  };

  return {
    payload,
    state: encodeBase64Url(JSON.stringify(payload))
  };
}

export function decodeGitHubOAuthState(stateValue) {
  const state = safeString(stateValue);
  if (!state) {
    return { ok: false, error: "missing_state", payload: null };
  }

  let parsed;
  try {
    parsed = JSON.parse(decodeBase64Url(state));
  } catch {
    return { ok: false, error: "invalid_state_encoding", payload: null };
  }

  const version = Number(parsed?.version);
  const target = safeString(parsed?.target);
  const returnPath = normalizeGitHubOAuthReturnPath(parsed?.returnPath);
  const nonce = safeString(parsed?.nonce);
  const sessionHint = safeString(parsed?.sessionHint);
  const issuedAt = safeString(parsed?.issuedAt);
  const issuedAtMs = Date.parse(issuedAt);

  if (version !== GITHUB_OAUTH_STATE_VERSION || !isGitHubOAuthTarget(target) || !returnPath || !nonce || !sessionHint) {
    return { ok: false, error: "invalid_state_payload", payload: null };
  }

  if (!Number.isFinite(issuedAtMs) || Date.now() - issuedAtMs > GITHUB_OAUTH_STATE_MAX_AGE_MS) {
    return { ok: false, error: "expired_state", payload: null };
  }

  return {
    ok: true,
    error: "",
    payload: {
      version,
      target,
      returnPath,
      nonce,
      sessionHint,
      issuedAt
    }
  };
}

export function buildGitHubOAuthAuthorizeUrl(state, overrides = {}) {
  const config = resolveGitHubOAuthClientConfig(overrides);
  if (!config.available) {
    throw new Error("GitHub OAuth client is not configured. Set TREEMA_GITHUB_OAUTH_CLIENT_ID.");
  }

  const url = new URL(config.authorizeUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.callbackUrl);
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("state", safeString(state));
  if (safeString(overrides.codeChallenge)) {
    url.searchParams.set("code_challenge", safeString(overrides.codeChallenge));
    url.searchParams.set("code_challenge_method", "S256");
  }
  return url.toString();
}

export function buildGitHubOAuthStartUrl(params = {}) {
  const url = new URL(GITHUB_OAUTH_START_URL);
  for (const [key, value] of Object.entries(params)) {
    if (safeString(value)) {
      url.searchParams.set(key, safeString(value));
    }
  }
  return url.toString();
}

export async function exchangeGitHubOAuthCode(params = {}, overrides = {}) {
  const code = safeString(params.code);
  if (!code) {
    throw new Error("GitHub callback arrived without an authorization code.");
  }

  const config = resolveGitHubOAuthClientConfig(overrides);
  if (!config.available) {
    throw new Error("GitHub OAuth client is not configured. Set TREEMA_GITHUB_OAUTH_CLIENT_ID.");
  }
  if (!config.canExchange) {
    throw new Error("GitHub OAuth client secret is not configured. Set TREEMA_GITHUB_OAUTH_CLIENT_SECRET.");
  }

  const form = new URLSearchParams();
  form.set("client_id", config.clientId);
  form.set("client_secret", config.clientSecret);
  form.set("code", code);
  form.set("redirect_uri", safeString(params.redirectUri || overrides.callbackUrl || config.callbackUrl));

  const codeVerifier = safeString(params.codeVerifier);
  if (codeVerifier) {
    form.set("code_verifier", codeVerifier);
  }

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form.toString()
  });
  const payload = await readJsonSafely(response);
  const accessToken = safeString(payload?.access_token);

  if (!response.ok || safeString(payload?.error) || !accessToken) {
    const detail = safeString(payload?.error_description || payload?.error || payload?.message);
    throw new Error(detail || `GitHub token exchange failed with status ${response.status}.`);
  }

  return {
    accessToken,
    tokenType: safeString(payload?.token_type) || "bearer",
    scope: safeString(payload?.scope)
  };
}

export function buildGitHubOAuthWebCompleteUrl(params = {}) {
  const url = new URL(`${GITHUB_OAUTH_APP_ORIGIN}/auth/complete`);
  for (const [key, value] of Object.entries(params)) {
    if (safeString(value)) {
      url.searchParams.set(key, safeString(value));
    }
  }
  return url.toString();
}

export function buildGitHubOAuthDesktopDeepLink(params = {}) {
  const url = new URL("treesma://auth/complete");
  for (const [key, value] of Object.entries(params)) {
    if (safeString(value)) {
      url.searchParams.set(key, safeString(value));
    }
  }
  return url.toString();
}

export async function startGitHubDesktopOAuthFlow(options = {}) {
  const settings = await readRawSettings();
  const current = settings.providers.githubCopilot;
  const { payload, state } = createGitHubOAuthState({
    target: "desktop",
    returnPath: options.returnPath || DEFAULT_GITHUB_OAUTH_RETURN_PATH
  });

  settings.providers.githubCopilot = {
    ...current,
    oauth: {
      ...current.oauth,
      pendingDesktopSession: payload
    }
  };

  await writeRawSettings(settings);

  return {
    authorizeUrl: buildGitHubOAuthStartUrl({ state }),
    state,
    session: payload
  };
}

export function createGitHubOAuthReceipt(params = {}) {
  const code = safeString(params.code);
  const state = safeString(params.state);
  const error = safeString(params.error);
  const errorDescription = safeString(params.error_description);
  const receivedAt = new Date().toISOString();

  if (error) {
    return {
      status: "error",
      message: `GitHub returned ${error}.`,
      codePreview: "",
      statePreview: maskSecret(state),
      error,
      errorDescription,
      receivedAt
    };
  }

  if (!code) {
    return {
      status: "error",
      message: "GitHub callback arrived without an authorization code.",
      codePreview: "",
      statePreview: maskSecret(state),
      error: "missing_code",
      errorDescription: "",
      receivedAt
    };
  }

  return {
    status: "success",
    message: "GitHub authorization code received.",
    codePreview: maskSecret(code),
    statePreview: maskSecret(state),
    error: "",
    errorDescription: "",
    receivedAt
  };
}

function createGitHubOAuthInvalidReceipt(state, message, errorCode) {
  return {
    status: "error",
    message,
    codePreview: "",
    statePreview: maskSecret(state),
    error: errorCode,
    errorDescription: "",
    receivedAt: new Date().toISOString()
  };
}

export async function recordGitHubOAuthCallback(params = {}, options = {}) {
  const settings = await readRawSettings();
  const receipt = createGitHubOAuthReceipt(params);
  const current = settings.providers.githubCopilot;

  settings.providers.githubCopilot = {
    ...current,
    oauth: {
      lastCallback: receipt
    }
  };

  const saved = await writeRawSettings(settings);
  return buildPublicSettings(saved, options).providers.githubCopilot.oauth;
}

export function createGitHubOAuthConnectedReceipt(params = {}) {
  const state = safeString(params.state);
  return {
    status: "success",
    message: safeString(params.message) || "GitHub token was exchanged and stored successfully.",
    codePreview: "",
    statePreview: maskSecret(state),
    error: "",
    errorDescription: "",
    receivedAt: new Date().toISOString()
  };
}

export async function connectGitHubOAuthToken(payload = {}, options = {}) {
  const accessToken = safeString(payload.accessToken || payload.access_token);
  if (!accessToken) {
    throw new Error("GitHub access token is required.");
  }

  const settings = await readRawSettings();
  const current = settings.providers.githubCopilot;
  const nextSettings = {
    githubToken: accessToken,
    apiBaseUrl: normalizeGitHubApiBaseUrl(payload.apiBaseUrl || current.apiBaseUrl)
  };
  const { provider: nextProvider, verification } = await buildGitHubCopilotProviderState(current, nextSettings);
  settings.providers.githubCopilot = {
    ...nextProvider,
    oauth: payload.oauthReceipt
      ? {
          ...current.oauth,
          lastCallback: sanitizeGithubOAuthReceipt(payload.oauthReceipt),
          pendingDesktopSession: current.oauth?.pendingDesktopSession ?? null
        }
      : nextProvider.oauth
  };
  const saved = await writeRawSettings(settings);

  return {
    settings: buildPublicSettings(saved, options),
    verification
  };
}

export async function completeGitHubDesktopOAuth(params = {}, options = {}) {
  const settings = await readRawSettings();
  const current = settings.providers.githubCopilot;
  const decoded = decodeGitHubOAuthState(params.state);
  const pendingSession = sanitizeGithubOAuthPendingSession(current.oauth?.pendingDesktopSession);
  let receipt = createGitHubOAuthReceipt(params);
  let shouldClearPendingSession = false;
  let accessToken = safeString(params.accessToken || params.access_token);

  if (!decoded.ok) {
    receipt = createGitHubOAuthInvalidReceipt(params.state, "GitHub desktop OAuth state is invalid or expired.", decoded.error);
  } else if (receipt.status !== "success") {
    receipt = createGitHubOAuthInvalidReceipt(params.state, receipt.message, receipt.error || "oauth_callback_error");
  } else if (decoded.payload.target !== "desktop") {
    receipt = createGitHubOAuthInvalidReceipt(params.state, "GitHub OAuth state target is not desktop.", "unexpected_state_target");
  } else if (
    !pendingSession ||
    pendingSession.nonce !== decoded.payload.nonce ||
    pendingSession.sessionHint !== decoded.payload.sessionHint
  ) {
    receipt = createGitHubOAuthInvalidReceipt(
      params.state,
      "GitHub desktop OAuth state did not match the pending local session.",
      "state_session_mismatch"
    );
  } else if (!accessToken && safeString(params.code)) {
    try {
      const exchanged = await exchangeGitHubOAuthCode(
        {
          code: params.code,
          redirectUri: options.githubOAuth?.callbackUrl
        },
        {
          callbackUrl: options.githubOAuth?.callbackUrl
        }
      );
      accessToken = exchanged.accessToken;
    } catch (error) {
      receipt = createGitHubOAuthInvalidReceipt(
        params.state,
        safeString(error.message) || "GitHub token exchange failed.",
        "token_exchange_failed"
      );
    }
  }

  let nextProvider = current;
  let completionMessage = receipt.message;

  if (receipt.status === "success" && !accessToken) {
    receipt = createGitHubOAuthInvalidReceipt(
      params.state,
      "GitHub desktop OAuth completed without an exchanged access token.",
      "missing_access_token"
    );
  } else {
    if (receipt.status === "success") {
      const nextSettings = {
        githubToken: accessToken,
        apiBaseUrl: current.apiBaseUrl
      };
      const built = await buildGitHubCopilotProviderState(current, nextSettings);
      nextProvider = {
        ...built.provider,
        oauth: {
          ...current.oauth,
          lastCallback: null,
          pendingDesktopSession: null
        }
      };
      shouldClearPendingSession = true;
      completionMessage =
        built.provider.lastVerification?.message || `Connected as ${built.provider.accountLogin || "GitHub user"}.`;
      receipt = createGitHubOAuthConnectedReceipt({
        state: params.state,
        message: completionMessage
      });
    }
  }

  settings.providers.githubCopilot =
    receipt.status === "success"
      ? {
          ...nextProvider,
          oauth: {
            ...nextProvider.oauth,
            lastCallback: receipt,
            pendingDesktopSession: null
          }
        }
      : {
          ...current,
          oauth: {
            ...current.oauth,
            lastCallback: receipt,
            pendingDesktopSession: shouldClearPendingSession ? null : current.oauth?.pendingDesktopSession ?? null
          }
        };

  const saved = await writeRawSettings(settings);
  return {
    oauth: buildPublicSettings(saved, options).providers.githubCopilot.oauth,
    completion: {
      ok: receipt.status === "success",
      error: receipt.error,
      message: receipt.message,
      accountLogin: settings.providers.githubCopilot.accountLogin
    }
  };
}

export function renderGitHubOAuthCallbackPage(receipt, callbackUrl = "") {
  const safeReceipt = sanitizeGithubOAuthReceipt(receipt);
  const title = safeReceipt?.status === "success" ? "GitHub Authorization Received" : "GitHub Authorization Failed";
  const tone = safeReceipt?.status === "success" ? "#1f6f43" : "#8a2f2f";
  const surface = safeReceipt?.status === "success" ? "#effaf3" : "#fff3f2";
  const details = [
    safeReceipt?.message ? `<li><strong>Status:</strong> ${escapeHtml(safeReceipt.message)}</li>` : "",
    safeReceipt?.codePreview ? `<li><strong>Code preview:</strong> ${escapeHtml(safeReceipt.codePreview)}</li>` : "",
    safeReceipt?.statePreview ? `<li><strong>State preview:</strong> ${escapeHtml(safeReceipt.statePreview)}</li>` : "",
    safeReceipt?.error ? `<li><strong>Error:</strong> ${escapeHtml(safeReceipt.error)}</li>` : "",
    safeReceipt?.errorDescription ? `<li><strong>Detail:</strong> ${escapeHtml(safeReceipt.errorDescription)}</li>` : "",
    safeReceipt?.receivedAt ? `<li><strong>Received at:</strong> ${escapeHtml(safeReceipt.receivedAt)}</li>` : "",
    callbackUrl ? `<li><strong>Callback URL:</strong> ${escapeHtml(callbackUrl)}</li>` : ""
  ]
    .filter(Boolean)
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Segoe UI", Helvetica, Arial, sans-serif;
      }
      body {
        margin: 0;
        background: #f4efe6;
        color: #1f2421;
      }
      main {
        max-width: 720px;
        margin: 64px auto;
        padding: 0 20px;
      }
      .card {
        background: #fffdf8;
        border: 1px solid #d7cfbf;
        border-radius: 20px;
        padding: 28px;
        box-shadow: 0 12px 30px rgba(49, 41, 30, 0.08);
      }
      .pill {
        display: inline-block;
        padding: 6px 10px;
        border-radius: 999px;
        background: ${surface};
        color: ${tone};
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      h1 {
        margin: 16px 0 8px;
        font-size: 30px;
        line-height: 1.1;
      }
      p {
        margin: 0 0 18px;
        line-height: 1.6;
      }
      ul {
        margin: 0 0 18px;
        padding-left: 20px;
        line-height: 1.7;
      }
      button {
        border: 0;
        border-radius: 999px;
        padding: 11px 18px;
        font: inherit;
        background: #1f2421;
        color: #fffdf8;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <main>
      <article class="card">
        <span class="pill">${safeReceipt?.status === "success" ? "Success" : "Attention"}</span>
        <h1>${escapeHtml(title)}</h1>
        <p>TreeMA received the GitHub OAuth callback and stored masked receipt metadata in local settings outside the workspace.</p>
        <ul>${details}</ul>
        <button type="button" onclick="window.close()">Close this window</button>
      </article>
    </main>
  </body>
</html>
`;
}
