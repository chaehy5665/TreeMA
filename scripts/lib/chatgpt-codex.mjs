const CHATGPT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const CHATGPT_CODEX_RESPONSES_PATH = "/codex/responses";
const CHATGPT_CODEX_AUTH_CLAIM = "https://api.openai.com/auth";

export const CHATGPT_CODEX_PROVIDER = "chatgpt-codex";
export const CHATGPT_CODEX_DEFAULT_MODEL = "gpt-5.3-codex";
export const CHATGPT_CODEX_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
export const CHATGPT_CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
export const CHATGPT_CODEX_CLIENT_ID =
  process.env.TREEMA_OPENAI_OAUTH_CLIENT_ID || process.env.OPENAI_OAUTH_CLIENT_ID || "app_EMoamEEZ73f0CkXaXp7hrann";
export const CHATGPT_CODEX_SCOPE = "openid profile email offline_access";

function safeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function isChatGptCodexModel(model = "") {
  return /codex/i.test(safeString(model));
}

export function isSupportedChatGptOAuthModel(model = "") {
  const value = safeString(model).toLowerCase();
  return Boolean(
    value &&
      (value.includes("codex") ||
        value === "gpt-5.4" ||
        value === "gpt-5.4-mini")
  );
}

export function normalizeChatGptCodexModel(model = "") {
  const value = safeString(model);
  if (!value) {
    return {
      requestedModel: "",
      model: CHATGPT_CODEX_DEFAULT_MODEL,
      usedFallback: false
    };
  }

  if (isSupportedChatGptOAuthModel(value)) {
    return {
      requestedModel: value,
      model: value,
      usedFallback: false
    };
  }

  return {
    requestedModel: value,
    model: CHATGPT_CODEX_DEFAULT_MODEL,
    usedFallback: true
  };
}

function normalizeBase64Url(value) {
  return String(value || "").replaceAll("-", "+").replaceAll("_", "/");
}

function decodeBase64Url(value) {
  const normalized = normalizeBase64Url(value);
  const padded = normalized + "===".slice((normalized.length + 3) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

export function decodeJwtPayload(token = "") {
  const value = safeString(token);
  if (!value) return null;

  const parts = value.split(".");
  if (parts.length < 2) return null;

  try {
    return JSON.parse(decodeBase64Url(parts[1]));
  } catch {
    return null;
  }
}

export function extractChatGptCodexAccountInfo(tokens = {}) {
  const payload = decodeJwtPayload(tokens.idToken || "") || decodeJwtPayload(tokens.accessToken || "") || {};
  const authClaims = payload?.[CHATGPT_CODEX_AUTH_CLAIM] || {};
  const accountId = safeString(authClaims.chatgpt_account_id || authClaims.account_id || payload.chatgpt_account_id || payload.sub);
  const accountEmail = safeString(payload.email || payload.preferred_username);
  const accountName = safeString(payload.name || payload.nickname);
  return {
    accountId,
    accountEmail,
    accountLabel: accountEmail || accountName || (accountId ? `ChatGPT ${accountId.slice(0, 8)}` : "")
  };
}

function buildTokenForm(fields = {}) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (safeString(value)) {
      form.set(key, safeString(value));
    }
  }
  return form;
}

