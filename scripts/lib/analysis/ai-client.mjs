import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import { CHATGPT_CODEX_PROVIDER, CHATGPT_CODEX_DEFAULT_MODEL, runChatGptCodexRequest } from "../chatgpt-codex.mjs";
import { DEFAULT_PROMPT_SET_VERSION, SCAN_MODES } from "./contracts.mjs";
import { loadAnalysisProviderSettings } from "../account-settings.mjs";
import { fetchGitHubCatalogModels, GITHUB_MODELS_API_VERSION, resolveAccessibleGitHubModel } from "../github-models.mjs";

const CACHE_ROOT = path.join(os.homedir(), ".treema", "cache", "project-scan");

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

function extractCodeFenceBlocks(value) {
  const matches = [];
  const pattern = /```[a-zA-Z0-9_-]*\n?([\s\S]*?)```/g;
  for (const match of String(value || "").matchAll(pattern)) {
    const block = String(match[1] || "").trim();
    if (block) {
      matches.push(block);
    }
  }
  return matches;
}

function extractBalancedJsonObjects(value) {
  const candidates = [];
  const source = String(value || "");
  let startIndex = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (startIndex === -1) {
      if (char === "{") {
        startIndex = index;
        depth = 1;
        inString = false;
        escaped = false;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        candidates.push(source.slice(startIndex, index + 1));
        startIndex = -1;
      }
    }
  }

  return candidates;
}

function tryParseJsonObject(value) {
  const parsed = JSON.parse(String(value || "").trim());
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed;
  }
  throw new Error("Parsed JSON was not an object.");
}

function safeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseJsonObject(raw, options = {}) {
  const stageName = typeof options.stageName === "string" ? options.stageName.trim() : "";
  const candidates = [];
  const stripped = stripCodeFence(raw);
  let lastParseError = null;

  for (const candidate of [
    String(raw || "").trim(),
    stripped,
    ...extractCodeFenceBlocks(raw),
    ...extractBalancedJsonObjects(stripped),
    ...extractBalancedJsonObjects(raw)
  ]) {
    const normalized = String(candidate || "").trim();
    if (normalized && !candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  }

  for (const candidate of candidates) {
    try {
      return tryParseJsonObject(candidate);
    } catch (error) {
      lastParseError = error;
    }
  }

  const reason = safeString(lastParseError?.message);
  throw new Error(
    `${stageName ? `AI response for stage ${stageName} did not contain valid JSON.` : "AI response did not contain valid JSON."}${
      reason ? ` Last parse failure: ${reason}` : ""
    }`
  );
}

function collectTextParts(value, textParts) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) {
      textParts.push(trimmed);
    }
    return;
  }

  if (!value || typeof value !== "object") return;

  if (Array.isArray(value)) {
    for (const item of value) {
      collectTextParts(item, textParts);
    }
    return;
  }

  for (const field of ["text", "output_text", "content", "value"]) {
    if (field in value) {
      collectTextParts(value[field], textParts);
    }
  }
}

