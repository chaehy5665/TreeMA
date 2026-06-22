export const DESKTOP_OAUTH_HANDOFF_HOST = "127.0.0.1";
export const DESKTOP_OAUTH_HANDOFF_PORT = 48152;
export const DESKTOP_OAUTH_DEEP_LINK_URL = "treesma://auth/complete";
const desktopOAuthDeepLink = new URL(DESKTOP_OAUTH_DEEP_LINK_URL);

export const DESKTOP_OAUTH_DEEP_LINK_PROTOCOL = desktopOAuthDeepLink.protocol;
export const DESKTOP_OAUTH_DEEP_LINK_PREFIX = `${desktopOAuthDeepLink.protocol}//`;
export const DESKTOP_OAUTH_DEEP_LINK_ROUTE = `${desktopOAuthDeepLink.host}${desktopOAuthDeepLink.pathname}`;
export const OAUTH_HANDOFF_PROVIDERS = Object.freeze({
  GITHUB: "github-copilot",
  OPENAI: "chatgpt-codex"
});
export const OAUTH_HANDOFF_PATHS = Object.freeze({
  [OAUTH_HANDOFF_PROVIDERS.GITHUB]: "/auth/github/complete",
  [OAUTH_HANDOFF_PROVIDERS.OPENAI]: "/auth/openai/complete"
});

export function normalizeOAuthHandoffProvider(value = "") {
  return String(value || "").trim() === OAUTH_HANDOFF_PROVIDERS.OPENAI
    ? OAUTH_HANDOFF_PROVIDERS.OPENAI
    : OAUTH_HANDOFF_PROVIDERS.GITHUB;
}

export function buildDesktopOAuthHandoffOrigin(options = {}) {
  const host = String(options.host || DESKTOP_OAUTH_HANDOFF_HOST).trim() || DESKTOP_OAUTH_HANDOFF_HOST;
  const port = Number(options.port) > 0 ? Number(options.port) : DESKTOP_OAUTH_HANDOFF_PORT;
  return `http://${host}:${port}`;
}

export function buildDesktopOAuthBridgeUrl(provider, options = {}) {
  const normalizedProvider = normalizeOAuthHandoffProvider(provider);
  return `${buildDesktopOAuthHandoffOrigin(options)}${OAUTH_HANDOFF_PATHS[normalizedProvider]}`;
}

export function buildDesktopOAuthDeepLink(params = {}) {
  const provider = normalizeOAuthHandoffProvider(params.provider);
  const url = new URL(DESKTOP_OAUTH_DEEP_LINK_URL);
  url.searchParams.set("provider", provider);

  for (const [key, value] of Object.entries(params)) {
    if (key === "provider") continue;
    const normalized = String(value || "").trim();
    if (normalized) {
      url.searchParams.set(key, normalized);
    }
  }

  return url.toString();
}
