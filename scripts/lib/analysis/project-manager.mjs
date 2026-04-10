import { createArtifact, createProvenance, uniqueSortedStrings } from "./contracts.mjs";

function normalizeTask(item, fallbackIndex = 0) {
  const taskId = String(item?.taskId || `TASK-${String(fallbackIndex + 1).padStart(3, "0")}`);
  return {
    taskId,
    title: String(item?.title || `Task ${fallbackIndex + 1}`).trim(),
    goal: String(item?.goal || "Deliver the scoped implementation outcome.").trim(),
    inputs: uniqueSortedStrings(item?.inputs || []),
    outputs: uniqueSortedStrings(item?.outputs || []),
    dependencies: uniqueSortedStrings(item?.dependencies || []),
    agent: String(item?.agent || "Codex").trim(),
    acceptanceCriteria: uniqueSortedStrings(item?.acceptanceCriteria || []),
    validation: uniqueSortedStrings(item?.validation || []),
    evidenceRefs: uniqueSortedStrings(item?.evidenceRefs || [])
  };
}

export async function runProjectManager(architectArtifacts, validationReport, generatedAt, options = {}) {
  const aiContext = options.aiContext;
  const promptPayload = {
    validationSummary: validationReport.summary,
    nonBlockingFindings: validationReport.findings.filter((finding) => finding.severity === "non_blocking"),
    implementationStrategy: architectArtifacts.implementationStrategy,
    modules: architectArtifacts.moduleBoundaries.modules,
    interfaces: architectArtifacts.interfaceContracts.interfaces
  };
  const aiResponse = await aiContext.runJsonStage(
    "pm",
    promptPayload,
    {
      modelProfile: "deep",
      userPrompt: `You are the Project Manager stage in TreeMA.
Return one JSON object with this shape:
{
  "tasks": [
    {
      "taskId": "TASK-001",
      "title": "string",
      "goal": "string",
      "inputs": ["string"],
      "outputs": ["string"],
      "dependencies": ["TASK-000"],
      "agent": "Codex",
      "acceptanceCriteria": ["string"],
      "validation": ["string"],
      "evidenceRefs": ["module id or path"]
    }
  ]
}
Rules:
- Respect the recommended build order and validation findings.
- Make acceptance criteria measurable and implementation-facing.
- Do not emit tasks if the validation status is blocked.`
    }
  );
  const provenance = createProvenance({
    ...aiResponse.provenance
  });

  const taskSpecs = (aiResponse.data?.tasks || []).map(normalizeTask);
  const executionPlan = createArtifact({
    artifactType: "execution/execution_plan",
    generatedAt,
    observed: architectArtifacts.implementationStrategy.recommendedBuildOrder,
    inferred: taskSpecs.map((task) => task.taskId),
    uncertain:
      validationReport.summary.nonBlockingCount > 0 ? ["Follow non-blocking validator findings during implementation."] : [],
    unknowns: validationReport.unknowns,
    confidence: taskSpecs.length > 0 ? 0.74 : 0.46,
    provenance,
    evidenceRefs: uniqueSortedStrings(taskSpecs.flatMap((task) => task.evidenceRefs)),
    gateStatus: validationReport.summary.status,
    phases: architectArtifacts.implementationStrategy.phases.map((phase, index) => ({
      ...phase,
      taskId: taskSpecs[index]?.taskId || `TASK-${String(index + 1).padStart(3, "0")}`
    })),
    tasks: taskSpecs.map((task) => ({
      taskId: task.taskId,
      title: task.title,
      dependencies: task.dependencies,
      agent: task.agent
    }))
  });

  const detailedTaskSpecs = taskSpecs.map((task) =>
    createArtifact({
      artifactType: "execution/task_spec",
      generatedAt,
      observed: task.inputs,
      inferred: [task.goal, ...task.acceptanceCriteria],
      uncertain: [],
      unknowns: validationReport.unknowns,
      confidence: 0.72,
      provenance,
      evidenceRefs: task.evidenceRefs,
      ...task
    })
  );

  return {
    executionPlan,
    taskSpecs: detailedTaskSpecs.sort((left, right) => left.taskId.localeCompare(right.taskId, "en"))
  };
}
