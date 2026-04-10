import { createArtifact, createProvenance, toSlug, uniqueSortedStrings } from "./contracts.mjs";

function buildDependencyGraph(componentReports) {
  const nodes = componentReports.map((report) => ({
    id: report.componentId,
    label: report.name,
    kind: report.type,
    clusterId: report.grouping?.clusterId || null,
    confidence: report.confidence
  }));

  const edges = [];
  const groupedEdges = new Map();
  for (const report of componentReports) {
    for (const dependency of report.dependencyDetails || []) {
      const targetId =
        dependency.targetComponentId ||
        dependency.targetClusterId ||
        (dependency.kind === "external" || dependency.kind === "node_builtin"
          ? `external:${dependency.targetLabel}`
          : dependency.resolvedPath || dependency.importPath);
      const edge = {
        from: report.componentId,
        to: targetId,
        type:
          dependency.kind === "local"
            ? dependency.targetComponentId
              ? "local_component"
              : "local_path"
            : dependency.kind === "node_builtin"
              ? "node_builtin"
              : "external_package",
        fromClusterId: report.grouping?.clusterId || null,
        toClusterId: dependency.targetClusterId || null,
        confidence: Number(Math.min(report.confidence, dependency.confidence || report.confidence).toFixed(2))
      };
      edges.push(edge);

      const groupedKey = `${edge.fromClusterId || report.componentId}:${edge.toClusterId || edge.to}:${edge.type}`;
      if (!groupedEdges.has(groupedKey)) {
        groupedEdges.set(groupedKey, {
          id: `grouped-edge:${toSlug(groupedKey)}`,
          from: edge.fromClusterId || report.componentId,
          to: edge.toClusterId || edge.to,
          type: edge.type,
          weight: 0,
          confidenceTotal: 0
        });
      }
      const grouped = groupedEdges.get(groupedKey);
      grouped.weight += 1;
      grouped.confidenceTotal += edge.confidence;
    }
  }

  const groupedEdgesList = [...groupedEdges.values()]
    .map((edge) => ({
      ...edge,
      confidence: Number((edge.confidenceTotal / edge.weight).toFixed(2))
    }))
    .sort((left, right) => right.weight - left.weight || left.id.localeCompare(right.id, "en"));

  const resolvedEdges = edges.filter((edge) => edge.type === "local_component" || edge.type === "local_path").length;
  const dependencyConfidence =
    edges.length > 0 ? Number((0.48 + resolvedEdges / Math.max(edges.length, 1) / 2).toFixed(2)) : 0.42;

  return {
    nodes: nodes.sort((left, right) => left.id.localeCompare(right.id, "en")),
    edges: edges.sort((left, right) =>
      `${left.from}:${left.to}:${left.type}`.localeCompare(`${right.from}:${right.to}:${right.type}`, "en")
    ),
    groupedEdges: groupedEdgesList,
    confidence: dependencyConfidence
  };
}

function buildSeniorPayload(scannerArtifacts, componentReports, dependencyGraphData) {
  return {
    scanRationale: scannerArtifacts.scanRationale
      ? {
          summary: scannerArtifacts.scanRationale.summary,
          focusAreas: scannerArtifacts.scanRationale.focusAreas,
          criticalQuestions: scannerArtifacts.scanRationale.criticalQuestions
        }
      : null,
    domains: scannerArtifacts.domainHypotheses?.domains || [],
    priorities: scannerArtifacts.scanPriorities?.priorities || [],
    components: componentReports.map((report) => ({
      componentId: report.componentId,
      name: report.name,
      type: report.type,
      grouping: report.grouping,
      responsibility: report.responsibility,
      inputs: report.inputs,
      outputs: report.outputs,
      dependencies: report.dependencies,
      risks: report.risks,
      missingPieces: report.missingPieces,
      confidence: report.confidence,
      evidenceRefs: report.evidenceRefs || []
    })),
    dependencyGraph: {
      groupedEdges: dependencyGraphData.groupedEdges,
      edgeCount: dependencyGraphData.edges.length
    },
    entrypoints: scannerArtifacts.entrypoints.entrypoints
  };
}

