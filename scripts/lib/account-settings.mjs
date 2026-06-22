import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  CHATGPT_CODEX_CLIENT_ID,
  CHATGPT_CODEX_DEFAULT_MODEL,
  CHATGPT_CODEX_PROVIDER,
  buildChatGptCodexAuthorizeUrl,
  exchangeChatGptCodexOAuthCode,
  extractChatGptCodexAccountInfo,
  normalizeChatGptCodexModel,
  refreshChatGptCodexOAuthToken,
  runChatGptCodexRequest,
  shouldRefreshChatGptCodexToken
} from "./chatgpt-codex.mjs";
import { loadRepoEnvFiles } from "./env-loader.mjs";
import { DEFAULT_GITHUB_MODELS_MODEL, resolveAccessibleGitHubModel } from "./github-models.mjs";
import { buildDesktopOAuthDeepLink, OAUTH_HANDOFF_PROVIDERS } from "./oauth-handoff-contract.js";

const SETTINGS_VERSION = 1;
const DEFAULT_ANALYSIS_PROVIDER = "auto";
const SUPPORTED_ANALYSIS_PROVIDERS = ["auto", "openai", "github-copilot", CHATGPT_CODEX_PROVIDER];
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";
const DEFAULT_GITHUB_API_BASE_URL = "https://api.github.com";
const DEFAULT_GITHUB_MODELS_BASE_URL = "https://models.github.ai/inference";
const GITHUB_API_VERSION = "2022-11-28";
export const GITHUB_OAUTH_CALLBACK_PATH = "/auth/github/callback";
export const GITHUB_OAUTH_DESKTOP_PORT = 48152;
export const GITHUB_OAUTH_HOSTED_CALLBACK_URL = "https://treesma.com/auth/github/callback";
export const GITHUB_OAUTH_APP_ORIGIN = "https://app.treesma.com";
export const GITHUB_OAUTH_START_URL = "https://treesma.com/api/auth/github/start";
export const GITHUB_OAUTH_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
export const GITHUB_OAUTH_TOKEN_URL = "https://github.com/login/oauth/access_token";
export const OPENAI_OAUTH_LOCAL_PORT = 1455;
export const OPENAI_OAUTH_CALLBACK_PATH = "/auth/callback";
export const OPENAI_OAUTH_HOSTED_CALLBACK_URL = "https://treesma.com/auth/openai/callback";
export const OPENAI_OAUTH_START_URL = "https://treesma.com/api/auth/openai/start";
const DEFAULT_GITHUB_OAUTH_SCOPE = "read:user user:email";
const DEFAULT_GITHUB_OAUTH_RETURN_PATH = "/settings/accounts";
const GITHUB_OAUTH_STATE_VERSION = 1;
const GITHUB_OAUTH_STATE_MAX_AGE_MS = 15 * 60 * 1000;
const GITHUB_OAUTH_PKCE_VERSION = 1;
const GITHUB_OAUTH_PKCE_MAX_AGE_SECONDS = 15 * 60;
const OPENAI_OAUTH_STATE_VERSION = 1;
const OPENAI_OAUTH_STATE_MAX_AGE_MS = 15 * 60 * 1000;
const OPENAI_OAUTH_PKCE_VERSION = 1;
const OPENAI_OAUTH_PKCE_MAX_AGE_SECONDS = 15 * 60;
const OPENAI_OAUTH_PENDING_SESSION_FIELD = "pendingSession";
const OPENAI_OAUTH_LEGACY_PENDING_SESSION_FIELD = "pendingDesktopSession";

loadRepoEnvFiles();

