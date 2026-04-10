import {
  buildGitHubOAuthAuthorizeUrl,
  createGitHubOAuthPkceSession,
  createGitHubOAuthState,
  decodeGitHubOAuthState
} from "../../../scripts/lib/account-settings.mjs";

const PKCE_COOKIE_NAME = "treema_github_oauth";
const PKCE_COOKIE_MAX_AGE_SECONDS = 15 * 60;

function renderErrorPage(message) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>GitHub OAuth Start Failed</title>
    <style>
      body {
        margin: 0;
        padding: 48px 20px;
        background: #f4efe6;
        color: #1f2421;
        font-family: "Segoe UI", Helvetica, Arial, sans-serif;
      }
      main {
        max-width: 720px;
        margin: 0 auto;
      }
      .card {
        background: #fffdf8;
        border: 1px solid #d7cfbf;
        border-radius: 22px;
        padding: 28px;
      }
    </style>
  </head>
  <body>
    <main>
      <article class="card">
        <h1>GitHub OAuth start failed</h1>
        <p>${message}</p>
      </article>
    </main>
  </body>
</html>`;
}

function buildPkceCookieHeader(cookieValue) {
  return `${PKCE_COOKIE_NAME}=${cookieValue}; Path=/; Max-Age=${PKCE_COOKIE_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

function resolveState(url) {
  const providedState = url.searchParams.get("state") || "";
  if (providedState) {
    const decoded = decodeGitHubOAuthState(providedState);
    if (!decoded.ok) {
      throw new Error("The provided GitHub OAuth state was invalid or expired.");
    }

    return {
      state: providedState,
      payload: decoded.payload
    };
  }

  return createGitHubOAuthState({
    target: url.searchParams.get("target") || "web",
    returnPath: url.searchParams.get("returnPath") || "/settings/accounts"
  });
}

export async function GET(request) {
  const url = new URL(request.url);

  try {
    const { state } = resolveState(url);
    const pkceSession = createGitHubOAuthPkceSession({ state });
    const authorizeUrl = buildGitHubOAuthAuthorizeUrl(state, {
      codeChallenge: pkceSession.codeChallenge
    });
    return new Response(null, {
      status: 302,
      headers: {
        Location: authorizeUrl,
        "Set-Cookie": buildPkceCookieHeader(pkceSession.cookieValue),
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return new Response(renderErrorPage(error.message || "Unable to start GitHub OAuth."), {
      status: 500,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  }
}
