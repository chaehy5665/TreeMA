import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import {
  SCAN_MODES,
  createArtifact,
  createProvenance,
  normalizeRelativePath,
  toSlug,
  toTitleCase,
  uniqueBy,
  uniqueSortedStrings
} from "./contracts.mjs";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".treema",
  ".turbo",
  ".vite",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "tmp"
]);

const ASSET_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp3",
  ".mp4",
  ".wav",
  ".webm"
]);

const DOC_EXTENSIONS = new Set([".md", ".mdx", ".rst", ".txt"]);
const STYLE_EXTENSIONS = new Set([".css", ".scss", ".sass", ".less"]);
const SCRIPT_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".jsx", ".tsx"]);
const DATA_EXTENSIONS = new Set([".json", ".jsonc", ".yaml", ".yml", ".toml", ".csv"]);
const COMPONENT_FILE_EXTENSIONS = new Set([".jsx", ".tsx", ".vue", ".svelte"]);
const TEXT_SCAN_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".mts",
  ".cts",
  ".jsx",
  ".tsx",
  ".vue",
  ".svelte",
  ".html",
  ".json",
  ".md"
]);
const CONFIG_FILENAMES = new Set([
  "package.json",
  "tsconfig.json",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.ts",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "nuxt.config.js",
  "nuxt.config.ts",
  "svelte.config.js",
  "astro.config.mjs",
  "tailwind.config.js",
  "tailwind.config.ts"
]);

const MAX_ANALYZED_FILE_BYTES = 200_000;
const MAX_COMPONENTS = 200;
const MAX_SUMMARIZED_FILES = 48;
const MAX_PREVIEW_CHARS = 700;
const MAX_PREVIEW_LINES = 24;
const GROUPING_STOP_WORDS = new Set([
  "src",
  "app",
  "lib",
  "shared",
  "core",
  "internal",
  "components",
  "component",
  "pages",
  "page",
  "views",
  "view",
  "routes",
  "route",
  "scripts",
  "electron",
  "analysis"
]);

function classifyFile(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const ext = path.extname(normalized).toLowerCase();
  const base = path.basename(normalized);
  const segments = normalized.split("/");
  const firstSegment = segments[0];

  if (CONFIG_FILENAMES.has(base) || base.startsWith(".env")) {
    return { kind: "config", group: "config" };
  }

  if (firstSegment === "schemas" || normalized.includes("/schemas/") || base.includes(".schema.")) {
    return { kind: "schema", group: "data" };
  }

  if (firstSegment === "examples" || normalized.includes("/examples/")) {
    return { kind: "example", group: "examples" };
  }

  if (firstSegment === "docs" || DOC_EXTENSIONS.has(ext)) {
    return { kind: "documentation", group: "docs" };
  }

  if (ASSET_EXTENSIONS.has(ext)) {
    return { kind: "asset", group: "assets" };
  }

  if (STYLE_EXTENSIONS.has(ext)) {
    return { kind: "style", group: "ui" };
  }

  if (firstSegment === "scripts" || firstSegment === "electron") {
    return { kind: "runtime-module", group: "runtime" };
  }

  if (
    segments.includes("components") ||
    segments.includes("layouts") ||
    segments.includes("pages") ||
    segments.includes("views") ||
    COMPONENT_FILE_EXTENSIONS.has(ext)
  ) {
    return { kind: "component-file", group: "ui" };
  }

  if (SCRIPT_EXTENSIONS.has(ext) || normalized.startsWith("src/") || normalized.startsWith("app/")) {
    return { kind: "source-module", group: "source" };
  }

  if (DATA_EXTENSIONS.has(ext)) {
    return { kind: "data", group: "data" };
  }

  return { kind: "other", group: "other" };
}

async function walkProject(rootDir, currentDir = rootDir, files = [], directories = new Set(["."])) {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const sortedEntries = [...entries].sort((left, right) => left.name.localeCompare(right.name, "en"));

  for (const entry of sortedEntries) {
    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = normalizeRelativePath(path.relative(rootDir, absolutePath));

    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      directories.add(relativePath);
      await walkProject(rootDir, absolutePath, files, directories);
      continue;
    }

    if (!entry.isFile()) continue;
    files.push(relativePath);
  }

  return { files, directories: [...directories].sort((left, right) => left.localeCompare(right, "en")) };
}