function normalizeTokenResponse(payload) {
  const accessToken = safeString(payload?.access_token);
  const refreshToken = safeString(payload?.refresh_token);
  const idToken = safeString(payload?.id_token);
  const expiresIn = Number(payload?.expires_in);

  if (!accessToken || !refreshToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error("OpenAI OAuth token response was missing required fields.");
  }

  return {
    accessToken,
    refreshToken,
    idToken,
    expiresAt: Date.now() + expiresIn * 1000
  };
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

export async function exchangeChatGptCodexOAuthCode(params = {}) {
  const code = safeString(params.code);
  const codeVerifier = safeString(params.codeVerifier);
  const redirectUri = safeString(params.redirectUri);
  if (!code) {
    throw new Error("OpenAI OAuth callback arrived without an authorization code.");
  }
  if (!codeVerifier) {
    throw new Error("OpenAI OAuth code verifier is required.");
  }
  if (!redirectUri) {
    throw new Error("OpenAI OAuth redirect URI is required.");
  }

  const response = await fetch(CHATGPT_CODEX_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: buildTokenForm({
      grant_type: "authorization_code",
      client_id: CHATGPT_CODEX_CLIENT_ID,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri
    }).toString()
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(safeString(payload?.error_description || payload?.error || payload?.message) || "OpenAI OAuth token exchange failed.");
  }
  return normalizeTokenResponse(payload);
}

export async function refreshChatGptCodexOAuthToken(refreshToken = "") {
  const value = safeString(refreshToken);
  if (!value) {
    throw new Error("OpenAI OAuth refresh token is required.");
  }

  const response = await fetch(CHATGPT_CODEX_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: buildTokenForm({
      grant_type: "refresh_token",
      client_id: CHATGPT_CODEX_CLIENT_ID,
      refresh_token: value
    }).toString()
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(safeString(payload?.error_description || payload?.error || payload?.message) || "OpenAI OAuth token refresh failed.");
  }
  return normalizeTokenResponse(payload);
}

export function shouldRefreshChatGptCodexToken(expiresAt) {
  const expiresMs = Number(expiresAt);
  if (!Number.isFinite(expiresMs) || expiresMs <= 0) {
    return true;
  }
  return expiresMs - Date.now() < 60 * 1000;
}

export function buildChatGptCodexAuthorizeUrl({ state, redirectUri, codeChallenge }) {
  const url = new URL(CHATGPT_CODEX_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CHATGPT_CODEX_CLIENT_ID);
  url.searchParams.set("redirect_uri", safeString(redirectUri));
  url.searchParams.set("scope", CHATGPT_CODEX_SCOPE);
  url.searchParams.set("state", safeString(state));
  url.searchParams.set("code_challenge", safeString(codeChallenge));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", "codex_cli_rs");
  return url.toString();
}

export function createChatGptCodexHeaders({ accessToken, accountId }) {
  return {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    Authorization: `Bearer ${safeString(accessToken)}`,
    "OpenAI-Beta": "responses=experimental",
    originator: "codex_cli_rs",
    "chatgpt-account-id": safeString(accountId)
  };
}

function parseSseDataLines(rawText) {
  const events = [];
  for (const line of String(rawText || "").split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      events.push(JSON.parse(payload));
    } catch {}
  }
  return events;
}

function collectEventTextParts(value, textParts) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) {
      textParts.push(trimmed);
    }
    return;
  }

  if (!value || typeof value !== "object") return;

  if (Array.isArray(value)) {
    for (const item of value) {
      collectEventTextParts(item, textParts);
    }
    return;
  }

  const candidateFields = ["delta", "text", "output_text", "content", "value"];
  for (const field of candidateFields) {
    if (field in value) {
      collectEventTextParts(value[field], textParts);
    }
  }
}

function mergeChatGptCodexStreamResponse(events = []) {
  const streamTextByKey = new Map();
  const messageItems = [];
  let responsePayload = null;
  let responseError = null;

  for (const event of events) {
    if (!event || typeof event !== "object") continue;

    if (event?.type === "error") {
      responseError = event.error || event;
      continue;
    }

    if (
      event?.type === "response.created" ||
      event?.type === "response.in_progress" ||
      event?.type === "response.done" ||
      event?.type === "response.completed"
    ) {
      responsePayload = event.response || responsePayload;
    }

    const textKey = `${safeString(event.item_id) || safeString(event.output_index)}:${Number.isInteger(event.content_index) ? event.content_index : 0}`;
    if (event?.type === "response.output_text.delta") {
      const previous = streamTextByKey.get(textKey) || "";
      streamTextByKey.set(textKey, previous + safeString(event.delta));
      continue;
    }

    if (event?.type === "response.output_text.done") {
      const text = safeString(event.text);
      if (text) {
        streamTextByKey.set(textKey, text);
      }
      continue;
    }

    if (event?.type === "response.content_part.done" && event.part?.type === "output_text") {
      const text = safeString(event.part?.text);
      if (text) {
        streamTextByKey.set(textKey, text);
      }
      continue;
    }

    if (event?.type === "response.output_item.done" && event.item?.type === "message") {
      messageItems.push(event.item);
      continue;
    }
  }

  if (responseError) {
    return { error: responseError };
  }

  const outputText = Array.from(streamTextByKey.values())
    .join("")
    .trim();
  if (!responsePayload && !outputText && messageItems.length === 0) {
    return null;
  }

  const mergedResponse = responsePayload && typeof responsePayload === "object" ? { ...responsePayload } : {};
  if (messageItems.length > 0) {
    mergedResponse.output = messageItems;
  }
  if (outputText) {
    mergedResponse.output_text = outputText;
  }
  return mergedResponse;
}

