import {
  buildOpenAiOAuthDesktopDeepLink,
  buildOpenAiOAuthWebCompleteUrl,
  createOpenAiOAuthReceipt,
  decodeOpenAiOAuthPkceSession,
  decodeOpenAiOAuthState,
  OPENAI_OAUTH_CALLBACK_PATH
} from "../../../scripts/lib/account-settings.mjs";
import { exchangeChatGptCodexOAuthCode, extractChatGptCodexAccountInfo } from "../../../scripts/lib/chatgpt-codex.mjs";
import { buildDesktopOAuthBridgeUrl, OAUTH_HANDOFF_PROVIDERS } from "../../../scripts/lib/oauth-handoff-contract.js";
import {
  buildHostedOAuthContinuationParams,
  clearHostedPkceCookieHeader,
  encodeHostedOAuthFragmentPayload,
  getCookieValue,
  renderHostedOAuthCallbackErrorPage,
  renderHostedOAuthDesktopHandoffPage,
  resolveHostedOAuthCallbackTarget,
  validateHostedOAuthCallbackParams
} from "../shared-oauth.mjs";

const PKCE_COOKIE_NAME = "treema_openai_oauth";
const PROVIDER_ID = "chatgpt-codex";
const PROVIDER_LABEL = "ChatGPT Codex";

export async function GET(request) {
  const url = new URL(request.url);
  const callbackUrl = `${url.origin}${OPENAI_OAUTH_CALLBACK_PATH}`;
  const params = buildHostedOAuthContinuationParams(url.searchParams);
  const receipt = createOpenAiOAuthReceipt(params);
  const callbackValidationError = validateHostedOAuthCallbackParams(params, PROVIDER_LABEL);
  const baseHeaders = {
    "Cache-Control": "no-store",
    "Set-Cookie": clearHostedPkceCookieHeader(PKCE_COOKIE_NAME)
  };

  if (callbackValidationError) {
    return new Response(
      renderHostedOAuthCallbackErrorPage({
        providerId: PROVIDER_ID,
        providerLabel: PROVIDER_LABEL,
        callbackUrl,
        receipt,
        message: callbackValidationError,
        target: "unknown"
      }),
      {
      status: 400,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        ...baseHeaders
      }
      }
    );
  }

  const decoded = decodeOpenAiOAuthState(params.state);
  const target = resolveHostedOAuthCallbackTarget(decoded);
  const pkceCookie = decodeOpenAiOAuthPkceSession(getCookieValue(request.headers.get("cookie"), PKCE_COOKIE_NAME));

  if (!decoded.ok) {
    return new Response(
      renderHostedOAuthCallbackErrorPage({
        providerId: PROVIDER_ID,
        providerLabel: PROVIDER_LABEL,
        callbackUrl,
        receipt,
        message: "The OpenAI OAuth state was invalid, malformed, or expired.",
        target
      }),
      {
        status: 400,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          ...baseHeaders
        }
      }
    );
  }

  if (!pkceCookie.ok || pkceCookie.payload.state !== params.state) {
    return new Response(
      renderHostedOAuthCallbackErrorPage({
        providerId: PROVIDER_ID,
        providerLabel: PROVIDER_LABEL,
        callbackUrl,
        receipt,
        message: "The OpenAI OAuth PKCE session was missing, expired, or did not match this callback.",
        target
      }),
      {
        status: 400,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          ...baseHeaders
        }
      }
    );
  }

  if (receipt.status !== "success") {
    return new Response(
      renderHostedOAuthCallbackErrorPage({
        providerId: PROVIDER_ID,
        providerLabel: PROVIDER_LABEL,
        callbackUrl,
        receipt,
        message: receipt.message,
        target
      }),
      {
      status: 400,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        ...baseHeaders
      }
      }
    );
  }

  let exchanged;
  let accountInfo;
  try {
    exchanged = await exchangeChatGptCodexOAuthCode({
      code: params.code,
      codeVerifier: pkceCookie.payload.codeVerifier,
      redirectUri: callbackUrl
    });
    accountInfo = extractChatGptCodexAccountInfo({
      accessToken: exchanged.accessToken,
      idToken: exchanged.idToken
    });
  } catch (error) {
    return new Response(
      renderHostedOAuthCallbackErrorPage({
        providerId: PROVIDER_ID,
        providerLabel: PROVIDER_LABEL,
        callbackUrl,
        receipt,
        message: error.message || "OpenAI token exchange failed.",
        target
      }),
      {
      status: 400,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        ...baseHeaders
      }
      }
    );
  }

  if (decoded.payload.target === "web") {
    const redirectUrl = buildOpenAiOAuthWebCompleteUrl({
      target: decoded.payload.target,
      result: "success",
      state: params.state
    });
    const fragmentPayload = encodeHostedOAuthFragmentPayload({
      provider: PROVIDER_ID,
      accessToken: exchanged.accessToken,
      refreshToken: exchanged.refreshToken,
      expiresAt: exchanged.expiresAt,
      accountId: accountInfo.accountId || "",
      accountEmail: accountInfo.accountEmail || "",
      accountLabel: accountInfo.accountLabel || accountInfo.accountEmail || accountInfo.accountId || "",
      connectedAt: new Date().toISOString()
    });
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${redirectUrl}#openai_oauth=${encodeURIComponent(fragmentPayload)}`,
        ...baseHeaders
      }
    });
  }

  const deepLinkUrl = buildOpenAiOAuthDesktopDeepLink({
    ...params,
    provider: PROVIDER_ID,
    status: "connected"
  });
  const transferPayload = {
    code: params.code,
    state: params.state,
    access_token: exchanged.accessToken,
    refresh_token: exchanged.refreshToken,
    expires_at: exchanged.expiresAt,
    account_id: accountInfo.accountId || "",
    account_email: accountInfo.accountEmail || "",
    account_label: accountInfo.accountLabel || ""
  };
  return new Response(
    renderHostedOAuthDesktopHandoffPage({
      bridgeUrl: buildDesktopOAuthBridgeUrl(OAUTH_HANDOFF_PROVIDERS.OPENAI),
      callbackUrl,
      deepLinkUrl,
      failureFlowLabel: PROVIDER_LABEL,
      providerId: PROVIDER_ID,
      providerLabel: PROVIDER_LABEL,
      receipt,
      target,
      transferPayload
    }),
    {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...baseHeaders
    }
    }
  );
}