async function maybeReadTextFile(targetPath) {
  const fileStat = await stat(targetPath);
  if (fileStat.size > MAX_ANALYZED_FILE_BYTES) {
    return { sizeBytes: fileStat.size, content: "" };
  }
  return {
    sizeBytes: fileStat.size,
    content: await readFile(targetPath, "utf8")
  };
}

function extractImports(content) {
  return uniqueSortedStrings(
    [...content.matchAll(/from\s+["']([^"']+)["']/g), ...content.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)].map(
      (match) => match[1]
    )
  );
}

function extractSymbolHints(content) {
  return uniqueSortedStrings(
    [
      ...content.matchAll(/\bfunction\s+([A-Za-z][A-Za-z0-9_]*)\s*\(/g),
      ...content.matchAll(/\bconst\s+([A-Za-z][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?(?:\(|[^=]*=>)/g),
      ...content.matchAll(/\bclass\s+([A-Za-z][A-Za-z0-9_]*)\b/g),
      ...content.matchAll(/\bexport\s+(?:default\s+)?(?:function|class|const)\s+([A-Za-z][A-Za-z0-9_]*)/g)
    ].map((match) => match[1])
  );
}

function buildPreview(content) {
  const preview = content
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(0, MAX_PREVIEW_LINES)
    .join("\n");
  return preview.slice(0, MAX_PREVIEW_CHARS);
}

function inferComponentKind(name, filePath) {
  if (name.startsWith("render")) return "ui_render_function";
  if (name.startsWith("use")) return "state_hook";
  if (filePath.startsWith("scripts/")) return "runtime_module";
  if (filePath.startsWith("electron/")) return "desktop_runtime_module";
  if (filePath.includes("/pages/")) return "page_component";
  if (filePath.includes("/layouts/")) return "layout_component";
  if (filePath.includes("/components/")) return "file_component";
  return "component";
}

function inferComponentDomainFromClassification(classification) {
  if (classification.group === "ui" || classification.group === "source") return "frontend";
  if (classification.group === "runtime") return "backend";
  if (classification.group === "data") return "data";
  if (classification.group === "config") return "ops";
  if (classification.group === "docs") return "docs";
  return "shared";
}

function inferLayer(segments, filePath, classification) {
  if (segments.includes("pages") || segments.includes("routes") || filePath.startsWith("app/")) return "routing";
  if (segments.includes("components")) return "components";
  if (segments.includes("layouts")) return "layout";
  if (segments.includes("hooks")) return "state";
  if (segments.includes("services")) return "services";
  if (segments.includes("stores") || segments.includes("state")) return "state";
  if (filePath.startsWith("electron/")) return "desktop";
  if (filePath.startsWith("scripts/")) return "runtime";
  if (classification.group === "data") return "data";
  return "module";
}

function inferFeatureSegments(relativePath) {
  const segments = normalizeRelativePath(relativePath).split("/");
  return segments.slice(0, -1).filter((segment) => segment && !GROUPING_STOP_WORDS.has(segment.toLowerCase())).slice(0, 2);
}

function buildGrouping(relativePath, classification, domainOverride = "") {
  const normalized = normalizeRelativePath(relativePath);
  const segments = normalized.split("/");
  const domain = domainOverride || inferComponentDomainFromClassification(classification);
  const area = segments[0] || ".";
  const layer = inferLayer(segments, normalized, classification);
  const featureSegments = inferFeatureSegments(normalized);
  const featureKey = featureSegments.length > 0 ? featureSegments.join("/") : area;
  const clusterId = `cluster:${toSlug(`${domain}-${area}-${layer}-${featureKey}`)}`;
  const clusterLabel = toTitleCase(featureSegments.length > 0 ? featureSegments.join(" ") : `${area} ${layer}`);

  return {
    domain,
    area,
    layer,
    featureKey,
    clusterId,
    clusterLabel
  };
}

function scoreCandidate(component, classification) {
  let score = 0.42;
  if (component.source === "filename_pattern") score += 0.08;
  if (component.source === "code_pattern") score += 0.12;
  if (component.type === "page_component" || component.type === "layout_component") score += 0.16;
  if (component.type === "file_component") score += 0.12;
  if (component.type === "ui_render_function" || component.type === "state_hook") score += 0.1;
  if (classification.group === "ui" || classification.group === "runtime") score += 0.08;
  if (component.path.includes("/components/") || component.path.includes("/pages/") || component.path.includes("/views/")) {
    score += 0.08;
  }
  if (component.path.split("/").length <= 3) score += 0.05;
  return Number(Math.min(0.95, score).toFixed(2));
}

function buildEvidenceSpan(relativePath, preview, lineCount) {
  return {
    id: `evidence:${toSlug(relativePath)}:preview`,
    path: relativePath,
    startLine: 1,
    endLine: Math.max(1, Math.min(lineCount || 1, MAX_PREVIEW_LINES)),
    label: "Preview",
    excerpt: preview
  };
}

function buildEntrypoints(files) {
  const candidates = [
    ["entry:index-html", "Web Entry", "index.html", "ui_entry", "browser-shell"],
    ["entry:src-main", "Main UI Controller", "src/main.js", "ui_controller", "browser-runtime"],
    ["entry:desktop-main", "Electron Main", "electron/main.cjs", "desktop_entry", "desktop-shell"],
    ["entry:desktop-preload", "Electron Preload", "electron/preload.cjs", "desktop_bridge", "desktop-shell"],
    ["entry:server", "Local App Server", "scripts/app-server.mjs", "server_entry", "runtime"],
    ["entry:cli", "CLI Entry", "scripts/treema.mjs", "cli_entry", "runtime"],
    ["entry:manifest", "Package Manifest", "package.json", "manifest", "metadata"]
  ];

  return candidates
    .filter(([, , targetPath]) => files.includes(targetPath))
    .map(([id, label, targetPath, kind, role]) => ({
      id,
      label,
      path: targetPath,
      kind,
      role,
      evidenceRefs: [targetPath]
    }));
}

function buildRoutes(files) {
  return files
    .filter(
      (file) =>
        file.includes("/pages/") ||
        file.includes("/routes/") ||
        file.startsWith("app/") ||
        /\[[^/]+\]/.test(file)
    )
    .map((file) => ({
      path: file,
      kind: file.endsWith(".html") ? "html_route" : "code_route",
      evidenceRefs: [file]
    }));
}

function buildProjectModules(directories, files) {
  const topLevelDirectories = directories
    .filter((directory) => directory !== "." && !directory.includes("/"))
    .map((directory) => ({
      id: `module:${toSlug(directory)}`,
      name: toTitleCase(directory),
      path: directory,
      type: directory === "src" ? "source_root" : directory === "scripts" ? "runtime_root" : "workspace_area"
    }));

  const topLevelFiles = files
    .filter((file) => !file.includes("/"))
    .map((file) => ({
      id: `module:${toSlug(file)}`,
      name: toTitleCase(path.basename(file, path.extname(file))),
      path: file,
      type: "top_level_file"
    }));

  return [...topLevelDirectories, ...topLevelFiles].sort((left, right) => left.path.localeCompare(right.path, "en"));
}

function buildServices(entrypoints) {
  return entrypoints
    .filter((entrypoint) => ["server_entry", "cli_entry", "desktop_entry", "ui_entry"].includes(entrypoint.kind))
    .map((entrypoint) => ({
      id: `service:${toSlug(entrypoint.path)}`,
      name: entrypoint.label,
      kind: entrypoint.kind,
      entrypointId: entrypoint.id,
      path: entrypoint.path,
      evidenceRefs: [entrypoint.path]
    }));
}

async function maybeReadPackageManifest(rootDir) {
  try {
    const manifestRaw = await readFile(path.join(rootDir, "package.json"), "utf8");
    return JSON.parse(manifestRaw);
  } catch {
    return null;
  }
}

function detectFrameworks(manifest, files) {
  const frameworks = new Set();
  const dependencies = {
    ...(manifest?.dependencies || {}),
    ...(manifest?.devDependencies || {})
  };

  if (dependencies.react) frameworks.add("react");
  if (dependencies.vue) frameworks.add("vue");
  if (dependencies.svelte) frameworks.add("svelte");
  if (dependencies.next) frameworks.add("next");
  if (dependencies.nuxt) frameworks.add("nuxt");
  if (dependencies.vite) frameworks.add("vite");
  if (dependencies.electron) frameworks.add("electron");

  if (files.some((file) => file.endsWith(".vue"))) frameworks.add("vue");
  if (files.some((file) => file.endsWith(".svelte"))) frameworks.add("svelte");
  if (files.some((file) => file.endsWith(".jsx") || file.endsWith(".tsx"))) frameworks.add("jsx");
  if (files.includes("index.html")) frameworks.add("static-html");

  return [...frameworks].sort((left, right) => left.localeCompare(right, "en"));
}

function detectProjectKinds(files) {
  const kinds = new Set();
  if (files.some((file) => file === "package.json")) kinds.add("node");
  if (files.some((file) => file.endsWith(".html") || file.endsWith(".css"))) kinds.add("browser-ui");
  if (files.some((file) => file.endsWith(".jsx") || file.endsWith(".tsx"))) kinds.add("jsx-ui");
  if (files.some((file) => file.endsWith(".vue"))) kinds.add("vue");
  if (files.some((file) => file.endsWith(".svelte"))) kinds.add("svelte");
  if (files.some((file) => file.startsWith("scripts/"))) kinds.add("cli-or-server");
  if (files.some((file) => file.startsWith("schemas/"))) kinds.add("structured-data");
  if (files.some((file) => file.startsWith("electron/"))) kinds.add("desktop-shell");
  return [...kinds].sort((left, right) => left.localeCompare(right, "en"));
}

async function buildFileEvidence(rootDir, files) {
  const evidence = [];

  for (const relativePath of files) {
    const classification = classifyFile(relativePath);
    const ext = path.extname(relativePath).toLowerCase();
    let sizeBytes = 0;
    let lineCount = 0;
    let imports = [];
    let symbolHints = [];
    let preview = "";

    if (TEXT_SCAN_EXTENSIONS.has(ext) || classification.kind === "config" || classification.kind === "documentation") {
      try {
        const result = await maybeReadTextFile(path.join(rootDir, relativePath));
        sizeBytes = result.sizeBytes;
        if (result.content) {
          lineCount = result.content.split("\n").length;
          preview = buildPreview(result.content);
          if (SCRIPT_EXTENSIONS.has(ext) || ext === ".jsx" || ext === ".tsx" || ext === ".vue" || ext === ".svelte") {
            imports = extractImports(result.content);
            symbolHints = extractSymbolHints(result.content);
          }
        }
      } catch {
        sizeBytes = 0;
      }
    } else {
      try {
        sizeBytes = (await stat(path.join(rootDir, relativePath))).size;
      } catch {
        sizeBytes = 0;
      }
    }

    evidence.push({
      id: `file:${toSlug(relativePath)}`,
      path: relativePath,
      kind: classification.kind,
      group: classification.group,
      extension: ext,
      sizeBytes,
      lineCount,
      imports,
      symbolHints,
      evidenceSpans: preview ? [buildEvidenceSpan(relativePath, preview, lineCount)] : []
    });
  }

  return evidence;
}

function extractFileLevelComponent(relativePath) {
  const base = path.basename(relativePath, path.extname(relativePath));
  if (!/^[A-Z][A-Za-z0-9]+$/.test(base)) return null;
  return {
    id: `component:${toSlug(`${relativePath}-${base}`)}`,
    name: base,
    type: inferComponentKind(base, relativePath),
    path: relativePath,
    source: "filename_pattern"
  };
}

function extractNamedFunctions(content, relativePath) {
  const matches = [
    ...content.matchAll(/\bfunction\s+((?:render|use)[A-Z][A-Za-z0-9_]*|[A-Z][a-zA-Z0-9]*)\s*\(/g),
    ...content.matchAll(/\bconst\s+((?:render|use)[A-Z][A-Za-z0-9_]*|[A-Z][a-zA-Z0-9]*)\s*=\s*(?:async\s*)?\(/g),
    ...content.matchAll(/\bconst\s+((?:render|use)[A-Z][A-Za-z0-9_]*|[A-Z][a-zA-Z0-9]*)\s*=\s*(?:async\s*)?[^=]*=>/g)
  ];

  return matches.map((match) => {
    const name = match[1];
    return {
      id: `component:${toSlug(`${relativePath}-${name}`)}`,
      name,
      type: inferComponentKind(name, relativePath),
      path: relativePath,
      source: "code_pattern"
    };
  });
}

async function scanDeterministicCandidateHints(rootDir, files) {
  const components = [];
  const maxComponents = Math.min(MAX_COMPONENTS, Math.max(120, Math.ceil(files.length * 0.18)));

  for (const relativePath of files) {
    const classification = classifyFile(relativePath);
    if (!["component-file", "source-module", "runtime-module"].includes(classification.kind)) continue;

    const fileLevelComponent = extractFileLevelComponent(relativePath);
    if (fileLevelComponent) {
      components.push(fileLevelComponent);
    }

    const ext = path.extname(relativePath).toLowerCase();
    if (!TEXT_SCAN_EXTENSIONS.has(ext)) continue;

    try {
      const result = await maybeReadTextFile(path.join(rootDir, relativePath));
      if (!result.content) continue;
      components.push(...extractNamedFunctions(result.content, relativePath));
    } catch {
      continue;
    }

    if (components.length >= maxComponents * 3) break;
  }

  return uniqueBy(components, (item) => `${item.path}:${item.name}`)
    .map((component) => {
      const classification = classifyFile(component.path);
      const grouping = buildGrouping(component.path, classification);
      return {
        ...component,
        grouping,
        candidateConfidence: scoreCandidate(component, classification),
        evidenceRefs: [component.path]
      };
    })
    .sort(
      (left, right) =>
        right.candidateConfidence - left.candidateConfidence ||
        `${left.grouping.clusterId}:${left.path}:${left.name}`.localeCompare(
          `${right.grouping.clusterId}:${right.path}:${right.name}`,
          "en"
        )
    )
    .slice(0, maxComponents);
}

function buildScannerPayload({
  projectInventory,
  entrypoints,
  routes,
  fileEvidence,
  candidateHints,
  docsPresence
}) {
  const emphasizedPaths = uniqueSortedStrings([
    ...entrypoints.map((entrypoint) => entrypoint.path),
    ...docsPresence,
    ...candidateHints.slice(0, 12).map((candidate) => candidate.path)
  ]).slice(0, MAX_SUMMARIZED_FILES);

  const fileIndex = new Map(fileEvidence.map((item) => [item.path, item]));

  return {
    project: {
      projectName: projectInventory.projectName,
      projectRoot: projectInventory.projectRoot,
      frameworks: projectInventory.summary.frameworks,
      projectKinds: projectInventory.summary.projectKinds,
      topLevelDirectories: projectInventory.topLevelDirectories,
      services: projectInventory.services,
      routes
    },
    entrypoints,
    deterministicCandidateHints: candidateHints.slice(0, 28).map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      type: candidate.type,
      path: candidate.path,
      grouping: candidate.grouping,
      confidence: candidate.candidateConfidence
    })),
    fileSummaries: emphasizedPaths
      .map((targetPath) => fileIndex.get(targetPath))
      .filter(Boolean)
      .map((file) => ({
        path: file.path,
        kind: file.kind,
        group: file.group,
        imports: file.imports.slice(0, 8),
        symbolHints: file.symbolHints.slice(0, 8),
        preview: file.evidenceSpans[0]?.excerpt || ""
      }))
  };
}

function normalizePriority(item, knownPaths) {
  const paths = uniqueSortedStrings((item?.paths || []).filter((value) => knownPaths.has(value)));
  const label = String(item?.label || item?.name || paths[0] || "Scan target").trim();
  const reason = String(item?.reason || item?.summary || "Important for scan coverage.").trim();
  return {
    id: String(item?.id || `priority:${toSlug(label)}`),
    label,
    reason,
    priority: Number(item?.priority ?? item?.rank ?? 50) || 50,
    confidence: Number(item?.confidence ?? 0.6) || 0.6,
    paths,
    evidenceRefs: paths
  };
}

function normalizeDomain(item, knownRefs) {
  const name = String(item?.name || item?.label || "Shared Domain").trim();
  const evidenceRefs = uniqueSortedStrings((item?.evidenceRefs || item?.paths || []).filter((value) => knownRefs.has(value)));
  return {
    id: String(item?.id || `domain:${toSlug(name)}`),
    name,
    description: String(item?.description || item?.summary || `${name} groups related responsibilities.`).trim(),
    evidenceRefs,
    confidence: Number(item?.confidence ?? 0.62) || 0.62
  };
}

function normalizeBundle(item, knownPaths, entrypointIdSet, priorities, domains) {
  const paths = uniqueSortedStrings((item?.paths || []).filter((value) => knownPaths.has(value)));
  if (paths.length === 0) return null;
  const name = String(item?.name || item?.label || path.basename(paths[0], path.extname(paths[0]))).trim();
  const domainHint = String(item?.domainHint || item?.domain || domains[0]?.name || "").trim();
  const priority = Number(item?.priority ?? item?.rank ?? priorities[0]?.priority ?? 50) || 50;
  return {
    id: String(item?.id || `bundle:${toSlug(name)}`),
    name,
    type: String(item?.type || "component_bundle").trim(),
    paths,
    evidenceRefs: uniqueSortedStrings(paths),
    entrypointIds: uniqueSortedStrings((item?.entrypointIds || []).filter((value) => entrypointIdSet.has(value))),
    domainHint,
    responsibilityHint: String(item?.responsibilityHint || item?.summary || `${name} owns a meaningful part of the project.`).trim(),
    priority,
    confidence: Number(item?.confidence ?? 0.66) || 0.66
  };
}

function bundleToCandidateComponent(bundle) {
  const primaryPath = bundle.paths[0];
  const classification = classifyFile(primaryPath);
  const grouping = buildGrouping(primaryPath, classification, bundle.domainHint ? toSlug(bundle.domainHint) : "");
  return {
    id: `component:${toSlug(bundle.name)}`,
    bundleId: bundle.id,
    name: bundle.name,
    type: bundle.type,
    path: primaryPath,
    primaryFiles: bundle.paths,
    grouping,
    candidateConfidence: Number(Math.min(0.95, bundle.confidence || 0.66).toFixed(2)),
    owningArea: primaryPath.split("/")[0] || ".",
    evidenceRefs: bundle.evidenceRefs,
    rationale: bundle.responsibilityHint,
    scanPriority: bundle.priority,
    domainHypothesisIds: bundle.domainHint ? [`domain:${toSlug(bundle.domainHint)}`] : []
  };
}

async function runAiScanner(payload, aiContext) {
  const response = await aiContext.runJsonStage(
    "scanner",
    payload,
    {
      modelProfile: "fast",
      userPrompt: `You are the AI-native Scanner stage in TreeMA.
Return one JSON object with this shape:
{
  "scanRationale": {
    "summary": "string",
    "focusAreas": ["string"],
    "notablePaths": ["path"],
    "criticalQuestions": ["string"],
    "unknowns": ["string"]
  },
  "priorities": [
    {
      "id": "string",
      "label": "string",
      "reason": "string",
      "priority": 0,
      "confidence": 0.0,
      "paths": ["path"]
    }
  ],
  "bundles": [
    {
      "id": "string",
      "name": "string",
      "type": "string",
      "paths": ["path"],
      "entrypointIds": ["entry id"],
      "domainHint": "string",
      "responsibilityHint": "string",
      "priority": 0,
      "confidence": 0.0
    }
  ],
  "domains": [
    {
      "id": "string",
      "name": "string",
      "description": "string",
      "evidenceRefs": ["path"],
      "confidence": 0.0
    }
  ]
}
Rules:
- Use only paths and entrypoint ids from the input.
- Prioritize semantic coverage, not raw file count.
- Candidate bundles should represent meaningful components or flows, not random files.
- If evidence is sparse, say so in unknowns instead of inventing structure.`
    }
  );

  return response;
}

export async function runScanner(projectRoot, generatedAt, options = {}) {
  const scanMode = options.scanMode || SCAN_MODES.PROJECT;
  const aiContext = options.aiContext || null;
  const { files, directories } = await walkProject(projectRoot);
  const manifest = await maybeReadPackageManifest(projectRoot);
  const frameworks = detectFrameworks(manifest, files);
  const projectKinds = detectProjectKinds(files);
  const entrypoints = buildEntrypoints(files);
  const routes = buildRoutes(files);
  const modules = buildProjectModules(directories, files);
  const services = buildServices(entrypoints);
  const fileEvidence = await buildFileEvidence(projectRoot, files);
  const candidateHints = await scanDeterministicCandidateHints(projectRoot, files);
  const docsPresence = files.filter((file) => file === "README.md" || file.startsWith("docs/"));
  const knownPaths = new Set(files);
  const knownRefs = new Set([...files, ...entrypoints.map((item) => item.id)]);
  const provenance = createProvenance({
    provider: aiContext?.provider || "",
    model: aiContext?.model || "",
    promptVersion: aiContext?.promptVersion,
    stageMode: scanMode,
    generatedFromCache: false
  });

  const unknowns = [];
  if (docsPresence.length === 0) {
    unknowns.push("project documentation is sparse");
  }
  if (entrypoints.length === 0) {
    unknowns.push("no conventional entrypoints detected");
  }

  const projectInventory = createArtifact({
    artifactType: "inventory/project_inventory",
    generatedAt,
    observed: [...files.slice(0, 30), ...entrypoints.map((entrypoint) => entrypoint.path)],
    inferred: [...frameworks, ...projectKinds],
    uncertain:
      scanMode === SCAN_MODES.QUICK
        ? ["Quick Scan is inventory-only and does not run semantic AI stages."]
        : routes.length === 0
          ? ["route inventory inferred from file structure only"]
          : [],
    unknowns,
    confidence: scanMode === SCAN_MODES.QUICK ? 0.9 : 0.88,
    provenance,
    projectRoot,
    projectName: manifest?.name || path.basename(projectRoot),
    directories,
    topLevelDirectories: directories.filter((directory) => directory !== "." && !directory.includes("/")),
    services,
    modules,
    configs: fileEvidence.filter((entry) => entry.kind === "config").map((entry) => entry.path),
    routes,
    entrypointIds: entrypoints.map((entrypoint) => entrypoint.id),
    summary: {
      totalFiles: files.length,
      totalDirectories: Math.max(0, directories.length - 1),
      frameworks,
      projectKinds
    }
  });

  const fileIndex = createArtifact({
    artifactType: "inventory/file_index",
    generatedAt,
    observed: files.slice(0, 40),
    inferred: uniqueSortedStrings(fileEvidence.map((entry) => `${entry.path}:${entry.kind}`)).slice(0, 40),
    unknowns,
    confidence: 0.95,
    provenance,
    evidenceRefs: fileEvidence.flatMap((entry) => entry.evidenceSpans.map((span) => span.id)).slice(0, 40),
    files: fileEvidence
  });

  const entrypointsArtifact = createArtifact({
    artifactType: "inventory/entrypoints",
    generatedAt,
    observed: entrypoints.map((entrypoint) => entrypoint.path),
    inferred: entrypoints.map((entrypoint) => `${entrypoint.label}:${entrypoint.role}`),
    uncertain: entrypoints.length === 0 ? ["entrypoint coverage is incomplete"] : [],
    unknowns,
    confidence: entrypoints.length > 0 ? 0.82 : 0.45,
    provenance,
    entrypoints
  });

  if (scanMode === SCAN_MODES.QUICK) {
    const candidateComponents = createArtifact({
      artifactType: "inventory/candidate_components",
      generatedAt,
      observed: candidateHints.map((component) => component.path),
      inferred: candidateHints.map((component) => `${component.name}:${component.type}`),
      uncertain: ["Quick Scan candidates are deterministic hints, not AI-grounded semantic bundles."],
      unknowns,
      confidence: candidateHints.length > 0 ? 0.68 : 0.38,
      provenance,
      components: candidateHints.map((component) => ({
        ...component,
        primaryFiles: [component.path],
        owningArea: component.path.split("/")[0] || "."
      }))
    });

    return {
      projectInventory,
      fileIndex,
      entrypoints: entrypointsArtifact,
      candidateComponents,
      scanPriorities: null,
      evidenceBundles: null,
      scanRationale: null,
      domainHypotheses: null,
      deterministicEvidence: {
        fileEvidence,
        candidateHints
      }
    };
  }

  const scannerPayload = buildScannerPayload({
    projectInventory,
    entrypoints,
    routes,
    fileEvidence,
    candidateHints,
    docsPresence
  });
  const scannerResult = await runAiScanner(scannerPayload, aiContext);
  const aiProvenance = createProvenance({
    ...scannerResult.provenance
  });
  const priorities = uniqueBy(
    (scannerResult.data?.priorities || []).map((item) => normalizePriority(item, knownPaths)),
    (item) => item.id
  )
    .sort((left, right) => left.priority - right.priority || left.label.localeCompare(right.label, "en"))
    .slice(0, 24);
  const domains = uniqueBy(
    (scannerResult.data?.domains || []).map((item) => normalizeDomain(item, knownRefs)),
    (item) => item.id
  ).slice(0, 12);
  const entrypointIdSet = new Set(entrypoints.map((item) => item.id));
  const bundles = uniqueBy(
    (scannerResult.data?.bundles || [])
      .map((item) => normalizeBundle(item, knownPaths, entrypointIdSet, priorities, domains))
      .filter(Boolean),
    (item) => item.id
  )
    .sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name, "en"))
    .slice(0, 24);
  const candidateComponentsList = bundles.map(bundleToCandidateComponent);

  const scanRationale = createArtifact({
    artifactType: "inventory/scan_rationale",
    generatedAt,
    observed: scannerPayload.fileSummaries.map((item) => item.path),
    inferred: [String(scannerResult.data?.scanRationale?.summary || "Semantic scan rationale generated.")],
    uncertain: uniqueSortedStrings(scannerResult.data?.scanRationale?.unknowns || []),
    unknowns: uniqueSortedStrings(scannerResult.data?.scanRationale?.criticalQuestions || []).slice(0, 12),
    confidence: candidateComponentsList.length > 0 ? 0.74 : 0.52,
    provenance: aiProvenance,
    summary: String(scannerResult.data?.scanRationale?.summary || "Semantic scan rationale generated.").trim(),
    focusAreas: uniqueSortedStrings(scannerResult.data?.scanRationale?.focusAreas || []),
    notablePaths: uniqueSortedStrings((scannerResult.data?.scanRationale?.notablePaths || []).filter((value) => knownPaths.has(value))),
    criticalQuestions: uniqueSortedStrings(scannerResult.data?.scanRationale?.criticalQuestions || [])
  });

  const scanPriorities = createArtifact({
    artifactType: "inventory/scan_priorities",
    generatedAt,
    observed: priorities.flatMap((item) => item.paths).slice(0, 32),
    inferred: priorities.map((item) => `${item.label}:${item.priority}`),
    uncertain: priorities.length === 0 ? ["No AI scan priorities were produced."] : [],
    unknowns,
    confidence: priorities.length > 0 ? 0.73 : 0.46,
    provenance: aiProvenance,
    priorities
  });

  const evidenceBundles = createArtifact({
    artifactType: "inventory/evidence_bundles",
    generatedAt,
    observed: bundles.flatMap((bundle) => bundle.paths).slice(0, 40),
    inferred: bundles.map((bundle) => `${bundle.name}:${bundle.type}`),
    uncertain: bundles.length === 0 ? ["No semantic evidence bundles were formed."] : [],
    unknowns,
    confidence: bundles.length > 0 ? 0.74 : 0.44,
    provenance: aiProvenance,
    bundles
  });

  const domainHypotheses = createArtifact({
    artifactType: "inventory/domain_hypotheses",
    generatedAt,
    observed: domains.flatMap((domain) => domain.evidenceRefs).slice(0, 40),
    inferred: domains.map((domain) => domain.name),
    uncertain: domains.length === 0 ? ["Project domains remain weakly identified."] : [],
    unknowns,
    confidence: domains.length > 0 ? 0.7 : 0.4,
    provenance: aiProvenance,
    domains
  });

  const candidateComponents = createArtifact({
    artifactType: "inventory/candidate_components",
    generatedAt,
    observed: candidateComponentsList.flatMap((component) => component.primaryFiles).slice(0, 40),
    inferred: candidateComponentsList.map((component) => `${component.name}:${component.type}`),
    uncertain: candidateComponentsList.length === 0 ? ["Component bundles were not confidently formed."] : [],
    unknowns: uniqueSortedStrings([...unknowns, ...scanRationale.unknowns]),
    confidence: candidateComponentsList.length > 0 ? 0.79 : 0.38,
    provenance: aiProvenance,
    evidenceRefs: candidateComponentsList.flatMap((component) => component.evidenceRefs).slice(0, 40),
    components: candidateComponentsList
  });

  return {
    projectInventory,
    fileIndex,
    entrypoints: entrypointsArtifact,
    candidateComponents,
    scanPriorities,
    evidenceBundles,
    scanRationale,
    domainHypotheses,
    deterministicEvidence: {
      fileEvidence,
      candidateHints
    }
  };
}
