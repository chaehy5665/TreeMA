import { buildViewModel } from "./lib/derive-view-model.js";
import {
  buildSidebarProjectMarkup,
  buildSidebarUtilityMarkup,
  countSidebarProjects,
  sanitizeSidebarLocation
} from "./lib/sidebar.js";
import { createProviderSettingsController } from "./lib/provider-settings.js";
import { validateState } from "./lib/validate-state.js";

const STATUS_COLUMNS = ["backlog", "ready", "in_progress", "blocked", "done"];
const RISK_COLUMNS = ["critical", "high", "medium", "low"];
const SCAN_SECTION_LABELS = {
  hierarchy: "Hierarchy",
  dependency: "Dependency",
  flow: "Critical Flow",
  roadmap: "Roadmap"
};
const TAB_CONFIG = [
  { id: "workspace", label: "Workspace", description: "Connection, imports, focus, and snapshots." },
  { id: "structure", label: "Structure", description: "Projects, subprojects, and track topology." },
  { id: "board", label: "Board", description: "Task and risk status lanes across active work." },
  { id: "timeline", label: "Timeline", description: "Decisions, risks, and markdown workspace context." },
  { id: "scan", label: "Project Scan", description: "Hierarchy, dependency, validator, and execution views." },
  { id: "review", label: "AI Review", description: "Proposal diffs against the current canonical state." }
];
const DEFAULT_UI_SETTINGS = {
  defaultTab: "workspace",
  density: "comfortable",
  showDocs: true,
  pinnedSidebar: true,
  autoOpenScan: true
};
const UI_SETTINGS_STORAGE_KEY = "treema.ui.settings";
const LAST_WORKSPACE_STORAGE_KEY = "treema.last-workspace";
const desktopBridge = window.treemaDesktop ?? null;

const appShellEl = document.querySelector(".app-shell");
const sidebarUtilityNavEl = document.querySelector("#sidebar-utility-nav");
const sidebarNavEl = document.querySelector("#sidebar-nav");
const sidebarWorkspaceNameEl = document.querySelector("#sidebar-workspace-name");
const sidebarStatusChipEl = document.querySelector("#sidebar-status-chip");
const sidebarWorkspaceMetaEl = document.querySelector("#sidebar-workspace-meta");
const sidebarProjectCountEl = document.querySelector("#sidebar-project-count");
const sidebarSectionNoteEl = document.querySelector("#sidebar-section-note");
const sidebarNewProjectButtonEl = document.querySelector("#sidebar-new-project-button");
const workspaceStatusEl = document.querySelector("#workspace-status");
const validationSummaryEl = document.querySelector("#validation-summary");
const currentFocusEl = document.querySelector("#current-focus");
const nextTasksEl = document.querySelector("#next-tasks");
const projectSummaryEl = document.querySelector("#project-summary");
const structureMapEl = document.querySelector("#structure-map");
const taskBoardEl = document.querySelector("#task-board");
const riskBoardEl = document.querySelector("#risk-board");
const workspaceDocsEl = document.querySelector("#workspace-docs");
const recentDecisionsEl = document.querySelector("#recent-decisions");
const timelineEl = document.querySelector("#timeline");
const proposalSummaryEl = document.querySelector("#proposal-summary");
const proposalChangesEl = document.querySelector("#proposal-changes");

const analyzeProjectButtonEl = document.querySelector("#analyze-project-button");
const quickScanButtonEl = document.querySelector("#quick-scan-button");
const snapshotSummaryInputEl = document.querySelector("#snapshot-summary-input");
const snapshotFocusInputEl = document.querySelector("#snapshot-focus-input");
const snapshotNextInputEl = document.querySelector("#snapshot-next-input");
const snapshotRisksInputEl = document.querySelector("#snapshot-risks-input");
const saveSnapshotButtonEl = document.querySelector("#save-snapshot-button");

const stateFileInputEl = document.querySelector("#state-file-input");
const proposalFileInputEl = document.querySelector("#proposal-file-input");
const exportStateButtonEl = document.querySelector("#export-state-button");
const analysisSummaryEl = document.querySelector("#analysis-summary");
const analysisHierarchyEl = document.querySelector("#analysis-hierarchy");
const analysisDependenciesEl = document.querySelector("#analysis-dependencies");
const analysisFlowsEl = document.querySelector("#analysis-flows");
const analysisRoadmapEl = document.querySelector("#analysis-roadmap");
const scanInspectorEl = document.querySelector("#scan-inspector");
const openSettingsButtonEl = document.querySelector("#open-settings-button");
const settingsModalEl = document.querySelector("#settings-modal");
const closeSettingsButtonEl = document.querySelector("#close-settings-button");
const tabShortcutsEl = document.querySelector("#tab-shortcuts");
const settingsSidebarNavEl = document.querySelector("#settings-sidebar-nav");
const settingsContentEl = document.querySelector("#settings-content");
const mainHeaderKickerEl = document.querySelector("#main-header-kicker");
const mainHeaderTitleEl = document.querySelector("#main-header-title");
const mainHeaderDescriptionEl = document.querySelector("#main-header-description");
const mainHeaderContextEl = document.querySelector("#main-header-context");
const settingsDefaultTabEl = document.querySelector("#settings-default-tab");
const settingsDensityEl = document.querySelector("#settings-density");
const settingsShowDocsEl = document.querySelector("#settings-show-docs");
const settingsPinnedSidebarEl = document.querySelector("#settings-pinned-sidebar");
const settingsAutoOpenScanEl = document.querySelector("#settings-auto-open-scan");
const settingsAccountStorageEl = document.querySelector("#settings-account-storage");
const settingsOpenAiBadgeEl = document.querySelector("#settings-openai-badge");
const settingsOpenAiLoginEl = document.querySelector("#settings-openai-login");
const settingsOpenAiApiKeyEl = document.querySelector("#settings-openai-api-key");
const settingsOpenAiBaseUrlEl = document.querySelector("#settings-openai-base-url");
const settingsOpenAiModelEl = document.querySelector("#settings-openai-model");
const settingsOpenAiSaveEl = document.querySelector("#settings-openai-save");
const settingsOpenAiTestEl = document.querySelector("#settings-openai-test");
const settingsOpenAiDisconnectEl = document.querySelector("#settings-openai-disconnect");
const settingsOpenAiStatusEl = document.querySelector("#settings-openai-status");
const settingsGitHubCopilotBadgeEl = document.querySelector("#settings-github-copilot-badge");
const settingsGitHubCopilotRegisterEl = document.querySelector("#settings-github-copilot-register");
const settingsGitHubCopilotHostedCallbackUrlEl = document.querySelector("#settings-github-copilot-hosted-callback-url");
const settingsGitHubCopilotCallbackUrlEl = document.querySelector("#settings-github-copilot-callback-url");
const settingsGitHubCopilotCallbackNoteEl = document.querySelector("#settings-github-copilot-callback-note");
const settingsGitHubCopilotTokenEl = document.querySelector("#settings-github-copilot-token");
const settingsGitHubCopilotSaveEl = document.querySelector("#settings-github-copilot-save");
const settingsGitHubCopilotTestEl = document.querySelector("#settings-github-copilot-test");
const settingsGitHubCopilotDisconnectEl = document.querySelector("#settings-github-copilot-disconnect");
const settingsGitHubCopilotStatusEl = document.querySelector("#settings-github-copilot-status");
const OPENAI_LOGIN_URL = "https://chatgpt.com/auth/login";
const DEFAULT_WEB_APP_ORIGIN = "https://app.treesma.com";
const WEB_APP_ACCOUNTS_PATH = "/settings/accounts";
const SETTINGS_SECTION_CONFIG = [
  {
    id: "general",
    group: "Desktop",
    label: "General",
    description: "Startup and analysis behavior.",
    icon: "sliders"
  },
  {
    id: "views",
    group: "Desktop",
    label: "Shortcuts",
    description: "Jump across dashboard surfaces.",
    icon: "keyboard"
  },
  {
    id: "appearance",
    group: "Desktop",
    label: "Appearance",
    description: "Density and supporting panels.",
    icon: "sparkles"
  },
  {
    id: "ai-accounts",
    group: "Server",
    label: "Providers",
    description: "OpenAI API, ChatGPT Codex OAuth, and GitHub Copilot connections.",
    icon: "server"
  }
];

let currentState = null;
let currentProposal = null;
let currentWorkspace = null;
let currentAnalysis = null;
let currentDocs = null;
let accountSettings = null;
let activeScanSelectionId = "";
let currentScanEntries = new Map();
let uiSettings = loadUiSettings();
let activeTab = uiSettings.defaultTab;
let activeSidebarSelectionId = `utility:${activeTab}`;
let activeSettingsSection = "general";

const providerSettingsController = createProviderSettingsController({
  apiFetch,
  desktopBridge,
  openExternalUrl,
  updateScanActionButtons,
  escapeHtml,
  formatDate,
  getToneCardClass,
  getVerificationToneClass,
  onAccountSettingsChange(nextAccountSettings) {
    accountSettings = nextAccountSettings;
  }
});

function sanitizeTab(tab) {
  return TAB_CONFIG.some((item) => item.id === tab) ? tab : DEFAULT_UI_SETTINGS.defaultTab;
}

function sanitizeUiSettings(settings) {
  return {
    defaultTab: sanitizeTab(settings?.defaultTab),
    density: settings?.density === "compact" ? "compact" : "comfortable",
    showDocs: settings?.showDocs !== false,
    pinnedSidebar: settings?.pinnedSidebar !== false,
    autoOpenScan: settings?.autoOpenScan !== false
  };
}

