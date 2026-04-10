const WEB_GITHUB_STORAGE_KEY = "treema.web.github.oauth";

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

function renderAuthComplete() {
  const params = readSearchParams();
  const hashParams = readHashParams();
  const code = params.get("code") || "";
  const error = params.get("error") || "";
  const errorDescription = params.get("error_description") || "";
  const state = params.get("state") || "";
  const handoff = decodeBase64UrlJson(hashParams.get("github_oauth") || "");
  const decodedState = decodeOAuthState(state);
  const statusEl = document.querySelector("[data-auth-status]");
  const detailEl = document.querySelector("[data-auth-details]");
  const nextLinkEl = document.querySelector("[data-auth-next-link]");
  const deepLinkEl = document.querySelector("[data-auth-deep-link]");
  const storageNoteEl = document.querySelector("[data-auth-storage-note]");
  const isSuccess = Boolean((code || handoff?.accessToken) && !error);

  statusEl.textContent = isSuccess ? "GitHub returned to app.treesma.com." : "GitHub returned an error.";
  statusEl.className = isSuccess ? "app-status-success" : "app-status-error";
  detailEl.innerHTML = [
    decodedState?.target ? `<li>Target: ${escapeHtml(decodedState.target)}</li>` : "",
    decodedState?.returnPath ? `<li>Return path: ${escapeHtml(decodedState.returnPath)}</li>` : "",
    handoff?.accountLogin ? `<li>Connected account: ${escapeHtml(handoff.accountLogin)}</li>` : "",
    handoff?.scope ? `<li>Granted scopes: ${escapeHtml(handoff.scope)}</li>` : "",
    code && !handoff?.accessToken ? `<li>Authorization code preview: ${escapeHtml(`${code.slice(0, 4)}...${code.slice(-4)}`)}</li>` : "",
    error ? `<li>Error: ${escapeHtml(error)}</li>` : "",
    errorDescription ? `<li>Detail: ${escapeHtml(errorDescription)}</li>` : ""
  ]
    .filter(Boolean)
    .join("");

  if (decodedState?.target === "desktop") {
    const deepLink = `treesma://auth/complete?${params.toString()}`;
    nextLinkEl.href = deepLink;
    nextLinkEl.textContent = "Open TreeMA Desktop";
    deepLinkEl.textContent = deepLink;
    deepLinkEl.hidden = false;
    window.setTimeout(() => {
      window.location.href = deepLink;
    }, 250);
    return;
  }

  if (handoff?.accessToken && !error) {
    storeGitHubWebAuth({
      provider: "github-copilot",
      accessToken: handoff.accessToken,
      tokenType: handoff.tokenType || "bearer",
      scope: handoff.scope || "",
      accountLogin: handoff.accountLogin || "",
      accountLabel: handoff.accountLabel || handoff.accountLogin || "",
      connectedAt: handoff.connectedAt || new Date().toISOString()
    });
    if (storageNoteEl) {
      storageNoteEl.hidden = false;
      storageNoteEl.textContent = "GitHub token stored in this browser for the hosted control-plane session.";
    }
    window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
  }

  nextLinkEl.href = "/settings/accounts";
  nextLinkEl.textContent = "Return to account settings";
  deepLinkEl.hidden = true;
}

function renderSettingsAccounts() {
  const statusEl = document.querySelector("[data-web-github-status]");
  const disconnectButton = document.querySelector("[data-web-github-disconnect]");
  if (!statusEl || !disconnectButton) return;

  const stored = readStoredGitHubWebAuth();
  if (stored?.accessToken) {
    statusEl.innerHTML = `
      <strong>Connected as ${escapeHtml(stored.accountLabel || stored.accountLogin || "GitHub user")}.</strong>
      <p>Stored token preview: ${escapeHtml(maskToken(stored.accessToken))}</p>
      <p>Granted scopes: ${escapeHtml(stored.scope || "unknown")}</p>
    `;
  } else {
    statusEl.innerHTML = `
      <strong>Not connected yet.</strong>
      <p>The hosted web surface stores the current GitHub OAuth token in this browser until a server-backed account system exists.</p>
    `;
  }

  disconnectButton.onclick = () => {
    clearStoredGitHubWebAuth();
    renderSettingsAccounts();
  };
}

function initAppPage() {
  const appPage = document.body.dataset.appPage || "";
  if (appPage === "auth-complete") {
    renderAuthComplete();
    return;
  }

  if (appPage === "settings-accounts") {
    renderSettingsAccounts();
  }
}

initAppPage();
