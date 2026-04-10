import { createArtifact, createProvenance, toSlug, uniqueSortedStrings } from "./contracts.mjs";

function createFinding(severity, category, title, detail, relatedArtifacts = [], evidenceRefs = []) {
  return {
    id: `finding:${toSlug(`${severity}-${category}-${title}-${detail}`)}`,
    severity,
    category,
    title,
    detail,
    relatedArtifacts,
    evidenceRefs: uniqueSortedStrings(evidenceRefs)
  };
}

function buildDependencyGraph(modules) {
  return new Map(modules.map((module) => [module.id, module.dependsOn.filter((dependency) => dependency.startsWith("module:"))]));
}

function hasCycle(graph) {
  const visited = new Set();
  const visiting = new Set();

  function visit(node) {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;

    visiting.add(node);
    for (const dependency of graph.get(node) || []) {
      if (visit(dependency)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  }

  for (const node of graph.keys()) {
    if (visit(node)) return true;
  }
  return false;
}

function normalizeResponsibility(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function hasMeaningfulChecks(items) {
  return Array.isArray(items) && items.some((item) => typeof item === "string" && item.trim().length >= 12);
}

function hasObservableTestabilitySignals(items) {
  return Array.isArray(items) && items.some((item) => typeof item === "string" && item.trim().length >= 8);
}

function collectResponsibilityCollisions(modules) {
  const findings = [];
  const responsibilityIndex = new Map();
  const componentOwners = new Map();

  for (const module of modules) {
    const normalized = normalizeResponsibility(module.responsibility);
    if (responsibilityIndex.has(normalized)) {
      findings.push(
        createFinding(
          "blocking",
          "responsibility_collision",
          "Overlapping module responsibility",
          `${module.id} and ${responsibilityIndex.get(normalized)} describe the same module responsibility.`,
          ["architecture/module_boundaries.json"],
          module.evidenceRefs
        )
      );
    } else {
      responsibilityIndex.set(normalized, module.id);
    }

    for (const componentId of module.sourceComponentIds || []) {
      if (componentOwners.has(componentId) && componentOwners.get(componentId) !== module.id) {
        findings.push(
          createFinding(
            "blocking",
            "responsibility_collision",
            "Source component assigned to multiple modules",
            `${componentId} is owned by both ${componentOwners.get(componentId)} and ${module.id}.`,
            ["architecture/module_boundaries.json"],
            [componentId]
          )
        );
      } else {
        componentOwners.set(componentId, module.id);
      }
    }
  }

  return findings;
}

function collectNonTestableTaskFindings(implementationStrategy) {
  const findings = [];

  for (const phase of implementationStrategy.phases || []) {
    if (!hasMeaningfulChecks(phase.acceptanceChecks)) {
      findings.push(
        createFinding(
          "blocking",
          "non_testable_task",
          "Phase lacks measurable acceptance checks",
          `${phase.id} does not define concrete acceptance checks, so a downstream task would not be testable.`,
          ["architecture/implementation_strategy.json"],
          phase.evidenceRefs
        )
      );
    }

    if (!hasObservableTestabilitySignals(phase.testabilitySignals)) {
      findings.push(
        createFinding(
          "non_blocking",
          "non_testable_task",
          "Phase has weak testability signals",
          `${phase.id} exposes limited machine-readable testability signals.`,
          ["architecture/implementation_strategy.json"],
          phase.evidenceRefs
        )
      );
    }
  }

  return findings;
}

function buildEvidenceRefSet(scannerArtifacts, seniorArtifacts, architectArtifacts) {
  return new Set([
    ...scannerArtifacts.fileIndex.files.map((file) => file.path),
    ...scannerArtifacts.fileIndex.files.flatMap((file) => (file.evidenceSpans || []).map((span) => span.id)),
    ...scannerArtifacts.entrypoints.entrypoints.map((item) => item.id),
    ...scannerArtifacts.candidateComponents.components.map((item) => item.id),
    ...(scannerArtifacts.evidenceBundles?.bundles || []).map((item) => item.id),
    ...(scannerArtifacts.domainHypotheses?.domains || []).map((item) => item.id),
    ...seniorArtifacts.systemMap.topLevelComponents.map((item) => item.id),
    ...seniorArtifacts.componentHierarchy.roots.map((item) => item.id),
    ...architectArtifacts.moduleBoundaries.modules.map((item) => item.id)
  ]);
}

function collectEvidenceGroundingFindings(scannerArtifacts, seniorArtifacts, architectArtifacts) {
  const findings = [];
  const validRefs = buildEvidenceRefSet(scannerArtifacts, seniorArtifacts, architectArtifacts);

  for (const report of seniorArtifacts.systemMap.criticalPaths || []) {
    const evidenceRefs = Array.isArray(report.evidenceRefs) ? report.evidenceRefs : [];
    if (evidenceRefs.length === 0) {
      findings.push(
        createFinding(
          "blocking",
          "critical_claim",
          "Critical path has no evidence references",
          `${report.id} must cite evidence refs.`,
          ["analysis/system_map.json"],
          []
        )
      );
      continue;
    }
    const unresolved = evidenceRefs.filter((ref) => !validRefs.has(ref));
    if (unresolved.length > 0) {
      findings.push(
        createFinding(
          "blocking",
          "critical_claim",
          "Critical path references unknown evidence",
          `${report.id} references unknown evidence refs: ${unresolved.join(", ")}.`,
          ["analysis/system_map.json"],
          evidenceRefs
        )
      );
    }
  }

  for (const flow of architectArtifacts.architectureBlueprint.flows || []) {
    const evidenceRefs = Array.isArray(flow.evidenceRefs) ? flow.evidenceRefs : [];
    if (evidenceRefs.length === 0) {
      findings.push(
        createFinding(
          "blocking",
          "architecture_flow",
          "Architecture flow has no evidence references",
          `${flow.id} must cite evidence refs.`,
          ["architecture/architecture_blueprint.json"],
          []
        )
      );
    }
  }

  for (const module of architectArtifacts.moduleBoundaries.modules || []) {
    const unresolved = (module.evidenceRefs || []).filter((ref) => !validRefs.has(ref));
    if (unresolved.length > 0) {
      findings.push(
        createFinding(
          "blocking",
          "module_boundaries",
          "Module references unknown evidence",
          `${module.id} references unknown evidence refs: ${unresolved.join(", ")}.`,
          ["architecture/module_boundaries.json"],
          module.evidenceRefs
        )
      );
    }
  }

  for (const report of architectArtifacts.interfaceContracts.interfaces || []) {
    const evidenceRefs = report.evidenceRefs || [];
    if (evidenceRefs.length === 0) {
      findings.push(
        createFinding(
          "blocking",
          "interface_contracts",
          "Interface contract lacks evidence",
          `${report.id} must cite evidence refs.`,
          ["architecture/interface_contracts.json"],
          []
        )
      );
      continue;
    }
    const unresolved = evidenceRefs.filter((ref) => !validRefs.has(ref));
    if (unresolved.length > 0) {
      findings.push(
        createFinding(
          "blocking",
          "interface_contracts",
          "Interface contract references unknown evidence",
          `${report.id} references unknown evidence refs: ${unresolved.join(", ")}.`,
          ["architecture/interface_contracts.json"],
          evidenceRefs
        )
      );
    }
  }

  return findings;
}

async function runAiCritique(aiContext, payload) {
  try {
    const response = await aiContext.runJsonStage(
      "validator-critique",
      payload,
      {
        modelProfile: "deep",
        userPrompt: `You are the Validator critique stage in TreeMA.
Return one JSON object:
{
  "findings": [
    {
      "category": "string",
      "title": "string",
      "detail": "string",
      "evidenceRefs": ["string"]
    }
  ]
}
Rules:
- Only report grounded concerns.
- Do not decide readiness.
- Prefer missing evidence, weak contracts, ambiguous boundaries, or suspicious execution steps.`
      }
    );

    return {
      findings: (response.data?.findings || []).map((finding) =>
        createFinding(
          "non_blocking",
          String(finding?.category || "ai_critique").trim(),
          String(finding?.title || "AI critique").trim(),
          String(finding?.detail || "Semantic review suggested a follow-up.").trim(),
          ["analysis/system_map.json", "architecture/architecture_blueprint.json"],
          finding?.evidenceRefs || []
        )
      ),
      provenance: createProvenance({
        ...response.provenance
      })
    };
  } catch {
    return {
      findings: [],
      provenance: null
    };
  }
}

export async function runValidator(architectArtifacts, seniorArtifacts, scannerArtifacts, generatedAt, options = {}) {
  const aiContext = options.aiContext;
  const findings = [];
  const modules = architectArtifacts.moduleBoundaries.modules;
  const interfaces = architectArtifacts.interfaceContracts.interfaces;
  const gapTitles = seniorArtifacts.analysisGaps.gaps.map((gap) => gap.title);

  if (modules.length === 0) {
    findings.push(
      createFinding(
        "blocking",
        "module_boundaries",
        "No modules defined",
        "Execution planning cannot proceed without at least one architecture module.",
        ["architecture/module_boundaries.json"]
      )
    );
  }

  const moduleIds = new Set();
  for (const module of modules) {
    if (moduleIds.has(module.id)) {
      findings.push(
        createFinding(
          "blocking",
          "module_boundaries",
          "Duplicate module id",
          `Module id ${module.id} is defined more than once.`,
          ["architecture/module_boundaries.json"],
          module.evidenceRefs
        )
      );
    }
    moduleIds.add(module.id);
  }

  if (interfaces.some((item) => !item.contract || item.contract.trim() === "")) {
    findings.push(
      createFinding(
        "blocking",
        "interface_contracts",
        "Missing interface contract",
        "At least one module interface is missing a concrete contract string.",
        ["architecture/interface_contracts.json"]
      )
    );
  }

  const graph = buildDependencyGraph(modules);
  if (hasCycle(graph)) {
    findings.push(
      createFinding(
        "blocking",
        "implementation_order",
        "Cyclic module dependency",
        "Recommended build order cannot be trusted while module dependencies contain a cycle.",
        ["architecture/module_boundaries.json", "architecture/implementation_strategy.json"]
      )
    );
  }

  if (architectArtifacts.implementationStrategy.recommendedBuildOrder.length !== modules.length) {
    findings.push(
      createFinding(
        "blocking",
        "implementation_order",
        "Implementation order is incomplete",
        "Every module must appear exactly once in the recommended build order before execution planning.",
        ["architecture/implementation_strategy.json"]
      )
    );
  }

  findings.push(...collectResponsibilityCollisions(modules));
  findings.push(...collectNonTestableTaskFindings(architectArtifacts.implementationStrategy));
  findings.push(...collectEvidenceGroundingFindings(scannerArtifacts, seniorArtifacts, architectArtifacts));

  for (const gapTitle of gapTitles.slice(0, 6)) {
    findings.push(
      createFinding(
        "non_blocking",
        "analysis_gap",
        "Analysis gap remains open",
        gapTitle,
        ["analysis/analysis_gaps.json"]
      )
    );
  }

  if (architectArtifacts.interfaceContracts.confidence < 0.72) {
    findings.push(
      createFinding(
        "non_blocking",
        "confidence",
        "Interface confidence is moderate",
        "Interface contracts are implementable but still inferred from limited evidence.",
        ["architecture/interface_contracts.json"],
        architectArtifacts.interfaceContracts.evidenceRefs || []
      )
    );
  }

  const aiCritique = aiContext
    ? await runAiCritique(aiContext, {
        systemMap: seniorArtifacts.systemMap,
        componentHierarchy: seniorArtifacts.componentHierarchy,
        architectureBlueprint: architectArtifacts.architectureBlueprint,
        interfaceContracts: architectArtifacts.interfaceContracts,
        implementationStrategy: architectArtifacts.implementationStrategy
      })
    : { findings: [], provenance: null };
  findings.push(...aiCritique.findings);

  const uniqueFindings = findings.filter(
    (finding, index, items) => items.findIndex((candidate) => candidate.id === finding.id) === index
  );
  const blockingCount = uniqueFindings.filter((finding) => finding.severity === "blocking").length;
  const nonBlockingCount = uniqueFindings.filter((finding) => finding.severity === "non_blocking").length;

  return createArtifact({
    artifactType: "architecture/validation_report",
    generatedAt,
    observed: [...modules.map((module) => module.id), ...interfaces.map((item) => item.id)],
    inferred: uniqueFindings.map((finding) => `${finding.severity}:${finding.title}`),
    uncertain: blockingCount === 0 ? ["Execution readiness still depends on grounded implementation work."] : [],
    unknowns: seniorArtifacts.analysisGaps.gaps.map((gap) => gap.title),
    confidence: blockingCount === 0 ? 0.78 : 0.5,
    provenance:
      aiCritique.provenance ||
      createProvenance({
        provider: aiContext?.provider || "",
        model: aiContext?.model || "",
        promptVersion: aiContext?.promptVersion,
        stageMode: aiContext?.scanMode || "",
        generatedFromCache: false
      }),
    evidenceRefs: uniqueSortedStrings(uniqueFindings.flatMap((finding) => finding.evidenceRefs || [])),
    summary: {
      status: blockingCount > 0 ? "blocked" : "ready",
      blockingCount,
      nonBlockingCount
    },
    findings: uniqueFindings
  });
}
