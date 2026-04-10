import { createArtifact, createProvenance, toSlug, toTitleCase, uniqueSortedStrings } from "./contracts.mjs";

function buildArchitectPayload(seniorArtifacts) {
  return {
    domains: seniorArtifacts.systemMap.domains,
    topLevelComponents: seniorArtifacts.systemMap.topLevelComponents,
    criticalPaths: seniorArtifacts.systemMap.criticalPaths,
    hierarchyRoots: seniorArtifacts.componentHierarchy.roots,
    groupedDependencies: seniorArtifacts.dependencyGraph.groupedEdges,
    analysisGaps: seniorArtifacts.analysisGaps.gaps
  };
}

function normalizeModule(item, fallbackIndex = 0) {
  const sourceComponentIds = uniqueSortedStrings(item?.sourceComponentIds || item?.componentIds || []);
  const id = String(item?.id || `module:${toSlug(item?.name || `module-${fallbackIndex + 1}`)}`).trim();
  return {
    id,
    name: String(item?.name || `Module ${fallbackIndex + 1}`).trim(),
    responsibility: String(item?.responsibility || `${id} owns a bounded responsibility.`).trim(),
    sourceComponentIds,
    dependsOn: uniqueSortedStrings(item?.dependsOn || []),
    evidenceRefs: uniqueSortedStrings(item?.evidenceRefs || sourceComponentIds)
  };
}

function normalizeInterface(item, fallbackIndex = 0) {
  const from = String(item?.from || "").trim();
  const to = String(item?.to || "").trim();
  return {
    id: String(item?.id || `interface:${toSlug(`${from}-${to || fallbackIndex}`)}`),
    from,
    to,
    contract: String(item?.contract || "proposed contract").trim(),
    status: String(item?.status || "proposed").trim(),
    inputs: uniqueSortedStrings(item?.inputs || []),
    outputs: uniqueSortedStrings(item?.outputs || []),
    confidence: Number(item?.confidence ?? 0.64) || 0.64,
    evidenceRefs: uniqueSortedStrings(item?.evidenceRefs || [])
  };
}

function normalizePhase(item, fallbackIndex = 0) {
  const index = fallbackIndex + 1;
  return {
    id: String(item?.id || `phase-${String(index).padStart(2, "0")}`),
    title: String(item?.title || `Phase ${index}`).trim(),
    goal: String(item?.goal || "Deliver the scoped module changes.").trim(),
    moduleIds: uniqueSortedStrings(item?.moduleIds || []),
    acceptanceFocus: uniqueSortedStrings(item?.acceptanceFocus || []),
    acceptanceChecks: uniqueSortedStrings(item?.acceptanceChecks || []),
    testabilitySignals: uniqueSortedStrings(item?.testabilitySignals || []),
    evidenceRefs: uniqueSortedStrings(item?.evidenceRefs || [])
  };
}

