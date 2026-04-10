import {
  buildGitHubOAuthDesktopDeepLink,
  buildGitHubOAuthWebCompleteUrl,
  createGitHubOAuthReceipt,
  decodeGitHubOAuthState,
  decodeGitHubOAuthPkceSession,
  exchangeGitHubOAuthCode,
  fetchGitHubAuthenticatedUser,
  GITHUB_OAUTH_CALLBACK_PATH
} from "../../../scripts/lib/account-settings.mjs";

const PKCE_COOKIE_NAME = "treema_github_oauth";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildContinuationParams(params) {
  return {
    code: params.code || "",
    state: params.state || "",
    error: params.error || "",
    error_description: params.error_description || ""
  };
}

function buildTokenTransferParams(params, exchange, profile) {
  return {
    code: params.code || "",
    state: params.state || "",
    access_token: exchange.accessToken || "",
    token_type: exchange.tokenType || "",
    scope: exchange.scope || "",
    account_login: profile?.accountLogin || "",
    account_label: profile?.accountLabel || ""
  };
}

function getCookieValue(header, key) {
  const cookieHeader = String(header || "");
  if (!cookieHeader) return "";
  for (const entry of cookieHeader.split(/;\s*/u)) {
    const [name, ...rest] = entry.split("=");
    if (name === key) {
      return rest.join("=");
    }
  }
  return "";
}

function clearPkceCookieHeader() {
  return `${PKCE_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function encodeFragmentPayload(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function renderCallbackErrorPage(receipt, callbackUrl, message) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>GitHub Authorization Failed</title>
    <style>
      body {
        margin: 0;
        padding: 48px 20px;
        background: linear-gradient(180deg, #f4efe6 0%, #ece5d7 100%);
        color: #1f2421;
        font-family: "Segoe UI", Helvetica, Arial, sans-serif;
      }
      main {
        max-width: 760px;
        margin: 0 auto;
      }
      .card {
        background: #fffdf8;
        border: 1px solid #d7cfbf;
        border-radius: 22px;
        padding: 28px;
      }
      .code {
        display: block;
        overflow-wrap: anywhere;
        padding: 12px 14px;
        border-radius: 14px;
        background: #f4efe6;
        border: 1px solid #d7cfbf;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 13px;
      }
    </style>
  </head>
  <body>
    <main>
      <article class="card">
        <h1>GitHub authorization failed</h1>
        <p>${escapeHtml(message)}</p>
        <p>Hosted callback URL</p>
        <span class="code">${escapeHtml(callbackUrl)}</span>
        ${receipt?.statePreview ? `<p>State preview: ${escapeHtml(receipt.statePreview)}</p>` : ""}
      </article>
    </main>
  </body>
</html>`;
}

function renderDesktopHandoffPage(receipt, callbackUrl, deepLinkUrl, transferPayload) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Open TreeMA Desktop</title>
    <style>
      body {
        margin: 0;
        padding: 48px 20px;
        background: linear-gradient(180deg, #f4efe6 0%, #ece5d7 100%);
        color: #1f2421;
        font-family: "Segoe UI", Helvetica, Arial, sans-serif;
      }
      main {
        max-width: 820px;
        margin: 0 auto;
      }
      .card {
        background: #fffdf8;
        border: 1px solid #d7cfbf;
        border-radius: 22px;
        padding: 28px;
        box-shadow: 0 12px 30px rgba(49, 41, 30, 0.08);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin: 24px 0 16px;
      }
      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 44px;
        padding: 0 18px;
        border-radius: 999px;
        text-decoration: none;
        font-weight: 600;
      }
      .button-primary {
        background: #1f2421;
        color: #fffdf8;
      }
      .button-secondary {
        background: #f4efe6;
        color: #1f2421;
        border: 1px solid #d7cfbf;
      }
      .code {
        display: block;
        overflow-wrap: anywhere;
        padding: 12px 14px;
        border-radius: 14px;
        background: #f4efe6;
        border: 1px solid #d7cfbf;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 13px;
      }
      .status {
        margin-top: 18px;
        padding: 14px 16px;
        border-radius: 14px;
        background: #f4efe6;
        border: 1px solid #d7cfbf;
      }
    </style>
  </head>
  <body>
    <main>
      <article class="card">
        <h1>Open TreeMA desktop</h1>
        <p>GitHub returned successfully to <strong>treesma.com</strong>. TreeMA will now try to deliver the exchanged token to the local desktop app over the loopback bridge, then focus the app with the registered <code>treesma://</code> protocol.</p>
        <p>Status: ${escapeHtml(receipt.message)}</p>
        <div class="status" data-desktop-status>Connecting to the local desktop runtime...</div>
        <div class="actions">
          <a class="button button-primary" href="${escapeHtml(deepLinkUrl)}">Open desktop app</a>
          <a class="button button-secondary" href="https://app.treesma.com/settings/download">Desktop help</a>
        </div>
        <p>If the app is not running, launch TreeMA Desktop and restart the GitHub connection flow.</p>
        <p>Deep link</p>
        <span class="code">${escapeHtml(deepLinkUrl)}</span>
        <p>Hosted callback URL</p>
        <span class="code">${escapeHtml(callbackUrl)}</span>
      </article>
    </main>
    <script>
      const transferPayload = ${JSON.stringify(transferPayload)};
      const statusEl = document.querySelector("[data-desktop-status]");

      async function deliverToken() {
        try {
          const response = await fetch("http://127.0.0.1:48152/auth/github/complete", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(transferPayload)
          });

          if (!response.ok) {
            throw new Error("Desktop runtime did not accept the OAuth completion.");
          }

          statusEl.textContent = "Desktop token handoff succeeded. Opening TreeMA Desktop...";
          window.setTimeout(() => {
            window.location.href = ${JSON.stringify(deepLinkUrl)};
          }, 250);
        } catch (error) {
          statusEl.textContent = "TreeMA Desktop was not reachable on the local handoff port. Launch the app and restart the GitHub connection flow.";
        }
      }

      deliverToken();
    </script>
  </body>
