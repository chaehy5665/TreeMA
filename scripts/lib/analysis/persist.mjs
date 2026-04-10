import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { componentReportFilename, getAnalysisPaths, relativeArtifactPath, taskSpecFilename } from "./contracts.mjs";

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

async function removeIfExists(targetPath) {
  await rm(targetPath, { force: true, recursive: false });
}

async function listJsonArtifactPaths(targetDir, baseDir) {
  try {
    const entries = await readdir(targetDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => relativeArtifactPath(path.relative(baseDir, targetDir), entry.name))
      .sort((left, right) => left.localeCompare(right, "en"));
  } catch {
    return [];
  }
}

function resolveArtifactIndex(manifest, paths, componentReportPaths, taskSpecPaths, hasExecutionPlan) {
  const { relative } = paths;

  return {
    inventory: {
      ...relative.inventory,
      ...(manifest?.artifacts?.inventory ?? {})
    },
    analysis: {
      ...relative.analysis,
      ...(manifest?.artifacts?.analysis ?? {}),
      componentReports: manifest?.artifacts?.analysis?.componentReports ?? componentReportPaths
    },
    architecture: {
      ...relative.architecture,
      ...(manifest?.artifacts?.architecture ?? {})
    },
    execution: {
      ...relative.execution,
      ...(manifest?.artifacts?.execution ?? {}),
      executionPlan:
        manifest?.artifacts?.execution?.executionPlan ?? (hasExecutionPlan ? relative.execution.executionPlan : null),
      taskSpecs: manifest?.artifacts?.execution?.taskSpecs ?? taskSpecPaths
    }
  };
}

function normalizeRootManifest(
  manifest,
  projectRoot,
  artifacts,
  projectInventory,
  candidateComponents,
  componentReports,
  validationReport,
  executionPlan,
  taskSpecs
) {
  const legacyMode = !manifest?.artifacts;
  const projectSummary = projectInventory?.summary ?? {};
  const legacySummary = manifest?.summary ?? {};
  const projectName =
    legacySummary.projectName ??
    manifest?.run?.projectName ??
    projectInventory?.projectName ??
    path.basename(projectRoot);
  const validationSummary = validationReport?.summary ?? null;

  return {
    ...manifest,
    projectRoot: manifest?.projectRoot ?? projectRoot,
    generatedAt: manifest?.generatedAt ?? manifest?.run?.generatedAt ?? null,
    analysisVersion: manifest?.analysisVersion ?? manifest?.run?.analysisVersion ?? null,
    run: {
      ...(manifest?.run ?? {}),
      projectRoot: manifest?.run?.projectRoot ?? manifest?.projectRoot ?? projectRoot,
      projectName,
      generatedAt: manifest?.run?.generatedAt ?? manifest?.generatedAt ?? null,
      analysisVersion: manifest?.run?.analysisVersion ?? manifest?.analysisVersion ?? null,
      scanMode: manifest?.run?.scanMode ?? "project",
      scanCompleteness: manifest?.run?.scanCompleteness ?? "semantic",
      aiRequired: manifest?.run?.aiRequired ?? false,
      provider: manifest?.run?.provider ?? "",
      modelProfile: manifest?.run?.modelProfile ?? "",
      promptSetVersion: manifest?.run?.promptSetVersion ?? "",
      migrationImpact:
        manifest?.run?.migrationImpact ??
        (legacyMode ? ["legacy flat analysis payload loaded without a manifest artifact index"] : [])
    },
    summary: {
      ...legacySummary,
      projectName,
      totalFiles: legacySummary.totalFiles ?? projectSummary.totalFiles ?? 0,
      totalDirectories: legacySummary.totalDirectories ?? projectSummary.totalDirectories ?? 0,
      candidateComponentCount: legacySummary.candidateComponentCount ?? candidateComponents?.components?.length ?? 0,
      componentReportCount: legacySummary.componentReportCount ?? legacySummary.componentCount ?? componentReports.length,
      taskCount: legacySummary.taskCount ?? taskSpecs.length,
      frameworks: legacySummary.frameworks ?? projectSummary.frameworks ?? [],
      projectKinds: legacySummary.projectKinds ?? projectSummary.projectKinds ?? []
    },
    artifacts,
    gate: {
      ...(manifest?.gate ?? {}),
      status: manifest?.gate?.status ?? validationSummary?.status ?? (legacyMode ? "legacy" : "unknown"),
      blockingFindingCount: manifest?.gate?.blockingFindingCount ?? validationSummary?.blockingCount ?? 0,
      nonBlockingFindingCount: manifest?.gate?.nonBlockingFindingCount ?? validationSummary?.nonBlockingCount ?? 0,
      executionArtifactsEmitted: manifest?.gate?.executionArtifactsEmitted ?? Boolean(executionPlan)
    }
  };
}

