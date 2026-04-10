import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SETTINGS_VERSION = 1;
const SETTINGS_DIR = path.join(os.homedir(), ".treema", "settings");
const SETTINGS_FILE = path.join(SETTINGS_DIR, "accounts.json");
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";
const DEFAULT_GITHUB_API_BASE_URL = "https://api.github.com";
const DEFAULT_GITHUB_MODELS_BASE_URL = "https://models.github.ai/inference";
const DEFAULT_GITHUB_MODELS_MODEL = "github-copilot/gpt-5.4-mini";
const GITHUB_API_VERSION = "2022-11-28";

function safeString(value) {
  return typeof value === "string" ? value.trim() : "";
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

function normalizeOpenAiBaseUrl(value) {
  const normalized = safeString(value).replace(/\/+$/, "");
  return normalized || DEFAULT_OPENAI_BASE_URL;
}

function normalizeGitHubApiBaseUrl(value) {
  const normalized = safeString(value).replace(/\/+$/, "");
  return normalized || DEFAULT_GITHUB_API_BASE_URL;
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
        lastVerifiedAt: safeString(githubCopilot.lastVerifiedAt),
        lastVerification: sanitizeVerification(githubCopilot.lastVerification)
      }
    }
  };
}

function buildPublicSettings(raw) {
  const settings = sanitizeRawSettings(raw);
  const openai = settings.providers.openai;
  const githubCopilot = settings.providers.githubCopilot;

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
    tokenType,
    copilotBillingStatus: "unverified"
  };
}

export async function loadAccountSettings() {
  const settings = await readRawSettings();
  return buildPublicSettings(settings);
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

    let verification;
    try {
      verification = await verifyGitHubCopilotProvider(nextSettings);
    } catch (error) {
      verification = {
        ok: false,
        tone: "error",
        message: safeString(error.message) || "Failed to verify GitHub Copilot settings.",
        detail: "",
        checkedAt: new Date().toISOString(),
        accountLogin: current.accountLogin,
        tokenType: detectGitHubTokenType(nextSettings.githubToken),
        copilotBillingStatus: "unverified"
      };
    }

    settings.providers.githubCopilot = {
      githubToken: nextSettings.githubToken,
      apiBaseUrl: nextSettings.apiBaseUrl,
      accountLogin: safeString(verification.accountLogin) || current.accountLogin,
      accountLabel: safeString(verification.accountLogin) || `Token ${maskSecret(nextSettings.githubToken)}`,
      tokenType: safeString(verification.tokenType) || detectGitHubTokenType(nextSettings.githubToken),
      copilotBillingStatus:
        verification.copilotBillingStatus === "verified" || verification.copilotBillingStatus === "unverified"
          ? verification.copilotBillingStatus
          : "unknown",
      lastVerifiedAt: verification.checkedAt,
      lastVerification: {
        ok: verification.ok === true,
        tone: verification.tone === "error" || verification.tone === "warning" ? verification.tone : "success",
        message: verification.message,
        detail: safeString(verification.detail),
        checkedAt: verification.checkedAt
      }
    };

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
