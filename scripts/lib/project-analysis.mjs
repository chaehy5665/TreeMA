import path from "node:path";

import {
  ANALYSIS_VERSION,
  DEFAULT_PROMPT_SET_VERSION,
  SCAN_MODES,
  componentReportFilename,
  createArtifact,
  createProvenance,
  createStageStatus,
  getAnalysisRelativePaths,
  normalizeRelativePath,
  relativeArtifactPath,
  taskSpecFilename
} from "./analysis/contracts.mjs";
import { createAnalysisAiContext } from "./analysis/ai-client.mjs";
import { runJuniorAnalyst } from "./analysis/junior-analyst.mjs";
import { runProjectManager } from "./analysis/project-manager.mjs";
import { loadAnalysisBundle, persistAnalysisBundle } from "./analysis/persist.mjs";
import { runScanner } from "./analysis/scanner.mjs";
import { runSeniorAnalyst } from "./analysis/senior-analyst.mjs";
import { runSolutionArchitect } from "./analysis/solution-architect.mjs";
import { runValidator } from "./analysis/validator.mjs";

function buildArtifactManifest(scannerArtifacts, componentReports, seniorArtifacts, architectArtifacts, validationReport, executionArtifacts) {
  const relative = getAnalysisRelativePaths();

  return {
    inventory: {
      projectInventory: relative.inventory.projectInventory,
      fileIndex: relative.inventory.fileIndex,
      entrypoints: relative.inventory.entrypoints,
      candidateComponents: relative.inventory.candidateComponents,
      scanPriorities: scannerArtifacts?.scanPriorities ? relative.inventory.scanPriorities : null,
      evidenceBundles: scannerArtifacts?.evidenceBundles ? relative.inventory.evidenceBundles : null,
      scanRationale: scannerArtifacts?.scanRationale ? relative.inventory.scanRationale : null,
      domainHypotheses: scannerArtifacts?.domainHypotheses ? relative.inventory.domainHypotheses : null
    },
    analysis: {
      componentReportsDir: relative.analysis.componentReportsDir,
      componentReports: componentReports.map((report) =>
        relativeArtifactPath("analysis", "component_reports", componentReportFilename(report.componentId))
      ),
      systemMap: seniorArtifacts?.systemMap ? relative.analysis.systemMap : null,
      componentHierarchy: seniorArtifacts?.componentHierarchy ? relative.analysis.componentHierarchy : null,
      dependencyGraph: seniorArtifacts?.dependencyGraph ? relative.analysis.dependencyGraph : null,
      analysisGaps: seniorArtifacts?.analysisGaps ? relative.analysis.analysisGaps : null
    },
    architecture: {
      architectureBlueprint: architectArtifacts?.architectureBlueprint ? relative.architecture.architectureBlueprint : null,
      interfaceContracts: architectArtifacts?.interfaceContracts ? relative.architecture.interfaceContracts : null,
      moduleBoundaries: architectArtifacts?.moduleBoundaries ? relative.architecture.moduleBoundaries : null,
      implementationStrategy: architectArtifacts?.implementationStrategy ? relative.architecture.implementationStrategy : null,
      validationReport: validationReport ? relative.architecture.validationReport : null
    },
    execution: {
      executionPlan: executionArtifacts?.executionPlan ? relative.execution.executionPlan : null,
      taskSpecsDir: relative.execution.taskSpecsDir,
      taskSpecs: (executionArtifacts?.taskSpecs || []).map((task) =>
        relativeArtifactPath("execution", "task_specs", taskSpecFilename(task.taskId))
      )
    }
  };
}

