const UTILITY_ITEMS = [
  { id: "workspace", label: "Workspace" },
  { id: "structure", label: "Structure" },
  { id: "board", label: "Board" },
  { id: "timeline", label: "Timeline" },
  { id: "scan", label: "Project Scan" },
  { id: "review", label: "AI Review" }
];

export const SIDEBAR_LOCATIONS = UTILITY_ITEMS.map((item) => ({
  id: item.id,
  label: item.label
}));

export const DEFAULT_SIDEBAR_LOCATION = SIDEBAR_LOCATIONS[0].id;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function truncate(value, length = 84) {
  if (!value || value.length <= length) return value;
  return `${value.slice(0, length - 1).trim()}…`;
}

function formatRelativeTime(value) {
  if (!value) return "new";

  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "new";

  const diffMs = Math.max(0, Date.now() - timestamp);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < hour) {
    return `${Math.max(1, Math.floor(diffMs / minute) || 1)}m`;
  }

  if (diffMs < day) {
    return `${Math.floor(diffMs / hour)}h`;
  }

  if (diffMs < day * 14) {
    return `${Math.floor(diffMs / day)}d`;
  }

  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(timestamp));
}

function projectSortValue(project) {
  const statusWeight = project.status === "active" ? 0 : project.status === "paused" ? 2 : 1;
  return `${statusWeight}:${project.name.toLowerCase()}`;
}

function buildProjectThreadEntries(project, state) {
  const tasks = Array.isArray(state?.tasks) ? state.tasks : [];
  const decisions = Array.isArray(state?.decisions) ? state.decisions : [];
  const tracks = Array.isArray(state?.tracks) ? state.tracks : [];
  const focusTaskIds = new Set(state?.meta?.currentFocusTaskIds ?? []);
  const taskEntries = tasks
    .filter((task) => task.projectId === project.id)
    .sort((left, right) => {
      const leftFocusScore = focusTaskIds.has(left.id) ? 0 : 1;
      const rightFocusScore = focusTaskIds.has(right.id) ? 0 : 1;
      if (leftFocusScore !== rightFocusScore) return leftFocusScore - rightFocusScore;
      return new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime();
    })
    .map((task) => ({
      id: `task:${task.id}`,
      tab: "board",
      title: task.title,
      meta: `${String(task.status).replaceAll("_", " ")}${task.priority ? ` · ${task.priority}` : ""}`,
      time: formatRelativeTime(task.updatedAt)
    }));

  const decisionEntries = decisions
    .filter((decision) => decision.projectId === project.id)
    .sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime())
    .map((decision) => ({
      id: `decision:${decision.id}`,
      tab: "timeline",
      title: decision.title,
      meta: `${decision.status || "decision"} · timeline`,
      time: formatRelativeTime(decision.updatedAt)
    }));

  const trackItems = tracks
    .filter((track) => track.projectId === project.id)
    .map((track) => ({
      id: `track:${track.id}`,
      tab: "workspace",
      title: track.name,
      meta: truncate(track.goal || "Track goal not recorded.", 58),
      time: "track"
    }));

  const entries = [...taskEntries, ...decisionEntries];
  if (entries.length === 0) {
    return trackItems.slice(0, 3);
  }

  return entries.slice(0, 4);
}

function getVisibleProjects(state) {
  if (!state?.projects?.length) return [];

  const childProjects = state.projects.filter((project) => project.parentId);
  const visibleProjects = childProjects.length > 0 ? childProjects : state.projects;

  return [...visibleProjects].sort((left, right) =>
    projectSortValue(left).localeCompare(projectSortValue(right), "en", { sensitivity: "base" })
  );
}

export function sanitizeSidebarLocation(locationId) {
  return SIDEBAR_LOCATIONS.some((location) => location.id === locationId) ? locationId : DEFAULT_SIDEBAR_LOCATION;
}

export function buildSidebarUtilityMarkup(activeLocationId) {
  const normalizedActiveLocationId = sanitizeSidebarLocation(activeLocationId);

  return UTILITY_ITEMS.map(
    (item) => `
      <button
        type="button"
        class="sidebar-utility-item ${item.id === normalizedActiveLocationId ? "is-active" : ""}"
        data-sidebar-target="${item.id}"
        data-sidebar-selection="utility:${item.id}"
        aria-pressed="${item.id === normalizedActiveLocationId ? "true" : "false"}"
      >
        <span class="sidebar-utility-dot" aria-hidden="true"></span>
        <span>${escapeHtml(item.label)}</span>
      </button>
    `
  ).join("");
}

export function buildSidebarProjectMarkup(state, activeSelectionId) {
  const projects = getVisibleProjects(state);
  const tasks = Array.isArray(state?.tasks) ? state.tasks : [];

  if (projects.length === 0) {
    return `
      <article class="sidebar-empty">
        <strong>No connected projects</strong>
        <p>Use Add to connect a folder or create a new .treema workspace.</p>
      </article>
    `;
  }

  return projects
    .map((project) => {
      const selectionId = `project:${project.id}`;
      const threadEntries = buildProjectThreadEntries(project, state);
      const hiddenCount = Math.max(0, tasks.filter((task) => task.projectId === project.id).length - threadEntries.length);

      return `
        <section class="sidebar-project-group">
          <button
            type="button"
            class="sidebar-project-trigger ${activeSelectionId === selectionId ? "is-selected" : ""}"
            data-sidebar-target="structure"
            data-sidebar-selection="${selectionId}"
          >
            <span class="sidebar-project-marker" aria-hidden="true"></span>
            <span class="sidebar-project-copy">
              <strong>${escapeHtml(project.name)}</strong>
              <span>${escapeHtml(truncate(project.description || "Project structure and live threads.", 72))}</span>
            </span>
            <span class="sidebar-project-status">${escapeHtml(project.status)}</span>
          </button>

          <div class="sidebar-thread-list">
            ${threadEntries
              .map(
                (entry) => `
                  <button
                    type="button"
                    class="sidebar-thread-item ${activeSelectionId === entry.id ? "is-selected" : ""}"
                    data-sidebar-target="${entry.tab}"
                    data-sidebar-selection="${entry.id}"
                  >
                    <span class="sidebar-thread-copy">
                      <strong>${escapeHtml(entry.title)}</strong>
                      <span>${escapeHtml(entry.meta)}</span>
                    </span>
                    <span class="sidebar-thread-time">${escapeHtml(entry.time)}</span>
                  </button>
                `
              )
              .join("")}

            ${
              hiddenCount > 0
                ? `
                  <button
                    type="button"
                    class="sidebar-thread-more"
                    data-sidebar-target="board"
                    data-sidebar-selection="${selectionId}:more"
                  >
                    Show ${hiddenCount} more
                  </button>
                `
                : ""
            }
          </div>
        </section>
      `;
    })
    .join("");
}

export function countSidebarProjects(state) {
  return getVisibleProjects(state).length;
}
