import path from "node:path";

export const ANALYSIS_VERSION = "0.3.0";
export const STAGE_ORDER = ["scanner", "junior", "senior", "architect", "validator", "pm"];
export const SCAN_MODES = {
  PROJECT: "project",
  QUICK: "quick"
};
export const STAGE_STATUSES = ["completed", "skipped", "failed", "partial", "unavailable"];
export const DEFAULT_PROMPT_SET_VERSION = "project-scan-v1";

export function normalizeRelativePath(value) {
  return String(value).split(path.sep).join("/");
}

export function toSlug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function toTitleCase(value) {
  return String(value)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

export function sortStrings(items) {
  return [...items].sort((left, right) => String(left).localeCompare(String(right), "en"));
}

export function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function uniqueSortedStrings(items) {
  return sortStrings(
    [...new Set(items.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
  );
}

export function clampConfidence(value, fallback = 0.5) {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return fallback;
  return Math.min(1, Math.max(0, Number(numeric.toFixed(2))));
}

export function createEvidence({
  observed = [],
  inferred = [],
  uncertain = [],
  unknowns = [],
  confidence = 0.5
} = {}) {
  return {
    observed: uniqueSortedStrings(observed),
    inferred: uniqueSortedStrings(inferred),
    uncertain: uniqueSortedStrings(uncertain),
    unknowns: uniqueSortedStrings(unknowns),
    confidence: clampConfidence(confidence)
  };
}

export function createArtifact({
  artifactType,
  generatedAt,
  observed = [],
  inferred = [],
  uncertain = [],
  unknowns = [],
  confidence = 0.5,
  provenance = null,
  evidenceRefs = [],
  claimRefs = [],
  ...rest
}) {
  return {
    artifactType,
    analysisVersion: ANALYSIS_VERSION,
    generatedAt,
    ...createEvidence({ observed, inferred, uncertain, unknowns, confidence }),
    ...(provenance ? { provenance } : {}),
    ...(evidenceRefs.length > 0 ? { evidenceRefs: uniqueSortedStrings(evidenceRefs) } : {}),
    ...(claimRefs.length > 0 ? { claimRefs: uniqueSortedStrings(claimRefs) } : {}),
    ...rest
  };
}

export function createStageStatus({
  status,
  inputArtifacts = [],
  outputArtifacts = [],
  notes = [],
  stageMode = "",
  error = ""
}) {
  return {
    status,
    ...(stageMode ? { stageMode } : {}),
    inputArtifacts: uniqueSortedStrings(inputArtifacts),
    outputArtifacts: uniqueSortedStrings(outputArtifacts),
    notes: uniqueSortedStrings(notes),
    ...(error ? { error } : {})
  };
}

export function createProvenance({
  provider = "",
  model = "",
  modelProfile = "",
  promptVersion = DEFAULT_PROMPT_SET_VERSION,
  stageMode = "",
  generatedFromCache = false
} = {}) {
  const value = {
    provider,
    model,
    promptVersion,
    stageMode,
    generatedFromCache: generatedFromCache === true
  };
  if (modelProfile) {
    value.modelProfile = modelProfile;
  }
  return value;
}

export function getAnalysisRelativePaths() {
  return {
    manifest: "project-structure.json",
    inventory: {
      projectInventory: "inventory/project_inventory.json",
      fileIndex: "inventory/file_index.json",
      entrypoints: "inventory/entrypoints.json",
      candidateComponents: "inventory/candidate_components.json",
      scanPriorities: "inventory/scan_priorities.json",
      evidenceBundles: "inventory/evidence_bundles.json",
      scanRationale: "inventory/scan_rationale.json",
      domainHypotheses: "inventory/domain_hypotheses.json"
    },
    analysis: {
      componentReportsDir: "analysis/component_reports",
      systemMap: "analysis/system_map.json",
      componentHierarchy: "analysis/component_hierarchy.json",
      dependencyGraph: "analysis/dependency_graph.json",
      analysisGaps: "analysis/analysis_gaps.json"
    },
    architecture: {
      architectureBlueprint: "architecture/architecture_blueprint.json",
      interfaceContracts: "architecture/interface_contracts.json",
      moduleBoundaries: "architecture/module_boundaries.json",
      implementationStrategy: "architecture/implementation_strategy.json",
      validationReport: "architecture/validation_report.json"
    },
    execution: {
      executionPlan: "execution/execution_plan.json",
      taskSpecsDir: "execution/task_specs"
    }
  };
}

export function getAnalysisPaths(projectRoot) {
  const analysisDir = path.join(projectRoot, ".treema", "analysis");
  const relative = getAnalysisRelativePaths();
  return {
    analysisDir,
    manifestPath: path.join(analysisDir, relative.manifest),
    inventoryDir: path.join(analysisDir, "inventory"),
    analysisDataDir: path.join(analysisDir, "analysis"),
    componentReportsDir: path.join(analysisDir, "analysis", "component_reports"),
    architectureDir: path.join(analysisDir, "architecture"),
    executionDir: path.join(analysisDir, "execution"),
    taskSpecsDir: path.join(analysisDir, "execution", "task_specs"),
    relative
  };
}

export function relativeArtifactPath(...segments) {
  return normalizeRelativePath(path.join(...segments));
}

export function componentReportFilename(componentId) {
  return `${toSlug(componentId) || "component-report"}.json`;
}

export function taskSpecFilename(taskId) {
  return `${toSlug(taskId) || "task-spec"}.json`;
}

export function summarizeStageArtifacts(relativeGroup, entries) {
  return entries
    .filter(Boolean)
    .map((entry) => relativeArtifactPath(relativeGroup, entry))
    .sort((left, right) => left.localeCompare(right, "en"));
}

export function toArtifactRef(value) {
  return normalizeRelativePath(String(value || "").trim());
}
