import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadProjectAnalysis } from "./project-analysis.mjs";

export function toSlug(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "project";
}

export function nowIso() {
  return new Date().toISOString();
}

export async function exists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function writeTextFile(targetPath, content) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, "utf8");
}

export async function readTextFileIfExists(targetPath, fallback = null) {
  if (!(await exists(targetPath))) {
    return fallback;
  }
  return readFile(targetPath, "utf8");
}

export function parseOptions(args) {
  const options = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      options._.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }

    if (options[key] === undefined) {
      options[key] = next;
    } else if (Array.isArray(options[key])) {
      options[key].push(next);
    } else {
      options[key] = [options[key], next];
    }
    index += 1;
  }
  return options;
}

export function asArray(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function createInitialState(projectName) {
  const slug = toSlug(projectName);
  const timestamp = nowIso();

  return {
    meta: {
      schemaVersion: "0.1.0",
      workspaceVersion: "0.1.0",
      projectName,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastApprovedUpdateAt: null,
      currentFocusTrackIds: [],
      currentFocusTaskIds: [],
      sourceFiles: [
        ".treema/AGENTS.md",
        ".treema/context/project-brief.md",
        ".treema/context/current-focus.md",
        ".treema/context/next-tasks.md",
        ".treema/context/operating-rules.md",
        ".treema/logs/decisions.md",
        ".treema/logs/status-updates.md",
        ".treema/tasks/task-index.md",
        ".treema/plans/active/README.md",
        ".treema/plans/completed/README.md"
      ]
    },
    projects: [
      {
        id: `project:${slug}`,
        name: projectName,
        description: "Project managed by Treema.",
        status: "active",
        parentId: null,
        trackIds: [],
        tags: ["treema", "workspace"]
      }
    ],
    tracks: [],
    tasks: [],
    decisions: [],
    risks: []
  };
}

export function renderWorkspaceReadme(projectName) {
  return `# ${projectName} Treema Workspace

This directory stores the Treema workspace for \`${projectName}\`.

- \`AGENTS.md\` is the workspace map for AI and humans
- \`project_state.json\` is the structured state file
- \`context/\` stores human-readable project context
- \`logs/\` stores decisions and chronological status updates
- \`tasks/\` stores task views for humans and AI
- \`plans/\` stores active and completed execution plans
- \`analysis/\` stores Project Scan and Quick Scan artifacts rooted at \`project-structure.json\`

Recommended rule:

- keep active focus to three tracks or fewer
- write why before starting work
- write result and impact after finishing work
`;
}

export function renderWorkspaceAgents(projectName) {
  return `# ${projectName} Workspace Map

Use this file as the entrypoint for work inside this project workspace.

## Source of truth order

1. Real project files and runtime behavior
2. \`project_state.json\`
3. \`analysis/project-structure.json\`
4. \`context/*.md\`
5. \`logs/*.md\`
6. \`plans/*\`

## Read these first

- \`context/project-brief.md\`: project purpose, outcome, constraints
- \`context/operating-rules.md\`: local definitions of done and editing rules
- \`context/current-focus.md\`: active focus set
- \`context/next-tasks.md\`: immediate queue
- \`logs/decisions.md\`: durable decision record
- \`logs/status-updates.md\`: chronological status snapshots
- \`analysis/project-structure.json\`: current Project Scan or Quick Scan manifest and artifact index

## Update rule

When project behavior or workspace contract changes, update the matching markdown or JSON source in the same change.
`;
}

export function renderProjectBrief(projectName) {
  return `# Project Brief

## Main Purpose

Describe the core objective of ${projectName}.

## Desired Outcome

Describe what “done” means in operational terms.

## Constraints

- Constraint 1
- Constraint 2

## Current Reality

Summarize the current state of the project.
`;
}

export function renderCurrentFocus() {
  return `# Current Focus

Keep this list narrow. Three items is the practical maximum.

- Focus 1
- Focus 2
- Focus 3
`;
}

export function renderNextTasks() {
  return `# Next Tasks

Use this as the immediate execution queue.

- [ ] Task 1
- [ ] Task 2
- [ ] Task 3
- [ ] Task 4
- [ ] Task 5
`;
}

export function renderDecisionsLog() {
  return `# Decisions

## Template

### Decision

- Why:
- Impact:
- Date:
`;
}

export function renderStatusUpdates(projectName) {
  return `# Status Updates

Chronological snapshots for ${projectName}.
`;
}

export function renderTaskIndex() {
  return `# Task Index

## Backlog

## Ready

## In Progress

## Blocked

## Done
`;
}

export function renderOperatingRules() {
  return `# Operating Rules

## Definition of Done

- Canonical state still validates
- Workspace docs match the current implementation state
- New behavior is reflected in analysis, plans, or logs when applicable

## Editing Rules

- Treat \`project_state.json\` as canonical state, not generated markdown
- Treat \`analysis/project-structure.json\` as the canonical scan root manifest
- Keep \`current-focus.md\` narrow and \`next-tasks.md\` short
- Record durable choices in \`logs/decisions.md\`
- Move large coordinated work through \`plans/active/\` before shipping
`;
}

export function renderPlanReadme(status) {
  return `# ${status === "active" ? "Active" : "Completed"} Plans

Use this directory for execution plans that coordinate multiple changes.

- Active plans live in \`plans/active/\`
- Completed plans move to \`plans/completed/\`
- Each plan should capture intent, implementation, validation, and follow-up
`;
}

export function renderBulletSection(title, items) {
  if (items.length === 0) {
    return `## ${title}\n\n- None\n`;
  }
  return `## ${title}\n\n${items.map((item) => `- ${item}`).join("\n")}\n`;
}

export function renderStatusEntry({ summary, focus, next, risks, timestamp }) {
  return `\n## ${timestamp}\n\n### Summary\n\n${summary}\n\n${renderBulletSection("Current Focus", focus)}\n${renderBulletSection("Next Tasks", next)}\n${renderBulletSection("Active Risks", risks)}`;
}

export async function initWorkspace(targetDir, projectName) {
  const projectRoot = path.resolve(targetDir);
  const treemaDir = path.join(projectRoot, ".treema");

  if (await exists(treemaDir)) {
    throw new Error(`Treema workspace already exists: ${treemaDir}`);
  }

  const resolvedName = projectName || path.basename(projectRoot);
  const state = createInitialState(resolvedName);

  await writeTextFile(path.join(treemaDir, "README.md"), renderWorkspaceReadme(resolvedName));
  await writeTextFile(path.join(treemaDir, "AGENTS.md"), renderWorkspaceAgents(resolvedName));
  await writeTextFile(path.join(treemaDir, "project_state.json"), `${JSON.stringify(state, null, 2)}\n`);
  await writeTextFile(path.join(treemaDir, "context", "project-brief.md"), renderProjectBrief(resolvedName));
  await writeTextFile(path.join(treemaDir, "context", "current-focus.md"), renderCurrentFocus());
  await writeTextFile(path.join(treemaDir, "context", "next-tasks.md"), renderNextTasks());
  await writeTextFile(path.join(treemaDir, "context", "operating-rules.md"), renderOperatingRules());
  await writeTextFile(path.join(treemaDir, "logs", "decisions.md"), renderDecisionsLog());
  await writeTextFile(path.join(treemaDir, "logs", "status-updates.md"), renderStatusUpdates(resolvedName));
  await writeTextFile(path.join(treemaDir, "tasks", "task-index.md"), renderTaskIndex());
  await writeTextFile(path.join(treemaDir, "plans", "active", "README.md"), renderPlanReadme("active"));
  await writeTextFile(path.join(treemaDir, "plans", "completed", "README.md"), renderPlanReadme("completed"));
  await mkdir(path.join(treemaDir, "ai", "proposals"), { recursive: true });
  await mkdir(path.join(treemaDir, "analysis", "inventory"), { recursive: true });
  await mkdir(path.join(treemaDir, "analysis", "analysis", "component_reports"), { recursive: true });
  await mkdir(path.join(treemaDir, "analysis", "architecture"), { recursive: true });
  await mkdir(path.join(treemaDir, "analysis", "execution", "task_specs"), { recursive: true });

  return {
    projectRoot,
    treemaDir
  };
}

export async function loadWorkspace(targetDir) {
  const projectRoot = path.resolve(targetDir);
  const treemaDir = path.join(projectRoot, ".treema");
  const statePath = path.join(treemaDir, "project_state.json");

  if (!(await exists(statePath))) {
    throw new Error(`Missing Treema state file: ${statePath}`);
  }

  const [stateRaw, briefRaw, focusRaw, nextRaw, decisionsRaw, statusRaw, taskIndexRaw, agentsRaw, operatingRulesRaw] = await Promise.all([
    readFile(statePath, "utf8"),
    readFile(path.join(treemaDir, "context", "project-brief.md"), "utf8"),
    readFile(path.join(treemaDir, "context", "current-focus.md"), "utf8"),
    readFile(path.join(treemaDir, "context", "next-tasks.md"), "utf8"),
    readFile(path.join(treemaDir, "logs", "decisions.md"), "utf8"),
    readFile(path.join(treemaDir, "logs", "status-updates.md"), "utf8"),
    readFile(path.join(treemaDir, "tasks", "task-index.md"), "utf8"),
    readTextFileIfExists(path.join(treemaDir, "AGENTS.md")),
    readTextFileIfExists(path.join(treemaDir, "context", "operating-rules.md"))
  ]);
  const analysis = await loadProjectAnalysis(projectRoot);

  return {
    projectRoot,
    treemaDir,
    state: JSON.parse(stateRaw),
    docs: {
      agents: agentsRaw,
      projectBrief: briefRaw,
      currentFocus: focusRaw,
      nextTasks: nextRaw,
      operatingRules: operatingRulesRaw,
      decisions: decisionsRaw,
      statusUpdates: statusRaw,
      taskIndex: taskIndexRaw
    },
    analysis
  };
}

export async function snapshotWorkspace(targetDir, options) {
  const projectRoot = path.resolve(targetDir);
  const treemaDir = path.join(projectRoot, ".treema");
  const statePath = path.join(treemaDir, "project_state.json");

  if (!(await exists(statePath))) {
    throw new Error(`Missing Treema state file: ${statePath}`);
  }

  const summary = options.summary;
  if (!summary || typeof summary !== "string") {
    throw new Error("snapshot requires --summary");
  }

  const focus = asArray(options.focus);
  const next = asArray(options.next);
  const risks = asArray(options.risk);
  const timestamp = nowIso();

  const rawState = await readFile(statePath, "utf8");
  const state = JSON.parse(rawState);
  state.meta.updatedAt = timestamp;
  state.meta.lastSnapshotAt = timestamp;
  state.meta.lastSnapshotSummary = summary;

  await writeTextFile(statePath, `${JSON.stringify(state, null, 2)}\n`);

  const statusLogPath = path.join(treemaDir, "logs", "status-updates.md");
  const currentLog = await readFile(statusLogPath, "utf8");
  await writeTextFile(statusLogPath, `${currentLog.trimEnd()}\n${renderStatusEntry({ summary, focus, next, risks, timestamp })}\n`);

  if (focus.length > 0) {
    await writeTextFile(
      path.join(treemaDir, "context", "current-focus.md"),
      `# Current Focus\n\n${focus.map((item) => `- ${item}`).join("\n")}\n`
    );
  }

  if (next.length > 0) {
    await writeTextFile(
      path.join(treemaDir, "context", "next-tasks.md"),
      `# Next Tasks\n\n${next.map((item) => `- [ ] ${item}`).join("\n")}\n`
    );
  }

  return {
    projectRoot,
    treemaDir,
    timestamp
  };
}