function extractChatCompletionText(responseJson) {
  const textParts = [];
  collectTextParts(responseJson?.choices?.[0]?.message?.content, textParts);
  if (textParts.length === 0) {
    collectTextParts(responseJson?.choices?.[0]?.message, textParts);
  }
  return textParts.join("\n").trim();
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

  let providerSettings;
  try {
    providerSettings = await loadAnalysisProviderSettings("auto");
  } catch (error) {
    if (error?.code === "ACCOUNT_SETTINGS_CONTRACT_INVALID") {
      throw new ProjectScanUnavailableError(error.message, {
        providers: ["openai", CHATGPT_CODEX_PROVIDER, "github-copilot"],
        ...(error?.details && typeof error.details === "object" ? error.details : {})
      });
    }
    throw error;
  }

  if (!providerSettings.connected) {
    throw new ProjectScanUnavailableError(
      providerSettings.blockedReason ||
        "Project Scan requires a connected OpenAI, ChatGPT Codex OAuth, or GitHub Copilot provider.",
      {
        providers: ["openai", CHATGPT_CODEX_PROVIDER, "github-copilot"],
        requestedProvider: providerSettings.requestedProvider || "auto",
        selection: providerSettings.selection || null
      }
    );
  }

  const isOpenAi = providerSettings.provider === "openai";
  const isGitHubCopilot = providerSettings.provider === "github-copilot";
  const isChatGptCodex = providerSettings.provider === CHATGPT_CODEX_PROVIDER;
  const baseUrl = String(
    isOpenAi
      ? providerSettings.baseUrl || "https://api.openai.com/v1"
      : providerSettings.chatBaseUrl || "https://models.github.ai/inference"
  ).replace(/\/+$/, "");
  const githubCatalogModels = isGitHubCopilot ? await fetchGitHubCatalogModels(providerSettings.githubToken) : null;
  const model = isOpenAi
    ? providerSettings.defaultModel || "gpt-5.4-mini"
    : isGitHubCopilot
      ? await resolveAccessibleGitHubModel(providerSettings.githubToken, providerSettings.defaultModel || "github-copilot/gpt-5.4-mini", githubCatalogModels)
        .then((result) => result.model)
        .catch((error) => {
          if (error?.code === "GITHUB_MODEL_ACCESS_RATE_LIMITED" || error?.code === "GITHUB_MODEL_ACCESS_UNAVAILABLE") {
            throw new ProjectScanUnavailableError(error.message, {
              provider: "github-copilot",
              ...(error.details || {})
            });
          }
          throw error;
        })
      : providerSettings.defaultModel || CHATGPT_CODEX_DEFAULT_MODEL;

  return {
    enabled: true,
    scanMode,
    provider: providerSettings.provider,
    model: model || "provider-default",
    promptVersion: DEFAULT_PROMPT_SET_VERSION,
    async runJsonStage(stageName, payload, options = {}) {
      const systemPrompt =
        options.systemPrompt ||
        "You are an analysis stage inside TreeMA. Return only one JSON object. Never wrap it in markdown.";
      const userPrompt = `${options.userPrompt || "Return a JSON object that matches the requested schema."}\n\nInput:\n${JSON.stringify(
        payload
      )}`;
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

      async function requestStageContent(requestSystemPrompt, requestUserPrompt) {
        const requestBody = {
          temperature: options.temperature ?? 0.2,
          messages: [
            {
              role: "system",
              content: requestSystemPrompt
            },
            {
              role: "user",
              content: requestUserPrompt
            }
          ]
        };
        if (model) {
          requestBody.model = model;
        }

        if (isChatGptCodex) {
          const result = await runChatGptCodexRequest({
            accessToken: providerSettings.accessToken,
            accountId: providerSettings.accountId,
            model,
            instructions: requestSystemPrompt,
            inputText: requestUserPrompt
          });
          return result.text || "";
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
        let responseJsonParseError = null;
        try {
          responseJson = JSON.parse(responseText);
        } catch (error) {
          responseJsonParseError = error;
        }

        if (!response.ok) {
          const providerMessage =
            responseJson?.error?.message ||
            responseJson?.message ||
            (responseJsonParseError
              ? `${providerSettings.provider} request failed with status ${response.status}. Response body was not valid JSON.`
              : "") ||
            `${providerSettings.provider} request failed with status ${response.status}.`;
          const message =
            isGitHubCopilot && responseJson?.error?.code === "no_access"
              ? `${providerMessage} Your GitHub token is connected, but it does not have access to the requested inference model.`
              : providerMessage;
          throw new Error(message);
        }

        return extractChatCompletionText(responseJson);
      }

      let content = await requestStageContent(systemPrompt, userPrompt);
      let data;
      try {
        data = parseJsonObject(content, { stageName });
      } catch {
        const repairPrompt = [
          "Convert the prior model output into exactly one valid JSON object.",
          "Return only JSON with no explanation or markdown.",
          "",
          "Original stage instructions:",
          options.userPrompt || "Return a JSON object that matches the requested schema.",
          "",
          "Prior model output:",
          String(content || "").trim()
        ].join("\n");
        content = await requestStageContent(systemPrompt, repairPrompt);
        data = parseJsonObject(content, { stageName });
      }

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