export async function persistAnalysisBundle(projectRoot, bundle) {
  const paths = getAnalysisPaths(projectRoot);
  const { relative } = paths;

  await mkdir(paths.analysisDir, { recursive: true });
  await mkdir(paths.inventoryDir, { recursive: true });
  await mkdir(paths.analysisDataDir, { recursive: true });
  await mkdir(paths.architectureDir, { recursive: true });
  await mkdir(paths.executionDir, { recursive: true });

  await rm(paths.componentReportsDir, { recursive: true, force: true });
  await rm(paths.taskSpecsDir, { recursive: true, force: true });
  await mkdir(paths.componentReportsDir, { recursive: true });
  await mkdir(paths.taskSpecsDir, { recursive: true });

  await writeJson(path.join(paths.analysisDir, relative.inventory.projectInventory), bundle.inventory.projectInventory);
  await writeJson(path.join(paths.analysisDir, relative.inventory.fileIndex), bundle.inventory.fileIndex);
  await writeJson(path.join(paths.analysisDir, relative.inventory.entrypoints), bundle.inventory.entrypoints);
  await writeJson(
    path.join(paths.analysisDir, relative.inventory.candidateComponents),
    bundle.inventory.candidateComponents
  );
  if (bundle.inventory.scanPriorities) {
    await writeJson(path.join(paths.analysisDir, relative.inventory.scanPriorities), bundle.inventory.scanPriorities);
  } else {
    await removeIfExists(path.join(paths.analysisDir, relative.inventory.scanPriorities));
  }
  if (bundle.inventory.evidenceBundles) {
    await writeJson(path.join(paths.analysisDir, relative.inventory.evidenceBundles), bundle.inventory.evidenceBundles);
  } else {
    await removeIfExists(path.join(paths.analysisDir, relative.inventory.evidenceBundles));
  }
  if (bundle.inventory.scanRationale) {
    await writeJson(path.join(paths.analysisDir, relative.inventory.scanRationale), bundle.inventory.scanRationale);
  } else {
    await removeIfExists(path.join(paths.analysisDir, relative.inventory.scanRationale));
  }
  if (bundle.inventory.domainHypotheses) {
    await writeJson(path.join(paths.analysisDir, relative.inventory.domainHypotheses), bundle.inventory.domainHypotheses);
  } else {
    await removeIfExists(path.join(paths.analysisDir, relative.inventory.domainHypotheses));
  }

  for (const report of bundle.analysis.componentReports) {
    await writeJson(
      path.join(paths.analysisDir, relativeArtifactPath("analysis", "component_reports", componentReportFilename(report.componentId))),
      report
    );
  }

  if (bundle.analysis.systemMap) {
    await writeJson(path.join(paths.analysisDir, relative.analysis.systemMap), bundle.analysis.systemMap);
  } else {
    await removeIfExists(path.join(paths.analysisDir, relative.analysis.systemMap));
  }
  if (bundle.analysis.componentHierarchy) {
    await writeJson(path.join(paths.analysisDir, relative.analysis.componentHierarchy), bundle.analysis.componentHierarchy);
  } else {
    await removeIfExists(path.join(paths.analysisDir, relative.analysis.componentHierarchy));
  }
  if (bundle.analysis.dependencyGraph) {
    await writeJson(path.join(paths.analysisDir, relative.analysis.dependencyGraph), bundle.analysis.dependencyGraph);
  } else {
    await removeIfExists(path.join(paths.analysisDir, relative.analysis.dependencyGraph));
  }
  if (bundle.analysis.analysisGaps) {
    await writeJson(path.join(paths.analysisDir, relative.analysis.analysisGaps), bundle.analysis.analysisGaps);
  } else {
    await removeIfExists(path.join(paths.analysisDir, relative.analysis.analysisGaps));
  }

  if (bundle.architecture.architectureBlueprint) {
    await writeJson(
      path.join(paths.analysisDir, relative.architecture.architectureBlueprint),
      bundle.architecture.architectureBlueprint
    );
  } else {
    await removeIfExists(path.join(paths.analysisDir, relative.architecture.architectureBlueprint));
  }
  if (bundle.architecture.interfaceContracts) {
    await writeJson(
      path.join(paths.analysisDir, relative.architecture.interfaceContracts),
      bundle.architecture.interfaceContracts
    );
  } else {
    await removeIfExists(path.join(paths.analysisDir, relative.architecture.interfaceContracts));
  }
  if (bundle.architecture.moduleBoundaries) {
    await writeJson(
      path.join(paths.analysisDir, relative.architecture.moduleBoundaries),
      bundle.architecture.moduleBoundaries
    );
  } else {
    await removeIfExists(path.join(paths.analysisDir, relative.architecture.moduleBoundaries));
  }
  if (bundle.architecture.implementationStrategy) {
    await writeJson(
      path.join(paths.analysisDir, relative.architecture.implementationStrategy),
      bundle.architecture.implementationStrategy
    );
  } else {
    await removeIfExists(path.join(paths.analysisDir, relative.architecture.implementationStrategy));
  }
  if (bundle.architecture.validationReport) {
    await writeJson(
      path.join(paths.analysisDir, relative.architecture.validationReport),
      bundle.architecture.validationReport
    );
  } else {
    await removeIfExists(path.join(paths.analysisDir, relative.architecture.validationReport));
  }

  if (bundle.execution.executionPlan) {
    await writeJson(path.join(paths.analysisDir, relative.execution.executionPlan), bundle.execution.executionPlan);
    for (const taskSpec of bundle.execution.taskSpecs) {
      await writeJson(
        path.join(paths.analysisDir, relativeArtifactPath("execution", "task_specs", taskSpecFilename(taskSpec.taskId))),
        taskSpec
      );
    }
  } else {
    await removeIfExists(path.join(paths.analysisDir, relative.execution.executionPlan));
  }

  await writeJson(paths.manifestPath, bundle.rootManifest);

  return {
    analysisDir: paths.analysisDir,
    jsonPath: paths.manifestPath,
    manifestPath: paths.manifestPath
  };
}

