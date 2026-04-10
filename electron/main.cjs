const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const rootDir = path.resolve(__dirname, "..");

async function importRuntimeModules() {
  const accountSettingsModuleUrl = pathToFileURL(path.join(rootDir, "scripts/lib/account-settings.mjs")).href;
  const workspaceModuleUrl = pathToFileURL(path.join(rootDir, "scripts/lib/treema-workspace.mjs")).href;
  const analysisModuleUrl = pathToFileURL(path.join(rootDir, "scripts/lib/project-analysis.mjs")).href;
  const accountSettingsModule = await import(accountSettingsModuleUrl);
  const workspaceModule = await import(workspaceModuleUrl);
  const analysisModule = await import(analysisModuleUrl);

  return {
    ...accountSettingsModule,
    ...workspaceModule,
    ...analysisModule
  };
}

async function createMainWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: "#f1ece1",
    show: false,
    title: "TreeMA",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs")
    }
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await window.loadFile(path.join(rootDir, "index.html"));
}

function registerIpcHandlers() {
  ipcMain.handle("treema:system:open-external", async (_event, targetUrl) => {
    if (!targetUrl || typeof targetUrl !== "string") {
      throw new Error("url is required");
    }
    await shell.openExternal(targetUrl);
    return { ok: true };
  });

  ipcMain.handle("treema:settings:accounts:load", async () => {
    const { loadAccountSettings } = await importRuntimeModules();
    return loadAccountSettings();
  });

  ipcMain.handle("treema:settings:accounts:save", async (_event, payload = {}) => {
    const { saveAccountSettings } = await importRuntimeModules();
    return saveAccountSettings(payload.provider, payload.values ?? {});
  });

  ipcMain.handle("treema:settings:accounts:test", async (_event, payload = {}) => {
    const { testAccountSettings } = await importRuntimeModules();
    return testAccountSettings(payload.provider, payload.values ?? {});
  });

  ipcMain.handle("treema:settings:accounts:disconnect", async (_event, payload = {}) => {
    const { disconnectAccountSettings } = await importRuntimeModules();
    return disconnectAccountSettings(payload.provider);
  });

  ipcMain.handle("treema:select-directory", async () => {
    const result = await dialog.showOpenDialog({
      title: "Select a project folder for TreeMA",
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled ? "" : result.filePaths[0] || "";
  });

  ipcMain.handle("treema:workspace:load", async (_event, projectPath) => {
    const { loadWorkspace } = await importRuntimeModules();
    return loadWorkspace(projectPath);
  });

  ipcMain.handle("treema:workspace:init", async (_event, payload = {}) => {
    const { initWorkspace, loadWorkspace } = await importRuntimeModules();
    const result = await initWorkspace(payload.projectPath, payload.projectName);
    return loadWorkspace(result.projectRoot);
  });

  ipcMain.handle("treema:workspace:snapshot", async (_event, payload = {}) => {
    const { loadWorkspace, snapshotWorkspace } = await importRuntimeModules();
    await snapshotWorkspace(payload.projectPath, {
      summary: payload.summary,
      focus: payload.focus ?? [],
      next: payload.next ?? [],
      risk: payload.risks ?? []
    });
    return loadWorkspace(payload.projectPath);
  });

  ipcMain.handle("treema:project:analyze", async (_event, payload = {}) => {
    const { analyzeProject, exists, persistProjectAnalysis } = await importRuntimeModules();
    const projectPath = typeof payload === "string" ? payload : payload.projectPath;
    const analysis = await analyzeProject(projectPath, {
      mode: typeof payload === "object" ? payload.mode : undefined
    });
    let saved = null;

    if (await exists(path.join(analysis.projectRoot, ".treema"))) {
      try {
        saved = await persistProjectAnalysis(analysis.projectRoot, analysis);
      } catch {
        saved = null;
      }
    }

    return { analysis, saved };
  });
}

app.whenReady().then(async () => {
  registerIpcHandlers();
  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