class AccountSettingsError extends Error {
  constructor(message, { code = "ACCOUNT_SETTINGS_ERROR", statusCode = 400, details = null } = {}) {
    super(message);
    this.name = "AccountSettingsError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

class AccountSettingsRequestError extends AccountSettingsError {
  constructor(message, details = null) {
    super(message, {
      code: "ACCOUNT_SETTINGS_REQUEST_INVALID",
      statusCode: 400,
      details
    });
    this.name = "AccountSettingsRequestError";
  }
}

class AccountSettingsContractError extends AccountSettingsError {
  constructor(message, details = null) {
    super(message, {
      code: "ACCOUNT_SETTINGS_CONTRACT_INVALID",
      statusCode: 409,
      details
    });
    this.name = "AccountSettingsContractError";
  }
}

function resolveAccountSettingsStorage() {
  if (Object.prototype.hasOwnProperty.call(process.env, "TREEMA_SETTINGS_HOME")) {
    const settingsHome = safeString(process.env.TREEMA_SETTINGS_HOME);
    if (!settingsHome) {
      throw new Error("TREEMA_SETTINGS_HOME must not be empty when set.");
    }
    const home = path.resolve(settingsHome);
    const dir = path.join(home, ".treema", "settings");
    return {
      home,
      dir,
      file: path.join(dir, "accounts.json")
    };
  }

  const home = os.homedir();
  const dir = path.join(home, ".treema", "settings");
  return {
    home,
    dir,
    file: path.join(dir, "accounts.json")
  };
}

function safeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function hasOwn(value, key) {
  return Boolean(value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key));
}

function isValidTimestamp(value) {
  const normalized = safeString(value);
  return Boolean(normalized) && Number.isFinite(Date.parse(normalized));
}

function getProviderDisplayName(provider) {
  if (provider === "openai") return "OpenAI";
  if (provider === "github-copilot") return "GitHub Copilot";
  if (provider === CHATGPT_CODEX_PROVIDER) return "ChatGPT Codex OAuth";
  return "Project Scan provider";
}

function joinReasonParts(...parts) {
  return parts.flat().map((part) => safeString(part)).filter(Boolean).join(" ");
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
  const checkedAt = safeString(value.checkedAt);
  if (!message || !isValidTimestamp(checkedAt)) return null;
  return {
    ok: value.ok === true,
    tone: value.tone === "error" || value.tone === "warning" ? value.tone : "success",
    message,
    detail: safeString(value.detail),
    checkedAt,
    ...(typeof value.scanReady === "boolean" ? { scanReady: value.scanReady } : {}),
    ...(safeString(value.scanModel) ? { scanModel: safeString(value.scanModel) } : {})
  };
}

function sanitizeGithubOAuthReceipt(value) {
  if (!value || typeof value !== "object") return null;
  const status = value.status === "success" ? "success" : "error";
  const receivedAt = safeString(value.receivedAt);
  if (!isValidTimestamp(receivedAt)) return null;
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

function isAnalysisProvider(value) {
  return value === "auto" || value === "openai" || value === "github-copilot" || value === CHATGPT_CODEX_PROVIDER;
}

function normalizeAnalysisProvider(value) {
  const normalized = safeString(value);
  return isAnalysisProvider(normalized) ? normalized : DEFAULT_ANALYSIS_PROVIDER;
}

function parseStoredAnalysisProvider(value) {
  const normalized = safeString(value);
  if (!normalized) return DEFAULT_ANALYSIS_PROVIDER;
  if (isAnalysisProvider(normalized)) {
    return normalized;
  }
  throw new AccountSettingsContractError(
    `defaultAnalysisProvider \"${normalized}\" is no longer supported. Use one of: ${SUPPORTED_ANALYSIS_PROVIDERS.join(", ")}.`,
    {
      field: "defaultAnalysisProvider",
      value: normalized,
      supportedValues: SUPPORTED_ANALYSIS_PROVIDERS
    }
  );
}

function parseRequestedAnalysisProvider(value) {
  const normalized = safeString(value);
  if (isAnalysisProvider(normalized)) {
    return normalized;
  }
  throw new AccountSettingsRequestError(
    `defaultAnalysisProvider must be one of: ${SUPPORTED_ANALYSIS_PROVIDERS.join(", ")}.`,
    {
      field: "defaultAnalysisProvider",
      value: normalized,
      supportedValues: SUPPORTED_ANALYSIS_PROVIDERS
    }
  );
}

function normalizeGitHubOAuthReturnPath(value) {
  const normalized = safeString(value);
  if (!normalized.startsWith("/")) return "";
  if (normalized.startsWith("//")) return "";
  if (normalized.includes("://") || normalized.includes("\\") || normalized.includes("..")) return "";
  return normalized;
}

function normalizeOpenAiOAuthReturnPath(value) {
  return normalizeGitHubOAuthReturnPath(value);
}

function normalizeLocalBridgeUrl(value) {
  const normalized = safeString(value);
  if (!normalized) return "";

  try {
    const url = new URL(normalized);
    const protocolOk = url.protocol === "http:" || url.protocol === "https:";
    const hostOk =
      url.hostname === "127.0.0.1" ||
      url.hostname === "localhost" ||
      url.hostname === "[::1]" ||
      url.hostname === "::1";
    return protocolOk && hostOk ? url.toString() : "";
  } catch {
    return "";
  }
}

function sanitizeGithubOAuthPendingSession(value) {
  if (!value || typeof value !== "object") return null;
  const target = safeString(value.target);
  const returnPath = normalizeGitHubOAuthReturnPath(value.returnPath);
  const nonce = safeString(value.nonce);
  const sessionHint = safeString(value.sessionHint);
  const issuedAt = safeString(value.issuedAt);

  if (!isGitHubOAuthTarget(target) || !returnPath || !nonce || !sessionHint || !isValidTimestamp(issuedAt)) {
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

function sanitizeOpenAiOAuthPendingSession(value) {
  if (!value || typeof value !== "object") return null;
  const target = safeString(value.target);
  const returnPath = normalizeOpenAiOAuthReturnPath(value.returnPath);
  const nonce = safeString(value.nonce);
  const sessionHint = safeString(value.sessionHint);
  const codeVerifier = safeString(value.codeVerifier);
  const issuedAt = safeString(value.issuedAt);

  if (!isGitHubOAuthTarget(target) || !returnPath || !nonce || !sessionHint || !codeVerifier || !isValidTimestamp(issuedAt)) {
    return null;
  }

  return {
    target,
    returnPath,
    nonce,
    sessionHint,
    codeVerifier,
    issuedAt
  };
}

function resolveOpenAiOAuthPendingSessionField(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  if (hasOwn(value, OPENAI_OAUTH_PENDING_SESSION_FIELD)) return OPENAI_OAUTH_PENDING_SESSION_FIELD;
  if (hasOwn(value, OPENAI_OAUTH_LEGACY_PENDING_SESSION_FIELD)) return OPENAI_OAUTH_LEGACY_PENDING_SESSION_FIELD;
  return "";
}

function resolveOpenAiOAuthPendingSessionValue(value) {
  const field = resolveOpenAiOAuthPendingSessionField(value);
  return field ? value[field] : null;
}

function sanitizeStoredOpenAiOAuthPendingSession(value) {
  return sanitizeOpenAiOAuthPendingSession(resolveOpenAiOAuthPendingSessionValue(value));
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
    defaultAnalysisProvider: DEFAULT_ANALYSIS_PROVIDER,
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
      },
      chatgptCodex: {
        accessToken: "",
        refreshToken: "",
        expiresAt: 0,
        accountId: "",
        accountEmail: "",
        accountLabel: "",
        defaultModel: CHATGPT_CODEX_DEFAULT_MODEL,
        oauth: {
          lastCallback: null,
          pendingSession: null
        },
        lastVerifiedAt: "",
        lastVerification: null
      }
    }
  };
}

function validateStoredVerification(provider, rawProvider = {}, sanitizedProvider = {}) {
  const displayName = getProviderDisplayName(provider);
  const verificationField = `providers.${provider}.lastVerification`;
  const timestampField = `providers.${provider}.lastVerifiedAt`;
  const rawLastVerifiedAt = safeString(rawProvider?.lastVerifiedAt);
  const hasRawVerification = hasOwn(rawProvider, "lastVerification") && rawProvider.lastVerification !== null;
  const verification = sanitizedProvider.lastVerification;

  if (rawLastVerifiedAt && !isValidTimestamp(rawLastVerifiedAt)) {
    throw new AccountSettingsContractError(`${displayName} verification timestamp is invalid. Remove and re-test this provider.`, {
      provider,
      field: timestampField
    });
  }

  if (hasRawVerification && !verification) {
    throw new AccountSettingsContractError(`${displayName} verification metadata is malformed. Remove and re-test this provider.`, {
      provider,
      field: verificationField
    });
  }

  if (verification && !rawLastVerifiedAt) {
    throw new AccountSettingsContractError(`${displayName} verification metadata is stale. Remove and re-test this provider.`, {
      provider,
      field: timestampField
    });
  }

  if (rawLastVerifiedAt && !verification) {
    throw new AccountSettingsContractError(`${displayName} verification metadata is stale. Remove and re-test this provider.`, {
      provider,
      field: verificationField
    });
  }

  if (verification && rawLastVerifiedAt && verification.checkedAt !== rawLastVerifiedAt) {
    throw new AccountSettingsContractError(`${displayName} verification metadata is stale. Remove and re-test this provider.`, {
      provider,
      field: verificationField,
      checkedAt: verification.checkedAt,
      lastVerifiedAt: rawLastVerifiedAt
    });
  }
}

function validateStoredOAuthState(provider, rawProvider = {}, sanitizedProvider = {}) {
  const displayName = getProviderDisplayName(provider);
  const rawOauth = rawProvider?.oauth;
  const sanitizedOauth = sanitizedProvider?.oauth || {};

  if (hasOwn(rawProvider, "oauth") && rawOauth !== null && (!rawOauth || typeof rawOauth !== "object" || Array.isArray(rawOauth))) {
    throw new AccountSettingsContractError(`${displayName} OAuth state is malformed. Disconnect and reconnect this provider.`, {
      provider,
      field: `providers.${provider}.oauth`
    });
  }

  if (!rawOauth || typeof rawOauth !== "object") {
    return;
  }

  if (hasOwn(rawOauth, "lastCallback") && rawOauth.lastCallback !== null && !sanitizedOauth.lastCallback) {
    throw new AccountSettingsContractError(`${displayName} OAuth receipt is stale or malformed. Disconnect and reconnect this provider.`, {
      provider,
      field: `providers.${provider}.oauth.lastCallback`
    });
  }

  const pendingSessionField =
    provider === CHATGPT_CODEX_PROVIDER ? resolveOpenAiOAuthPendingSessionField(rawOauth) : "pendingDesktopSession";
  const rawPendingSession =
    provider === CHATGPT_CODEX_PROVIDER ? resolveOpenAiOAuthPendingSessionValue(rawOauth) : rawOauth.pendingDesktopSession;
  const sanitizedPendingSession =
    provider === CHATGPT_CODEX_PROVIDER ? sanitizedOauth.pendingSession : sanitizedOauth.pendingDesktopSession;

  if (pendingSessionField && rawPendingSession !== null && rawPendingSession !== undefined && !sanitizedPendingSession) {
    throw new AccountSettingsContractError(`${displayName} OAuth pending session is stale or malformed. Restart the OAuth flow for this provider.`, {
      provider,
      field: `providers.${provider}.oauth.${pendingSessionField}`
    });
  }
}

function isVerificationScanReady(verification) {
  if (!verification) return false;
  if (verification.ok !== true) return false;
  if (verification.scanReady === false) return false;
  return true;
}

function deriveProviderLifecycleState(provider, { connected, scanReady, lastVerification, oauth = null }) {
  const hasPendingSession =
    provider === CHATGPT_CODEX_PROVIDER ? Boolean(oauth?.pendingSession) : Boolean(oauth?.pendingDesktopSession);
  if (hasPendingSession) return "oauth-pending";
  if (!connected && oauth?.lastCallback?.status === "error") return "oauth-failed";
  if (!connected) return "disconnected";
  if (!lastVerification) return "saved";
  if (scanReady) return "scan-ready";
  if (lastVerification.ok === true) return "verified";
  return "needs-attention";
}

function buildProviderBlockedReason(provider, { connected, lastVerification }) {
  const displayName = getProviderDisplayName(provider);
  if (!connected) {
    return `${displayName} is disconnected. Connect and verify ${displayName} or switch the default provider back to auto.`;
  }
  if (!lastVerification) {
    return `${displayName} is saved but not scan-ready yet. Run Save + Test or switch the default provider back to auto.`;
  }
  return (
    joinReasonParts(lastVerification.message, lastVerification.detail) ||
    `${displayName} is connected, but Project Scan cannot use it yet.`
  );
}

function buildOpenAiReadiness(openai) {
  const connected = Boolean(openai.apiKey);
  const scanReady = connected && isVerificationScanReady(openai.lastVerification);
  return {
    provider: "openai",
    connected,
    scanReady,
    state: deriveProviderLifecycleState("openai", {
      connected,
      scanReady,
      lastVerification: openai.lastVerification
    }),
    blockedReason: scanReady ? "" : buildProviderBlockedReason("openai", { connected, lastVerification: openai.lastVerification })
  };
}

function buildGitHubCopilotReadiness(githubCopilot) {
  const connected = Boolean(githubCopilot.githubToken);
  const scanReady = connected && isVerificationScanReady(githubCopilot.lastVerification);
  return {
    provider: "github-copilot",
    connected,
    scanReady,
    state: deriveProviderLifecycleState("github-copilot", {
      connected,
      scanReady,
      lastVerification: githubCopilot.lastVerification,
      oauth: githubCopilot.oauth
    }),
    blockedReason: scanReady
      ? ""
      : buildProviderBlockedReason("github-copilot", { connected, lastVerification: githubCopilot.lastVerification })
  };
}

function buildChatGptCodexReadiness(chatgptCodex) {
  const connected = Boolean(chatgptCodex.accessToken);
  const scanReady = connected && isVerificationScanReady(chatgptCodex.lastVerification);
  return {
    provider: CHATGPT_CODEX_PROVIDER,
    connected,
    scanReady,
    state: deriveProviderLifecycleState(CHATGPT_CODEX_PROVIDER, {
      connected,
      scanReady,
      lastVerification: chatgptCodex.lastVerification,
      oauth: chatgptCodex.oauth
    }),
    blockedReason: scanReady
      ? ""
      : buildProviderBlockedReason(CHATGPT_CODEX_PROVIDER, { connected, lastVerification: chatgptCodex.lastVerification })
  };
}

function buildAnalysisProviderSummary(settings) {
  const readiness = {
    openai: buildOpenAiReadiness(settings.providers.openai),
    githubCopilot: buildGitHubCopilotReadiness(settings.providers.githubCopilot),
    chatgptCodex: buildChatGptCodexReadiness(settings.providers.chatgptCodex)
  };
  const fallbackOrder = ["openai", "github-copilot", CHATGPT_CODEX_PROVIDER];
  const requestedProvider = settings.defaultAnalysisProvider;

  if (requestedProvider !== DEFAULT_ANALYSIS_PROVIDER) {
    const selected =
      requestedProvider === "openai"
        ? readiness.openai
        : requestedProvider === "github-copilot"
          ? readiness.githubCopilot
          : readiness.chatgptCodex;
    return {
      requestedProvider,
      activeProvider: selected.scanReady ? selected.provider : "",
      available: selected.scanReady,
      blockedReason: selected.scanReady ? "" : selected.blockedReason,
      selectionMode: "explicit",
      fallbackOrder
    };
  }

  const selected = [readiness.openai, readiness.githubCopilot, readiness.chatgptCodex].find((candidate) => candidate.scanReady);
  if (selected) {
    return {
      requestedProvider,
      activeProvider: selected.provider,
      available: true,
      blockedReason: "",
      selectionMode: "auto",
      fallbackOrder
    };
  }

  return {
    requestedProvider,
    activeProvider: "",
    available: false,
    blockedReason: "Project Scan requires a scan-ready OpenAI, GitHub Copilot, or ChatGPT Codex provider.",
    selectionMode: "auto",
    fallbackOrder
  };
}

function sanitizeRawSettings(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AccountSettingsContractError("Account settings must be stored as one JSON object.", {
      field: "root"
    });
  }

