import path from "node:path";

import { createArtifact, createProvenance, uniqueSortedStrings } from "./contracts.mjs";

function resolveLocalImport(componentPath, importPath, fileSet) {
  if (!importPath.startsWith(".")) return null;
  const basePath = path.posix.normalize(path.posix.join(path.posix.dirname(componentPath), importPath));
  const candidates = [
    basePath,
    `${basePath}.js`,
    `${basePath}.mjs`,
    `${basePath}.cjs`,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.jsx`,
    `${basePath}/index.js`,
    `${basePath}/index.mjs`,
    `${basePath}/index.ts`,
    `${basePath}/index.tsx`,
    `${basePath}/index.jsx`
  ];
  return candidates.find((candidate) => fileSet.has(candidate)) || null;
}

function extractPackageName(importPath) {
  if (importPath.startsWith("node:")) return importPath;
  if (importPath.startsWith("@")) {
    const [scope, name] = importPath.split("/");
    return name ? `${scope}/${name}` : scope;
  }
  return importPath.split("/")[0];
}

function inferCompanionTests(componentPaths, fileSet) {
  const tests = [];
  for (const componentPath of componentPaths) {
    const ext = path.extname(componentPath);
    const withoutExt = componentPath.slice(0, -ext.length);
    const candidates = [
      `${withoutExt}.test${ext}`,
      `${withoutExt}.spec${ext}`,
      `${withoutExt}.integration${ext}`,
      `${path.dirname(componentPath)}/${path.basename(withoutExt)}.test${ext}`,
      `${path.dirname(componentPath)}/${path.basename(withoutExt)}.spec${ext}`
    ];
    tests.push(...candidates.filter((candidate) => fileSet.has(candidate)));
  }
  return uniqueSortedStrings(tests);
}

function buildDependencyDetails(component, imports, scannerArtifacts) {
  const fileSet = new Set(scannerArtifacts.fileIndex.files.map((entry) => entry.path));
  const componentByPath = new Map();
  for (const candidate of scannerArtifacts.candidateComponents.components) {
    for (const filePath of candidate.primaryFiles || [candidate.path]) {
      componentByPath.set(filePath, candidate);
    }
  }

  return imports.map(({ sourcePath, importPath }) => {
    const resolvedPath = resolveLocalImport(sourcePath, importPath, fileSet);
    if (resolvedPath) {
      const targetComponent = componentByPath.get(resolvedPath) || null;
      return {
        importPath,
        sourcePath,
        kind: "local",
        resolvedPath,
        targetComponentId: targetComponent?.id ?? null,
        targetClusterId: targetComponent?.grouping?.clusterId ?? null,
        targetLabel: targetComponent?.name ?? path.basename(resolvedPath, path.extname(resolvedPath)),
        confidence: targetComponent ? 0.92 : 0.7
      };
    }

    const packageName = extractPackageName(importPath);
    return {
      importPath,
      sourcePath,
      kind: importPath.startsWith("node:") ? "node_builtin" : "external",
      resolvedPath: null,
      targetComponentId: null,
      targetClusterId: null,
      targetLabel: packageName,
      confidence: importPath.startsWith("node:") ? 0.95 : 0.84
    };
  });
}

function buildJuniorPromptPayload(component, scannerArtifacts) {
  const fileIndex = new Map(scannerArtifacts.fileIndex.files.map((entry) => [entry.path, entry]));
  const bundle = (scannerArtifacts.evidenceBundles?.bundles || []).find((item) => item.id === component.bundleId) || null;
  const fileDetails = (component.primaryFiles || [component.path])
    .map((targetPath) => fileIndex.get(targetPath))
    .filter(Boolean)
    .map((entry) => ({
      path: entry.path,
      kind: entry.kind,
      group: entry.group,
      imports: entry.imports || [],
      symbolHints: entry.symbolHints || [],
      preview: entry.evidenceSpans?.[0]?.excerpt || ""
    }));

  return {
    component: {
      id: component.id,
      name: component.name,
      type: component.type,
      grouping: component.grouping,
      rationale: component.rationale,
      primaryFiles: component.primaryFiles || [component.path],
      evidenceRefs: component.evidenceRefs || []
    },
    bundle,
    scanRationale: scannerArtifacts.scanRationale
      ? {
          summary: scannerArtifacts.scanRationale.summary,
          focusAreas: scannerArtifacts.scanRationale.focusAreas
        }
      : null,
    domains: scannerArtifacts.domainHypotheses?.domains || [],
    files: fileDetails
  };
}

function normalizeTextList(value, fallback = []) {
  return uniqueSortedStrings(Array.isArray(value) ? value.filter((item) => typeof item === "string") : fallback);
}

function normalizeState(value) {
  return {
    local_state: normalizeTextList(value?.local_state || value?.localState, []),
    server_state: normalizeTextList(value?.server_state || value?.serverState, [])
  };
}

function inferConfidence(component, dependencyDetails, companionTests, aiConfidence) {
  let score = component.candidateConfidence ?? 0.6;
  const localDependencies = dependencyDetails.filter((item) => item.kind === "local");
  const resolvedLocalDependencies = localDependencies.filter((item) => item.targetComponentId || item.resolvedPath);
  const externalDependencies = dependencyDetails.filter((item) => item.kind !== "local");

  if (dependencyDetails.length > 0) score += 0.05;
  if (resolvedLocalDependencies.length > 0) score += 0.09;
  if (localDependencies.length > resolvedLocalDependencies.length) score -= 0.05;
  if (externalDependencies.length > 0 && resolvedLocalDependencies.length === 0) score -= 0.03;
  if (companionTests.length > 0) score += 0.07;
  if (typeof aiConfidence === "number") {
    score = (score + aiConfidence) / 2;
  }

  return Math.min(0.96, Math.max(0.38, Number(score.toFixed(2))));
}

export async function runJuniorAnalyst(projectRoot, scannerArtifacts, generatedAt, options = {}) {
  const aiContext = options.aiContext;
  const reports = [];
  const fileSet = new Set(scannerArtifacts.fileIndex.files.map((entry) => entry.path));

  for (const component of scannerArtifacts.candidateComponents.components) {
    const promptPayload = buildJuniorPromptPayload(component, scannerArtifacts);
    const aiResponse = await aiContext.runJsonStage(
      `junior-${component.id}`,
      promptPayload,
      {
        modelProfile: "fast",
        userPrompt: `You are the Junior Analyst stage in TreeMA.
Return one JSON object with this shape:
{
  "responsibility": "string",
  "inputs": ["string"],
  "outputs": ["string"],
  "state": { "local_state": ["string"], "server_state": ["string"] },
  "risks": ["string"],
  "missingPieces": ["string"],
  "evidenceRefs": ["path or evidence ref"],
  "confidence": 0.0
}
Rules:
- Use only the provided bundle and file context.
- Prefer grounded, concise responsibilities.
- If evidence is weak, say so in missingPieces or risks instead of inventing behavior.`
      }
    );

    const fileEntries = (component.primaryFiles || [component.path])
      .map((targetPath) => scannerArtifacts.fileIndex.files.find((entry) => entry.path === targetPath))
      .filter(Boolean);
    const imports = uniqueSortedStrings(
      fileEntries.flatMap((entry) => (entry.imports || []).map((importPath) => `${entry.path}::${importPath}`))
    ).map((value) => {
      const [sourcePath, importPath] = value.split("::");
      return { sourcePath, importPath };
    });
    const dependencyDetails = buildDependencyDetails(component, imports, scannerArtifacts);
    const normalizedDependencies = uniqueSortedStrings(
      dependencyDetails.map((detail) => detail.targetComponentId || detail.resolvedPath || detail.targetLabel)
    );
    const companionTests = inferCompanionTests(component.primaryFiles || [component.path], fileSet);
    const confidence = inferConfidence(component, dependencyDetails, companionTests, Number(aiResponse.data?.confidence));
    const evidenceRefs = uniqueSortedStrings(
      (aiResponse.data?.evidenceRefs || []).filter((value) => typeof value === "string" && value.trim().length > 0)
    ).filter((value) =>
      value.startsWith("evidence:") ||
      fileSet.has(value) ||
      (component.primaryFiles || [component.path]).includes(value)
    );
    const provenance = createProvenance({
      ...aiResponse.provenance
    });

    const responsibility =
      String(aiResponse.data?.responsibility || component.rationale || `${component.name} owns a focused project responsibility.`).trim();

    const report = createArtifact({
      artifactType: "analysis/component_report",
      generatedAt,
      observed: [...(component.primaryFiles || [component.path]), ...imports.map((item) => item.importPath), ...companionTests],
      inferred: [responsibility, ...normalizeTextList(aiResponse.data?.inputs), ...normalizeTextList(aiResponse.data?.outputs)],
      uncertain:
        evidenceRefs.length === 0 ? ["Component semantic claims are grounded mostly by file-level evidence."] : [],
      unknowns: normalizeTextList(aiResponse.data?.missingPieces),
      confidence,
      provenance,
      evidenceRefs: evidenceRefs.length > 0 ? evidenceRefs : uniqueSortedStrings(component.evidenceRefs || component.primaryFiles || [component.path]),
      componentId: component.id,
      name: component.name,
      type: component.type,
      grouping: component.grouping,
      responsibility,
      primaryFiles: component.primaryFiles || [component.path],
      inputs: normalizeTextList(aiResponse.data?.inputs, ["module invocation"]),
      outputs: normalizeTextList(aiResponse.data?.outputs, ["structured module output"]),
      dependencies: normalizedDependencies,
      dependencyDetails,
      companionTests,
      state: normalizeState(aiResponse.data?.state),
      risks: normalizeTextList(aiResponse.data?.risks),
      missingPieces: normalizeTextList(aiResponse.data?.missingPieces)
    });

    reports.push(report);
  }

  return reports.sort((left, right) => left.componentId.localeCompare(right.componentId, "en"));
}
