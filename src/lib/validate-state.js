const REQUIRED_COLLECTIONS = ["projects", "tracks", "tasks", "decisions", "risks"];

const STATUS_RULES = {
  projects: ["active", "paused", "archived"],
  tracks: ["active", "paused", "archived"],
  tasks: ["backlog", "ready", "in_progress", "blocked", "done"],
  decisions: ["proposed", "accepted", "rejected", "superseded"],
  risks: ["open", "monitoring", "mitigated", "realized", "closed"]
};

const RISK_SEVERITIES = ["low", "medium", "high", "critical"];

function isIsoDate(value) {
  if (typeof value !== "string") return false;
  return !Number.isNaN(Date.parse(value));
}

function pushError(errors, path, message) {
  errors.push({ path, message });
}

function requireString(errors, path, value) {
  if (typeof value !== "string" || value.trim() === "") {
    pushError(errors, path, "Expected a non-empty string");
  }
}

function requireStatus(errors, path, value, allowed) {
  if (!allowed.includes(value)) {
    pushError(errors, path, `Expected one of: ${allowed.join(", ")}`);
  }
}

function requireDate(errors, path, value) {
  if (!isIsoDate(value)) {
    pushError(errors, path, "Expected an ISO 8601 date-time string");
  }
}

export function validateState(state) {
  const errors = [];

  if (!state || typeof state !== "object" || Array.isArray(state)) {
    pushError(errors, "$", "State must be an object");
    return { valid: false, errors };
  }

  if (!state.meta || typeof state.meta !== "object") {
    pushError(errors, "meta", "Missing meta object");
  } else {
    requireString(errors, "meta.schemaVersion", state.meta.schemaVersion);
    requireString(errors, "meta.projectName", state.meta.projectName);
    requireDate(errors, "meta.createdAt", state.meta.createdAt);
    requireDate(errors, "meta.updatedAt", state.meta.updatedAt);
    if (state.meta.lastApprovedUpdateAt !== null && state.meta.lastApprovedUpdateAt !== undefined) {
      requireDate(errors, "meta.lastApprovedUpdateAt", state.meta.lastApprovedUpdateAt);
    }
  }

  for (const collectionName of REQUIRED_COLLECTIONS) {
    if (!Array.isArray(state[collectionName])) {
      pushError(errors, collectionName, "Expected an array");
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const ids = new Map();
  for (const collectionName of REQUIRED_COLLECTIONS) {
    for (const item of state[collectionName]) {
      if (!item || typeof item !== "object") {
        pushError(errors, collectionName, "Expected each item to be an object");
        continue;
      }
      requireString(errors, `${collectionName}[]/id`, item.id);
      if (typeof item.id === "string") {
        if (ids.has(item.id)) {
          pushError(errors, `${collectionName}.${item.id}`, `Duplicate id already used in ${ids.get(item.id)}`);
        } else {
          ids.set(item.id, collectionName);
        }
      }
    }
  }

  for (const project of state.projects) {
    requireString(errors, `projects.${project.id}.name`, project.name);
    requireStatus(errors, `projects.${project.id}.status`, project.status, STATUS_RULES.projects);
  }

  for (const track of state.tracks) {
    requireString(errors, `tracks.${track.id}.projectId`, track.projectId);
    requireString(errors, `tracks.${track.id}.name`, track.name);
    requireStatus(errors, `tracks.${track.id}.status`, track.status, STATUS_RULES.tracks);
  }

  for (const task of state.tasks) {
    requireString(errors, `tasks.${task.id}.projectId`, task.projectId);
    requireString(errors, `tasks.${task.id}.title`, task.title);
    requireStatus(errors, `tasks.${task.id}.status`, task.status, STATUS_RULES.tasks);
    requireDate(errors, `tasks.${task.id}.updatedAt`, task.updatedAt);
  }

  for (const decision of state.decisions) {
    requireString(errors, `decisions.${decision.id}.projectId`, decision.projectId);
    requireString(errors, `decisions.${decision.id}.title`, decision.title);
    requireStatus(errors, `decisions.${decision.id}.status`, decision.status, STATUS_RULES.decisions);
    requireDate(errors, `decisions.${decision.id}.updatedAt`, decision.updatedAt);
  }

  for (const risk of state.risks) {
    requireString(errors, `risks.${risk.id}.projectId`, risk.projectId);
    requireString(errors, `risks.${risk.id}.title`, risk.title);
    requireStatus(errors, `risks.${risk.id}.status`, risk.status, STATUS_RULES.risks);
    requireStatus(errors, `risks.${risk.id}.severity`, risk.severity, RISK_SEVERITIES);
    requireDate(errors, `risks.${risk.id}.updatedAt`, risk.updatedAt);
  }

  const referenceChecks = [
    { collection: "tracks", field: "projectId", target: "projects" },
    { collection: "tasks", field: "projectId", target: "projects" },
    { collection: "tasks", field: "trackId", target: "tracks", optional: true },
    { collection: "decisions", field: "projectId", target: "projects" },
    { collection: "decisions", field: "trackId", target: "tracks", optional: true },
    { collection: "risks", field: "projectId", target: "projects" },
    { collection: "risks", field: "trackId", target: "tracks", optional: true }
  ];

  for (const rule of referenceChecks) {
    const targetIds = new Set(state[rule.target].map((item) => item.id));
    for (const item of state[rule.collection]) {
      const value = item[rule.field];
      if ((value === undefined || value === null || value === "") && rule.optional) {
        continue;
      }
      if (!targetIds.has(value)) {
        pushError(errors, `${rule.collection}.${item.id}.${rule.field}`, `Unknown reference: ${String(value)}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export function summarizeState(state) {
  const openRisks = state.risks.filter((risk) => ["open", "monitoring", "realized"].includes(risk.status)).length;
  const activeTasks = state.tasks.filter((task) => ["ready", "in_progress", "blocked"].includes(task.status)).length;
  const acceptedDecisions = state.decisions.filter((decision) => decision.status === "accepted").length;
  const activeTracks = state.tracks.filter((track) => track.status === "active").length;

  return {
    projects: state.projects.length,
    tracks: activeTracks,
    activeTasks,
    openRisks,
    acceptedDecisions
  };
}