  if (hasOwn(raw, "providers") && (!raw.providers || typeof raw.providers !== "object" || Array.isArray(raw.providers))) {
    throw new AccountSettingsContractError("Account settings providers must be stored as one JSON object.", {
      field: "providers"
    });
  }

  const defaults = createDefaultRawSettings();
  const providers = raw?.providers ?? {};
  const openai = providers.openai ?? {};
  const githubCopilot = providers.githubCopilot ?? {};
  const chatgptCodex = providers.chatgptCodex ?? {};

  for (const [providerKey, providerValue] of Object.entries({
    openai,
    githubCopilot,
    chatgptCodex
  })) {
    if (providerValue !== null && (!providerValue || typeof providerValue !== "object" || Array.isArray(providerValue))) {
      throw new AccountSettingsContractError(`${getProviderDisplayName(providerKey === "chatgptCodex" ? CHATGPT_CODEX_PROVIDER : providerKey === "githubCopilot" ? "github-copilot" : "openai")} settings are malformed.`, {
        field: `providers.${providerKey}`
      });
    }
  }

  const sanitized = {
    version: SETTINGS_VERSION,
    updatedAt: safeString(raw?.updatedAt),
    defaultAnalysisProvider: parseStoredAnalysisProvider(raw?.defaultAnalysisProvider),
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
      },
      chatgptCodex: {
        accessToken: safeString(chatgptCodex.accessToken),
        refreshToken: safeString(chatgptCodex.refreshToken),
        expiresAt: Number.isFinite(Number(chatgptCodex.expiresAt)) ? Number(chatgptCodex.expiresAt) : 0,
        accountId: safeString(chatgptCodex.accountId),
        accountEmail: safeString(chatgptCodex.accountEmail),
        accountLabel: safeString(chatgptCodex.accountLabel),
        defaultModel: safeString(chatgptCodex.defaultModel) || CHATGPT_CODEX_DEFAULT_MODEL,
        oauth: {
          lastCallback: sanitizeGithubOAuthReceipt(chatgptCodex.oauth?.lastCallback),
          pendingSession: sanitizeStoredOpenAiOAuthPendingSession(chatgptCodex.oauth)
        },
        lastVerifiedAt: safeString(chatgptCodex.lastVerifiedAt),
        lastVerification: sanitizeVerification(chatgptCodex.lastVerification)
      }
    }
  };

  validateStoredVerification("openai", openai, sanitized.providers.openai);
  validateStoredVerification("github-copilot", githubCopilot, sanitized.providers.githubCopilot);
  validateStoredVerification(CHATGPT_CODEX_PROVIDER, chatgptCodex, sanitized.providers.chatgptCodex);
  validateStoredOAuthState("github-copilot", githubCopilot, sanitized.providers.githubCopilot);
  validateStoredOAuthState(CHATGPT_CODEX_PROVIDER, chatgptCodex, sanitized.providers.chatgptCodex);

  return sanitized;
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

function normalizeOpenAiOAuthRuntime(value = {}) {
  const callbackPath = safeString(value.callbackPath) || OPENAI_OAUTH_CALLBACK_PATH;
  const callbackUrl = safeString(value.callbackUrl);
  const hostedCallbackUrl = safeString(value.hostedCallbackUrl) || OPENAI_OAUTH_HOSTED_CALLBACK_URL;
  return {
    available: Boolean(value.available && callbackUrl),
    callbackPath,
    callbackUrl,
    hostedCallbackUrl,
    clientId: safeString(value.clientId) || CHATGPT_CODEX_CLIENT_ID
  };
}