function buildStageStatus({ scanMode, scannerArtifacts, componentReports, seniorArtifacts, architectArtifacts, validationReport, executionArtifacts }) {
  const scannerOutputs = [
    "inventory/project_inventory.json",
    "inventory/file_index.json",
    "inventory/entrypoints.json",
    "inventory/candidate_components.json"
  ];
  if (scannerArtifacts?.scanPriorities) scannerOutputs.push("inventory/scan_priorities.json");
  if (scannerArtifacts?.evidenceBundles) scannerOutputs.push("inventory/evidence_bundles.json");
  if (scannerArtifacts?.scanRationale) scannerOutputs.push("inventory/scan_rationale.json");
  if (scannerArtifacts?.domainHypotheses) scannerOutputs.push("inventory/domain_hypotheses.json");

  return {
    scanner: createStageStatus({
      status: "completed",
      stageMode: scanMode,
      outputArtifacts: scannerOutputs
    }),
    junior: createStageStatus({
      status: scanMode === SCAN_MODES.QUICK ? "unavailable" : componentReports.length > 0 ? "completed" : "failed",
      stageMode: scanMode,
      inputArtifacts: ["inventory/candidate_components.json"],
      outputArtifacts: componentReports.map((report) =>
        relativeArtifactPath("analysis", "component_reports", componentReportFilename(report.componentId))
      ),
      notes: scanMode === SCAN_MODES.QUICK ? ["Quick Scan does not run semantic analysis stages."] : []
    }),
    senior: createStageStatus({
      status: scanMode === SCAN_MODES.QUICK ? "unavailable" : seniorArtifacts?.systemMap ? "completed" : "failed",
      stageMode: scanMode,
      inputArtifacts: ["inventory/project_inventory.json", "analysis/component_reports"],
      outputArtifacts: seniorArtifacts?.systemMap
        ? [
            "analysis/system_map.json",
            "analysis/component_hierarchy.json",
            "analysis/dependency_graph.json",
            "analysis/analysis_gaps.json"
          ]
        : [],
      notes: scanMode === SCAN_MODES.QUICK ? ["Quick Scan does not synthesize system semantics."] : []
    }),
    architect: createStageStatus({
      status: scanMode === SCAN_MODES.QUICK ? "unavailable" : architectArtifacts?.architectureBlueprint ? "completed" : "failed",
      stageMode: scanMode,
      inputArtifacts: seniorArtifacts?.systemMap
        ? [
            "analysis/system_map.json",
            "analysis/component_hierarchy.json",
            "analysis/dependency_graph.json",
            "analysis/analysis_gaps.json"
          ]
        : [],
      outputArtifacts: architectArtifacts?.architectureBlueprint
        ? [
            "architecture/architecture_blueprint.json",
            "architecture/interface_contracts.json",
            "architecture/module_boundaries.json",
            "architecture/implementation_strategy.json"
          ]
        : [],
      notes: scanMode === SCAN_MODES.QUICK ? ["Quick Scan does not generate architecture artifacts."] : []
    }),
    validator: createStageStatus({
      status: scanMode === SCAN_MODES.QUICK ? "unavailable" : validationReport ? "completed" : "failed",
      stageMode: scanMode,
      inputArtifacts: architectArtifacts?.architectureBlueprint
        ? [
            "architecture/architecture_blueprint.json",
            "architecture/interface_contracts.json",
            "architecture/module_boundaries.json",
            "architecture/implementation_strategy.json"
          ]
        : [],
      outputArtifacts: validationReport ? ["architecture/validation_report.json"] : [],
      notes: scanMode === SCAN_MODES.QUICK ? ["Quick Scan has no execution gate."] : []
    }),
    pm: createStageStatus({
      status:
        scanMode === SCAN_MODES.QUICK
          ? "unavailable"
          : !validationReport
            ? "unavailable"
            : validationReport.summary.status === "blocked"
              ? "skipped"
              : executionArtifacts?.executionPlan
                ? "completed"
                : "failed",
      stageMode: scanMode,
      inputArtifacts: validationReport ? ["architecture/validation_report.json"] : [],
      outputArtifacts:
        executionArtifacts?.executionPlan
          ? [
              "execution/execution_plan.json",
              ...(executionArtifacts.taskSpecs || []).map((task) => `execution/task_specs/${taskSpecFilename(task.taskId)}`)
            ]
          : [],
      notes:
        scanMode === SCAN_MODES.QUICK
          ? ["Quick Scan does not produce execution artifacts."]
          : validationReport?.summary.status === "blocked"
            ? ["Validator returned blocking findings."]
            : []
    })
  };
}