function normalizeTopLevelComponent(item, fallbackIndex = 0) {
  const id = String(item?.id || `cluster:${toSlug(item?.name || `component-group-${fallbackIndex + 1}`)}`);
  return {
    id,
    name: String(item?.name || item?.label || `Component Group ${fallbackIndex + 1}`).trim(),
    domain: String(item?.domain || "shared").trim(),
    area: String(item?.area || ".").trim(),
    layer: String(item?.layer || "module").trim(),
    children: uniqueSortedStrings(item?.children || []),
    memberCount: Array.isArray(item?.children) ? item.children.length : 0
  };
}

function normalizeHierarchyRoot(item, fallbackIndex = 0) {
  return {
    id: String(item?.id || `cluster:${toSlug(item?.label || `hierarchy-root-${fallbackIndex + 1}`)}`),
    label: String(item?.label || item?.name || `Hierarchy Root ${fallbackIndex + 1}`).trim(),
    type: String(item?.type || "component_group").trim(),
    domain: String(item?.domain || "shared").trim(),
    area: String(item?.area || ".").trim(),
    layer: String(item?.layer || "module").trim(),
    featureKey: String(item?.featureKey || item?.area || ".").trim(),
    confidence: Number(item?.confidence ?? 0.66) || 0.66,
    children: (item?.children || []).map((child) => ({
      id: String(child?.id || "").trim(),
      label: String(child?.label || child?.name || child?.id || "Component").trim(),
      type: String(child?.type || "component").trim(),
      confidence: Number(child?.confidence ?? 0.66) || 0.66
    }))
  };
}

function normalizeCriticalPath(item, fallbackIndex = 0) {
  const evidenceRefs = uniqueSortedStrings(item?.evidenceRefs || []);
  return {
    id: String(item?.id || `critical-path:${toSlug(item?.label || `path-${fallbackIndex + 1}`)}`),
    label: String(item?.label || `Critical Path ${fallbackIndex + 1}`).trim(),
    steps: uniqueSortedStrings(item?.steps || []),
    evidenceRefs,
    confidence: Number(item?.confidence ?? 0.62) || 0.62
  };
}

function normalizeGap(item, fallbackIndex = 0) {
  return {
    id: String(item?.id || `gap:${toSlug(item?.title || `gap-${fallbackIndex + 1}`)}`),
    title: String(item?.title || item?.summary || `Gap ${fallbackIndex + 1}`).trim(),
    relatedComponentId: typeof item?.relatedComponentId === "string" ? item.relatedComponentId : null,
    severity: item?.severity === "high" ? "high" : "medium"
  };
}