function buildPublicSettings(raw, options = {}) {
  const settings = sanitizeRawSettings(raw);
  const openai = settings.providers.openai;
  const githubCopilot = settings.providers.githubCopilot;
  const githubOAuth = normalizeGitHubOAuthRuntime(options.githubOAuth);
  const openaiOAuth = normalizeOpenAiOAuthRuntime(options.openaiOAuth);
  const chatgptCodex = settings.providers.chatgptCodex;
  const openaiReadiness = buildOpenAiReadiness(openai);
  const githubCopilotReadiness = buildGitHubCopilotReadiness(githubCopilot);
  const chatgptCodexReadiness = buildChatGptCodexReadiness(chatgptCodex);
  const analysisProvider = buildAnalysisProviderSummary(settings);
  const { file: storagePath } = resolveAccountSettingsStorage();

  return {
    version: settings.version,
    updatedAt: settings.updatedAt,
    defaultAnalysisProvider: settings.defaultAnalysisProvider,
    analysisProvider,
    storagePath,
    providers: {
      openai: {
        connected: openaiReadiness.connected,
        scanReady: openaiReadiness.scanReady,
        state: openaiReadiness.state,
        blockedReason: openaiReadiness.scanReady ? "" : openaiReadiness.blockedReason,
        secretPreview: maskSecret(openai.apiKey),
        baseUrl: openai.baseUrl,
        defaultModel: openai.defaultModel,
        accountLabel: openai.accountLabel || (openai.apiKey ? `Key ${maskSecret(openai.apiKey)}` : ""),
        lastVerifiedAt: openai.lastVerifiedAt,
        lastVerification: openai.lastVerification
      },
      githubCopilot: {
        connected: githubCopilotReadiness.connected,
        scanReady: githubCopilotReadiness.scanReady,
        state: githubCopilotReadiness.state,
        blockedReason: githubCopilotReadiness.scanReady ? "" : githubCopilotReadiness.blockedReason,
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
      },
      chatgptCodex: {
        connected: chatgptCodexReadiness.connected,
        scanReady: chatgptCodexReadiness.scanReady,
        state: chatgptCodexReadiness.state,
        blockedReason: chatgptCodexReadiness.scanReady ? "" : chatgptCodexReadiness.blockedReason,
        secretPreview: maskSecret(chatgptCodex.accessToken),
        expiresAt: chatgptCodex.expiresAt,
        accountId: chatgptCodex.accountId,
        accountEmail: chatgptCodex.accountEmail,
        accountLabel:
          chatgptCodex.accountLabel ||
          chatgptCodex.accountEmail ||
          (chatgptCodex.accountId ? `ChatGPT ${chatgptCodex.accountId.slice(0, 8)}` : ""),
        defaultModel: chatgptCodex.defaultModel,
        oauth: {
          available: openaiOAuth.available,
          callbackPath: openaiOAuth.callbackPath,
          callbackUrl: openaiOAuth.callbackUrl,
          hostedCallbackUrl: openaiOAuth.hostedCallbackUrl,
          webAppOrigin: GITHUB_OAUTH_APP_ORIGIN,
          clientId: openaiOAuth.clientId,
          lastCallback: chatgptCodex.oauth.lastCallback
        },
        lastVerifiedAt: chatgptCodex.lastVerifiedAt,
        lastVerification: chatgptCodex.lastVerification
      }
    }
  };
}

async function ensureSettingsDir() {
  const { dir } = resolveAccountSettingsStorage();
  await mkdir(dir, { recursive: true, mode: 0o700 });
}

async function readRawSettings() {
  const { file } = resolveAccountSettingsStorage();
  try {
    const content = await readFile(file, "utf8");
    return sanitizeRawSettings(JSON.parse(content));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return createDefaultRawSettings();
    }
    if (error instanceof SyntaxError) {
      throw new AccountSettingsContractError("Account settings contain invalid JSON. Fix or remove the accounts.json file and try again.", {
        field: file
      });
    }
    throw error;
  }
}

async function writeRawSettings(nextSettings) {
  const { file } = resolveAccountSettingsStorage();
  await ensureSettingsDir();
  const payload = sanitizeRawSettings({
    ...nextSettings,
    updatedAt: new Date().toISOString()
  });
  const tempPath = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  await rename(tempPath, file);
  try {
    await chmod(file, 0o600);
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

  let billingVerification = {
    detail: "",
    copilotBillingStatus: "unverified"
  };

  const usageResponse = await fetch(`${apiBaseUrl}/users/${accountLogin}/settings/billing/premium_request/usage`, {
    headers
  });

  if (usageResponse.ok) {
    const usagePayload = await readJsonSafely(usageResponse);
    const usageItems = Array.isArray(usagePayload?.usageItems) ? usagePayload.usageItems : [];
    const copilotLines = usageItems.filter((item) => /copilot/i.test(`${item?.product || ""} ${item?.sku || ""}`));
    billingVerification = {
      detail: copilotLines.length
        ? `${copilotLines.length} Copilot premium-request usage rows were returned.`
        : "The billing endpoint responded, but there are no Copilot usage rows yet.",
    };
    billingVerification.copilotBillingStatus = "verified";
  } else {
    const usagePayload = await readJsonSafely(usageResponse);
    billingVerification = {
      detail: extractGitHubError(
        usagePayload,
        "The token may lack Plan read permission, or this account may not expose the billing endpoint."
      ),
      copilotBillingStatus: "unverified"
    };
  }

  try {
    const access = await resolveAccessibleGitHubModel(githubToken, DEFAULT_GITHUB_MODELS_MODEL);
    return {
      ok: true,
      tone: "success",
      message: `Connected as ${accountLogin}. Project Scan can use ${access.model}.`,
      detail: billingVerification.detail,
      checkedAt: new Date().toISOString(),
      accountLogin,
      accountLabel,
      tokenType,
      copilotBillingStatus: billingVerification.copilotBillingStatus,
      scanReady: true,
      scanModel: access.model
    };
  } catch (error) {
    if (error?.code === "GITHUB_MODEL_ACCESS_UNAVAILABLE") {
      return {
        ok: false,
        tone: "error",
        message: `Connected as ${accountLogin}, but Project Scan cannot use this token.`,
        detail: `${error.message} Connect OpenAI instead, or save a GitHub OAuth user token, GitHub App user token, or fine-grained PAT with model access.`,
        checkedAt: new Date().toISOString(),
        accountLogin,
        accountLabel,
        tokenType,
        copilotBillingStatus: billingVerification.copilotBillingStatus,
        scanReady: false
      };
    }

    if (error?.code === "GITHUB_MODEL_ACCESS_RATE_LIMITED") {
      return {
        ok: false,
        tone: "warning",
        message: `Connected as ${accountLogin}, but GitHub model access could not be confirmed right now.`,
        detail: `${error.message} Retry Save + Test or run Quick Scan in the meantime.`,
        checkedAt: new Date().toISOString(),
        accountLogin,
        accountLabel,
        tokenType,
        copilotBillingStatus: billingVerification.copilotBillingStatus
      };
    }

    throw error;
  }
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
        checkedAt: verification.checkedAt,
        ...(typeof verification.scanReady === "boolean" ? { scanReady: verification.scanReady } : {}),
        ...(safeString(verification.scanModel) ? { scanModel: safeString(verification.scanModel) } : {})
      }
    }
  };
}

async function ensureChatGptCodexProviderTokens(providerSettings) {
  const current = {
    accessToken: safeString(providerSettings.accessToken),
    refreshToken: safeString(providerSettings.refreshToken),
    expiresAt: Number(providerSettings.expiresAt) || 0,
    accountId: safeString(providerSettings.accountId),
    accountEmail: safeString(providerSettings.accountEmail),
    accountLabel: safeString(providerSettings.accountLabel),
    defaultModel: safeString(providerSettings.defaultModel) || CHATGPT_CODEX_DEFAULT_MODEL
  };

  if (!current.accessToken) {
    throw new Error("ChatGPT Codex OAuth access token is required.");
  }

  if (!shouldRefreshChatGptCodexToken(current.expiresAt)) {
    return current;
  }

  if (!current.refreshToken) {
    throw new Error("ChatGPT Codex OAuth refresh token is missing or expired.");
  }

  const refreshed = await refreshChatGptCodexOAuthToken(current.refreshToken);
  const accountInfo = extractChatGptCodexAccountInfo({
    accessToken: refreshed.accessToken,
    idToken: refreshed.idToken
  });

  return {
    ...current,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAt: refreshed.expiresAt,
    accountId: accountInfo.accountId || current.accountId,
    accountEmail: accountInfo.accountEmail || current.accountEmail,
    accountLabel: accountInfo.accountLabel || current.accountLabel
  };
}

