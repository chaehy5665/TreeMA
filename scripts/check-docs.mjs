import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { initWorkspace } from "./lib/treema-workspace.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const REQUIRED_REPO_FILES = [
  "AGENTS.md",
  "README.md",
  "docs/README.md",
  "docs/ARCHITECTURE.md",
  "docs/MVP_SPEC.md",
  "docs/DATA_MODEL.md",
  "docs/PROJECT_STRUCTURE.md",
  "docs/TREEMA_WORKSPACE.md",
  "docs/PLANS.md",
  "docs/QUALITY_SCORE.md",
  "docs/TECH_DEBT.md",
  "docs/exec-plans/TEMPLATE.md",
  "docs/exec-plans/active/README.md",
  "docs/exec-plans/completed/README.md",
  "schemas/project_state.schema.json",
  "schemas/project_structure.schema.json",
  "schemas/analysis/root-manifest.schema.json",
  "schemas/analysis/artifact-metadata.schema.json",
  "schemas/analysis/inventory/project_inventory.schema.json",
  "schemas/analysis/inventory/file_index.schema.json",
  "schemas/analysis/inventory/entrypoints.schema.json",
  "schemas/analysis/inventory/candidate_components.schema.json",
  "schemas/analysis/inventory/scan_priorities.schema.json",
  "schemas/analysis/inventory/evidence_bundles.schema.json",
  "schemas/analysis/inventory/scan_rationale.schema.json",
  "schemas/analysis/inventory/domain_hypotheses.schema.json",
  "schemas/analysis/analysis/component_report.schema.json",
  "schemas/analysis/analysis/system_map.schema.json",
  "schemas/analysis/analysis/component_hierarchy.schema.json",
  "schemas/analysis/analysis/dependency_graph.schema.json",
  "schemas/analysis/analysis/analysis_gaps.schema.json",
  "schemas/analysis/architecture/architecture_blueprint.schema.json",
  "schemas/analysis/architecture/interface_contracts.schema.json",
  "schemas/analysis/architecture/module_boundaries.schema.json",
  "schemas/analysis/architecture/implementation_strategy.schema.json",
  "schemas/analysis/architecture/validation_report.schema.json",
  "schemas/analysis/execution/execution_plan.schema.json",
  "schemas/analysis/execution/task_spec.schema.json"
];

const REQUIRED_WORKSPACE_FILES = [
  ".treema/README.md",
  ".treema/AGENTS.md",
  ".treema/project_state.json",
  ".treema/analysis",
  ".treema/analysis/inventory",
  ".treema/analysis/analysis",
  ".treema/analysis/analysis/component_reports",
  ".treema/analysis/architecture",
  ".treema/analysis/execution",
  ".treema/analysis/execution/task_specs",
  ".treema/context/project-brief.md",
  ".treema/context/current-focus.md",
  ".treema/context/next-tasks.md",
  ".treema/context/operating-rules.md",
  ".treema/logs/decisions.md",
  ".treema/logs/status-updates.md",
  ".treema/tasks/task-index.md",
  ".treema/plans/active/README.md",
  ".treema/plans/completed/README.md",
  ".treema/ai/proposals"
];

const ALLOWED_AGENT_LINKS = new Set([
  "docs/README.md",
  "docs/MVP_SPEC.md",
  "docs/DATA_MODEL.md",
  "docs/ARCHITECTURE.md",
  "docs/PROJECT_STRUCTURE.md",
  "docs/TREEMA_WORKSPACE.md",
  "docs/PLANS.md",
  "docs/QUALITY_SCORE.md",
  "docs/TECH_DEBT.md"
]);

function normalizeRelativePath(value) {
  return value.split("#")[0].replace(/\\/g, "/");
}

function isLocalDocLink(target) {
  return (
    target &&
    !target.startsWith("#") &&
    !target.startsWith("http://") &&
    !target.startsWith("https://") &&
    !target.startsWith("mailto:")
  );
}

function extractMarkdownLinks(content) {
  return [...content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);
}

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function listMarkdownFiles(targetDir) {
  const entries = await readdir(targetDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(absolutePath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(absolutePath);
    }
  }

  return files;
}

async function main() {
  const errors = [];

  for (const relativePath of REQUIRED_REPO_FILES) {
    const absolutePath = path.join(rootDir, relativePath);
    if (!(await pathExists(absolutePath))) {
      errors.push(`Missing required repo doc: ${relativePath}`);
    }
  }

  const repoMarkdownFiles = [
    path.join(rootDir, "AGENTS.md"),
    ...(await listMarkdownFiles(path.join(rootDir, "docs")))
  ];

  for (const absolutePath of repoMarkdownFiles) {
    if (!(await pathExists(absolutePath))) {
      continue;
    }

    const content = await readFile(absolutePath, "utf8");
    const fileLabel = path.relative(rootDir, absolutePath).replace(/\\/g, "/");

    for (const linkTarget of extractMarkdownLinks(content)) {
      if (!isLocalDocLink(linkTarget)) {
        continue;
      }

      const normalizedTarget = normalizeRelativePath(linkTarget);
      const resolvedPath = path.resolve(path.dirname(absolutePath), normalizedTarget);
      if (!(await pathExists(resolvedPath))) {
        errors.push(`${fileLabel} contains a broken local link: ${linkTarget}`);
      }
    }

    if (fileLabel === "AGENTS.md") {
      const agentTargets = extractMarkdownLinks(content)
        .filter(isLocalDocLink)
        .map(normalizeRelativePath);
      for (const target of agentTargets) {
        if (!ALLOWED_AGENT_LINKS.has(target)) {
          errors.push(`AGENTS.md references a non-canonical doc: ${target}`);
        }
      }
    }
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "treema-docs-"));
  try {
    await initWorkspace(tempRoot, "Docs Check");
    for (const relativePath of REQUIRED_WORKSPACE_FILES) {
      const absolutePath = path.join(tempRoot, relativePath);
      if (!(await pathExists(absolutePath))) {
        errors.push(`Workspace init did not create: ${relativePath}`);
      }
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }

  if (errors.length > 0) {
    console.error("Docs validation failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Docs validation passed.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