function buildRootManifest({
  projectRoot,
  generatedAt,
  scanMode,
  aiContext,
  scannerArtifacts,
  componentReports,
  seniorArtifacts,
  architectArtifacts,
  validationReport,
  executionArtifacts
}) {
  const artifacts = buildArtifactManifest(
    scannerArtifacts,
    componentReports,
    seniorArtifacts,
    architectArtifacts,
    validationReport,
    executionArtifacts
  );
  const stageStatus = buildStageStatus({
    scanMode,
    scannerArtifacts,
    componentReports,
    seniorArtifacts,
    architectArtifacts,
    validationReport,
    executionArtifacts
  });
  const gateStatus = scanMode === SCAN_MODES.QUICK ? "unavailable" : validationReport?.summary?.status || "unavailable";
  const provenance = createProvenance({
    provider: aiContext?.provider || "",
    model: aiContext?.model || "",
    modelProfile: scanMode === SCAN_MODES.PROJECT ? "mixed" : "",
    promptVersion: aiContext?.promptVersion || DEFAULT_PROMPT_SET_VERSION,
    stageMode: scanMode,
    generatedFromCache: false
  });

  return createArtifact({
    artifactType: "analysis/root_manifest",
    generatedAt,
    observed: [
      normalizeRelativePath(projectRoot),
      ...scannerArtifacts.entrypoints.entrypoints.map((entrypoint) => entrypoint.path)
    ],
    inferred: [
      ...scannerArtifacts.projectInventory.summary.frameworks,
      ...scannerArtifacts.projectInventory.summary.projectKinds,
      ...(architectArtifacts?.implementationStrategy?.recommendedBuildOrder || [])
    ],
    uncertain:
      scanMode === SCAN_MODES.QUICK
        ? ["Quick Scan is evidence-only and does not include semantic readiness."]
        : validationReport?.summary?.nonBlockingCount > 0
          ? ["Review non-blocking findings before large execution changes."]
          : [],
    unknowns: uniqueSortedStrings([
      ...(scannerArtifacts.scanRationale?.criticalQuestions || []),
      ...(validationReport?.unknowns || [])
    ]),
    confidence:
      gateStatus === "ready" ? 0.82 : gateStatus === "blocked" ? 0.58 : scanMode === SCAN_MODES.QUICK ? 0.62 : 0.46,
    provenance,
    run: {
      projectRoot,
      projectName: scannerArtifacts.projectInventory.projectName,
      generatedAt,
      analysisVersion: ANALYSIS_VERSION,
      scanMode,
      scanCompleteness: scanMode === SCAN_MODES.QUICK ? "inventory_only" : gateStatus === "unavailable" ? "partial" : "semantic",
      aiRequired: scanMode === SCAN_MODES.PROJECT,
      provider: aiContext?.provider || "",
      modelProfile: scanMode === SCAN_MODES.PROJECT ? "mixed" : "deterministic",
      promptSetVersion: aiContext?.promptVersion || DEFAULT_PROMPT_SET_VERSION,
      migrationImpact: [
        "Project Scan is now AI-native and provider-backed.",
        "Quick Scan is the deterministic inventory fallback.",
        "Consumers must follow manifest artifact paths for stage detail."
      ]
    },
    summary: {
      projectName: scannerArtifacts.projectInventory.projectName,
      totalFiles: scannerArtifacts.projectInventory.summary.totalFiles,
      totalDirectories: scannerArtifacts.projectInventory.summary.totalDirectories,
      candidateComponentCount: scannerArtifacts.candidateComponents.components.length,
      componentReportCount: componentReports.length,
      domainCount:
        seniorArtifacts?.systemMap?.domains?.length || scannerArtifacts.domainHypotheses?.domains?.length || 0,
      moduleCount: architectArtifacts?.moduleBoundaries?.modules?.length || 0,
      taskCount: executionArtifacts?.taskSpecs?.length || 0,
      frameworks: scannerArtifacts.projectInventory.summary.frameworks,
      projectKinds: scannerArtifacts.projectInventory.summary.projectKinds
    },
    artifacts,
    stageStatus,
    gate: {
      status: gateStatus,
      blockingFindingCount: validationReport?.summary?.blockingCount || 0,
      nonBlockingFindingCount: validationReport?.summary?.nonBlockingCount || 0,
      executionArtifactsEmitted: Boolean(executionArtifacts?.executionPlan)
    }
  });
}

