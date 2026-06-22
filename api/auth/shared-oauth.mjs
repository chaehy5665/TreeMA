function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function normalizeHostedOAuthTarget(value) {
  return String(value || "").trim() === "desktop" ? "desktop" : "web";
}

export function resolveHostedOAuthTarget(url, decodeState) {
  const providedState = url.searchParams.get("state") || "";
  if (providedState) {
    const decoded = decodeState(providedState);
    if (decoded.ok) {
      return decoded.payload.target;
    }
  }

  return normalizeHostedOAuthTarget(url.searchParams.get("target"));
}

export function buildHostedPkceCookieHeader(cookieName, cookieValue, maxAgeSeconds) {
  return `${cookieName}=${cookieValue}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export function renderHostedOAuthStartErrorPage({ providerId, providerLabel, message, target }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${providerLabel} OAuth Start Failed</title>
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
        <h1>${providerLabel} OAuth start failed</h1>
        <p><strong>Provider ID:</strong> ${providerId}</p>
        <p><strong>Target:</strong> ${target}</p>
        <p><strong>Result:</strong> start failed</p>
        <p>${message}</p>
      </article>
    </main>
  </body>
</html>`;
}

export function buildHostedOAuthContinuationParams(searchParams) {
  return {
    code: searchParams.get("code") || "",
    state: searchParams.get("state") || "",
    error: searchParams.get("error") || "",
    error_description: searchParams.get("error_description") || ""
  };
}

export function resolveHostedOAuthCallbackTarget(decodedState) {
  return decodedState?.ok ? decodedState.payload.target : "unknown";
}

export function validateHostedOAuthCallbackParams(params, providerLabel) {
  if (params.code && params.error) {
    return `${providerLabel} callback returned both code and error parameters.`;
  }

  if (!params.state) {
    return `${providerLabel} callback missing required state parameter.`;
  }

  if (!params.error && !params.code) {
    return `${providerLabel} callback missing required code parameter.`;
  }

  return "";
}

export function getCookieValue(header, key) {
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

export function clearHostedPkceCookieHeader(cookieName) {
  return `${cookieName}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function encodeHostedOAuthFragmentPayload(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function renderHostedOAuthCallbackErrorPage({ providerId, providerLabel, callbackUrl, receipt, message, target, title }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title || `${providerLabel} Authorization Failed`}</title>
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
        <h1>${providerLabel} callback failed</h1>
        <p><strong>Provider ID:</strong> ${providerId}</p>
        <p><strong>Target:</strong> ${escapeHtml(target)}</p>
        <p><strong>Result:</strong> failed</p>
        <p>${escapeHtml(message)}</p>
        <p>Callback status: ${escapeHtml(receipt?.message || "No callback receipt was recorded.")}</p>
        <p>Hosted callback URL</p>
        <span class="code">${escapeHtml(callbackUrl)}</span>
        ${receipt?.statePreview ? `<p>State preview: ${escapeHtml(receipt.statePreview)}</p>` : ""}
      </article>
    </main>
  </body>
</html>`;
}

export function renderHostedOAuthDesktopHandoffPage({
  bridgeUrl,
  callbackUrl,
  deepLinkUrl,
  desktopHelpUrl = "https://app.treesma.com/settings/download",
  failureFlowLabel,
  providerId,
  providerLabel,
  receipt,
  target,
  transferPayload
}) {
  const reconnectLabel = failureFlowLabel || providerLabel;
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
        <h1>${providerLabel} desktop handoff</h1>
        <p>The hosted callback on <strong>treesma.com</strong> completed for TreeMA Desktop. TreeMA will now try the local loopback handoff, then focus the desktop app through the registered <code>treesma://</code> protocol.</p>
        <p><strong>Provider ID:</strong> ${providerId}</p>
        <p><strong>Target:</strong> ${escapeHtml(target)}</p>
        <p><strong>Result:</strong> hosted callback complete; desktop handoff pending</p>
        <p>Callback status: ${escapeHtml(receipt.message)}</p>
        <div class="status" data-desktop-status>Result: hosted callback completed. Connecting to the local TreeMA Desktop runtime now...</div>
        <div class="actions">
          <a class="button button-primary" href="${escapeHtml(deepLinkUrl)}">Open desktop app</a>
          <a class="button button-secondary" href="${escapeHtml(desktopHelpUrl)}">Desktop help</a>
        </div>
        <p>If the app is not running, launch TreeMA Desktop and restart the ${providerLabel} connection flow.</p>
        <p>Deep link</p>
        <span class="code">${escapeHtml(deepLinkUrl)}</span>
        <p>Hosted callback URL</p>
        <span class="code">${escapeHtml(callbackUrl)}</span>
      </article>
    </main>
    <script>
      const transferPayload = ${JSON.stringify(transferPayload)};
      const statusEl = document.querySelector("[data-desktop-status]");

      async function deliverTokens() {
        try {
          const response = await fetch(${JSON.stringify(bridgeUrl)}, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(transferPayload)
          });

          if (!response.ok) {
            throw new Error("Desktop runtime did not accept the OAuth completion.");
          }

          statusEl.textContent = "Result: hosted callback completed and the local TreeMA Desktop handoff succeeded. Opening TreeMA Desktop...";
          window.setTimeout(() => {
            window.location.href = ${JSON.stringify(deepLinkUrl)};
          }, 250);
        } catch (error) {
          statusEl.textContent = ${JSON.stringify(
            `Result: hosted callback completed, but the local TreeMA Desktop handoff failed. Launch the app and restart the ${reconnectLabel} connection flow.`
          )};
        }
      }

      deliverTokens();
    </script>
  </body>
</html>`;
}