async function verifyChatGptCodexProvider(settings) {
  const providerSettings = await ensureChatGptCodexProviderTokens(settings);
  const accountId = safeString(providerSettings.accountId);
  const modelSelection = normalizeChatGptCodexModel(providerSettings.defaultModel);
  const defaultModel = modelSelection.model;

  if (!accountId) {
    throw new Error("ChatGPT Codex OAuth token did not include a ChatGPT account id.");
  }

  const result = await runChatGptCodexRequest({
    accessToken: providerSettings.accessToken,
    accountId,
    model: defaultModel,
    instructions: "Return exactly one compact JSON object and nothing else.",
    inputText: 'Return exactly {"ok":true}.'
  });

  const verificationText = safeString(result.text);
  const strictVerificationOk = verificationText.includes('"ok":true') || verificationText.includes('"ok": true');
  const requestAccepted = Boolean(result.response?.ok && (verificationText || result.rawText || result.parsedPayload));
  const verificationOk = strictVerificationOk || requestAccepted;

  return {
    providerSettings,
    verification: {
      ok: verificationOk,
      tone:
        modelSelection.usedFallback || !strictVerificationOk
          ? "warning"
          : verificationOk
            ? "success"
            : "warning",
      message: verificationOk
        ? modelSelection.usedFallback
          ? `Connected. ${modelSelection.requestedModel} is not a Codex model, so TreeMA switched this provider to ${defaultModel}.`
          : strictVerificationOk
            ? `Connected. ${defaultModel} responded through ChatGPT OAuth.`
            : `Connected. ${defaultModel} accepted requests through ChatGPT OAuth, but the verification payload was not strict JSON.`
        : `Connected, but ${defaultModel} returned an unexpected verification payload.`,
      detail: verificationOk
        ? modelSelection.usedFallback
          ? "This provider currently supports Codex-family models plus gpt-5.4 and gpt-5.4-mini."
          : strictVerificationOk
            ? "Hosted OAuth credentials are valid and Project Scan can use this provider."
            : `Verification response preview: ${verificationText || "empty response"}. TreeMA will still treat this provider as scan-ready.`
        : `Received: ${verificationText || "empty response"}`,
      checkedAt: new Date().toISOString(),
      scanReady: verificationOk,
      scanModel: defaultModel,
      accountId: providerSettings.accountId,
      accountEmail: providerSettings.accountEmail,
      accountLabel: providerSettings.accountLabel,
      defaultModel
    }
  };
}

async function buildChatGptCodexProviderState(current, nextSettings) {
  let verification;
  let providerSettings;

  try {
    const built = await verifyChatGptCodexProvider({
      accessToken: nextSettings.accessToken,
      refreshToken: nextSettings.refreshToken,
      expiresAt: nextSettings.expiresAt,
      accountId: nextSettings.accountId,
      accountEmail: nextSettings.accountEmail,
      accountLabel: nextSettings.accountLabel,
      defaultModel: nextSettings.defaultModel
    });
    verification = built.verification;
    providerSettings = built.providerSettings;
  } catch (error) {
    providerSettings = {
      accessToken: safeString(nextSettings.accessToken),
      refreshToken: safeString(nextSettings.refreshToken),
      expiresAt: Number(nextSettings.expiresAt) || 0,
      accountId: safeString(nextSettings.accountId) || current.accountId,
      accountEmail: safeString(nextSettings.accountEmail) || current.accountEmail,
      accountLabel: safeString(nextSettings.accountLabel) || current.accountLabel,
      defaultModel: normalizeChatGptCodexModel(safeString(nextSettings.defaultModel) || current.defaultModel).model
    };
    verification = {
      ok: false,
      tone: "error",
      message: safeString(error.message) || "Failed to verify ChatGPT Codex OAuth settings.",
      detail: "",
      checkedAt: new Date().toISOString(),
      scanReady: false
    };
  }

  return {
    verification,
    provider: {
      accessToken: providerSettings.accessToken,
      refreshToken: providerSettings.refreshToken,
      expiresAt: providerSettings.expiresAt,
      accountId: providerSettings.accountId,
      accountEmail: providerSettings.accountEmail,
      accountLabel:
        providerSettings.accountLabel ||
        providerSettings.accountEmail ||
        current.accountLabel ||
        (providerSettings.accountId ? `ChatGPT ${providerSettings.accountId.slice(0, 8)}` : ""),
      defaultModel:
        safeString(verification.defaultModel) ||
        providerSettings.defaultModel ||
        normalizeChatGptCodexModel(current.defaultModel).model ||
        CHATGPT_CODEX_DEFAULT_MODEL,
      oauth: current.oauth,
      lastVerifiedAt: verification.checkedAt,
      lastVerification: {
        ok: verification.ok === true,
        tone: verification.tone === "warning" || verification.tone === "error" ? verification.tone : "success",
        message: verification.message,
        detail: safeString(verification.detail),
        checkedAt: verification.checkedAt,
        ...(typeof verification.scanReady === "boolean" ? { scanReady: verification.scanReady } : {}),
        ...(safeString(verification.scanModel) ? { scanModel: verification.scanModel } : {})
      }
    }
  };
}

export async function loadAccountSettings(options = {}) {
  const settings = await readRawSettings();
  return buildPublicSettings(settings, options);
}

function buildDisconnectedProviderResult(provider) {
  return {
    provider,
    connected: false,
    configured: false,
    scanReady: false,
    blockedReason: "",
    apiKey: "",
    githubToken: "",
    accessToken: "",
    refreshToken: "",
    baseUrl: "",
    chatBaseUrl: DEFAULT_GITHUB_MODELS_BASE_URL,
    defaultModel: "",
    accountId: "",
    accountEmail: "",
    accountLabel: "",
    lastVerifiedAt: "",
    lastVerification: null
  };
}

function buildOpenAiAnalysisProvider(openai) {
  const readiness = buildOpenAiReadiness(openai);
  if (!readiness.scanReady) {
    return {
      provider: "openai",
      connected: false,
      configured: readiness.connected,
      scanReady: false,
      blockedReason: readiness.blockedReason,
      apiKey: "",
      baseUrl: openai.baseUrl,
      defaultModel: openai.defaultModel || DEFAULT_OPENAI_MODEL,
      accountLabel: openai.accountLabel,
      lastVerifiedAt: openai.lastVerifiedAt,
      lastVerification: openai.lastVerification,
      state: readiness.state
    };
  }

  return {
    provider: "openai",
    connected: true,
    configured: true,
    scanReady: true,
    blockedReason: "",
    apiKey: openai.apiKey,
    baseUrl: openai.baseUrl,
    defaultModel: openai.defaultModel || DEFAULT_OPENAI_MODEL,
    accountLabel: openai.accountLabel,
    lastVerifiedAt: openai.lastVerifiedAt,
    lastVerification: openai.lastVerification,
    state: readiness.state
  };
}