function loadUiSettings() {
  try {
    const raw = localStorage.getItem(UI_SETTINGS_STORAGE_KEY);
    return sanitizeUiSettings(raw ? JSON.parse(raw) : DEFAULT_UI_SETTINGS);
  } catch {
    return { ...DEFAULT_UI_SETTINGS };
  }
}

function persistUiSettings() {
  try {
    localStorage.setItem(UI_SETTINGS_STORAGE_KEY, JSON.stringify(uiSettings));
  } catch {}
}

function loadLastWorkspacePath() {
  try {
    return localStorage.getItem(LAST_WORKSPACE_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function persistLastWorkspacePath(projectPath) {
  try {
    if (projectPath) {
      localStorage.setItem(LAST_WORKSPACE_STORAGE_KEY, projectPath);
      return;
    }
    localStorage.removeItem(LAST_WORKSPACE_STORAGE_KEY);
  } catch {}
}

function syncSettingsControls() {
  settingsDefaultTabEl.value = uiSettings.defaultTab;
  settingsDensityEl.value = uiSettings.density;
  settingsShowDocsEl.checked = uiSettings.showDocs;
  settingsPinnedSidebarEl.checked = uiSettings.pinnedSidebar;
  settingsAutoOpenScanEl.checked = uiSettings.autoOpenScan;
}

function applyUiSettings() {
  document.documentElement.dataset.density = uiSettings.density;
  appShellEl.dataset.sidebarPinned = uiSettings.pinnedSidebar ? "true" : "false";
  workspaceDocsEl.hidden = !uiSettings.showDocs;
}

function updateUiSettings(partial) {
  uiSettings = sanitizeUiSettings({ ...uiSettings, ...partial });
  persistUiSettings();
  syncSettingsControls();
  applyUiSettings();
  renderInspector();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatConfidence(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric.toFixed(2);
  }
  return value ? String(value) : "n/a";
}

function createScanSelectionId(section, rawId, fallbackTitle) {
  return `${section}:${rawId || fallbackTitle || "item"}`;
}

function createInspectorFact(label, value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return { label, value: String(value) };
}

function getValidationTone(summary) {
  if (!summary) return "default";
  if (summary.status === "blocked" || summary.blockingCount > 0) return "blocked";
  if (summary.nonBlockingCount > 0) return "warning";
  if (summary.status === "ready") return "ok";
  return "default";
}

function buildScanEntries(analysis) {
  const hierarchy = analysis?.analysis?.componentHierarchy?.roots ?? [];
  const dependencyEdges =
    analysis?.analysis?.dependencyGraph?.groupedEdges?.length > 0
      ? analysis.analysis.dependencyGraph.groupedEdges
      : analysis?.analysis?.dependencyGraph?.edges ?? [];
  const criticalPaths = analysis?.analysis?.systemMap?.criticalPaths ?? [];
  const executionPhases = analysis?.execution?.executionPlan?.phases ?? [];

  const hierarchyEntries = hierarchy.map((root) => ({
    id: createScanSelectionId("hierarchy", root.id, root.label),
    section: "hierarchy",
    tone: "default",
    title: root.label,
    summary: `${root.children.length} synthesized components in ${root.area || "."}.`,
    pills: [root.type, root.domain || "shared", root.layer || "module"],
    facts: [
      createInspectorFact("Area", root.area || "."),
      createInspectorFact("Children", root.children.length),
      createInspectorFact("Confidence", formatConfidence(root.confidence))
    ].filter(Boolean),
    groups: [
      {
        title: "Child Components",
        items: root.children.map((child) => `${child.label} · ${child.type} · confidence ${formatConfidence(child.confidence)}`)
      }
    ],
    previewItems: root.children.map((child) => child.label).slice(0, 4)
  }));

  const dependencyEntries = dependencyEdges.map((edge) => ({
    id: createScanSelectionId("dependency", edge.id, `${edge.from}:${edge.to}`),
    section: "dependency",
    tone: edge.weight >= 12 ? "warning" : "default",
    title: edge.from,
    summary: edge.to,
    pills: [edge.type, edge.weight ? `weight ${edge.weight}` : "", `confidence ${formatConfidence(edge.confidence)}`].filter(
      Boolean
    ),
    facts: [
      createInspectorFact("Type", edge.type),
      createInspectorFact("Weight", edge.weight),
      createInspectorFact("Confidence", formatConfidence(edge.confidence)),
      createInspectorFact("Confidence Total", edge.confidenceTotal ? formatConfidence(edge.confidenceTotal) : "")
    ].filter(Boolean),
    groups: [
      {
        title: "Connection",
        items: [edge.from, edge.to]
      }
    ],
    connection: { from: edge.from, to: edge.to }
  }));

  const flowEntries = criticalPaths.map((flow) => ({
    id: createScanSelectionId("flow", flow.id, flow.label),
    section: "flow",
    tone: flow.confidence < 0.8 ? "warning" : "default",
    title: flow.label,
    summary: `${flow.steps.length} steps across the primary synthesized path.`,
    pills: [`confidence ${formatConfidence(flow.confidence)}`, `${flow.steps.length} steps`],
    facts: [
      createInspectorFact("Confidence", formatConfidence(flow.confidence)),
      createInspectorFact("Steps", flow.steps.length),
      createInspectorFact("Evidence", flow.evidenceRefs?.length ?? 0)
    ].filter(Boolean),
    groups: [
      { title: "Steps", items: flow.steps },
      { title: "Evidence", items: (flow.evidenceRefs ?? []).slice(0, 12) }
    ],
    stepPreview: flow.steps
  }));

  const roadmapEntries = executionPhases.map((phase) => ({
    id: createScanSelectionId("roadmap", phase.id, phase.title),
    section: "roadmap",
    tone: "default",
    title: phase.title,
    summary: phase.goal,
    pills: [phase.id, phase.taskId || "task-pending"],
    facts: [
      createInspectorFact("Modules", phase.moduleIds?.length ?? 0),
      createInspectorFact("Acceptance Focus", phase.acceptanceFocus?.length ?? 0),
      createInspectorFact("Checks", phase.acceptanceChecks?.length ?? 0)
    ].filter(Boolean),
    groups: [
      { title: "Module IDs", items: phase.moduleIds ?? [] },
      { title: "Acceptance Focus", items: phase.acceptanceFocus ?? [] },
      { title: "Acceptance Checks", items: phase.acceptanceChecks ?? [] },
      { title: "Testability Signals", items: phase.testabilitySignals ?? [] }
    ],
    previewItems: phase.acceptanceFocus?.slice(0, 3) ?? []
  }));

  return { hierarchyEntries, dependencyEntries, flowEntries, roadmapEntries };
}

function getDefaultScanSelectionId(entryGroups) {
  return (
    entryGroups.roadmapEntries[0]?.id ||
    entryGroups.flowEntries[0]?.id ||
    entryGroups.dependencyEntries[0]?.id ||
    entryGroups.hierarchyEntries[0]?.id ||
    ""
  );
}

function renderScanInspector(entry, validationSummary = null) {
  if (!scanInspectorEl) return;

  if (!entry) {
    const tone = getValidationTone(validationSummary);
    scanInspectorEl.innerHTML = `
      <article class="analysis-card scan-inspector-card ${tone !== "default" ? `analysis-card-tone-${tone}` : ""}">
        <span class="scan-card-kicker">Inspector</span>
        <h4>No scan selection</h4>
        <p class="muted">${
          validationSummary?.status === "blocked"
            ? "Blocking findings suppressed roadmap output. Select another scan card or resolve validator blockers first."
            : "Run an analysis and select a hierarchy, dependency, flow, or roadmap card to inspect it here."
        }</p>
      </article>
    `;
    return;
  }

  const pillsMarkup = entry.pills.map((pill) => `<span class="pill">${escapeHtml(pill)}</span>`).join("");
  const factsMarkup = entry.facts
    .map(
      (fact) => `
        <div class="scan-fact">
          <span>${escapeHtml(fact.label)}</span>
          <strong>${escapeHtml(fact.value)}</strong>
        </div>
      `
    )
    .join("");
  const groupsMarkup = entry.groups
    .filter((group) => group.items.length > 0)
    .map(
      (group) => `
        <section class="scan-group">
          <h5>${escapeHtml(group.title)}</h5>
          <div class="scan-group-list">
            ${group.items.map((item) => `<span class="scan-group-item">${escapeHtml(item)}</span>`).join("")}
          </div>
        </section>
      `
    )
    .join("");

  scanInspectorEl.innerHTML = `
    <article class="analysis-card scan-inspector-card ${entry.tone !== "default" ? `analysis-card-tone-${entry.tone}` : ""}">
      <div class="scan-inspector-head">
        <div>
          <span class="scan-card-kicker">${escapeHtml(SCAN_SECTION_LABELS[entry.section])}</span>
          <h4>${escapeHtml(entry.title)}</h4>
          <p>${escapeHtml(entry.summary)}</p>
        </div>
        <div class="analysis-meta">${pillsMarkup}</div>
      </div>
      <div class="scan-inspector-body">
        <div class="scan-facts">${factsMarkup}</div>
        <div class="scan-groups">${groupsMarkup}</div>
      </div>
    </article>
  `;
}

function syncActiveScanSelection() {
  document.querySelectorAll("[data-scan-selection]").forEach((button) => {
    const isSelected = button.dataset.scanSelection === activeScanSelectionId;
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-pressed", isSelected ? "true" : "false");
  });
}

function setActiveScanSelection(selectionId) {
  if (!currentScanEntries.has(selectionId)) return;
  activeScanSelectionId = selectionId;
  syncActiveScanSelection();
  renderScanInspector(currentScanEntries.get(selectionId), currentAnalysis?.architecture?.validationReport?.summary ?? null);
}

function renderSelectableScanCard(entry) {
  const pillsMarkup = entry.pills.map((pill) => `<span class="pill">${escapeHtml(pill)}</span>`).join("");
  const previewMarkup = entry.connection
    ? `
        <div class="scan-connection">
          <span>${escapeHtml(entry.connection.from)}</span>
          <strong aria-hidden="true">→</strong>
          <span>${escapeHtml(entry.connection.to)}</span>
        </div>
      `
    : entry.stepPreview?.length
      ? `<p class="scan-sequence">${escapeHtml(entry.stepPreview.join(" -> "))}</p>`
      : entry.previewItems?.length
        ? `
            <div class="scan-preview-list">
              ${entry.previewItems.map((item) => `<span class="scan-preview-item">${escapeHtml(item)}</span>`).join("")}
            </div>
          `
        : "";

  return `
    <button
      type="button"
      class="analysis-card analysis-card-button ${entry.tone !== "default" ? `analysis-card-tone-${entry.tone}` : ""}"
      data-scan-selection="${escapeHtml(entry.id)}"
      aria-pressed="${entry.id === activeScanSelectionId ? "true" : "false"}"
    >
      <span class="scan-card-kicker">${escapeHtml(SCAN_SECTION_LABELS[entry.section])}</span>
      ${pillsMarkup ? `<div class="analysis-meta">${pillsMarkup}</div>` : ""}
      <h4>${escapeHtml(entry.title)}</h4>
      <p>${escapeHtml(entry.summary)}</p>
      ${previewMarkup}
    </button>
  `;
}

function getActiveTabConfig() {
  return TAB_CONFIG.find((tab) => tab.id === activeTab) ?? TAB_CONFIG[0];
}

function parseLines(value) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function deriveProjectNameFromPath(projectPath) {
  const normalizedPath = String(projectPath).trim().replace(/[\\/]+$/, "");
  if (!normalizedPath) return "";
  const segments = normalizedPath.split(/[/\\]/).filter(Boolean);
  return segments[segments.length - 1] || normalizedPath;
}

function getCurrentProjectPath() {
  return currentWorkspace?.projectRoot || "";
}

function isMissingWorkspaceError(error) {
  return String(error?.message || "").includes("Missing Treema state file");
}

function renderSidebarNav() {
  sidebarUtilityNavEl.innerHTML = buildSidebarUtilityMarkup(activeTab);
  sidebarNavEl.innerHTML = buildSidebarProjectMarkup(currentState, activeSidebarSelectionId);
  sidebarProjectCountEl.textContent = String(countSidebarProjects(currentState));
  renderShellContext();
}

function renderShellContext() {
  const tabConfig = getActiveTabConfig();
  const workspaceName = currentState?.meta?.projectName || "TreeMA Workspace";
  const projectCount = countSidebarProjects(currentState);
  const focusCount =
    (currentState?.meta?.currentFocusTrackIds?.length ?? 0) + (currentState?.meta?.currentFocusTaskIds?.length ?? 0);
  const workspaceMeta = currentWorkspace?.projectRoot
    ? currentWorkspace.projectRoot
    : "Use Add to connect a local folder and create or load a workspace.";
  const statusLabel = currentWorkspace ? "Connected" : "Idle";
  const analysisState = currentAnalysis ? "Scan ready" : "Scan idle";

  sidebarWorkspaceNameEl.textContent = workspaceName;
  sidebarStatusChipEl.textContent = statusLabel;
  sidebarWorkspaceMetaEl.textContent = workspaceMeta;
  sidebarSectionNoteEl.textContent =
    projectCount > 0
      ? `${projectCount} project groups with recent threads and review surfaces.`
      : "Connect a workspace to populate project groups and recent threads.";

  mainHeaderKickerEl.textContent = currentWorkspace ? "Connected Workspace" : "No Workspace";
  mainHeaderTitleEl.textContent = workspaceName;
  mainHeaderDescriptionEl.textContent = tabConfig.description;
  mainHeaderContextEl.innerHTML = `
    <span class="main-header-pill">${escapeHtml(tabConfig.label)}</span>
    <span class="main-header-pill">${escapeHtml(`${projectCount} projects`)}</span>
    <span class="main-header-pill">${escapeHtml(`${focusCount} focus items`)}</span>
    <span class="main-header-pill">${escapeHtml(analysisState)}</span>
  `;
}

function renderTabShortcuts() {
  tabShortcutsEl.innerHTML = TAB_CONFIG.map(
    (tab) => `
      <button
        type="button"
        class="shortcut-button ${tab.id === activeTab ? "is-active" : ""}"
        data-tab-target="${escapeHtml(tab.id)}"
      >
        <div class="shortcut-copy">
          <strong>${escapeHtml(tab.label)}</strong>
          <span>${escapeHtml(tab.description)}</span>
        </div>
        <span class="shortcut-arrow" aria-hidden="true">›</span>
      </button>
    `
  ).join("");
}

function sanitizeSettingsSection(sectionId) {
  return SETTINGS_SECTION_CONFIG.some((section) => section.id === sectionId)
    ? sectionId
    : SETTINGS_SECTION_CONFIG[0].id;
}

function getSettingsPageIcon(iconId) {
  const icons = {
    sliders:
      '<svg viewBox="0 0 20 20" focusable="false" aria-hidden="true"><path d="M4 5.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Zm9 0a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0ZM8 5h5m-9 0H2m14 0h2M7 14.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0ZM13 14h5m-11 0H2m8 0h3" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"/></svg>',
    keyboard:
      '<svg viewBox="0 0 20 20" focusable="false" aria-hidden="true"><rect x="2.5" y="4.5" width="15" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5 8h1.5M8 8h1.5M11 8h1.5M14 8h1M5 11h6.5M12.5 11H15" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"/></svg>',
    sparkles:
      '<svg viewBox="0 0 20 20" focusable="false" aria-hidden="true"><path d="m10 3 .9 2.8L13.8 7l-2.9 1.1L10 11l-.9-2.9L6.2 7l2.9-1.2L10 3Zm5.5 8 .5 1.6 1.5.6-1.5.6-.5 1.6-.5-1.6-1.5-.6 1.5-.6.5-1.6ZM5 11.5l.7 2.1 2.1.7-2.1.7L5 17.1l-.7-2.1-2.1-.7 2.1-.7.7-2.1Z" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.4"/></svg>',
    server:
      '<svg viewBox="0 0 20 20" focusable="false" aria-hidden="true"><rect x="3" y="3.5" width="14" height="5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="3" y="11.5" width="14" height="5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 6h.01M6 14h.01M10 6h4M10 14h4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"/></svg>'
  };
  return icons[iconId] ?? icons.sliders;
}

function setActiveSettingsSection(sectionId) {
  activeSettingsSection = sanitizeSettingsSection(sectionId);
  Array.from(settingsContentEl.querySelectorAll("[data-settings-section]")).forEach((section) => {
    section.hidden = section.dataset.settingsSection !== activeSettingsSection;
  });
  settingsContentEl.scrollTop = 0;
  Array.from(settingsSidebarNavEl.querySelectorAll("[data-settings-target]")).forEach((button) => {
    const isActive = button.dataset.settingsTarget === activeSettingsSection;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-current", isActive ? "page" : "false");
  });
}

function renderSettingsSidebar() {
  const groupedSections = SETTINGS_SECTION_CONFIG.reduce((map, section) => {
    const sections = map.get(section.group) ?? [];
    sections.push(section);
    map.set(section.group, sections);
    return map;
  }, new Map());

  settingsSidebarNavEl.innerHTML = Array.from(groupedSections.entries())
    .map(
      ([group, sections]) => `
        <div class="settings-sidebar-group">
          <span class="settings-sidebar-group-label">${escapeHtml(group)}</span>
          <div class="settings-sidebar-group-items">
            ${sections
              .map(
                (section) => `
                  <button
                    type="button"
                    class="settings-sidebar-link ${section.id === activeSettingsSection ? "is-active" : ""}"
                    data-settings-target="${escapeHtml(section.id)}"
                    aria-current="${section.id === activeSettingsSection ? "page" : "false"}"
                  >
                    <span class="settings-sidebar-link-icon" aria-hidden="true">${getSettingsPageIcon(section.icon)}</span>
                    <span class="settings-sidebar-link-copy">
                      <strong>${escapeHtml(section.label)}</strong>
                      <span>${escapeHtml(section.description)}</span>
                    </span>
                  </button>
                `
              )
              .join("")}
          </div>
        </div>
      `
    )
    .join("");
}

function getVerificationToneClass(verification) {
  if (!verification) return "";
  if (verification.tone === "error") return "validation-error";
  if (verification.tone === "warning") return "validation-warning";
  return "validation-ok";
}

function getToneCardClass(tone) {
  if (tone === "error" || tone === "blocked") return "analysis-card-tone-blocked";
  if (tone === "warning") return "analysis-card-tone-warning";
  if (tone === "ok" || tone === "ready") return "analysis-card-tone-ok";
  return "";
}

function buildProjectScanButtonTitle(settings) {
  return settings?.analysisProvider?.available
    ? "Run Project Scan"
    : settings?.analysisProvider?.blockedReason || "Project Scan is unavailable.";
}

function buildQuickScanButtonTitle() {
  return getCurrentProjectPath()
    ? "Run deterministic Quick Scan"
    : "Connect a project before running Quick Scan.";
}

function updateScanActionButtons() {
  const projectConnected = Boolean(getCurrentProjectPath());
  const projectScanAvailable = accountSettings?.analysisProvider?.available ?? false;

  if (analyzeProjectButtonEl) {
    analyzeProjectButtonEl.disabled = !projectConnected || !projectScanAvailable;
    analyzeProjectButtonEl.title = !projectConnected
      ? "Connect a project before running a scan."
      : buildProjectScanButtonTitle(accountSettings);
  }

  if (quickScanButtonEl) {
    quickScanButtonEl.disabled = !projectConnected;
    quickScanButtonEl.title = buildQuickScanButtonTitle();
  }
}

function normalizeDesktopErrorMessage(error) {
  const rawMessage = typeof error?.message === "string" ? error.message : String(error || "Request failed.");
  return rawMessage.replace(/^Error invoking remote method '[^']+':\s*/u, "").trim() || "Request failed.";
}

function hasSemanticScanProvider(settings) {
  const openaiConnected = settings?.providers?.openai?.connected ?? false;
  const githubCopilotConnected = settings?.providers?.githubCopilot?.connected ?? false;
  return openaiConnected || githubCopilotConnected;
}

function renderAccountBadge(targetEl, providerSettings) {
  if (!targetEl) return;

  if (!providerSettings?.connected) {
    targetEl.className = "pill status-backlog";
    targetEl.textContent = "Disconnected";
    return;
  }

  const verification = providerSettings.lastVerification;
  if (verification?.tone === "warning") {
    targetEl.className = "pill status-medium";
    targetEl.textContent = "Connected";
    return;
  }

  if (verification?.tone === "error" || verification?.ok === false) {
    targetEl.className = "pill status-blocked";
    targetEl.textContent = "Needs Attention";
    return;
  }

  if (verification?.ok) {
    targetEl.className = "pill status-active";
    targetEl.textContent = "Connected";
    return;
  }

  targetEl.className = "pill status-ready";
  targetEl.textContent = "Saved";
}

function buildAccountStatusMarkup(providerLabel, providerSettings, disconnectedCopy) {
  if (!providerSettings?.connected) {
    return `
      <article class="validation-card">
        <strong>${escapeHtml(`${providerLabel} is not connected`)}</strong>
        <p class="muted">${escapeHtml(disconnectedCopy)}</p>
      </article>
    `;
  }

  const verification = providerSettings.lastVerification;
  const metadata = [
    providerSettings.accountLabel ? `Saved as ${providerSettings.accountLabel}.` : "",
    providerSettings.secretPreview ? `Stored secret: ${providerSettings.secretPreview}.` : "",
    providerSettings.accountLogin ? `GitHub account: ${providerSettings.accountLogin}.` : "",
    providerSettings.tokenType ? `Token type: ${providerSettings.tokenType.replaceAll("_", " ")}.` : ""
  ]
    .filter(Boolean)
    .join(" ");

  if (!verification) {
    return `
      <article class="validation-card">
        <strong>${escapeHtml(`${providerLabel} credentials saved`)}</strong>
        <p class="muted">${escapeHtml(`${metadata} Run Save + Test to verify the connection.`)}</p>
      </article>
    `;
  }

  const checkedAt = formatDate(verification.checkedAt || providerSettings.lastVerifiedAt);
  return `
    <article class="validation-card ${getToneCardClass(verification.tone || (verification.ok ? "ok" : ""))}">
      <strong class="${escapeHtml(getVerificationToneClass(verification))}">${escapeHtml(verification.message)}</strong>
      <p class="muted">${escapeHtml([verification.detail, metadata].filter(Boolean).join(" "))}</p>
      ${checkedAt ? `<p class="muted">Last checked ${escapeHtml(checkedAt)}</p>` : ""}
    </article>
  `;
}

function buildGitHubOAuthCallbackNote(oauthSettings) {
  if (!oauthSettings?.available || !oauthSettings.callbackUrl) {
    return "Start the local runtime for desktop handoff, and register the hosted URL in your GitHub OAuth app settings.";
  }

  const lastCallback = oauthSettings.lastCallback;
  if (!lastCallback) {
    return "Register the hosted URL in your GitHub OAuth app. After GitHub returns there, continue into the local browser app or desktop app to store the masked callback receipt.";
  }

  const parts = [
    lastCallback.message || "",
    lastCallback.codePreview ? `Code ${lastCallback.codePreview}.` : "",
    lastCallback.statePreview ? `State ${lastCallback.statePreview}.` : "",
    lastCallback.receivedAt ? `Received ${formatDate(lastCallback.receivedAt)}.` : ""
  ].filter(Boolean);

  return parts.join(" ");
}

function getGitHubWebAppOrigin() {
  return accountSettings?.providers?.githubCopilot?.oauth?.webAppOrigin || DEFAULT_WEB_APP_ORIGIN;
}

function buildHostedWebAppUrl(pathname) {
  return new URL(pathname, `${getGitHubWebAppOrigin()}/`).toString();
}

async function startGitHubOAuthConnection() {
  if (!desktopBridge?.startGitHubOAuthFlow) {
    await openExternalUrl(buildHostedWebAppUrl(WEB_APP_ACCOUNTS_PATH));
    renderInlineAccountActionStatus(
      settingsGitHubCopilotStatusEl,
      "Opened app.treesma.com account settings. Continue the hosted GitHub connection flow there."
    );
    return;
  }

  const started = await desktopBridge.startGitHubOAuthFlow({
    returnPath: WEB_APP_ACCOUNTS_PATH
  });
  await openExternalUrl(started.authorizeUrl);
  renderInlineAccountActionStatus(
    settingsGitHubCopilotStatusEl,
    "Opened GitHub OAuth in your browser. After authorization, treesma.com will hand the result back through the treesma:// desktop link."
  );
}

function syncAccountSettingsControls() {
  if (!accountSettings) {
    settingsAccountStorageEl.textContent = "Loading local account settings...";
    settingsOpenAiStatusEl.innerHTML = "";
    settingsGitHubCopilotStatusEl.innerHTML = "";
    analyzeProjectButtonEl.disabled = true;
    return;
  }

  const openai = accountSettings.providers?.openai ?? {};
  const githubCopilot = accountSettings.providers?.githubCopilot ?? {};
  const semanticProviderConnected = hasSemanticScanProvider(accountSettings);
  const githubOAuth = githubCopilot.oauth ?? {};

  settingsAccountStorageEl.textContent = `Stored outside the workspace at ${accountSettings.storagePath}`;

  settingsOpenAiBaseUrlEl.value = openai.baseUrl || "https://api.openai.com/v1";
  settingsOpenAiModelEl.value = openai.defaultModel || "gpt-5.4-mini";
  settingsOpenAiApiKeyEl.value = "";
  settingsOpenAiApiKeyEl.placeholder = openai.connected
    ? `Stored key ${openai.secretPreview}. Leave blank to keep it.`
    : "sk-...";
  settingsOpenAiDisconnectEl.disabled = !openai.connected;
  renderAccountBadge(settingsOpenAiBadgeEl, openai);
  settingsOpenAiStatusEl.innerHTML = buildAccountStatusMarkup(
    "OpenAI",
    openai,
    "Start with ChatGPT Plus/Pro login, then save an API key here only when direct OpenAI API access is needed."
  );
  analyzeProjectButtonEl.disabled = !semanticProviderConnected;
  analyzeProjectButtonEl.title = semanticProviderConnected
    ? "Run AI-native Project Scan"
    : "Project Scan requires a connected OpenAI or GitHub Copilot provider. Connect one in Settings or run Quick Scan.";

  settingsGitHubCopilotTokenEl.value = "";
  settingsGitHubCopilotHostedCallbackUrlEl.value = githubOAuth.hostedCallbackUrl || "";
  settingsGitHubCopilotCallbackUrlEl.value = githubOAuth.callbackUrl || "";
  settingsGitHubCopilotCallbackUrlEl.placeholder = githubOAuth.available
    ? githubOAuth.callbackUrl
    : "Start the local app runtime to expose a callback URL.";
  settingsGitHubCopilotCallbackNoteEl.textContent = buildGitHubOAuthCallbackNote(githubOAuth);
  settingsGitHubCopilotTokenEl.placeholder = githubCopilot.connected
    ? `Stored token ${githubCopilot.secretPreview}. Leave blank to keep it.`
    : "gho_, ghu_, or github_pat_";
  settingsGitHubCopilotDisconnectEl.disabled = !githubCopilot.connected;
  renderAccountBadge(settingsGitHubCopilotBadgeEl, githubCopilot);
  settingsGitHubCopilotStatusEl.innerHTML = buildAccountStatusMarkup(
    "GitHub Copilot",
    githubCopilot,
    "Start from the GitHub Copilot browser setup flow, then save a supported GitHub user token only when this app needs direct verification."
  );
}

function renderInlineAccountActionStatus(targetEl, message, tone = "ok") {
  if (!targetEl) return;
  targetEl.innerHTML = `
    <article class="validation-card ${getToneCardClass(tone)}">
      <strong class="${tone === "error" ? "validation-error" : tone === "warning" ? "validation-warning" : ""}">
        ${escapeHtml(message)}
      </strong>
    </article>
  `;
}

async function openExternalUrl(targetUrl) {
  window.open(targetUrl, "_blank", "noopener,noreferrer");
}

function renderInspector() {
  renderTabShortcuts();
  renderSettingsSidebar();
  setActiveSettingsSection(activeSettingsSection);
}

function openSettingsModal() {
  settingsModalEl.hidden = false;
  document.body.classList.add("has-settings-modal");
  openSettingsButtonEl.setAttribute("aria-expanded", "true");
  renderInspector();
}

function closeSettingsModal() {
  settingsModalEl.hidden = true;
  document.body.classList.remove("has-settings-modal");
  openSettingsButtonEl.setAttribute("aria-expanded", "false");
}

function setActiveTab(tabId, selectionId = null) {
  activeTab = sanitizeTab(tabId);
  activeSidebarSelectionId = selectionId ?? `utility:${activeTab}`;

  document
    .querySelectorAll(".tab-panel")
    .forEach((panel) => panel.classList.toggle("is-active", panel.dataset.panel === activeTab));

  renderSidebarNav();
  renderInspector();
}

async function apiFetch(pathname, options = {}) {
  if (desktopBridge) {
    try {
      const method = options.method || "GET";
      const requestUrl = new URL(pathname, "http://treema.local");
      const body = options.body ? JSON.parse(options.body) : {};

      if (method === "GET" && requestUrl.pathname === "/api/settings/accounts") {
        return desktopBridge.loadAccountSettings();
      }

      if (method === "GET" && requestUrl.pathname === "/api/workspace") {
        return desktopBridge.loadWorkspace(requestUrl.searchParams.get("projectPath") || "");
      }

      if (method === "POST" && requestUrl.pathname === "/api/system/select-directory") {
        return { projectPath: await desktopBridge.selectDirectory() };
      }

      if (method === "POST" && requestUrl.pathname === "/api/settings/accounts/openai") {
        return desktopBridge.saveAccountSettings("openai", body);
      }

      if (method === "POST" && requestUrl.pathname === "/api/settings/accounts/openai/test") {
        return desktopBridge.testAccountSettings("openai", body);
      }

      if (method === "POST" && requestUrl.pathname === "/api/settings/accounts/github-copilot") {
        return desktopBridge.saveAccountSettings("github-copilot", body);
      }

      if (method === "POST" && requestUrl.pathname === "/api/settings/accounts/github-copilot/test") {
        return desktopBridge.testAccountSettings("github-copilot", body);
      }

      if (method === "POST" && requestUrl.pathname === "/api/settings/accounts/chatgpt-codex") {
        return desktopBridge.saveAccountSettings("chatgpt-codex", body);
      }

      if (method === "POST" && requestUrl.pathname === "/api/settings/accounts/chatgpt-codex/test") {
        return desktopBridge.testAccountSettings("chatgpt-codex", body);
      }

      if (method === "POST" && requestUrl.pathname === "/api/settings/accounts/preferences") {
        return desktopBridge.saveAccountPreferences(body);
      }

      if (method === "POST" && requestUrl.pathname === "/api/settings/accounts/disconnect") {
        return desktopBridge.disconnectAccountSettings(body.provider);
      }

      if (method === "POST" && requestUrl.pathname === "/api/workspace/init") {
        return desktopBridge.initWorkspace(body.projectPath, body.projectName || "");
      }

      if (method === "POST" && requestUrl.pathname === "/api/workspace/snapshot") {
        return desktopBridge.snapshotWorkspace({
          projectPath: body.projectPath,
          summary: body.summary,
          focus: body.focus ?? [],
          next: body.next ?? [],
          risks: body.risks ?? []
        });
      }

      if (method === "POST" && requestUrl.pathname === "/api/project/analyze") {
        return desktopBridge.analyzeProject(body.projectPath, body.mode || "project");
      }

      throw new Error(`Unsupported desktop API route: ${method} ${requestUrl.pathname}`);
    } catch (error) {
      throw new Error(normalizeDesktopErrorMessage(error));
    }
  }

  const response = await fetch(pathname, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

function renderWorkspaceStatus(message, tone = "ok") {
  workspaceStatusEl.innerHTML = `
    <article class="validation-card sidebar-status-card ${getToneCardClass(tone)}">
      <strong class="${tone === "error" ? "validation-error" : "validation-ok"}">${escapeHtml(message)}</strong>
    </article>
  `;
}

function renderValidation(validation) {
  if (validation.valid) {
    validationSummaryEl.innerHTML = `
      <article class="validation-card analysis-card-tone-ok">
        <strong class="validation-ok">Valid canonical state</strong>
        <p class="muted">The current state passed the lightweight runtime checks.</p>
      </article>
    `;
    return;
  }

  validationSummaryEl.innerHTML = validation.errors
    .map(
      (error) => `
        <article class="validation-card analysis-card-tone-blocked">
          <strong class="validation-error">${escapeHtml(error.path)}</strong>
          <p class="muted">${escapeHtml(error.message)}</p>
        </article>
      `
    )
    .join("");
}

function renderCurrentFocus(viewModel) {
  currentFocusEl.innerHTML = `
    ${viewModel.currentFocusTracks
      .map(
        (track) => `
          <article class="focus-card">
            <div class="pill status-${escapeHtml(track.status)}">${escapeHtml(track.name)}</div>
            <h3>${escapeHtml(track.goal || "No goal recorded.")}</h3>
            <p>${escapeHtml(track.projectId)}</p>
          </article>
        `
      )
      .join("")}
    ${viewModel.currentFocusTasks
      .map(
        (task) => `
          <article class="focus-card">
            <div class="pill status-${escapeHtml(task.status)}">${escapeHtml(task.status)}</div>
            <h3>${escapeHtml(task.title)}</h3>
            <p>${escapeHtml(task.description || "No description provided.")}</p>
          </article>
        `
      )
      .join("")}
  `;
}

function renderNextTasks(viewModel, trackIndex) {
  nextTasksEl.innerHTML = viewModel.nextTasks
    .map(
      (task) => `
        <article class="focus-card">
          <div class="tree-meta">
            <span class="pill status-${escapeHtml(task.status)}">${escapeHtml(task.status)}</span>
            <span class="pill">${escapeHtml(task.priority || "unprioritized")}</span>
          </div>
          <h3>${escapeHtml(task.title)}</h3>
          <p>${escapeHtml(trackIndex.get(task.trackId)?.name || "Unassigned")}</p>
        </article>
      `
    )
    .join("");
}

function renderProjectSummary(state, viewModel) {
  projectSummaryEl.innerHTML = state.projects
    .map((project) => {
      const counts = viewModel.taskCountsByProject[project.id] ?? { open: 0, done: 0 };
      const riskCount = viewModel.riskCountsByProject[project.id] ?? 0;
      const decisionCount = viewModel.decisionCountsByProject[project.id] ?? 0;
      return `
        <article class="summary-card">
          <div class="pill status-${escapeHtml(project.status)}">${escapeHtml(project.status)}</div>
          <h3>${escapeHtml(project.name)}</h3>
          <p>${escapeHtml(project.description || "No description yet.")}</p>
          <div class="tree-meta">
            <span class="pill">Open Tasks ${counts.open}</span>
            <span class="pill">Done ${counts.done}</span>
            <span class="pill">Risks ${riskCount}</span>
            <span class="pill">Decisions ${decisionCount}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderProjectNode(project, state, viewModel) {
  const tracks = state.tracks.filter((track) => track.projectId === project.id);
  const counts = viewModel.taskCountsByProject[project.id] ?? { open: 0, done: 0 };
  const childProjects = viewModel.childrenByParentId[project.id] ?? [];

  return `
    <article class="tree-node">
      <div class="pill status-${escapeHtml(project.status)}">${escapeHtml(project.status)}</div>
      <h3>${escapeHtml(project.name)}</h3>
      <p>${escapeHtml(project.description || "No description provided.")}</p>
      <div class="tree-meta">
        <span class="pill">Open ${counts.open}</span>
        <span class="pill">Done ${counts.done}</span>
        <span class="pill">Risks ${viewModel.riskCountsByProject[project.id] ?? 0}</span>
        <span class="pill">Decisions ${viewModel.decisionCountsByProject[project.id] ?? 0}</span>
      </div>
      <div class="track-list">
        ${tracks
          .map((track) => `<span class="pill status-${escapeHtml(track.status)}">${escapeHtml(track.name)}</span>`)
          .join("")}
      </div>
      ${
        childProjects.length > 0
          ? `<div class="tree-children">${childProjects
              .map((childProject) => renderProjectNode(childProject, state, viewModel))
              .join("")}</div>`
          : ""
      }
    </article>
  `;
}

function renderStructureMap(state, viewModel) {
  const roots = viewModel.childrenByParentId.__root__ ?? [];
  structureMapEl.innerHTML = `<div class="tree-root">${roots
    .map((project) => renderProjectNode(project, state, viewModel))
    .join("")}</div>`;
}

function renderTaskBoard(tasksByStatus, trackIndex) {
  taskBoardEl.innerHTML = STATUS_COLUMNS.map((status) => {
    const items = tasksByStatus[status] ?? [];
    return `
      <article class="column">
        <div class="column-header">
          <h4>${escapeHtml(status.replaceAll("_", " "))}</h4>
          <span class="pill status-${escapeHtml(status)}">${items.length}</span>
        </div>
        <div class="item-list">
          ${
            items.length > 0
              ? items
                  .map(
                    (task) => `
                      <article class="item-card ${
                        task.status === "blocked"
                          ? "item-card-emphasis-blocked"
                          : task.priority === "high" || task.priority === "critical"
                            ? "item-card-emphasis-warning"
                            : ""
                      }">
                        <div class="pill status-${escapeHtml(task.status)}">${escapeHtml(task.status)}</div>
                        <h5>${escapeHtml(task.title)}</h5>
                        <p>${escapeHtml(task.description || "No description provided.")}</p>
                        <p class="muted">Track: ${escapeHtml(trackIndex.get(task.trackId)?.name || "Unassigned")}</p>
                      </article>
                    `
                  )
                  .join("")
              : `<article class="item-card"><p class="muted">No items</p></article>`
          }
        </div>
      </article>
    `;
  }).join("");
}

function renderRiskBoard(risksBySeverity, trackIndex) {
  riskBoardEl.innerHTML = RISK_COLUMNS.map((severity) => {
    const items = risksBySeverity[severity] ?? [];
    return `
      <article class="column">
        <div class="column-header">
          <h4>${escapeHtml(severity)}</h4>
          <span class="pill status-${escapeHtml(severity)}">${items.length}</span>
        </div>
        <div class="item-list">
          ${
            items.length > 0
              ? items
                  .map(
                    (risk) => `
                      <article class="item-card ${
                        risk.severity === "critical" || risk.severity === "high" || risk.status === "realized"
                          ? "item-card-emphasis-blocked"
                          : risk.severity === "medium"
                            ? "item-card-emphasis-warning"
                            : ""
                      }">
                        <div class="tree-meta">
                          <span class="pill status-${escapeHtml(risk.status)}">${escapeHtml(risk.status)}</span>
                          <span class="pill status-${escapeHtml(risk.severity)}">${escapeHtml(risk.severity)}</span>
                        </div>
                        <h5>${escapeHtml(risk.title)}</h5>
                        <p>${escapeHtml(risk.description || risk.mitigation || "No risk detail provided.")}</p>
                        <p class="muted">Track: ${escapeHtml(trackIndex.get(risk.trackId)?.name || "Unassigned")}</p>
                      </article>
                    `
                  )
                  .join("")
              : `<article class="item-card"><p class="muted">No items</p></article>`
          }
        </div>
      </article>
    `;
  }).join("");
}

function renderWorkspaceDocs(docs) {
  if (!docs) {
    workspaceDocsEl.innerHTML = "";
    return;
  }

  const items = [
    ["Workspace AGENTS.md", docs.agents],
    ["Project Brief", docs.projectBrief],
    ["Operating Rules.md", docs.operatingRules],
    ["Current Focus.md", docs.currentFocus],
    ["Next Tasks.md", docs.nextTasks],
    ["Decisions.md", docs.decisions],
    ["Status Updates.md", docs.statusUpdates],
    ["Task Index.md", docs.taskIndex]
  ];

  const renderedItems = items
    .filter(([, content]) => typeof content === "string" && content.trim().length > 0)
    .map(
      ([title, content]) => `
        <article class="doc-card">
          <h3>${escapeHtml(title)}</h3>
          <pre>${escapeHtml(content.trim())}</pre>
        </article>
      `
    );

  workspaceDocsEl.innerHTML = renderedItems.join("");
}

function renderRecentDecisions(recentDecisions) {
  recentDecisionsEl.innerHTML = recentDecisions
    .map(
      (decision) => `
        <article class="decision-card">
          <div class="tree-meta">
            <span class="pill">Decision</span>
            <span class="pill status-${escapeHtml(decision.status)}">${escapeHtml(decision.status)}</span>
          </div>
          <h3>${escapeHtml(decision.title)}</h3>
          <p>${escapeHtml(decision.summary || decision.impact || "No summary provided.")}</p>
          <p class="muted">${escapeHtml(formatDate(decision.updatedAt))}</p>
        </article>
      `
    )
    .join("");
}

function renderTimeline(timeline, projectIndex, trackIndex) {
  timelineEl.innerHTML = timeline
    .map(
      (item) => `
        <article class="timeline-item">
          <div class="timeline-head">
            <div>
              <span class="pill">${escapeHtml(item.type)}</span>
              <span class="pill status-${escapeHtml(item.severity || item.status)}">${escapeHtml(
                item.severity || item.status
              )}</span>
            </div>
            <span class="timestamp">${escapeHtml(formatDate(item.updatedAt))}</span>
          </div>
          <h4>${escapeHtml(item.title)}</h4>
          <p>${escapeHtml(item.summary || "No additional detail.")}</p>
          <div class="tree-meta">
            <span class="pill">Project ${escapeHtml(projectIndex.get(item.projectId)?.name || item.projectId)}</span>
            <span class="pill">Track ${escapeHtml(trackIndex.get(item.trackId)?.name || "Unassigned")}</span>
          </div>
        </article>
      `
    )
    .join("");
}

function renderProposal(proposal, state) {
  if (!proposal) {
    proposalSummaryEl.innerHTML = `
      <article class="proposal-card">
        <h3>No proposal loaded</h3>
        <p class="muted">Load a proposal JSON file to review AI-suggested changes.</p>
      </article>
    `;
    proposalChangesEl.innerHTML = "";
    return;
  }

  proposalSummaryEl.innerHTML = `
    <article class="proposal-card">
      <div class="pill">${escapeHtml(proposal.proposalId)}</div>
      <h3>${escapeHtml(proposal.summary)}</h3>
      <p class="muted">Based on state version ${escapeHtml(proposal.basedOnStateVersion)} with ${
        proposal.changes.length
      } proposed changes.</p>
    </article>
  `;

  proposalChangesEl.innerHTML = proposal.changes
    .map((change) => {
      const collection = Array.isArray(state?.[`${change.entityType}s`]) ? state[`${change.entityType}s`] : [];
      const entity = collection.find((item) => item.id === change.entityId);
      return `
        <article class="change-card">
          <div class="change-grid">
            <span class="pill">${escapeHtml(change.operation)}</span>
            <span class="pill">${escapeHtml(change.entityType)}</span>
            <span class="pill">${escapeHtml(change.entityId)}</span>
          </div>
          <h3>${escapeHtml(entity?.title || entity?.name || change.entityId)}</h3>
          <p>${escapeHtml(change.reason)}</p>
          <pre>${escapeHtml(JSON.stringify(change.after, null, 2))}</pre>
        </article>
      `;
    })
    .join("");
}

function renderProjectAnalysis(analysis) {
  const manifest = analysis?.rootManifest ?? null;
  const summary = manifest?.summary ?? null;
  const validationSummary = analysis?.architecture?.validationReport?.summary ?? null;
  const scanMode = manifest?.run?.scanMode || "project";
  const scanCompleteness = manifest?.run?.scanCompleteness || "semantic";
  const scanRationale = analysis?.inventory?.scanRationale ?? null;
  const domainHypotheses = analysis?.inventory?.domainHypotheses?.domains ?? [];

  if (!analysis) {
    currentScanEntries = new Map();
    activeScanSelectionId = "";
    analysisSummaryEl.innerHTML = `
      <article class="analysis-card">
        <h4>No project scan loaded</h4>
        <p class="muted">Run Project Scan for AI-native semantic analysis, or Quick Scan for deterministic inventory only.</p>
      </article>
    `;
    analysisHierarchyEl.innerHTML = "";
    analysisDependenciesEl.innerHTML = "";
    analysisFlowsEl.innerHTML = "";
    analysisRoadmapEl.innerHTML = "";
    renderScanInspector(null, validationSummary);
    renderSidebarNav();
    renderInspector();
    return;
  }

  const { hierarchyEntries, dependencyEntries, flowEntries, roadmapEntries } = buildScanEntries(analysis);
  currentScanEntries = new Map(
    [...hierarchyEntries, ...dependencyEntries, ...flowEntries, ...roadmapEntries].map((entry) => [entry.id, entry])
  );
  if (!currentScanEntries.has(activeScanSelectionId)) {
    activeScanSelectionId = getDefaultScanSelectionId({
      hierarchyEntries,
      dependencyEntries,
      flowEntries,
      roadmapEntries
    });
  }

  const summaryItems = [
    ["Files", summary?.totalFiles ?? 0],
    ["Directories", summary?.totalDirectories ?? 0],
    ["Components", summary?.componentReportCount ?? 0],
    ["Tasks", summary?.taskCount ?? 0],
    ["Mode", scanMode === "quick" ? "Quick" : "Project"],
    ["Gate", manifest?.gate?.status ?? "unknown"]
  ];

  analysisSummaryEl.innerHTML = summaryItems
    .map(
      ([label, value]) => `
        <article class="analysis-card">
          <span class="metric-label">${escapeHtml(label)}</span>
          <strong class="metric-value">${escapeHtml(value)}</strong>
        </article>
      `
    )
    .join("");

  const frameworkPills = summary?.frameworks?.length
    ? summary.frameworks.map((framework) => `<span class="pill">${escapeHtml(framework)}</span>`).join("")
    : `<span class="pill">none-detected</span>`;
  const kindPills = summary?.projectKinds?.length
    ? summary.projectKinds.map((kind) => `<span class="pill">${escapeHtml(kind)}</span>`).join("")
    : `<span class="pill">unclassified</span>`;
  const validationTone = getValidationTone(validationSummary);
  const validatorPills = validationSummary
    ? `
      <div class="analysis-meta">
        <span class="pill status-${escapeHtml(validationSummary.status)}">${escapeHtml(validationSummary.status)}</span>
        <span class="pill">blocking ${escapeHtml(validationSummary.blockingCount)}</span>
        <span class="pill">non-blocking ${escapeHtml(validationSummary.nonBlockingCount)}</span>
      </div>
    `
    : "";
  const validatorNotice = validationSummary
    ? `
      <div class="scan-status-banner ${validationTone !== "default" ? `scan-status-banner-${validationTone}` : ""}">
        <strong>${
          validationTone === "blocked"
            ? "Blocking findings are suppressing parts of the execution output."
            : validationTone === "warning"
              ? "Non-blocking findings still need review before larger execution work."
            : "Validator gate is ready for execution planning."
        }</strong>
        <span>${
          validationTone === "blocked"
            ? `${validationSummary.blockingCount} blocking findings require resolution.`
            : validationTone === "warning"
              ? `${validationSummary.nonBlockingCount} warning findings remain open.`
              : "Roadmap artifacts are available from this scan."
        }</span>
      </div>
    `
    : manifest?.gate?.status === "unavailable"
      ? `
      <div class="scan-status-banner scan-status-banner-warning">
        <strong>${
          scanMode === "quick"
            ? "Quick Scan is inventory-only."
            : "Project Scan semantic stages are unavailable."
        }</strong>
        <span>${
          scanMode === "quick"
            ? "Run Project Scan with a connected AI provider to generate semantic analysis, architecture, and execution artifacts."
            : "Connect an AI provider in Settings, then rerun Project Scan."
        }</span>
      </div>
    `
      : "";
  const runMetaPills = [
    `<span class="pill">${escapeHtml(scanMode === "quick" ? "quick-scan" : "project-scan")}</span>`,
    `<span class="pill">${escapeHtml(scanCompleteness)}</span>`,
    manifest?.run?.provider ? `<span class="pill">${escapeHtml(manifest.run.provider)}</span>` : "",
    manifest?.run?.modelProfile ? `<span class="pill">${escapeHtml(manifest.run.modelProfile)}</span>` : ""
  ]
    .filter(Boolean)
    .join("");
  const rationaleMarkup = scanRationale
    ? `
      <div class="section-gap">
        <h4>Scanner Rationale</h4>
        <p>${escapeHtml(scanRationale.summary || "Semantic scan rationale available.")}</p>
        ${
          scanRationale.focusAreas?.length
            ? `<div class="analysis-meta">${scanRationale.focusAreas
                .slice(0, 8)
                .map((item) => `<span class="pill">${escapeHtml(item)}</span>`)
                .join("")}</div>`
            : ""
        }
      </div>
    `
    : "";
  const domainMarkup = domainHypotheses.length
    ? `
      <div class="section-gap">
        <h4>Domain Hypotheses</h4>
        <div class="analysis-meta">${domainHypotheses
          .slice(0, 8)
          .map((domain) => `<span class="pill">${escapeHtml(domain.name)}</span>`)
          .join("")}</div>
      </div>
    `
    : "";

  analysisSummaryEl.innerHTML += `
    <article class="analysis-card analysis-card-overview ${validationTone !== "default" ? `analysis-card-tone-${validationTone}` : ""}">
      <h4>${escapeHtml(summary?.projectName || manifest?.run?.projectName || "Analysis Run")}</h4>
      <p>${escapeHtml(manifest?.run?.projectRoot || analysis.projectRoot)}</p>
      <div class="analysis-meta">${runMetaPills}</div>
      <div class="analysis-meta">${frameworkPills}</div>
      <div class="analysis-meta">${kindPills}</div>
      ${validatorPills}
      ${validatorNotice}
      ${rationaleMarkup}
      ${domainMarkup}
    </article>
  `;

  analysisHierarchyEl.innerHTML = hierarchyEntries.length
    ? hierarchyEntries.map((entry) => renderSelectableScanCard(entry)).join("")
    : `
      <article class="analysis-card">
        <h4>No hierarchy detected</h4>
        <p class="muted">${
          scanMode === "quick"
            ? "Quick Scan does not synthesize semantic hierarchy."
            : "The Senior stage did not synthesize component hierarchy roots."
        }</p>
      </article>
    `;

  analysisDependenciesEl.innerHTML = dependencyEntries.length
    ? dependencyEntries.map((entry) => renderSelectableScanCard(entry)).join("")
    : `
      <article class="analysis-card">
        <h4>No dependency edges detected</h4>
      </article>
    `;

  analysisFlowsEl.innerHTML = flowEntries.length
    ? flowEntries.map((entry) => renderSelectableScanCard(entry)).join("")
    : `
      <article class="analysis-card">
        <h4>No critical flow synthesized</h4>
        <p class="muted">${
          scanMode === "quick"
            ? "Quick Scan does not synthesize critical flows."
            : "The analysis bundle does not yet expose a confident primary path."
        }</p>
      </article>
    `;

  analysisRoadmapEl.innerHTML = roadmapEntries.length
    ? roadmapEntries.map((entry) => renderSelectableScanCard(entry)).join("")
    : `
      <article class="analysis-card ${manifest?.gate?.status === "blocked" ? "analysis-card-tone-blocked" : "analysis-card-tone-warning"}">
        <h4>Execution roadmap unavailable</h4>
        <p class="muted">${
          scanMode === "quick"
            ? "Quick Scan does not generate execution planning artifacts."
            : manifest?.gate?.status === "blocked"
            ? "Validator blocking findings suppressed PM artifacts."
            : "No execution plan has been generated yet."
        }</p>
      </article>
    `;
  renderScanInspector(currentScanEntries.get(activeScanSelectionId) ?? null, validationSummary);
  syncActiveScanSelection();
  updateScanActionButtons();
  renderSidebarNav();
  renderInspector();
}

function clearMainViews() {
  currentFocusEl.innerHTML = "";
  nextTasksEl.innerHTML = "";
  projectSummaryEl.innerHTML = "";
  structureMapEl.innerHTML = "";
  taskBoardEl.innerHTML = "";
  riskBoardEl.innerHTML = "";
  workspaceDocsEl.innerHTML = "";
  recentDecisionsEl.innerHTML = "";
  timelineEl.innerHTML = "";
}

function bindSidebarNavigation() {
  renderSidebarNav();

  sidebarUtilityNavEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-sidebar-target]");
    if (!button) return;
    setActiveTab(sanitizeSidebarLocation(button.dataset.sidebarTarget), button.dataset.sidebarSelection || null);
  });

  sidebarNavEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-sidebar-target]");
    if (!button) return;
    setActiveTab(sanitizeSidebarLocation(button.dataset.sidebarTarget), button.dataset.sidebarSelection || null);
  });

  sidebarNewProjectButtonEl.addEventListener("click", async () => {
    renderWorkspaceStatus("Opening folder picker...");
    try {
      const projectPath = await selectProjectPath();
      if (!projectPath) {
        renderWorkspaceStatus("Folder selection canceled.");
        return;
      }

      const projectName = deriveProjectNameFromPath(projectPath);
      renderWorkspaceStatus(`Connecting ${projectName || "project"}...`);

      try {
        await loadWorkspace(projectPath);
      } catch (error) {
        if (!isMissingWorkspaceError(error)) {
          throw error;
        }
        await initWorkspace(projectPath, projectName);
      }
    } catch (error) {
      renderWorkspaceStatus(error.message, "error");
    }
  });
}

function setProviderActionBusy(provider, busy) {
  const isOpenAi = provider === "openai";
  const disconnectControl = isOpenAi ? settingsOpenAiDisconnectEl : settingsGitHubCopilotDisconnectEl;
  const connected = isOpenAi
    ? accountSettings?.providers?.openai?.connected ?? false
    : accountSettings?.providers?.githubCopilot?.connected ?? false;
  const controls = isOpenAi
    ? [settingsOpenAiSaveEl, settingsOpenAiTestEl, settingsOpenAiDisconnectEl]
    : [settingsGitHubCopilotSaveEl, settingsGitHubCopilotTestEl, settingsGitHubCopilotDisconnectEl];

  controls.forEach((control) => {
    control.disabled = busy;
  });
  disconnectControl.disabled = busy || !connected;
  if (isOpenAi) {
    settingsOpenAiLoginEl.disabled = busy;
  } else {
    settingsGitHubCopilotRegisterEl.disabled = busy;
  }
}

function getOpenAiFormPayload() {
  return {
    apiKey: settingsOpenAiApiKeyEl.value.trim(),
    baseUrl: settingsOpenAiBaseUrlEl.value.trim(),
    defaultModel: settingsOpenAiModelEl.value.trim()
  };
}

function getGitHubCopilotFormPayload() {
  return {
    githubToken: settingsGitHubCopilotTokenEl.value.trim()
  };
}

async function refreshAccountSettings() {
  try {
    accountSettings = await apiFetch("/api/settings/accounts");
    syncAccountSettingsControls();
  } catch (error) {
    settingsAccountStorageEl.textContent = error.message;
    renderInlineAccountActionStatus(settingsOpenAiStatusEl, "Failed to load account settings.", "error");
    renderInlineAccountActionStatus(settingsGitHubCopilotStatusEl, "Failed to load account settings.", "error");
  }
}

async function runAccountProviderAction(provider, action) {
  const isOpenAi = provider === "openai";
  const statusEl = isOpenAi ? settingsOpenAiStatusEl : settingsGitHubCopilotStatusEl;
  const pathname =
    action === "save"
      ? `/api/settings/accounts/${provider}`
      : action === "test"
        ? `/api/settings/accounts/${provider}/test`
        : "/api/settings/accounts/disconnect";
  const payload =
    action === "disconnect"
      ? { provider }
      : isOpenAi
        ? getOpenAiFormPayload()
        : getGitHubCopilotFormPayload();
  const pendingMessage =
    action === "save" ? "Saving account settings..." : action === "test" ? "Saving and testing..." : "Disconnecting...";

  setProviderActionBusy(provider, true);
  renderInlineAccountActionStatus(statusEl, pendingMessage);

  try {
    await apiFetch(pathname, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    await refreshAccountSettings();
  } catch (error) {
    renderInlineAccountActionStatus(statusEl, error.message, "error");
  } finally {
    setProviderActionBusy(provider, false);
  }
}

function bindInspectorControls() {
  tabShortcutsEl.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("[data-tab-target]");
    if (!button) return;
    setActiveTab(button.dataset.tabTarget);
    closeSettingsModal();
  });

  settingsSidebarNavEl.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("[data-settings-target]");
    if (!button) return;
    setActiveSettingsSection(button.dataset.settingsTarget);
  });

  openSettingsButtonEl.addEventListener("click", () => {
    openSettingsModal();
  });

  closeSettingsButtonEl.addEventListener("click", () => {
    closeSettingsModal();
  });

  settingsModalEl.addEventListener("click", (event) => {
    if (event.target instanceof HTMLElement && event.target.dataset.closeSettings === "true") {
      closeSettingsModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !settingsModalEl.hidden) {
      closeSettingsModal();
    }
  });

  settingsDefaultTabEl.addEventListener("change", () => {
    const tab = sanitizeTab(settingsDefaultTabEl.value);
    updateUiSettings({ defaultTab: tab });
    setActiveTab(tab);
  });

  settingsDensityEl.addEventListener("change", () => {
    updateUiSettings({ density: settingsDensityEl.value });
  });

  settingsShowDocsEl.addEventListener("change", () => {
    updateUiSettings({ showDocs: settingsShowDocsEl.checked });
  });

  settingsPinnedSidebarEl.addEventListener("change", () => {
    updateUiSettings({ pinnedSidebar: settingsPinnedSidebarEl.checked });
  });

  settingsAutoOpenScanEl.addEventListener("change", () => {
    updateUiSettings({ autoOpenScan: settingsAutoOpenScanEl.checked });
  });
}

function bindScanInteractions() {
  [analysisHierarchyEl, analysisDependenciesEl, analysisFlowsEl, analysisRoadmapEl].forEach((container) => {
    container.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest("[data-scan-selection]");
      if (!button) return;
      setActiveScanSelection(button.dataset.scanSelection);
    });
  });
}

function renderApp(state, proposal, docs = null) {
  currentDocs = docs;
  renderSidebarNav();

  if (!state) {
    validationSummaryEl.innerHTML = `
      <article class="validation-card">
        <strong>Connect a project</strong>
        <p class="muted">Use Add in the Projects sidebar to load an existing workspace or create a new .treema folder.</p>
      </article>
    `;
    clearMainViews();
    renderProposal(proposal, state);
    renderInspector();
    return;
  }

  const validation = validateState(state);
  renderValidation(validation);

  if (!validation.valid) {
    clearMainViews();
    renderProposal(proposal, state);
    renderInspector();
    return;
  }

  const viewModel = buildViewModel(state);
  const projectIndex = new Map(state.projects.map((project) => [project.id, project]));

  renderCurrentFocus(viewModel);
  renderNextTasks(viewModel, viewModel.trackIndex);
  renderProjectSummary(state, viewModel);
  renderStructureMap(state, viewModel);
  renderTaskBoard(viewModel.tasksByStatus, viewModel.trackIndex);
  renderRiskBoard(viewModel.risksBySeverity, viewModel.trackIndex);
  renderWorkspaceDocs(docs);
  renderRecentDecisions(viewModel.recentDecisions);
  renderTimeline(viewModel.timeline, projectIndex, viewModel.trackIndex);
  renderProposal(proposal, state);
  renderInspector();
}

async function readFileAsJson(file) {
  const text = await file.text();
  return JSON.parse(text);
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function hydrateSnapshotFormFromDocs(docs) {
  if (!docs) return;
  snapshotFocusInputEl.value = docs.currentFocus
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2))
    .join("\n");
  snapshotNextInputEl.value = docs.nextTasks
    .split("\n")
    .filter((line) => line.startsWith("- [ ] "))
    .map((line) => line.slice(6))
    .join("\n");
}

function applyWorkspacePayload(payload) {
  currentWorkspace = payload;
  currentState = payload.state;
  currentProposal = null;
  currentAnalysis = payload.analysis ?? null;
  currentDocs = payload.docs ?? null;
  persistLastWorkspacePath(payload.projectRoot || "");
  hydrateSnapshotFormFromDocs(payload.docs);
  renderApp(currentState, currentProposal, currentDocs);
  renderProjectAnalysis(currentAnalysis);
}

async function restoreLastWorkspace() {
  const projectPath = loadLastWorkspacePath();
  if (!projectPath) {
    return false;
  }

  renderWorkspaceStatus(`Restoring workspace from ${projectPath}...`);
  try {
    await loadWorkspace(projectPath);
    return true;
  } catch (error) {
    if (isMissingWorkspaceError(error)) {
      persistLastWorkspacePath("");
    }
    renderWorkspaceStatus(`Could not restore saved workspace: ${error.message}`, "error");
    return false;
  }
}

async function loadWorkspace(projectPath) {
  const payload = await apiFetch(`/api/workspace?projectPath=${encodeURIComponent(projectPath)}`);
  applyWorkspacePayload(payload);
  renderWorkspaceStatus(`Loaded workspace from ${payload.treemaDir}`);
}

async function initWorkspace(projectPath, projectName = "") {
  const payload = await apiFetch("/api/workspace/init", {
    method: "POST",
    body: JSON.stringify({ projectPath, projectName })
  });
  applyWorkspacePayload(payload);
  renderWorkspaceStatus(`Initialized workspace in ${payload.treemaDir}`);
}

async function selectProjectPath() {
  const payload = await apiFetch("/api/system/select-directory", {
    method: "POST",
    body: JSON.stringify({})
  });
  return payload.projectPath || "";
}

async function runAnalysis(mode) {
  const projectPath = getCurrentProjectPath();
  if (!projectPath) {
    renderWorkspaceStatus("Connect a project before running a scan.", "error");
    return;
  }

  if (mode === "project" && !(accountSettings?.analysisProvider?.available ?? false)) {
    renderWorkspaceStatus(buildProjectScanButtonTitle(accountSettings), "warning");
    updateScanActionButtons();
    return;
  }

  renderWorkspaceStatus(mode === "quick" ? "Running Quick Scan..." : "Running Project Scan...");
  try {
    const payload = await apiFetch("/api/project/analyze", {
      method: "POST",
      body: JSON.stringify({ projectPath, mode })
    });
    currentAnalysis = payload.analysis;
    renderProjectAnalysis(currentAnalysis);
    if (uiSettings.autoOpenScan) {
      setActiveTab("scan");
    }
    renderWorkspaceStatus(
      payload.saved
        ? `${mode === "quick" ? "Quick Scan" : "Project Scan"} saved to ${payload.saved.analysisDir} (${payload.analysis.rootManifest.gate.status})`
        : `${mode === "quick" ? "Quick Scan" : "Project Scan"} completed for ${payload.analysis.projectRoot} (${payload.analysis.rootManifest.gate.status})`
    );
  } catch (error) {
    renderWorkspaceStatus(error.message, "error");
  }
}

function bindWorkspaceControls() {
  analyzeProjectButtonEl.addEventListener("click", async () => {
    await runAnalysis("project");
  });

  quickScanButtonEl?.addEventListener("click", async () => {
    await runAnalysis("quick");
  });

  saveSnapshotButtonEl.addEventListener("click", async () => {
    const projectPath = getCurrentProjectPath();
    const summary = snapshotSummaryInputEl.value.trim();
    if (!projectPath || !summary) {
      renderWorkspaceStatus("Connect a project and enter a snapshot summary.", "error");
      return;
    }
    try {
      const payload = await apiFetch("/api/workspace/snapshot", {
        method: "POST",
        body: JSON.stringify({
          projectPath,
          summary,
          focus: parseLines(snapshotFocusInputEl.value),
          next: parseLines(snapshotNextInputEl.value),
          risks: parseLines(snapshotRisksInputEl.value)
        })
      });
      currentWorkspace = payload;
      currentState = payload.state;
      currentProposal = null;
      currentAnalysis = payload.analysis ?? currentAnalysis;
      currentDocs = payload.docs ?? null;
      renderWorkspaceStatus(`Snapshot saved for ${payload.projectRoot}`);
      renderApp(currentState, currentProposal, currentDocs);
      renderProjectAnalysis(currentAnalysis);
    } catch (error) {
      renderWorkspaceStatus(error.message, "error");
    }
  });
}

function bindImportExport() {
  stateFileInputEl.addEventListener("change", async (event) => {
    const [file] = event.target.files ?? [];
    if (!file) return;
    try {
      currentState = await readFileAsJson(file);
      currentWorkspace = null;
      currentAnalysis = null;
      currentDocs = null;
      persistLastWorkspacePath("");
      renderApp(currentState, currentProposal, currentDocs);
      renderProjectAnalysis(currentAnalysis);
    } catch (error) {
      validationSummaryEl.innerHTML = `
        <article class="validation-card">
          <strong class="validation-error">Failed to read state file</strong>
          <p class="muted">${escapeHtml(error.message)}</p>
        </article>
      `;
    }
  });

  proposalFileInputEl.addEventListener("change", async (event) => {
    const [file] = event.target.files ?? [];
    if (!file) return;
    try {
      currentProposal = await readFileAsJson(file);
      renderProposal(currentProposal, currentState);
      renderInspector();
    } catch (error) {
      proposalSummaryEl.innerHTML = `
        <article class="proposal-card">
          <strong class="validation-error">Failed to read proposal file</strong>
          <p class="muted">${escapeHtml(error.message)}</p>
        </article>
      `;
    }
  });

  exportStateButtonEl.addEventListener("click", () => {
    if (!currentState) return;
    downloadJson("project_state.export.json", currentState);
  });
}

async function init() {
  syncSettingsControls();
  applyUiSettings();
  providerSettingsController.syncAccountSettingsControls();
  openSettingsButtonEl.setAttribute("aria-expanded", "false");
  bindSidebarNavigation();
  renderWorkspaceStatus("Use Add in the Projects sidebar to connect or create a workspace.");
  renderApp(currentState, currentProposal, currentDocs);
  renderProjectAnalysis(currentAnalysis);
  bindInspectorControls();
  providerSettingsController.bindEvents();
  bindScanInteractions();
  bindWorkspaceControls();
  bindImportExport();
  renderProjectAnalysis(currentAnalysis);
  setActiveTab(uiSettings.defaultTab);
  if (desktopBridge?.onOAuthComplete) {
    desktopBridge.onOAuthComplete(async (payload = {}) => {
      await providerSettingsController.refreshAccountSettings();
      providerSettingsController.handleOAuthComplete(payload);
    });
  }
  await providerSettingsController.refreshAccountSettings();
  await restoreLastWorkspace();
}

init().catch((error) => {
  renderWorkspaceStatus(error.message, "error");
});
