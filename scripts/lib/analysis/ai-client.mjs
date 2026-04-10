import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import { DEFAULT_PROMPT_SET_VERSION, SCAN_MODES } from "./contracts.mjs";
import { loadAnalysisProviderSettings } from "../account-settings.mjs";

const CACHE_ROOT = path.join(os.homedir(), ".treema", "cache", "project-scan");
const GITHUB_MODELS_API_VERSION = "2026-03-10";
const GITHUB_MODELS_CATALOG_URL = "https://models.github.ai/catalog/models";
const GITHUB_MODEL_ALIAS_PREFERENCES = {
  "github-copilot/gpt-5.4-mini": [
    "openai/gpt-5-mini",
    "openai/gpt-5-chat",
    "openai/gpt-5",
    "openai/gpt-4.1-mini",
    "openai/gpt-4.1"
  ]
};
const GITHUB_MODEL_PROBE_PROMPT = {
  temperature: 0,
  messages: [{ role: "user", content: "Return exactly ok" }]
};

export class ProjectScanUnavailableError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ProjectScanUnavailableError";
    this.code = "PROJECT_SCAN_UNAVAILABLE";
    this.details = details;
  }
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  return `{${Object.keys(value)
    .sort((left, right) => left.localeCompare(right, "en"))
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function hashValue(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

async function readJsonIfExists(targetPath) {
  try {
    const raw = await readFile(targetPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeJson(targetPath, value) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function stripCodeFence(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```[a-zA-Z0-9_-]*\n?/, "").replace(/\n?```$/, "").trim();
}

function parseJsonObject(raw) {
  const stripped = stripCodeFence(raw);
  try {
    return JSON.parse(stripped);
  } catch {}

  const firstBrace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return JSON.parse(stripped.slice(firstBrace, lastBrace + 1));
  }

  throw new Error("AI response did not contain valid JSON.");
}

async function fetchGitHubCatalogModels(githubToken) {
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

function resolveGitHubModelSelection(requestedModel, catalogModels) {
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

async function resolveAccessibleGitHubModel(githubToken, requestedModel, catalogModels) {
  const available = new Set(catalogModels.map((item) => item.id).filter(Boolean));
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

  const heuristic = resolveGitHubModelSelection(requestedModel, catalogModels);
  if (heuristic && available.has(heuristic) && !candidates.includes(heuristic)) {
    candidates.push(heuristic);
  }

  const probeCandidates = candidates.slice(0, 4);
  for (const candidate of probeCandidates) {
    const probe = await probeGitHubModelAccess(githubToken, candidate);
    if (probe.ok) {
      return candidate;
    }
    if (probe.code === "rate_limited") {
      throw new ProjectScanUnavailableError(
        "GitHub Copilot model access checks are currently rate-limited. Wait a moment and retry Project Scan.",
        {
          provider: "github-copilot",
          attemptedModels: probeCandidates
        }
      );
    }
  }

  throw new ProjectScanUnavailableError(
    "GitHub Copilot is connected, but this token does not have access to any supported inference model for Project Scan.",
    {
      provider: "github-copilot",
      attemptedModels: probeCandidates
    }
  );
}

export async function createAnalysisAiContext({ scanMode }) {
  if (scanMode !== SCAN_MODES.PROJECT) {
    return {
      enabled: false,
      scanMode,
      provider: "",
      model: "",
      promptVersion: DEFAULT_PROMPT_SET_VERSION,
      async runJsonStage() {
        throw new ProjectScanUnavailableError("AI stages are unavailable for Quick Scan.");
      }
    };
  }

  const providerSettings = await loadAnalysisProviderSettings("auto");
  if (!providerSettings.connected) {
    throw new ProjectScanUnavailableError("Project Scan requires a connected OpenAI or GitHub Copilot provider.", {
      providers: ["openai", "github-copilot"]
    });
  }

  const isOpenAi = providerSettings.provider === "openai";
  const isGitHubCopilot = providerSettings.provider === "github-copilot";
  const baseUrl = String(
    isOpenAi
      ? providerSettings.baseUrl || "https://api.openai.com/v1"
      : providerSettings.chatBaseUrl || "https://models.github.ai/inference"
  ).replace(/\/+$/, "");
  const githubCatalogModels = isGitHubCopilot ? await fetchGitHubCatalogModels(providerSettings.githubToken) : null;
  const model = isOpenAi
    ? providerSettings.defaultModel || "gpt-5.4-mini"
    : await resolveAccessibleGitHubModel(
        providerSettings.githubToken,
        providerSettings.defaultModel || "github-copilot/gpt-5.4-mini",
        githubCatalogModels
      );

  return {
    enabled: true,
    scanMode,
    provider: providerSettings.provider,
    model: model || "provider-default",
    promptVersion: DEFAULT_PROMPT_SET_VERSION,
    async runJsonStage(stageName, payload, options = {}) {
      const modelProfile = options.modelProfile || "balanced";
      const cacheKey = hashValue({
        provider: providerSettings.provider,
        stageName,
        model,
        modelProfile,
        promptVersion: DEFAULT_PROMPT_SET_VERSION,
        payload
      });
      const cachePath = path.join(CACHE_ROOT, stageName, `${cacheKey}.json`);
      const cached = await readJsonIfExists(cachePath);
      if (cached) {
        return {
          data: cached.data,
          provenance: {
            provider: providerSettings.provider,
            model: model || "provider-default",
            modelProfile,
            promptVersion: DEFAULT_PROMPT_SET_VERSION,
            stageMode: scanMode,
            generatedFromCache: true
          }
        };
      }

      const requestBody = {
        temperature: options.temperature ?? 0.2,
        messages: [
          {
            role: "system",
            content:
              options.systemPrompt ||
              "You are an analysis stage inside TreeMA. Return only one JSON object. Never wrap it in markdown."
          },
          {
            role: "user",
            content: `${options.userPrompt || "Return a JSON object that matches the requested schema."}\n\nInput:\n${JSON.stringify(
              payload
            )}`
          }
        ]
      };
      if (model) {
        requestBody.model = model;
      }

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(isGitHubCopilot
            ? {
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": GITHUB_MODELS_API_VERSION
              }
            : {}),
          Authorization: `Bearer ${isOpenAi ? providerSettings.apiKey : providerSettings.githubToken}`
        },
        body: JSON.stringify(requestBody)
      });

      const responseText = await response.text();
      let responseJson = null;
      try {
        responseJson = JSON.parse(responseText);
      } catch {}

      if (!response.ok) {
        const providerMessage =
          responseJson?.error?.message ||
          responseJson?.message ||
          `${providerSettings.provider} request failed with status ${response.status}.`;
        const message =
          isGitHubCopilot && responseJson?.error?.code === "no_access"
            ? `${providerMessage} Your GitHub token is connected, but it does not have access to the requested inference model.`
            : providerMessage;
        throw new Error(message);
      }

      const content = responseJson?.choices?.[0]?.message?.content || "";
      const data = parseJsonObject(content);
      await writeJson(cachePath, {
        stageName,
        createdAt: new Date().toISOString(),
        data
      });

      return {
        data,
        provenance: {
          provider: providerSettings.provider,
          model: model || "provider-default",
          modelProfile,
          promptVersion: DEFAULT_PROMPT_SET_VERSION,
          stageMode: scanMode,
          generatedFromCache: false
        }
      };
    }
  };
}
