const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const rootDir = path.resolve(__dirname, "..");
let mainWindow = null;
let githubOAuthServer = null;
let githubOAuthRuntime = {
  available: false,
  callbackPath: "/auth/github/callback",
  callbackUrl: ""
};
const pendingProtocolUrls = [];
const DESKTOP_OAUTH_COMPLETE_PATH = "/auth/github/complete";

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function enqueueProtocolUrl(targetUrl) {
  if (targetUrl && typeof targetUrl === "string") {
    pendingProtocolUrls.push(targetUrl);
  }
}

function parseProtocolUrl(argv = []) {
  return argv.find((value) => typeof value === "string" && value.startsWith("treesma://")) || "";
}

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
  mainWindow = new BrowserWindow({
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

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadFile(path.join(rootDir, "index.html"));
  await flushPendingProtocolUrls();
}

function registerTreesmaProtocol() {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("treesma", process.execPath, [path.resolve(process.argv[1])]);
    return;
  }

  app.setAsDefaultProtocolClient("treesma");
}

async function handleTreesmaProtocolUrl(targetUrl) {
  if (!targetUrl) return;

  const url = new URL(targetUrl);
  const route = `${url.host}${url.pathname}`;
  if (route !== "auth/complete") {
    return;
  }

  if (url.searchParams.get("state") || url.searchParams.get("code") || url.searchParams.get("error")) {
    const { buildGitHubOAuthCallbackRuntime, completeGitHubDesktopOAuth } = await importRuntimeModules();
    const result = await completeGitHubDesktopOAuth(
      {
        code: url.searchParams.get("code") || "",
        state: url.searchParams.get("state") || "",
        error: url.searchParams.get("error") || "",
        error_description: url.searchParams.get("error_description") || ""
      },
      {
        githubOAuth: buildGitHubOAuthCallbackRuntime(githubOAuthRuntime.callbackUrl)
      }
    );

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("treema:auth:oauth-complete", {
        provider: "github-copilot",
        completion: result.completion
      });
    }
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  }
}

async function flushPendingProtocolUrls() {
  while (pendingProtocolUrls.length > 0) {
    const targetUrl = pendingProtocolUrls.shift();
    await handleTreesmaProtocolUrl(targetUrl);
  }
}

async function startGitHubOAuthLoopbackServer() {
  const accountSettingsModuleUrl = pathToFileURL(path.join(rootDir, "scripts/lib/account-settings.mjs")).href;
  const {
    buildGitHubOAuthCallbackRuntime,
    buildGitHubOAuthCallbackUrl,
    completeGitHubDesktopOAuth,
    GITHUB_OAUTH_CALLBACK_PATH,
    GITHUB_OAUTH_DESKTOP_PORT,
    renderGitHubOAuthCallbackPage
  } = await import(accountSettingsModuleUrl);

  const callbackUrl = buildGitHubOAuthCallbackUrl(`http://127.0.0.1:${GITHUB_OAUTH_DESKTOP_PORT}`);
  githubOAuthRuntime = buildGitHubOAuthCallbackRuntime(callbackUrl);

  githubOAuthServer = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${GITHUB_OAUTH_DESKTOP_PORT}`);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "https://treesma.com",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS" && url.pathname === DESKTOP_OAUTH_COMPLETE_PATH) {
      response.writeHead(204, corsHeaders);
      response.end();
      return;
    }

    if (request.method === "POST" && url.pathname === DESKTOP_OAUTH_COMPLETE_PATH) {
      try {
        const body = await readJsonBody(request);
        const oauth = await completeGitHubDesktopOAuth(
          {
            code: body.code || "",
            state: body.state || "",
            error: body.error || "",
            error_description: body.error_description || "",
            accessToken: body.access_token || body.accessToken || ""
          },
          {
            githubOAuth: githubOAuthRuntime
          }
        );
        response.writeHead(oauth.completion.ok ? 200 : 400, {
          ...corsHeaders,
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store"
        });
        response.end(JSON.stringify(oauth.completion));
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("treema:auth:oauth-complete", {
            provider: "github-copilot",
            completion: oauth.completion
          });
        }
      } catch (error) {
        response.writeHead(500, {
          ...corsHeaders,
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store"
        });
        response.end(
          JSON.stringify({
            ok: false,
            error: "desktop_oauth_handoff_failed",
            message: error.message || "Failed to complete GitHub OAuth handoff."
          })
        );
      }
      return;
    }

    if (request.method !== "GET" || url.pathname !== GITHUB_OAUTH_CALLBACK_PATH) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    try {
      const oauth = await completeGitHubDesktopOAuth(
        {
          code: url.searchParams.get("code") || "",
          state: url.searchParams.get("state") || "",
          error: url.searchParams.get("error") || "",
          error_description: url.searchParams.get("error_description") || ""
        },
        {
          githubOAuth: githubOAuthRuntime
        }
      );
      const html = renderGitHubOAuthCallbackPage(oauth.oauth.lastCallback, callbackUrl);
      response.writeHead(oauth.oauth.lastCallback?.status === "success" ? 200 : 400, {
        "Content-Type": "text/html; charset=utf-8"
      });
      response.end(html);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("treema:auth:oauth-complete", {
          provider: "github-copilot",
          completion: oauth.completion
        });
      }
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(error.message || "Failed to record GitHub OAuth callback.");
    }
  });

  await new Promise((resolve) => {
    githubOAuthServer.once("error", () => {
      githubOAuthRuntime = {
        available: false,
        callbackPath: GITHUB_OAUTH_CALLBACK_PATH,
        callbackUrl: ""
      };
      githubOAuthServer = null;
      resolve();
    });
    githubOAuthServer.listen(GITHUB_OAUTH_DESKTOP_PORT, "127.0.0.1", resolve);
  });
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
    return loadAccountSettings({ githubOAuth: githubOAuthRuntime });
  });

  ipcMain.handle("treema:settings:accounts:github-oauth:start", async (_event, payload = {}) => {
    const { startGitHubDesktopOAuthFlow } = await importRuntimeModules();
    return startGitHubDesktopOAuthFlow(payload);
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

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  const initialProtocolUrl = parseProtocolUrl(process.argv);
  if (initialProtocolUrl) {
    enqueueProtocolUrl(initialProtocolUrl);
  }

  app.on("second-instance", (_event, argv) => {
    const protocolUrl = parseProtocolUrl(argv);
    if (protocolUrl) {
      enqueueProtocolUrl(protocolUrl);
      void flushPendingProtocolUrls();
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.on("open-url", (event, targetUrl) => {
  event.preventDefault();
  enqueueProtocolUrl(targetUrl);
  void flushPendingProtocolUrls();
});

if (hasSingleInstanceLock) {
  app.whenReady().then(async () => {
    registerTreesmaProtocol();
    await startGitHubOAuthLoopbackServer();
    registerIpcHandlers();
    await createMainWindow();

    app.on("activate", async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await createMainWindow();
      }
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  if (githubOAuthServer) {
    githubOAuthServer.close();
    githubOAuthServer = null;
  }
});