export async function runSeniorAnalyst(scannerArtifacts, componentReports, generatedAt, options = {}) {
  const aiContext = options.aiContext;
  const dependencyGraphData = buildDependencyGraph(componentReports);
  const promptPayload = buildSeniorPayload(scannerArtifacts, componentReports, dependencyGraphData);
  const aiResponse = await aiContext.runJsonStage(
    "senior",
    promptPayload,
    {
      modelProfile: "deep",
      userPrompt: `You are the Senior Analyst stage in TreeMA.
Return one JSON object with this shape:
{
  "systemMap": {
    "domains": ["string"],
    "topLevelComponents": [
      {
        "id": "string",
        "name": "string",
        "domain": "string",
        "area": "string",
        "layer": "string",
        "children": ["component id"]
      }
    ],
    "criticalPaths": [
      {
        "id": "string",
        "label": "string",
        "steps": ["string"],
        "evidenceRefs": ["component id or path"],
        "confidence": 0.0
      }
    ]
  },
  "hierarchyRoots": [
    {
      "id": "string",
      "label": "string",
      "domain": "string",
      "area": "string",
      "layer": "string",
      "featureKey": "string",
      "children": [{ "id": "component id", "label": "string", "type": "string", "confidence": 0.0 }]
    }
  ],
  "gaps": [
    { "id": "string", "title": "string", "relatedComponentId": "component id or null", "severity": "medium|high" }
  ]
}
Rules:
- Use only component ids, paths, and evidence refs that appear in the input.
- Prefer a small number of meaningful domains and critical paths.
- If you are unsure, emit gaps rather than inventing flows.`
    }
  );
  const provenance = createProvenance({
    ...aiResponse.provenance
  });

  const topLevelComponents = (aiResponse.data?.systemMap?.topLevelComponents || []).map(normalizeTopLevelComponent);
  const hierarchyRoots = (aiResponse.data?.hierarchyRoots || []).map(normalizeHierarchyRoot);
  const criticalPaths = (aiResponse.data?.systemMap?.criticalPaths || []).map(normalizeCriticalPath);
  const gaps = (aiResponse.data?.gaps || []).map(normalizeGap);
  const domains = uniqueSortedStrings(
    aiResponse.data?.systemMap?.domains || scannerArtifacts.domainHypotheses?.domains?.map((domain) => domain.name) || []
  );
  const averageComponentConfidence =
    componentReports.length > 0
      ? componentReports.reduce((sum, report) => sum + Number(report.confidence || 0), 0) / componentReports.length
      : 0.4;

  const systemMap = createArtifact({
    artifactType: "analysis/system_map",
    generatedAt,
    observed: [
      ...scannerArtifacts.entrypoints.entrypoints.map((entrypoint) => entrypoint.path),
      ...componentReports.map((report) => report.componentId)
    ],
    inferred: [...domains, ...criticalPaths.flatMap((path) => path.steps)],
    uncertain: criticalPaths.length === 0 ? ["No critical path is yet confidently identified."] : [],
    unknowns: uniqueSortedStrings(gaps.map((gap) => gap.title)),
    confidence: Number(Math.min(0.92, ((averageComponentConfidence + dependencyGraphData.confidence) / 2 + 0.08).toFixed(2))),
    provenance,
    evidenceRefs: uniqueSortedStrings(criticalPaths.flatMap((item) => item.evidenceRefs)),
    domains,
    topLevelComponents,
    criticalPaths
  });

  const componentHierarchy = createArtifact({
    artifactType: "analysis/component_hierarchy",
    generatedAt,
    observed: componentReports.map((report) => report.componentId),
    inferred: topLevelComponents.map((group) => `${group.domain}:${group.name}:${group.layer}`),
    uncertain: hierarchyRoots.length === 0 ? ["Hierarchy synthesis remains incomplete."] : [],
    unknowns: uniqueSortedStrings(gaps.map((gap) => gap.title)),
    confidence:
      hierarchyRoots.length > 0
        ? Number(
            (
              hierarchyRoots.reduce((sum, root) => sum + Number(root.confidence || 0), 0) / hierarchyRoots.length
            ).toFixed(2)
          )
        : 0.42,
    provenance,
    roots: hierarchyRoots
  });

  const dependencyGraph = createArtifact({
    artifactType: "analysis/dependency_graph",
    generatedAt,
    observed: componentReports.flatMap((report) => (report.dependencyDetails || []).slice(0, 4).map((item) => item.importPath)),
    inferred: dependencyGraphData.groupedEdges.map((edge) => `${edge.from}->${edge.to}:${edge.weight}`),
    uncertain: dependencyGraphData.edges.length === 0 ? ["Dependency graph is sparse."] : [],
    unknowns: uniqueSortedStrings(gaps.map((gap) => gap.title)),
    confidence: dependencyGraphData.confidence,
    provenance,
    ...dependencyGraphData
  });

  const analysisGaps = createArtifact({
    artifactType: "analysis/analysis_gaps",
    generatedAt,
    observed: componentReports.flatMap((report) => report.missingPieces),
    inferred: gaps.map((gap) => gap.title),
    uncertain: gaps.length === 0 ? ["No major analysis gaps detected."] : [],
    unknowns: uniqueSortedStrings(componentReports.flatMap((report) => report.missingPieces)),
    confidence: gaps.length > 0 ? 0.68 : 0.8,
    provenance,
    gaps
  });

  return {
    systemMap,
    componentHierarchy,
    dependencyGraph,
    analysisGaps
  };
}