function buildGitHubCopilotAnalysisProvider(githubCopilot) {
  const readiness = buildGitHubCopilotReadiness(githubCopilot);
  if (!readiness.scanReady) {
    return {
      provider: "github-copilot",
      connected: false,
      configured: readiness.connected,
      scanReady: false,
      blockedReason: readiness.blockedReason,
      githubToken: "",
      chatBaseUrl: DEFAULT_GITHUB_MODELS_BASE_URL,
      defaultModel: DEFAULT_GITHUB_MODELS_MODEL,
      accountLabel: githubCopilot.accountLabel || githubCopilot.accountLogin,
      accountLogin: githubCopilot.accountLogin,
      tokenType: githubCopilot.tokenType || detectGitHubTokenType(githubCopilot.githubToken),
      lastVerifiedAt: githubCopilot.lastVerifiedAt,
      lastVerification: githubCopilot.lastVerification,
      state: readiness.state
    };
  }

  return {
    provider: "github-copilot",
    connected: true,
    configured: true,
    scanReady: true,
    blockedReason: "",
    githubToken: githubCopilot.githubToken,
    chatBaseUrl: DEFAULT_GITHUB_MODELS_BASE_URL,
    defaultModel: DEFAULT_GITHUB_MODELS_MODEL,
    accountLabel: githubCopilot.accountLabel || githubCopilot.accountLogin,
    accountLogin: githubCopilot.accountLogin,
    tokenType: githubCopilot.tokenType || detectGitHubTokenType(githubCopilot.githubToken),
    lastVerifiedAt: githubCopilot.lastVerifiedAt,
    lastVerification: githubCopilot.lastVerification,
    state: readiness.state
  };
}

async function buildChatGptCodexAnalysisProvider(chatgptCodex, settings) {
  if (!chatgptCodex.accessToken) {
    return buildDisconnectedProviderResult(CHATGPT_CODEX_PROVIDER);
  }

  const { provider } = await buildChatGptCodexProviderState(chatgptCodex, chatgptCodex);
  if (
    provider.accessToken !== chatgptCodex.accessToken ||
    provider.refreshToken !== chatgptCodex.refreshToken ||
    provider.expiresAt !== chatgptCodex.expiresAt
  ) {
    settings.providers.chatgptCodex = provider;
    await writeRawSettings(settings);
  }

  const readiness = buildChatGptCodexReadiness(provider);
  if (!readiness.scanReady) {
    return {
      provider: CHATGPT_CODEX_PROVIDER,
      connected: false,
      configured: readiness.connected,
      scanReady: false,
      blockedReason: readiness.blockedReason,
      accessToken: "",
      refreshToken: "",
      accountId: provider.accountId,
      accountEmail: provider.accountEmail,
      defaultModel: provider.defaultModel || CHATGPT_CODEX_DEFAULT_MODEL,
      accountLabel: provider.accountLabel,
      lastVerifiedAt: provider.lastVerifiedAt,
      lastVerification: provider.lastVerification,
      state: readiness.state
    };
  }

  return {
    provider: CHATGPT_CODEX_PROVIDER,
    connected: true,
    configured: true,
    scanReady: true,
    blockedReason: "",
    accessToken: provider.accessToken,
    refreshToken: provider.refreshToken,
    accountId: provider.accountId,
    accountEmail: provider.accountEmail,
    defaultModel: provider.defaultModel || CHATGPT_CODEX_DEFAULT_MODEL,
    accountLabel: provider.accountLabel,
    lastVerifiedAt: provider.lastVerifiedAt,
    lastVerification: provider.lastVerification,
    state: readiness.state
  };
}

export async function loadAnalysisProviderSettings(provider = "openai") {
  const settings = await readRawSettings();
  const openai = settings.providers.openai;
  const githubCopilot = settings.providers.githubCopilot;
  const chatgptCodex = settings.providers.chatgptCodex;
  const publicAnalysisProvider = buildAnalysisProviderSummary(settings);

  if (provider === "auto") {
    const preferredProvider = parseStoredAnalysisProvider(settings.defaultAnalysisProvider);
    if (preferredProvider !== DEFAULT_ANALYSIS_PROVIDER) {
      return loadAnalysisProviderSettings(preferredProvider);
    }

    if (openai.apiKey) {
      const resolved = buildOpenAiAnalysisProvider(openai);
      if (resolved.connected) return resolved;
    }

    if (githubCopilot.githubToken) {
      const resolved = buildGitHubCopilotAnalysisProvider(githubCopilot);
      if (resolved.connected) return resolved;
    }

    if (chatgptCodex.accessToken) {
      const resolved = await buildChatGptCodexAnalysisProvider(chatgptCodex, settings);
      if (resolved.connected) return resolved;
    }

    return {
      ...buildDisconnectedProviderResult(""),
      blockedReason: publicAnalysisProvider.blockedReason,
      requestedProvider: publicAnalysisProvider.requestedProvider,
      selection: publicAnalysisProvider
    };
  }

  if (provider === "openai") {
    return {
      ...buildOpenAiAnalysisProvider(openai),
      requestedProvider: provider,
      selection: publicAnalysisProvider
    };
  }

  if (provider === "github-copilot") {
    return {
      ...buildGitHubCopilotAnalysisProvider(githubCopilot),
      requestedProvider: provider,
      selection: publicAnalysisProvider
    };
  }

  if (provider === CHATGPT_CODEX_PROVIDER) {
    return {
      ...(await buildChatGptCodexAnalysisProvider(chatgptCodex, settings)),
      requestedProvider: provider,
      selection: buildAnalysisProviderSummary(settings)
    };
  }

  throw new AccountSettingsRequestError(`Unsupported provider: ${provider}`, {
    field: "provider",
    value: provider,
    supportedValues: SUPPORTED_ANALYSIS_PROVIDERS.filter((value) => value !== DEFAULT_ANALYSIS_PROVIDER)
  });
}

export async function saveAccountPreferences(payload = {}, options = {}) {
  const settings = await readRawSettings();
  settings.defaultAnalysisProvider = parseRequestedAnalysisProvider(payload.defaultAnalysisProvider);
  const saved = await writeRawSettings(settings);
  return buildPublicSettings(saved, options);
}