function uniqueSortedStrings(items) {
  return [...new Set(items.filter((item) => typeof item === "string" && item.trim().length > 0))].sort((left, right) =>
    left.localeCompare(right, "en")
  );
}

export async function analyzeProject(projectPath, options = {}) {
  const projectRoot = path.resolve(projectPath);
  const generatedAt = new Date().toISOString();
  const scanMode = options.mode === SCAN_MODES.QUICK ? SCAN_MODES.QUICK : SCAN_MODES.PROJECT;
  const aiContext = await createAnalysisAiContext({ scanMode });
  const scannerArtifacts = await runScanner(projectRoot, generatedAt, {
    scanMode,
    aiContext
  });

  let componentReports = [];
  let seniorArtifacts = null;
  let architectArtifacts = null;
  let validationReport = null;
  let executionArtifacts = { executionPlan: null, taskSpecs: [] };

  if (scanMode === SCAN_MODES.PROJECT) {
    componentReports = await runJuniorAnalyst(projectRoot, scannerArtifacts, generatedAt, {
      aiContext
    });
    seniorArtifacts = await runSeniorAnalyst(scannerArtifacts, componentReports, generatedAt, {
      aiContext
    });
    architectArtifacts = await runSolutionArchitect(seniorArtifacts, generatedAt, {
      aiContext
    });
    validationReport = await runValidator(architectArtifacts, seniorArtifacts, scannerArtifacts, generatedAt, {
      aiContext
    });
    executionArtifacts =
      validationReport.summary.status === "blocked"
        ? { executionPlan: null, taskSpecs: [] }
        : await runProjectManager(architectArtifacts, validationReport, generatedAt, { aiContext });
  }

  const rootManifest = buildRootManifest({
    projectRoot,
    generatedAt,
    scanMode,
    aiContext,
    scannerArtifacts,
    componentReports,
    seniorArtifacts,
    architectArtifacts,
    validationReport,
    executionArtifacts
  });

  return {
    projectRoot,
    rootManifest,
    inventory: {
      projectInventory: scannerArtifacts.projectInventory,
      fileIndex: scannerArtifacts.fileIndex,
      entrypoints: scannerArtifacts.entrypoints,
      candidateComponents: scannerArtifacts.candidateComponents,
      scanPriorities: scannerArtifacts.scanPriorities,
      evidenceBundles: scannerArtifacts.evidenceBundles,
      scanRationale: scannerArtifacts.scanRationale,
      domainHypotheses: scannerArtifacts.domainHypotheses
    },
    analysis: {
      componentReports,
      systemMap: seniorArtifacts?.systemMap || null,
      componentHierarchy: seniorArtifacts?.componentHierarchy || null,
      dependencyGraph: seniorArtifacts?.dependencyGraph || null,
      analysisGaps: seniorArtifacts?.analysisGaps || null
    },
    architecture: {
      architectureBlueprint: architectArtifacts?.architectureBlueprint || null,
      interfaceContracts: architectArtifacts?.interfaceContracts || null,
      moduleBoundaries: architectArtifacts?.moduleBoundaries || null,
      implementationStrategy: architectArtifacts?.implementationStrategy || null,
      validationReport
    },
    execution: executionArtifacts
  };
}

export async function persistProjectAnalysis(projectRoot, analysisBundle) {
  return persistAnalysisBundle(projectRoot, analysisBundle);
}

export async function loadProjectAnalysis(projectRoot) {
  return loadAnalysisBundle(projectRoot);
}
