import { buildDesktopOAuthDeepLink, OAUTH_HANDOFF_PROVIDERS } from "../scripts/lib/oauth-handoff-contract.js";

const WEB_GITHUB_STORAGE_KEY = "treema.web.github.oauth";
const WEB_OPENAI_STORAGE_KEY = "treema.web.openai.oauth";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function encodeFragmentValue(value) {
  return JSON.stringify(value);
}

function decodeBase64UrlJson(value) {
  try {
    const normalized = String(value || "").replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized + "===".slice((normalized.length + 3) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function decodeOAuthState(stateValue) {
  return decodeBase64UrlJson(stateValue);
}

function readSearchParams() {
  return new URLSearchParams(window.location.search);
}

function readHashParams() {
  const fragment = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  return new URLSearchParams(fragment);
}

function maskToken(token) {
  const value = String(token || "").trim();
  if (!value) return "";
  if (value.length <= 8) {
    return `${value.slice(0, 2)}••••`;
  }
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

function normalizeProvider(value) {
  return String(value || "").trim() === OAUTH_HANDOFF_PROVIDERS.OPENAI
    ? OAUTH_HANDOFF_PROVIDERS.OPENAI
    : OAUTH_HANDOFF_PROVIDERS.GITHUB;
}

function normalizeTarget(value) {
  return String(value || "").trim() === "desktop" ? "desktop" : "web";
}

function normalizeResult(value) {
  const normalized = String(value || "").trim();
  if (["success", "error", "browser-storage", "desktop-handoff", "local-runtime"].includes(normalized)) {
    return normalized;
  }
  return "";
}

function getProviderMeta(provider) {
  if (provider === OAUTH_HANDOFF_PROVIDERS.OPENAI) {
    return {
      id: OAUTH_HANDOFF_PROVIDERS.OPENAI,
      label: "ChatGPT Codex",
      fallbackLabel: "ChatGPT account"
    };
  }

  return {
    id: OAUTH_HANDOFF_PROVIDERS.GITHUB,
    label: "GitHub Copilot",
    fallbackLabel: "GitHub user"
  };
}

function buildResultLabel(result) {
  switch (result) {
    case "success":
      return "callback completed";
    case "error":
      return "failed";
    case "browser-storage":
      return "stored in this browser";
    case "desktop-handoff":
      return "ready for TreeMA Desktop handoff";
    case "local-runtime":
      return "handed back to the local TreeMA runtime";
    default:
      return "waiting for more details";
  }
}

function buildStatusText(context) {
  const provider = getProviderMeta(context.provider);
  return `${provider.label} ${context.target} result: ${buildResultLabel(context.result)}.`;
}

function buildAuthDetailMarkup(context) {
  const provider = getProviderMeta(context.provider);
  const activeHandoff = context.activeHandoff || {};
  const connectedAccount = activeHandoff.accountLogin || activeHandoff.accountLabel || "";

  return [
    `<li>Provider ID: ${escapeHtml(provider.id)}</li>`,
    `<li>Provider: ${escapeHtml(provider.label)}</li>`,
    `<li>Target: ${escapeHtml(context.target)}</li>`,
    `<li>Result: ${escapeHtml(buildResultLabel(context.result))}</li>`,
    context.decodedState?.returnPath ? `<li>Return path: ${escapeHtml(context.decodedState.returnPath)}</li>` : "",
    connectedAccount ? `<li>Connected account: ${escapeHtml(connectedAccount)}</li>` : "",
    activeHandoff.accountEmail ? `<li>Account email: ${escapeHtml(activeHandoff.accountEmail)}</li>` : "",
    activeHandoff.scope ? `<li>Granted scopes: ${escapeHtml(activeHandoff.scope)}</li>` : "",
    context.code && !activeHandoff.accessToken ? `<li>Authorization code preview: ${escapeHtml(maskToken(context.code))}</li>` : "",
    context.state ? `<li>State preview: ${escapeHtml(maskToken(context.state))}</li>` : "",
    context.error ? `<li>Error: ${escapeHtml(context.error)}</li>` : "",
    context.errorDescription ? `<li>Detail: ${escapeHtml(context.errorDescription)}</li>` : ""
  ]
    .filter(Boolean)
    .join("");
}

function renderAuthSummary(statusEl, detailEl, context) {
  statusEl.textContent = buildStatusText(context);
  statusEl.className = context.result === "error" ? "app-status-error" : "app-status-success";
  detailEl.innerHTML = buildAuthDetailMarkup(context);
}

function buildGuidanceNote(context) {
  if (context.target === "desktop") {
    return "Desktop target behavior stays hosted-first: the callback completes on treesma.com, then TreeMA guides the loopback and treesma:// handoff back into TreeMA Desktop.";
  }

  if (context.provider === OAUTH_HANDOFF_PROVIDERS.OPENAI) {
    return "Web target behavior keeps the ChatGPT Codex token set in this browser only when the local TreeMA runtime cannot accept the handoff.";
  }

  return "Web target behavior keeps the GitHub token in this browser as the current hosted fallback until a durable hosted account layer exists.";
}

function readStoredGitHubWebAuth() {
  try {
    const raw = window.localStorage.getItem(WEB_GITHUB_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function storeGitHubWebAuth(payload) {
  window.localStorage.setItem(WEB_GITHUB_STORAGE_KEY, encodeFragmentValue(payload));
}

function clearStoredGitHubWebAuth() {
  window.localStorage.removeItem(WEB_GITHUB_STORAGE_KEY);
}

function readStoredOpenAiWebAuth() {
  try {
    const raw = window.localStorage.getItem(WEB_OPENAI_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function storeOpenAiWebAuth(payload) {
  window.localStorage.setItem(WEB_OPENAI_STORAGE_KEY, encodeFragmentValue(payload));
}

function clearStoredOpenAiWebAuth() {
  window.localStorage.removeItem(WEB_OPENAI_STORAGE_KEY);
}

function storeOpenAiFallback(activeHandoff) {
  storeOpenAiWebAuth({
    provider: OAUTH_HANDOFF_PROVIDERS.OPENAI,
    accessToken: activeHandoff.accessToken,
    refreshToken: activeHandoff.refreshToken || "",
    expiresAt: activeHandoff.expiresAt || 0,
    accountId: activeHandoff.accountId || "",
    accountEmail: activeHandoff.accountEmail || "",
    accountLabel: activeHandoff.accountLabel || activeHandoff.accountEmail || "",
    connectedAt: activeHandoff.connectedAt || new Date().toISOString()
  });
}

async function handoffOpenAiWebAuthToLocalRuntime(decodedState, activeHandoff) {
  const bridgeUrl = typeof decodedState?.bridgeUrl === "string" ? decodedState.bridgeUrl : "";
  if (!bridgeUrl || !activeHandoff?.accessToken) {
    return { ok: false, bridged: false, redirectUrl: "" };
  }

  const response = await fetch(bridgeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      provider: OAUTH_HANDOFF_PROVIDERS.OPENAI,
      accessToken: activeHandoff.accessToken,
      refreshToken: activeHandoff.refreshToken || "",
      expiresAt: activeHandoff.expiresAt || 0,
      accountId: activeHandoff.accountId || "",
      accountEmail: activeHandoff.accountEmail || "",
      accountLabel: activeHandoff.accountLabel || activeHandoff.accountEmail || "",
      connectedAt: activeHandoff.connectedAt || new Date().toISOString()
    })
  });

  if (!response.ok) {
    throw new Error("Local TreeMA runtime did not accept the ChatGPT Codex OAuth handoff.");
  }

  const bridgeOrigin = new URL(bridgeUrl).origin;
  return {
    ok: true,
    bridged: true,
    redirectUrl: `${bridgeOrigin}${decodedState?.returnPath || "/"}`
  };
}

function buildDesktopNextLink(provider, params, decodedState) {
  const deepLinkParams = Object.fromEntries(params.entries());
  deepLinkParams.provider = provider;
  if (!deepLinkParams.target) {
    deepLinkParams.target = "desktop";
  }
  if (decodedState?.returnPath && !deepLinkParams.returnPath) {
    deepLinkParams.returnPath = decodedState.returnPath;
  }
  return buildDesktopOAuthDeepLink(deepLinkParams);
}

function shouldAutoLaunchDesktop(params, context) {
  return context.target === "desktop" && Boolean(context.state || context.code || context.error || params.get("result") || params.get("status"));
}

async function renderAuthComplete() {
  const params = readSearchParams();
  const hashParams = readHashParams();
  const code = params.get("code") || "";
  const error = params.get("error") || "";
  const errorDescription = params.get("error_description") || "";
  const state = params.get("state") || "";
  const decodedState = decodeOAuthState(state);
  const githubHandoff = decodeBase64UrlJson(hashParams.get("github_oauth") || "");
  const openAiHandoff = decodeBase64UrlJson(hashParams.get("openai_oauth") || "");
  const provider = normalizeProvider(params.get("provider") || (openAiHandoff ? OAUTH_HANDOFF_PROVIDERS.OPENAI : OAUTH_HANDOFF_PROVIDERS.GITHUB));
  const activeHandoff = provider === OAUTH_HANDOFF_PROVIDERS.OPENAI ? openAiHandoff : githubHandoff;
  const target = normalizeTarget(params.get("target") || decodedState?.target || "web");
  const statusEl = document.querySelector("[data-auth-status]");
  const detailEl = document.querySelector("[data-auth-details]");
  const nextLinkEl = document.querySelector("[data-auth-next-link]");
  const deepLinkEl = document.querySelector("[data-auth-deep-link]");
  const storageNoteEl = document.querySelector("[data-auth-storage-note]");

  let result = normalizeResult(params.get("result"));
  if (!result) {
    if (error) {
      result = "error";
    } else if (code || activeHandoff?.accessToken) {
      result = "success";
    } else if (target === "desktop") {
      result = "desktop-handoff";
    } else {
      result = "browser-storage";
    }
  }

  let context = {
    provider,
    target,
    result,
    code,
    error,
    errorDescription,
    state,
    decodedState,
    activeHandoff
  };

  if (storageNoteEl) {
    storageNoteEl.hidden = true;
    storageNoteEl.textContent = "";
  }

  if (target === "desktop") {
    const deepLink = buildDesktopNextLink(provider, params, decodedState);
    renderAuthSummary(statusEl, detailEl, context);
    nextLinkEl.href = deepLink;
    nextLinkEl.textContent = "Open TreeMA Desktop";
    deepLinkEl.textContent = deepLink;
    deepLinkEl.hidden = false;
    if (storageNoteEl) {
      storageNoteEl.hidden = false;
      storageNoteEl.textContent = buildGuidanceNote(context);
    }
    if (shouldAutoLaunchDesktop(params, context)) {
      window.setTimeout(() => {
        window.location.href = deepLink;
      }, 250);
    }
    return;
  }

  if (activeHandoff?.accessToken && !error) {
    if (provider === OAUTH_HANDOFF_PROVIDERS.OPENAI) {
      try {
        const localBridge = await handoffOpenAiWebAuthToLocalRuntime(decodedState, activeHandoff);
        if (localBridge.bridged) {
          context = {
            ...context,
            result: "local-runtime"
          };
          if (storageNoteEl) {
            storageNoteEl.hidden = false;
            storageNoteEl.textContent =
              "Provider chatgpt-codex completed for the web target and the local TreeMA runtime accepted the handoff. Tokens were stored outside `.treema`.";
          }
          nextLinkEl.href = localBridge.redirectUrl || "/";
          nextLinkEl.textContent = "Return to local TreeMA";
          if (localBridge.redirectUrl) {
            window.setTimeout(() => {
              window.location.href = localBridge.redirectUrl;
            }, 250);
          }
        } else {
          storeOpenAiFallback(activeHandoff);
          context = {
            ...context,
            result: "browser-storage"
          };
          if (storageNoteEl) {
            storageNoteEl.hidden = false;
            storageNoteEl.textContent =
              "Provider chatgpt-codex completed for the web target, but local handoff was unavailable. The hosted control plane kept the token set in this browser as the documented fallback.";
          }
        }
      } catch {
        storeOpenAiFallback(activeHandoff);
        context = {
          ...context,
          result: "browser-storage"
        };
        if (storageNoteEl) {
          storageNoteEl.hidden = false;
          storageNoteEl.textContent =
            "Provider chatgpt-codex completed for the web target, but the local TreeMA runtime was not reachable. The hosted control plane kept the token set in this browser as the documented fallback.";
        }
      }
    } else {
      storeGitHubWebAuth({
        provider: OAUTH_HANDOFF_PROVIDERS.GITHUB,
        accessToken: activeHandoff.accessToken,
        tokenType: activeHandoff.tokenType || "bearer",
        scope: activeHandoff.scope || "",
        accountLogin: activeHandoff.accountLogin || "",
        accountLabel: activeHandoff.accountLabel || activeHandoff.accountLogin || "",
        connectedAt: activeHandoff.connectedAt || new Date().toISOString()
      });
      context = {
        ...context,
        result: "browser-storage"
      };
      if (storageNoteEl) {
        storageNoteEl.hidden = false;
        storageNoteEl.textContent =
          "Provider github-copilot completed for the web target. The hosted control plane kept the token in this browser as the current fallback until durable hosted accounts exist.";
      }
    }

    window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
  }

  renderAuthSummary(statusEl, detailEl, context);

  if (!nextLinkEl.textContent.trim() || nextLinkEl.textContent.trim() === "Continue") {
    nextLinkEl.href = "/settings/accounts";
    nextLinkEl.textContent = "Return to account settings";
  }

  if (storageNoteEl && storageNoteEl.hidden && context.result !== "error") {
    storageNoteEl.hidden = false;
    storageNoteEl.textContent = buildGuidanceNote(context);
  }

  deepLinkEl.hidden = true;
}

function renderSettingsAccounts() {
  const openAiStatusEl = document.querySelector("[data-web-openai-status]");
  const openAiDisconnectButton = document.querySelector("[data-web-openai-disconnect]");
  const statusEl = document.querySelector("[data-web-github-status]");
  const disconnectButton = document.querySelector("[data-web-github-disconnect]");
  if (!statusEl || !disconnectButton || !openAiStatusEl || !openAiDisconnectButton) return;

  const openAiStored = readStoredOpenAiWebAuth();
  if (openAiStored?.accessToken) {
    openAiStatusEl.innerHTML = `
      <strong>Provider ID: ${escapeHtml(OAUTH_HANDOFF_PROVIDERS.OPENAI)} | Target: web | Result: stored in this browser.</strong>
      <p>Connected account: ${escapeHtml(openAiStored.accountLabel || openAiStored.accountEmail || "ChatGPT account")}</p>
      <p>Stored token preview: ${escapeHtml(maskToken(openAiStored.accessToken))}</p>
      <p>Account email: ${escapeHtml(openAiStored.accountEmail || "unknown")}</p>
    `;
  } else {
    openAiStatusEl.innerHTML = `
      <strong>Provider ID: ${escapeHtml(OAUTH_HANDOFF_PROVIDERS.OPENAI)} | Target: web | Result: not connected.</strong>
      <p>The hosted web surface keeps the ChatGPT Codex token set in this browser only when it cannot hand the tokens back to a reachable local TreeMA runtime.</p>
    `;
  }

  const stored = readStoredGitHubWebAuth();
  if (stored?.accessToken) {
    statusEl.innerHTML = `
      <strong>Provider ID: ${escapeHtml(OAUTH_HANDOFF_PROVIDERS.GITHUB)} | Target: web | Result: stored in this browser.</strong>
      <p>Connected account: ${escapeHtml(stored.accountLabel || stored.accountLogin || "GitHub user")}</p>
      <p>Stored token preview: ${escapeHtml(maskToken(stored.accessToken))}</p>
      <p>Granted scopes: ${escapeHtml(stored.scope || "unknown")}</p>
    `;
  } else {
    statusEl.innerHTML = `
      <strong>Provider ID: ${escapeHtml(OAUTH_HANDOFF_PROVIDERS.GITHUB)} | Target: web | Result: not connected.</strong>
      <p>The hosted web surface stores the current GitHub token in this browser until a server-backed account system exists.</p>
    `;
  }

  openAiDisconnectButton.onclick = () => {
    clearStoredOpenAiWebAuth();
    renderSettingsAccounts();
  };

  disconnectButton.onclick = () => {
    clearStoredGitHubWebAuth();
    renderSettingsAccounts();
  };
}

async function initAppPage() {
  const appPage = document.body.dataset.appPage || "";
  if (appPage === "auth-complete") {
    await renderAuthComplete();
    return;
  }

  if (appPage === "settings-accounts") {
    renderSettingsAccounts();
  }
}

void initAppPage();