export async function runSolutionArchitect(seniorArtifacts, generatedAt, options = {}) {
  const aiContext = options.aiContext;
  const promptPayload = buildArchitectPayload(seniorArtifacts);
  const aiResponse = await aiContext.runJsonStage(
    "architect",
    promptPayload,
    {
      modelProfile: "deep",
      userPrompt: `You are the Solution Architect stage in TreeMA.
Return one JSON object with this shape:
{
  "modules": [
    {
      "id": "string",
      "name": "string",
      "responsibility": "string",
      "sourceComponentIds": ["component id"],
      "dependsOn": ["module:id or external:*"],
      "evidenceRefs": ["component id or path"]
    }
  ],
  "interfaces": [
    {
      "id": "string",
      "from": "module id",
      "to": "module id or external:*",
      "contract": "string",
      "status": "proposed",
      "inputs": ["string"],
      "outputs": ["string"],
      "confidence": 0.0,
      "evidenceRefs": ["component id or path"]
    }
  ],
  "recommendedBuildOrder": ["module id"],
  "phases": [
    {
      "id": "string",
      "title": "string",
      "goal": "string",
      "moduleIds": ["module id"],
      "acceptanceFocus": ["string"],
      "acceptanceChecks": ["string"],
      "testabilitySignals": ["string"],
      "evidenceRefs": ["component id or path"]
    }
  ]
}
Rules:
- Use only module ids that you define in this response.
- Keep module boundaries bounded and explainable from the provided evidence.
- If interfaces are unclear, make them explicit and mark them proposed rather than vague.`
    }
  );
  const provenance = createProvenance({
    ...aiResponse.provenance
  });

  const modules = (aiResponse.data?.modules || []).map(normalizeModule);
  const moduleIdSet = new Set(modules.map((item) => item.id));
  const interfaces = (aiResponse.data?.interfaces || [])
    .map(normalizeInterface)
    .filter((item) => item.from && item.to);
  const recommendedBuildOrder = uniqueSortedStrings(aiResponse.data?.recommendedBuildOrder || []).filter((value) => moduleIdSet.has(value));
  const phases = (aiResponse.data?.phases || [])
    .map(normalizePhase)
    .map((phase, index) => ({
      ...phase,
      moduleIds: phase.moduleIds.filter((moduleId) => moduleIdSet.has(moduleId)),
      title: phase.title || `Phase ${index + 1}: ${toTitleCase((phase.moduleIds[0] || "module").replace(/^module:/, ""))}`
    }));

  const architectureBlueprint = createArtifact({
    artifactType: "architecture/architecture_blueprint",
    generatedAt,
    observed: seniorArtifacts.systemMap.topLevelComponents.map((component) => component.id),
    inferred: [...modules.map((module) => module.id), ...recommendedBuildOrder],
    uncertain: seniorArtifacts.systemMap.criticalPaths.length === 0 ? ["Critical flow remains incomplete."] : [],
    unknowns: seniorArtifacts.analysisGaps.gaps.map((gap) => gap.title),
    confidence: modules.length > 0 ? 0.76 : 0.44,
    provenance,
    evidenceRefs: uniqueSortedStrings(modules.flatMap((module) => module.evidenceRefs)),
    modules: modules.map(({ id, name, responsibility, evidenceRefs }) => ({ id, name, responsibility, evidenceRefs })),
    flows: seniorArtifacts.systemMap.criticalPaths,
    buildOrder: recommendedBuildOrder
  });

  const interfaceContracts = createArtifact({
    artifactType: "architecture/interface_contracts",
    generatedAt,
    observed: seniorArtifacts.dependencyGraph.edges.map((edge) => `${edge.from}->${edge.to}`).slice(0, 40),
    inferred: interfaces.map((item) => `${item.from}->${item.to}:${item.contract}`),
    uncertain: interfaces.length === 0 ? ["No explicit module interfaces were identified."] : [],
    unknowns: seniorArtifacts.analysisGaps.gaps.map((gap) => gap.title),
    confidence: interfaces.length > 0 ? 0.7 : 0.42,
    provenance,
    evidenceRefs: uniqueSortedStrings(interfaces.flatMap((item) => item.evidenceRefs)),
    interfaces
  });

  const moduleBoundaries = createArtifact({
    artifactType: "architecture/module_boundaries",
    generatedAt,
    observed: seniorArtifacts.componentHierarchy.roots.map((root) => root.id),
    inferred: modules.map((module) => `${module.id}:${module.responsibility}`),
    uncertain: modules.length === 0 ? ["Module boundaries are not established."] : [],
    unknowns: seniorArtifacts.analysisGaps.gaps.map((gap) => gap.title),
    confidence: modules.length > 0 ? 0.78 : 0.35,
    provenance,
    evidenceRefs: uniqueSortedStrings(modules.flatMap((item) => item.evidenceRefs)),
    modules
  });

  const implementationStrategy = createArtifact({
    artifactType: "architecture/implementation_strategy",
    generatedAt,
    observed: recommendedBuildOrder,
    inferred: recommendedBuildOrder.map((moduleId, index) => `phase-${index + 1}:${moduleId}`),
    uncertain: seniorArtifacts.analysisGaps.gaps.length > 0 ? ["Follow-up clarification may be required before execution."] : [],
    unknowns: seniorArtifacts.analysisGaps.gaps.map((gap) => gap.title),
    confidence: phases.length > 0 ? 0.72 : 0.4,
    provenance,
    evidenceRefs: uniqueSortedStrings(phases.flatMap((item) => item.evidenceRefs)),
    recommendedBuildOrder,
    phases
  });

  return {
    architectureBlueprint,
    interfaceContracts,
    moduleBoundaries,
    implementationStrategy
  };
}
