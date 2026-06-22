import {
  createOpenAiOAuthPkceSession,
  createOpenAiOAuthState,
  decodeOpenAiOAuthState,
  OPENAI_OAUTH_HOSTED_CALLBACK_URL
} from "../../../scripts/lib/account-settings.mjs";
import { buildChatGptCodexAuthorizeUrl } from "../../../scripts/lib/chatgpt-codex.mjs";
import {
  buildHostedPkceCookieHeader,
  normalizeHostedOAuthTarget,
  renderHostedOAuthStartErrorPage,
  resolveHostedOAuthTarget
} from "../shared-oauth.mjs";

const PKCE_COOKIE_NAME = "treema_openai_oauth";
const PKCE_COOKIE_MAX_AGE_SECONDS = 15 * 60;
const PROVIDER_ID = "chatgpt-codex";
const PROVIDER_LABEL = "ChatGPT Codex";

function resolveTarget(url) {
  return resolveHostedOAuthTarget(url, decodeOpenAiOAuthState);
}

function resolveState(url) {
  const providedState = url.searchParams.get("state") || "";
  if (providedState) {
    const decoded = decodeOpenAiOAuthState(providedState);
    if (!decoded.ok) {
      throw new Error("The provided OpenAI OAuth state was invalid or expired.");
    }
    return {
      state: providedState,
      payload: decoded.payload
    };
  }

  return createOpenAiOAuthState({
    target: normalizeHostedOAuthTarget(url.searchParams.get("target")),
    returnPath: url.searchParams.get("returnPath") || "/settings/accounts"
  });
}

export async function GET(request) {
  const url = new URL(request.url);
  const target = resolveTarget(url);

  try {
    const { state } = resolveState(url);
    const pkceSession = createOpenAiOAuthPkceSession({ state });
    const authorizeUrl = buildChatGptCodexAuthorizeUrl({
      state,
      redirectUri: OPENAI_OAUTH_HOSTED_CALLBACK_URL,
      codeChallenge: pkceSession.codeChallenge
    });
    return new Response(null, {
      status: 302,
      headers: {
        Location: authorizeUrl,
        "Set-Cookie": buildHostedPkceCookieHeader(PKCE_COOKIE_NAME, pkceSession.cookieValue, PKCE_COOKIE_MAX_AGE_SECONDS),
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return new Response(
      renderHostedOAuthStartErrorPage({
        providerId: PROVIDER_ID,
        providerLabel: PROVIDER_LABEL,
        message: error.message || "Unable to start OpenAI OAuth.",
        target
      }),
      {
      status: 500,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      }
      }
    );
  }
}