export async function loadAnalysisBundle(projectRoot) {
  const paths = getAnalysisPaths(projectRoot);
  const manifest = await readJsonIfExists(paths.manifestPath);
  if (!manifest) {
    return null;
  }

  const componentReportPaths = await listJsonArtifactPaths(paths.componentReportsDir, paths.analysisDir);
  const taskSpecPaths = await listJsonArtifactPaths(paths.taskSpecsDir, paths.analysisDir);
  const fallbackExecutionPlan = await readJsonIfExists(path.join(paths.analysisDir, paths.relative.execution.executionPlan));
  const artifacts = resolveArtifactIndex(
    manifest,
    paths,
    componentReportPaths,
    taskSpecPaths,
    Boolean(fallbackExecutionPlan || manifest?.artifacts?.execution?.executionPlan)
  );

  const projectInventory = artifacts.inventory.projectInventory
    ? await readJsonIfExists(path.join(paths.analysisDir, artifacts.inventory.projectInventory))
    : null;
  const fileIndex = artifacts.inventory.fileIndex
    ? await readJsonIfExists(path.join(paths.analysisDir, artifacts.inventory.fileIndex))
    : null;
  const entrypoints = artifacts.inventory.entrypoints
    ? await readJsonIfExists(path.join(paths.analysisDir, artifacts.inventory.entrypoints))
    : null;
  const candidateComponents = artifacts.inventory.candidateComponents
    ? await readJsonIfExists(path.join(paths.analysisDir, artifacts.inventory.candidateComponents))
    : null;
  const scanPriorities = artifacts.inventory.scanPriorities
    ? await readJsonIfExists(path.join(paths.analysisDir, artifacts.inventory.scanPriorities))
    : null;
  const evidenceBundles = artifacts.inventory.evidenceBundles
    ? await readJsonIfExists(path.join(paths.analysisDir, artifacts.inventory.evidenceBundles))
    : null;
  const scanRationale = artifacts.inventory.scanRationale
    ? await readJsonIfExists(path.join(paths.analysisDir, artifacts.inventory.scanRationale))
    : null;
  const domainHypotheses = artifacts.inventory.domainHypotheses
    ? await readJsonIfExists(path.join(paths.analysisDir, artifacts.inventory.domainHypotheses))
    : null;

  const componentReports = [];
  for (const relativePath of artifacts.analysis.componentReports ?? []) {
    const report = await readJsonIfExists(path.join(paths.analysisDir, relativePath));
    if (report) componentReports.push(report);
  }

  const systemMap = artifacts.analysis.systemMap
    ? await readJsonIfExists(path.join(paths.analysisDir, artifacts.analysis.systemMap))
    : null;
  const componentHierarchy = artifacts.analysis.componentHierarchy
    ? await readJsonIfExists(path.join(paths.analysisDir, artifacts.analysis.componentHierarchy))
    : null;
  const dependencyGraph = artifacts.analysis.dependencyGraph
    ? await readJsonIfExists(path.join(paths.analysisDir, artifacts.analysis.dependencyGraph))
    : null;
  const analysisGaps = artifacts.analysis.analysisGaps
    ? await readJsonIfExists(path.join(paths.analysisDir, artifacts.analysis.analysisGaps))
    : null;

  const architectureBlueprint = artifacts.architecture.architectureBlueprint
    ? await readJsonIfExists(path.join(paths.analysisDir, artifacts.architecture.architectureBlueprint))
    : null;
  const interfaceContracts = artifacts.architecture.interfaceContracts
    ? await readJsonIfExists(path.join(paths.analysisDir, artifacts.architecture.interfaceContracts))
    : null;
  const moduleBoundaries = artifacts.architecture.moduleBoundaries
    ? await readJsonIfExists(path.join(paths.analysisDir, artifacts.architecture.moduleBoundaries))
    : null;
  const implementationStrategy = artifacts.architecture.implementationStrategy
    ? await readJsonIfExists(path.join(paths.analysisDir, artifacts.architecture.implementationStrategy))
    : null;
  const validationReport = artifacts.architecture.validationReport
    ? await readJsonIfExists(path.join(paths.analysisDir, artifacts.architecture.validationReport))
    : null;

  const taskSpecs = [];
  for (const relativePath of artifacts.execution.taskSpecs ?? []) {
    const task = await readJsonIfExists(path.join(paths.analysisDir, relativePath));
    if (task) taskSpecs.push(task);
  }

  const executionPlan =
    artifacts.execution.executionPlan && artifacts.execution.executionPlan === paths.relative.execution.executionPlan
      ? fallbackExecutionPlan
      : artifacts.execution.executionPlan
        ? await readJsonIfExists(path.join(paths.analysisDir, artifacts.execution.executionPlan))
        : null;

  return {
    projectRoot,
    rootManifest: normalizeRootManifest(
      manifest,
      projectRoot,
      artifacts,
      projectInventory,
      candidateComponents,
      componentReports,
      validationReport,
      executionPlan,
      taskSpecs
    ),
    inventory: {
      projectInventory,
      fileIndex,
      entrypoints,
      candidateComponents,
      scanPriorities,
      evidenceBundles,
      scanRationale,
      domainHypotheses
    },
    analysis: {
      componentReports,
      systemMap,
      componentHierarchy,
      dependencyGraph,
      analysisGaps
    },
    architecture: {
      architectureBlueprint,
      interfaceContracts,
      moduleBoundaries,
      implementationStrategy,
      validationReport
    },
    execution: {
      executionPlan,
      taskSpecs
    }
  };
}