export function parseChatGptCodexResponsePayload(rawText = "") {
  const trimmed = String(rawText || "").trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {}

  const events = parseSseDataLines(trimmed);
  const mergedResponse = mergeChatGptCodexStreamResponse(events);
  if (mergedResponse) {
    return mergedResponse;
  }

  const textParts = [];
  for (const event of events) {
    if (event?.type === "error") {
      return { error: event.error || event };
    }
    collectEventTextParts(event, textParts);
  }
  if (textParts.length > 0) {
    return {
      output_text: textParts.join("\n").trim()
    };
  }

  return null;
}

export function extractTextFromChatGptCodexResponse(responsePayload) {
  if (!responsePayload || typeof responsePayload !== "object") return "";

  if (safeString(responsePayload.output_text)) {
    return safeString(responsePayload.output_text);
  }

  if (typeof responsePayload.output === "string") {
    return responsePayload.output.trim();
  }

  const textParts = [];
  const stacks = [];

  if (Array.isArray(responsePayload.output)) {
    stacks.push(...responsePayload.output);
  }
  if (Array.isArray(responsePayload.content)) {
    stacks.push(...responsePayload.content);
  }

  for (const item of stacks) {
    if (typeof item === "string") {
      textParts.push(item);
      continue;
    }

    if (!item || typeof item !== "object") continue;

    if (safeString(item.text)) {
      textParts.push(safeString(item.text));
    }

    if (Array.isArray(item.content)) {
      for (const contentItem of item.content) {
        if (typeof contentItem === "string") {
          textParts.push(contentItem);
          continue;
        }
        if (!contentItem || typeof contentItem !== "object") continue;
        const contentText =
          safeString(contentItem.text) ||
          safeString(contentItem.output_text) ||
          safeString(contentItem.value) ||
          safeString(contentItem.content);
        if (contentText) {
          textParts.push(contentText);
        }
      }
    }
  }

  return textParts.join("\n").trim();
}

function extractCodexErrorMessage(rawText, parsedPayload, fallback) {
  const payloadError = safeString(parsedPayload?.error?.message || parsedPayload?.error?.code || parsedPayload?.message);
  if (payloadError) return payloadError;

  const events = parseSseDataLines(rawText);
  for (const event of events) {
    const message = safeString(event?.error?.message || event?.message || event?.detail);
    if (message) return message;
  }

  return fallback;
}

export async function runChatGptCodexRequest({
  accessToken,
  accountId,
  model = CHATGPT_CODEX_DEFAULT_MODEL,
  instructions,
  inputText,
  reasoning = { effort: "medium", summary: "auto" },
  text = { verbosity: "medium" }
}) {
  const response = await fetch(`${CHATGPT_CODEX_BASE_URL}${CHATGPT_CODEX_RESPONSES_PATH}`, {
    method: "POST",
    headers: createChatGptCodexHeaders({ accessToken, accountId }),
    body: JSON.stringify({
      model,
      store: false,
      stream: true,
      instructions,
      input: [
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: inputText
            }
          ]
        }
      ],
      reasoning,
      text,
      include: ["reasoning.encrypted_content"]
    })
  });

  const rawText = await response.text();
  const parsedPayload = parseChatGptCodexResponsePayload(rawText);

  if (!response.ok) {
    throw new Error(
      extractCodexErrorMessage(rawText, parsedPayload, `ChatGPT Codex request failed with status ${response.status}.`)
    );
  }

  if (parsedPayload?.error) {
    throw new Error(extractCodexErrorMessage(rawText, parsedPayload, "ChatGPT Codex returned an error response."));
  }

  return {
    response,
    rawText,
    parsedPayload,
    text: extractTextFromChatGptCodexResponse(parsedPayload)
  };
}
