function groupBy(items, key) {
  return items.reduce((accumulator, item) => {
    const bucket = item[key] ?? "unknown";
    if (!accumulator[bucket]) accumulator[bucket] = [];
    accumulator[bucket].push(item);
    return accumulator;
  }, {});
}

function indexById(items) {
  return new Map(items.map((item) => [item.id, item]));
}

function sortByUpdatedAtDesc(items) {
  return [...items].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export function buildViewModel(state) {
  const tasksByStatus = groupBy(state.tasks, "status");
  const risksBySeverity = groupBy(state.risks, "severity");
  const trackIndex = indexById(state.tracks);

  const taskCountsByProject = state.tasks.reduce((counts, task) => {
    counts[task.projectId] = counts[task.projectId] ?? { open: 0, done: 0 };
    if (task.status === "done") counts[task.projectId].done += 1;
    else counts[task.projectId].open += 1;
    return counts;
  }, {});

  const riskCountsByProject = state.risks.reduce((counts, risk) => {
    counts[risk.projectId] = (counts[risk.projectId] ?? 0) + 1;
    return counts;
  }, {});

  const decisionCountsByProject = state.decisions.reduce((counts, decision) => {
    counts[decision.projectId] = (counts[decision.projectId] ?? 0) + 1;
    return counts;
  }, {});

  const childrenByParentId = state.projects.reduce((accumulator, project) => {
    const parentId = project.parentId ?? "__root__";
    if (!accumulator[parentId]) accumulator[parentId] = [];
    accumulator[parentId].push(project);
    return accumulator;
  }, {});

  const timeline = sortByUpdatedAtDesc([
    ...state.decisions.map((decision) => ({
      type: "decision",
      id: decision.id,
      title: decision.title,
      status: decision.status,
      projectId: decision.projectId,
      trackId: decision.trackId,
      summary: decision.summary || decision.impact || "",
      updatedAt: decision.updatedAt
    })),
    ...state.risks.map((risk) => ({
      type: "risk",
      id: risk.id,
      title: risk.title,
      status: risk.status,
      projectId: risk.projectId,
      trackId: risk.trackId,
      summary: risk.description || risk.mitigation || "",
      severity: risk.severity,
      updatedAt: risk.updatedAt
    }))
  ]);

  const currentFocusTasks = (state.meta.currentFocusTaskIds ?? [])
    .map((taskId) => state.tasks.find((task) => task.id === taskId))
    .filter(Boolean);

  const currentFocusTracks = (state.meta.currentFocusTrackIds ?? [])
    .map((trackId) => trackIndex.get(trackId))
    .filter(Boolean);

  const statusOrder = { in_progress: 0, ready: 1, blocked: 2, backlog: 3, done: 4 };
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const nextTasks = [...state.tasks]
    .filter((task) => ["ready", "backlog", "blocked", "in_progress"].includes(task.status))
    .sort((left, right) => {
      const byStatus = (statusOrder[left.status] ?? 99) - (statusOrder[right.status] ?? 99);
      if (byStatus !== 0) return byStatus;
      return (priorityOrder[left.priority] ?? 99) - (priorityOrder[right.priority] ?? 99);
    })
    .slice(0, 5);

  const recentDecisions = sortByUpdatedAtDesc(state.decisions).slice(0, 3);

  return {
    tasksByStatus,
    risksBySeverity,
    trackIndex,
    taskCountsByProject,
    riskCountsByProject,
    decisionCountsByProject,
    childrenByParentId,
    timeline,
    currentFocusTasks,
    currentFocusTracks,
    nextTasks,
    recentDecisions
  };
}