</html>`;
}

export async function GET(request) {
  const url = new URL(request.url);
  const callbackUrl = `${url.origin}${GITHUB_OAUTH_CALLBACK_PATH}`;
  const params = buildContinuationParams({
    code: url.searchParams.get("code") || "",
    state: url.searchParams.get("state") || "",
    error: url.searchParams.get("error") || "",
    error_description: url.searchParams.get("error_description") || ""
  });
  const receipt = createGitHubOAuthReceipt(params);
  const decoded = decodeGitHubOAuthState(params.state);
  const pkceCookie = decodeGitHubOAuthPkceSession(getCookieValue(request.headers.get("cookie"), PKCE_COOKIE_NAME));
  const baseHeaders = {
    "Cache-Control": "no-store",
    "Set-Cookie": clearPkceCookieHeader()
  };

  if (!decoded.ok) {
    return new Response(
      renderCallbackErrorPage(receipt, callbackUrl, "The GitHub OAuth state was invalid, malformed, or expired."),
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
      renderCallbackErrorPage(receipt, callbackUrl, "The GitHub OAuth PKCE session was missing, expired, or did not match this callback."),
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
    return new Response(renderCallbackErrorPage(receipt, callbackUrl, receipt.message), {
      status: 400,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        ...baseHeaders
      }
    });
  }

  let exchanged;
  let profile;
  try {
    exchanged = await exchangeGitHubOAuthCode(
      {
        code: params.code,
        redirectUri: callbackUrl,
        codeVerifier: pkceCookie.payload.codeVerifier
      },
      {
        callbackUrl
      }
    );
    profile = await fetchGitHubAuthenticatedUser(exchanged.accessToken);
  } catch (error) {
    return new Response(renderCallbackErrorPage(receipt, callbackUrl, error.message || "GitHub token exchange failed."), {
      status: 400,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        ...baseHeaders
      }
    });
  }

  if (decoded.payload.target === "web") {
    const redirectUrl = buildGitHubOAuthWebCompleteUrl({
      state: params.state
    });
    const fragmentPayload = encodeFragmentPayload({
      provider: "github-copilot",
      accessToken: exchanged.accessToken,
      tokenType: exchanged.tokenType,
      scope: exchanged.scope,
      accountLogin: profile.accountLogin,
      accountLabel: profile.accountLabel,
      connectedAt: new Date().toISOString()
    });

    return new Response(null, {
      status: 302,
      headers: {
        Location: `${redirectUrl}#github_oauth=${fragmentPayload}`,
        ...baseHeaders
      }
    });
  }

  const deepLinkUrl = buildGitHubOAuthDesktopDeepLink({
    provider: "github-copilot",
    status: "connected",
    session_hint: decoded.payload.sessionHint
  });
  const transferPayload = buildTokenTransferParams(params, exchanged, profile);
  return new Response(renderDesktopHandoffPage(receipt, callbackUrl, deepLinkUrl, transferPayload), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...baseHeaders
    }
  });
}