export async function saveAccountSettings(provider, payload = {}, options = {}) {
  const settings = await readRawSettings();

  if (provider === "openai") {
    const current = settings.providers.openai;
    const nextApiKey = safeString(payload.apiKey) || current.apiKey;
    if (!nextApiKey) {
      throw new AccountSettingsRequestError("OpenAI API key is required.", {
        provider: "openai",
        field: "apiKey"
      });
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
    return buildPublicSettings(saved, options);
  }

  if (provider === "github-copilot") {
    const current = settings.providers.githubCopilot;
    const nextToken = safeString(payload.githubToken) || current.githubToken;
    if (!nextToken) {
      throw new AccountSettingsRequestError("GitHub token is required.", {
        provider: "github-copilot",
        field: "githubToken"
      });
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
    return buildPublicSettings(saved, options);
  }

  if (provider === CHATGPT_CODEX_PROVIDER) {
    const current = settings.providers.chatgptCodex;
    if (!current.accessToken) {
      throw new AccountSettingsRequestError("Connect ChatGPT Codex OAuth before saving this provider.", {
        provider: CHATGPT_CODEX_PROVIDER
      });
    }
    const nextModel = normalizeChatGptCodexModel(payload.defaultModel || current.defaultModel || CHATGPT_CODEX_DEFAULT_MODEL).model;

    settings.providers.chatgptCodex = {
      ...current,
      defaultModel: nextModel
    };
    const saved = await writeRawSettings(settings);
    return buildPublicSettings(saved, options);
  }

  throw new AccountSettingsRequestError(`Unsupported provider: ${provider}`, {
    field: "provider",
    value: provider
  });
}

export async function testAccountSettings(provider, payload = {}, options = {}) {
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
      return buildPublicSettings(saved, options);
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
    return buildPublicSettings(saved, options);
  }

  if (provider === CHATGPT_CODEX_PROVIDER) {
    const current = settings.providers.chatgptCodex;
    if (!current.accessToken) {
      throw new AccountSettingsRequestError("Connect ChatGPT Codex OAuth before testing this provider.", {
        provider: CHATGPT_CODEX_PROVIDER
      });
    }
    const nextModel = normalizeChatGptCodexModel(payload.defaultModel || current.defaultModel || CHATGPT_CODEX_DEFAULT_MODEL).model;

    const nextSettings = {
      accessToken: current.accessToken,
      refreshToken: current.refreshToken,
      expiresAt: current.expiresAt,
      accountId: current.accountId,
      accountEmail: current.accountEmail,
      accountLabel: current.accountLabel,
      defaultModel: nextModel
    };
    const { provider: nextProvider } = await buildChatGptCodexProviderState(current, nextSettings);
    settings.providers.chatgptCodex = nextProvider;
    const saved = await writeRawSettings(settings);
    return buildPublicSettings(saved, options);
  }

  throw new AccountSettingsRequestError(`Unsupported provider: ${provider}`, {
    field: "provider",
    value: provider
  });
}

export async function disconnectAccountSettings(provider, options = {}) {
  const settings = await readRawSettings();

  if (provider === "openai") {
    settings.providers.openai = createDefaultRawSettings().providers.openai;
    const saved = await writeRawSettings(settings);
    return buildPublicSettings(saved, options);
  }

  if (provider === "github-copilot") {
    settings.providers.githubCopilot = createDefaultRawSettings().providers.githubCopilot;
    const saved = await writeRawSettings(settings);
    return buildPublicSettings(saved, options);
  }

  if (provider === CHATGPT_CODEX_PROVIDER) {
    settings.providers.chatgptCodex = createDefaultRawSettings().providers.chatgptCodex;
    const saved = await writeRawSettings(settings);
    return buildPublicSettings(saved, options);
  }

  throw new AccountSettingsRequestError(`Unsupported provider: ${provider}`, {
    field: "provider",
    value: provider
  });
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
  return buildDesktopOAuthDeepLink({
    provider: OAUTH_HANDOFF_PROVIDERS.GITHUB,
    ...params
  });
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

export function buildOpenAiOAuthCallbackRuntime(callbackUrl = "") {
  const normalizedUrl = safeString(callbackUrl);
  return {
    available: Boolean(normalizedUrl),
    callbackPath: OPENAI_OAUTH_CALLBACK_PATH,
    callbackUrl: normalizedUrl,
    hostedCallbackUrl: OPENAI_OAUTH_HOSTED_CALLBACK_URL,
    clientId: CHATGPT_CODEX_CLIENT_ID
  };
}

export function buildOpenAiOAuthCallbackUrl(origin) {
  const normalizedOrigin = safeString(origin).replace(/\/+$/, "");
  if (!normalizedOrigin) return "";
  return `${normalizedOrigin}${OPENAI_OAUTH_CALLBACK_PATH}`;
}

export function createOpenAiOAuthPkceSession(options = {}) {
  const state = safeString(options.state);
  if (!state) {
    throw new Error("OpenAI OAuth state is required to create a PKCE session.");
  }

  const issuedAt = safeString(options.issuedAt) || new Date().toISOString();
  const codeVerifier = safeString(options.codeVerifier) || randomBytes(32).toString("base64url");
  const payload = {
    version: OPENAI_OAUTH_PKCE_VERSION,
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

export function decodeOpenAiOAuthPkceSession(cookieValue = "") {
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

  if (version !== OPENAI_OAUTH_PKCE_VERSION || !state || !codeVerifier) {
    return { ok: false, error: "invalid_pkce_payload", payload: null };
  }

  if (!Number.isFinite(issuedAtMs) || Date.now() - issuedAtMs > OPENAI_OAUTH_PKCE_MAX_AGE_SECONDS * 1000) {
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

export function createOpenAiOAuthState(options = {}) {
  const target = isGitHubOAuthTarget(options.target) ? options.target : "web";
  const returnPath = normalizeOpenAiOAuthReturnPath(options.returnPath) || DEFAULT_GITHUB_OAUTH_RETURN_PATH;
  const nonce = safeString(options.nonce) || randomBytes(16).toString("hex");
  const sessionHint = safeString(options.sessionHint) || randomBytes(8).toString("hex");
  const issuedAt = safeString(options.issuedAt) || new Date().toISOString();
  const bridgeUrl = normalizeLocalBridgeUrl(options.bridgeUrl);
  const payload = {
    version: OPENAI_OAUTH_STATE_VERSION,
    target,
    returnPath,
    nonce,
    sessionHint,
    issuedAt,
    ...(bridgeUrl ? { bridgeUrl } : {})
  };

  return {
    payload,
    state: encodeBase64Url(JSON.stringify(payload))
  };
}

export function decodeOpenAiOAuthState(stateValue) {
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
  const returnPath = normalizeOpenAiOAuthReturnPath(parsed?.returnPath);
  const nonce = safeString(parsed?.nonce);
  const sessionHint = safeString(parsed?.sessionHint);
  const issuedAt = safeString(parsed?.issuedAt);
  const issuedAtMs = Date.parse(issuedAt);
  const bridgeUrl = normalizeLocalBridgeUrl(parsed?.bridgeUrl);

  if (version !== OPENAI_OAUTH_STATE_VERSION || !isGitHubOAuthTarget(target) || !returnPath || !nonce || !sessionHint) {
    return { ok: false, error: "invalid_state_payload", payload: null };
  }

  if (!Number.isFinite(issuedAtMs) || Date.now() - issuedAtMs > OPENAI_OAUTH_STATE_MAX_AGE_MS) {
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
      issuedAt,
      ...(bridgeUrl ? { bridgeUrl } : {})
    }
  };
}

export function buildOpenAiOAuthStartUrl(params = {}) {
  const url = new URL(OPENAI_OAUTH_START_URL);
  for (const [key, value] of Object.entries(params)) {
    if (safeString(value)) {
      url.searchParams.set(key, safeString(value));
    }
  }
  return url.toString();
}

export function buildOpenAiOAuthWebCompleteUrl(params = {}) {
  const url = new URL(`${GITHUB_OAUTH_APP_ORIGIN}/auth/complete`);
  for (const [key, value] of Object.entries(params)) {
    if (safeString(value)) {
      url.searchParams.set(key, safeString(value));
    }
  }
  url.searchParams.set("provider", CHATGPT_CODEX_PROVIDER);
  return url.toString();
}

export function buildOpenAiOAuthDesktopDeepLink(params = {}) {
  return buildDesktopOAuthDeepLink({
    provider: OAUTH_HANDOFF_PROVIDERS.OPENAI,
    ...params
  });
}

export function createOpenAiOAuthReceipt(params = {}) {
  const code = safeString(params.code);
  const state = safeString(params.state);
  const error = safeString(params.error);
  const errorDescription = safeString(params.error_description);
  const receivedAt = new Date().toISOString();

  if (error) {
    return {
      status: "error",
      message: `OpenAI returned ${error}.`,
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
      message: "OpenAI callback arrived without an authorization code.",
      codePreview: "",
      statePreview: maskSecret(state),
      error: "missing_code",
      errorDescription: "",
      receivedAt
    };
  }

  return {
    status: "success",
    message: "OpenAI authorization code received.",
    codePreview: maskSecret(code),
    statePreview: maskSecret(state),
    error: "",
    errorDescription: "",
    receivedAt
  };
}

function createOpenAiOAuthInvalidReceipt(state, message, errorCode) {
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

export function createOpenAiOAuthConnectedReceipt(params = {}) {
  const state = safeString(params.state);
  return {
    status: "success",
    message: safeString(params.message) || "ChatGPT Codex OAuth tokens were exchanged and stored successfully.",
    codePreview: "",
    statePreview: maskSecret(state),
    error: "",
    errorDescription: "",
    receivedAt: new Date().toISOString()
  };
}

export async function recordOpenAiOAuthCallback(params = {}, options = {}) {
  const settings = await readRawSettings();
  const receipt = createOpenAiOAuthReceipt(params);
  const current = settings.providers.chatgptCodex;

  settings.providers.chatgptCodex = {
    ...current,
    oauth: {
      ...current.oauth,
      lastCallback: receipt
    }
  };

  const saved = await writeRawSettings(settings);
  return buildPublicSettings(saved, options).providers.chatgptCodex.oauth;
}

export async function startOpenAiOAuthFlow(options = {}) {
  const settings = await readRawSettings();
  const current = settings.providers.chatgptCodex;
  const redirectUri = safeString(options.callbackUrl || options.redirectUri) || OPENAI_OAUTH_HOSTED_CALLBACK_URL;
  const target = isGitHubOAuthTarget(options.target) ? options.target : "desktop";
  const { payload, state } = createOpenAiOAuthState({
    target,
    returnPath: options.returnPath || DEFAULT_GITHUB_OAUTH_RETURN_PATH
  });
  const pkceSession = createOpenAiOAuthPkceSession({ state });

  settings.providers.chatgptCodex = {
    ...current,
    oauth: {
      ...current.oauth,
      pendingSession: {
        ...payload,
        codeVerifier: pkceSession.codeVerifier
      }
    }
  };

  await writeRawSettings(settings);

  return {
    authorizeUrl: buildChatGptCodexAuthorizeUrl({
      state,
      redirectUri,
      codeChallenge: pkceSession.codeChallenge
    }),
    state,
    session: {
      ...payload,
      codeVerifier: pkceSession.codeVerifier
    }
  };
}

export async function connectOpenAiOAuthToken(payload = {}, options = {}) {
  const accessToken = safeString(payload.accessToken || payload.access_token);
  const refreshToken = safeString(payload.refreshToken || payload.refresh_token);
  const expiresAt = Number(payload.expiresAt || payload.expires_at || 0);
  if (!accessToken || !refreshToken || !Number.isFinite(expiresAt) || expiresAt <= 0) {
    throw new Error("OpenAI OAuth token payload was incomplete.");
  }

  const settings = await readRawSettings();
  const current = settings.providers.chatgptCodex;
  const accountInfo = extractChatGptCodexAccountInfo({
    accessToken,
    idToken: payload.idToken || payload.id_token
  });
  const nextSettings = {
    accessToken,
    refreshToken,
    expiresAt,
    accountId: safeString(payload.accountId || payload.account_id) || accountInfo.accountId || current.accountId,
    accountEmail: safeString(payload.accountEmail || payload.account_email) || accountInfo.accountEmail || current.accountEmail,
    accountLabel: safeString(payload.accountLabel || payload.account_label) || accountInfo.accountLabel || current.accountLabel,
    defaultModel: normalizeChatGptCodexModel(payload.defaultModel || current.defaultModel || CHATGPT_CODEX_DEFAULT_MODEL).model
  };
  const { provider: nextProvider, verification } = await buildChatGptCodexProviderState(current, nextSettings);
  settings.providers.chatgptCodex = {
    ...nextProvider,
    oauth: payload.oauthReceipt
      ? {
          ...current.oauth,
          lastCallback: sanitizeGithubOAuthReceipt(payload.oauthReceipt),
          pendingSession: current.oauth?.pendingSession ?? null
        }
      : nextProvider.oauth
  };
  const saved = await writeRawSettings(settings);

  return {
    settings: buildPublicSettings(saved, options),
    verification
  };
}

export async function completeOpenAiOAuthFlow(params = {}, options = {}) {
  const settings = await readRawSettings();
  const current = settings.providers.chatgptCodex;
  const decoded = decodeOpenAiOAuthState(params.state);
  const pendingSession = sanitizeStoredOpenAiOAuthPendingSession(current.oauth);
  const expectedTarget = isGitHubOAuthTarget(options.expectedTarget) ? options.expectedTarget : "desktop";
  let receipt = createOpenAiOAuthReceipt(params);
  let shouldClearPendingSession = false;
  let accessToken = safeString(params.accessToken || params.access_token);
  let refreshToken = safeString(params.refreshToken || params.refresh_token);
  let expiresAt = Number(params.expiresAt || params.expires_at || 0);

  if (!decoded.ok) {
    receipt = createOpenAiOAuthInvalidReceipt(params.state, "OpenAI OAuth state is invalid or expired.", decoded.error);
  } else if (receipt.status !== "success") {
    receipt = createOpenAiOAuthInvalidReceipt(params.state, receipt.message, receipt.error || "oauth_callback_error");
  } else if (decoded.payload.target !== expectedTarget) {
    receipt = createOpenAiOAuthInvalidReceipt(
      params.state,
      `OpenAI OAuth state target is not ${expectedTarget}.`,
      "unexpected_state_target"
    );
  } else if (
    !pendingSession ||
    pendingSession.nonce !== decoded.payload.nonce ||
    pendingSession.sessionHint !== decoded.payload.sessionHint
  ) {
    receipt = createOpenAiOAuthInvalidReceipt(
      params.state,
      "OpenAI OAuth state did not match the pending session.",
      "state_session_mismatch"
    );
  } else if ((!accessToken || !refreshToken || !Number.isFinite(expiresAt) || expiresAt <= 0) && safeString(params.code)) {
    try {
      const exchanged = await exchangeChatGptCodexOAuthCode({
        code: params.code,
        codeVerifier: pendingSession.codeVerifier,
        redirectUri: options.openaiOAuth?.callbackUrl || options.openaiOAuth?.hostedCallbackUrl || OPENAI_OAUTH_HOSTED_CALLBACK_URL
      });
      accessToken = exchanged.accessToken;
      refreshToken = exchanged.refreshToken;
      expiresAt = exchanged.expiresAt;
    } catch (error) {
      receipt = createOpenAiOAuthInvalidReceipt(
        params.state,
        safeString(error.message) || "OpenAI token exchange failed.",
        "token_exchange_failed"
      );
    }
  }

  let nextProvider = current;

  if (receipt.status === "success") {
    if (!accessToken || !refreshToken || !Number.isFinite(expiresAt) || expiresAt <= 0) {
      receipt = createOpenAiOAuthInvalidReceipt(
        params.state,
        "OpenAI OAuth completed without exchanged tokens.",
        "missing_token_payload"
      );
    } else {
      const accountInfo = extractChatGptCodexAccountInfo({
        accessToken,
        idToken: params.idToken || params.id_token
      });
      const built = await buildChatGptCodexProviderState(current, {
        accessToken,
        refreshToken,
        expiresAt,
        accountId: safeString(params.accountId || params.account_id) || accountInfo.accountId || current.accountId,
        accountEmail: safeString(params.accountEmail || params.account_email) || accountInfo.accountEmail || current.accountEmail,
        accountLabel: safeString(params.accountLabel || params.account_label) || accountInfo.accountLabel || current.accountLabel,
        defaultModel: normalizeChatGptCodexModel(current.defaultModel || CHATGPT_CODEX_DEFAULT_MODEL).model
      });
      nextProvider = {
        ...built.provider,
        oauth: {
          ...current.oauth,
          lastCallback: null,
          pendingSession: null
        }
      };
      shouldClearPendingSession = true;
      receipt = createOpenAiOAuthConnectedReceipt({
        state: params.state,
        message: built.provider.lastVerification?.message || "Connected through ChatGPT Codex OAuth."
      });
    }
  }

  settings.providers.chatgptCodex =
    receipt.status === "success"
      ? {
          ...nextProvider,
          oauth: {
            ...nextProvider.oauth,
            lastCallback: receipt,
            pendingSession: null
          }
        }
      : {
          ...current,
          oauth: {
            ...current.oauth,
            lastCallback: receipt,
            pendingSession: shouldClearPendingSession ? null : current.oauth?.pendingSession ?? null
          }
        };

  const saved = await writeRawSettings(settings);
  return {
    oauth: buildPublicSettings(saved, options).providers.chatgptCodex.oauth,
    completion: {
      ok: receipt.status === "success",
      error: receipt.error,
      message: receipt.message,
      accountLabel: settings.providers.chatgptCodex.accountLabel
    }
  };
}

export function renderOpenAiOAuthCallbackPage(receipt, callbackUrl = "") {
  const safeReceipt = sanitizeGithubOAuthReceipt(receipt);
  const title = safeReceipt?.status === "success" ? "OpenAI Authorization Received" : "OpenAI Authorization Failed";
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
        <p>TreeMA received the OpenAI OAuth callback and stored masked receipt metadata in local settings outside the workspace.</p>
        <ul>${details}</ul>
        <button type="button" onclick="window.close()">Close this window</button>
      </article>
    </main>
  </body>
</html>
`;
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
