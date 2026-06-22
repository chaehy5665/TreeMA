const GITHUB_MODELS_CATALOG_URL = "https://models.github.ai/catalog/models";
export const GITHUB_MODELS_API_VERSION = "2026-03-10";
export const DEFAULT_GITHUB_MODELS_MODEL = "github-copilot/gpt-5.4-mini";

const GITHUB_MODEL_ALIAS_PREFERENCES = {
  [DEFAULT_GITHUB_MODELS_MODEL]: ["openai/gpt-5-mini", "openai/gpt-5-chat", "openai/gpt-5", "openai/gpt-4.1-mini", "openai/gpt-4.1"]
};

const GITHUB_MODEL_PROBE_PROMPT = {
  temperature: 0,
  messages: [{ role: "user", content: "Return exactly ok" }]
};

function createGitHubModelAccessError(message, code, details = {}) {
  const error = new Error(message);
  error.name = "GitHubModelAccessError";
  error.code = code;
  error.details = details;
  return error;
}

export async function fetchGitHubCatalogModels(githubToken) {
  const response = await fetch(GITHUB_MODELS_CATALOG_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_MODELS_API_VERSION,
      Authorization: `Bearer ${githubToken}`
    }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`github-copilot catalog request failed with status ${response.status}.`);
  }
  return JSON.parse(text);
}

async function probeGitHubModelAccess(githubToken, model) {
  const response = await fetch("https://models.github.ai/inference/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_MODELS_API_VERSION,
      Authorization: `Bearer ${githubToken}`
    },
    body: JSON.stringify({
      model,
      ...GITHUB_MODEL_PROBE_PROMPT
    })
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {}

  if (response.ok) {
    return { ok: true, model };
  }

  if (response.status === 429) {
    return { ok: false, code: "rate_limited", model };
  }

  if (payload?.error?.code === "no_access") {
    return { ok: false, code: "no_access", model };
  }

  throw new Error(payload?.error?.message || payload?.message || `github-copilot request failed with status ${response.status}.`);
}

export function resolveGitHubModelSelection(requestedModel, catalogModels) {
  const available = new Set(catalogModels.map((item) => item.id).filter(Boolean));
  if (requestedModel && available.has(requestedModel)) {
    return requestedModel;
  }

  const aliasCandidates = GITHUB_MODEL_ALIAS_PREFERENCES[requestedModel] || [];
  for (const candidate of aliasCandidates) {
    if (available.has(candidate)) return candidate;
  }

  const preferred = ["openai/gpt-5-mini", "openai/gpt-5-chat", "openai/gpt-5", "openai/gpt-4.1-mini", "openai/gpt-4.1"];
  for (const candidate of preferred) {
    if (available.has(candidate)) return candidate;
  }

  return catalogModels.find((item) => item.capabilities?.includes("agents") || item.capabilities?.includes("tool-calling"))?.id || catalogModels[0]?.id || requestedModel;
}

export async function resolveAccessibleGitHubModel(githubToken, requestedModel, catalogModels = null) {
  const resolvedCatalogModels = catalogModels || (await fetchGitHubCatalogModels(githubToken));
  const available = new Set(resolvedCatalogModels.map((item) => item.id).filter(Boolean));
  const candidates = [];

  if (requestedModel && available.has(requestedModel)) {
    candidates.push(requestedModel);
  }

  for (const candidate of GITHUB_MODEL_ALIAS_PREFERENCES[requestedModel] || []) {
    if (available.has(candidate) && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  }

  for (const candidate of ["openai/gpt-5-mini", "openai/gpt-5-chat", "openai/gpt-5", "openai/gpt-4.1-mini", "openai/gpt-4.1", "openai/gpt-4o-mini", "openai/gpt-4o"]) {
    if (available.has(candidate) && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  }

  const heuristic = resolveGitHubModelSelection(requestedModel, resolvedCatalogModels);
  if (heuristic && available.has(heuristic) && !candidates.includes(heuristic)) {
    candidates.push(heuristic);
  }

  const probeCandidates = candidates.slice(0, 4);
  for (const candidate of probeCandidates) {
    const probe = await probeGitHubModelAccess(githubToken, candidate);
    if (probe.ok) {
      return {
        model: candidate,
        attemptedModels: probeCandidates,
        catalogModels: resolvedCatalogModels
      };
    }
    if (probe.code === "rate_limited") {
      throw createGitHubModelAccessError(
        "GitHub Copilot model access checks are currently rate-limited. Wait a moment and retry Project Scan.",
        "GITHUB_MODEL_ACCESS_RATE_LIMITED",
        {
          attemptedModels: probeCandidates
        }
      );
    }
  }

  throw createGitHubModelAccessError(
    "GitHub Copilot is connected, but this token does not have access to any supported inference model for Project Scan.",
    "GITHUB_MODEL_ACCESS_UNAVAILABLE",
    {
      attemptedModels: probeCandidates
    }
  );
}
