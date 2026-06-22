const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const rootDir = path.resolve(__dirname, "..");
const oauthHandoffContractUrl = pathToFileURL(path.join(rootDir, "scripts/lib/oauth-handoff-contract.js")).href;
const oauthHandoffContractPromise = import(oauthHandoffContractUrl);
let mainWindow = null;
let githubOAuthServer = null;
let openAiOAuthServer = null;
let githubOAuthRuntime = {
  available: false,
  callbackPath: "/auth/github/callback",
  callbackUrl: ""
};
let openAiOAuthRuntime = {
  available: false,
  callbackPath: "/auth/callback",
  callbackUrl: "",
  hostedCallbackUrl: "https://treesma.com/auth/openai/callback",
  clientId: ""
};
const pendingProtocolUrls = [];

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

function getAccountSettingsRuntimeOptions() {
  return {
    githubOAuth: githubOAuthRuntime,
    openaiOAuth: openAiOAuthRuntime
  };
}

function normalizePreferencesPayload(payload = {}) {
  if (payload && typeof payload === "object" && payload.values && typeof payload.values === "object") {
    return payload.values;
  }
  return payload && typeof payload === "object" ? payload : {};
}

async function parseProtocolUrl(argv = []) {
  const { DESKTOP_OAUTH_DEEP_LINK_PREFIX } = await oauthHandoffContractPromise;
  return argv.find((value) => typeof value === "string" && value.startsWith(DESKTOP_OAUTH_DEEP_LINK_PREFIX)) || "";
}

async function importRuntimeModules() {
  const cacheBust = `?v=${Date.now()}`;
  const accountSettingsModuleUrl = `${pathToFileURL(path.join(rootDir, "scripts/lib/account-settings.mjs")).href}${cacheBust}`;
  const workspaceModuleUrl = `${pathToFileURL(path.join(rootDir, "scripts/lib/treema-workspace.mjs")).href}${cacheBust}`;
  const analysisModuleUrl = `${pathToFileURL(path.join(rootDir, "scripts/lib/project-analysis.mjs")).href}${cacheBust}`;
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

async function registerTreesmaProtocol() {
  const { DESKTOP_OAUTH_DEEP_LINK_PROTOCOL } = await oauthHandoffContractPromise;
  const protocol = DESKTOP_OAUTH_DEEP_LINK_PROTOCOL.replace(/:$/u, "");

  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(protocol, process.execPath, [path.resolve(process.argv[1])]);
    return;
  }

  app.setAsDefaultProtocolClient(protocol);
}

async function handleTreesmaProtocolUrl(targetUrl) {
  if (!targetUrl) return;

  const { DESKTOP_OAUTH_DEEP_LINK_ROUTE, OAUTH_HANDOFF_PROVIDERS, normalizeOAuthHandoffProvider } = await oauthHandoffContractPromise;
  const url = new URL(targetUrl);
  const route = `${url.host}${url.pathname}`;
  if (route !== DESKTOP_OAUTH_DEEP_LINK_ROUTE) {
    return;
  }

  if (url.searchParams.get("state") || url.searchParams.get("code") || url.searchParams.get("error")) {
    const provider = normalizeOAuthHandoffProvider(url.searchParams.get("provider"));
    const runtimeModules = await importRuntimeModules();
    const result =
      provider === OAUTH_HANDOFF_PROVIDERS.OPENAI
        ? await runtimeModules.completeOpenAiOAuthFlow(
            {
              code: url.searchParams.get("code") || "",
              state: url.searchParams.get("state") || "",
              error: url.searchParams.get("error") || "",
              error_description: url.searchParams.get("error_description") || ""
            },
            {
              openaiOAuth: runtimeModules.buildOpenAiOAuthCallbackRuntime(openAiOAuthRuntime.callbackUrl)
            }
          )
        : await runtimeModules.completeGitHubDesktopOAuth(
            {
              code: url.searchParams.get("code") || "",
              state: url.searchParams.get("state") || "",
              error: url.searchParams.get("error") || "",
              error_description: url.searchParams.get("error_description") || ""
            },
            {
              githubOAuth: runtimeModules.buildGitHubOAuthCallbackRuntime(githubOAuthRuntime.callbackUrl)
            }
          );

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("treema:auth:oauth-complete", {
        provider,
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
    buildOpenAiOAuthCallbackRuntime,
    buildOpenAiOAuthCallbackUrl,
    completeOpenAiOAuthFlow,
    completeGitHubDesktopOAuth,
    GITHUB_OAUTH_CALLBACK_PATH,
    OPENAI_OAUTH_LOCAL_PORT,
    OPENAI_OAUTH_CALLBACK_PATH,
    renderGitHubOAuthCallbackPage,
    renderOpenAiOAuthCallbackPage
  } = await import(accountSettingsModuleUrl);
  const {
    buildDesktopOAuthHandoffOrigin,
    DESKTOP_OAUTH_HANDOFF_HOST,
    DESKTOP_OAUTH_HANDOFF_PORT,
    OAUTH_HANDOFF_PATHS,
    OAUTH_HANDOFF_PROVIDERS
  } = await oauthHandoffContractPromise;
  const desktopOAuthHandoffOrigin = buildDesktopOAuthHandoffOrigin();
  const openAiLoopbackOrigin = buildDesktopOAuthHandoffOrigin({ port: OPENAI_OAUTH_LOCAL_PORT });
  const desktopGitHubHandoffPath = OAUTH_HANDOFF_PATHS[OAUTH_HANDOFF_PROVIDERS.GITHUB];
  const desktopOpenAiHandoffPath = OAUTH_HANDOFF_PATHS[OAUTH_HANDOFF_PROVIDERS.OPENAI];

  const callbackUrl = buildGitHubOAuthCallbackUrl(`http://localhost:${DESKTOP_OAUTH_HANDOFF_PORT}`);
  const openAiCallbackUrl = buildOpenAiOAuthCallbackUrl(`http://localhost:${OPENAI_OAUTH_LOCAL_PORT}`);
  githubOAuthRuntime = buildGitHubOAuthCallbackRuntime(callbackUrl);
  openAiOAuthRuntime = buildOpenAiOAuthCallbackRuntime(openAiCallbackUrl);

  githubOAuthServer = http.createServer(async (request, response) => {
    const url = new URL(request.url, desktopOAuthHandoffOrigin);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "https://treesma.com",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (
      request.method === "OPTIONS" &&
      (url.pathname === desktopGitHubHandoffPath || url.pathname === desktopOpenAiHandoffPath)
    ) {
      response.writeHead(204, corsHeaders);
      response.end();
      return;
    }

    if (request.method === "POST" && url.pathname === desktopGitHubHandoffPath) {
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
            provider: OAUTH_HANDOFF_PROVIDERS.GITHUB,
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

    if (request.method === "POST" && url.pathname === desktopOpenAiHandoffPath) {
      try {
        const body = await readJsonBody(request);
        const oauth = await completeOpenAiOAuthFlow(
          {
            code: body.code || "",
            state: body.state || "",
            error: body.error || "",
            error_description: body.error_description || "",
            accessToken: body.access_token || body.accessToken || "",
            refreshToken: body.refresh_token || body.refreshToken || "",
            expiresAt: body.expires_at || body.expiresAt || 0,
            idToken: body.id_token || body.idToken || ""
          },
          {
            openaiOAuth: openAiOAuthRuntime
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
            provider: OAUTH_HANDOFF_PROVIDERS.OPENAI,
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
            message: error.message || "Failed to complete OpenAI OAuth handoff."
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
          provider: OAUTH_HANDOFF_PROVIDERS.GITHUB,
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
      openAiOAuthRuntime = {
        available: false,
        callbackPath: OPENAI_OAUTH_CALLBACK_PATH,
        callbackUrl: "",
        hostedCallbackUrl: "https://treesma.com/auth/openai/callback",
        clientId: ""
      };
      githubOAuthServer = null;
      resolve();
    });
    githubOAuthServer.listen(DESKTOP_OAUTH_HANDOFF_PORT, DESKTOP_OAUTH_HANDOFF_HOST, resolve);
  });

  openAiOAuthServer = http.createServer(async (request, response) => {
    const url = new URL(request.url, openAiLoopbackOrigin);

    if (request.method !== "GET" || url.pathname !== OPENAI_OAUTH_CALLBACK_PATH) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    try {
      const oauth = await completeOpenAiOAuthFlow(
        {
          code: url.searchParams.get("code") || "",
          state: url.searchParams.get("state") || "",
          error: url.searchParams.get("error") || "",
          error_description: url.searchParams.get("error_description") || ""
        },
        {
          openaiOAuth: openAiOAuthRuntime
        }
      );
      const html = renderOpenAiOAuthCallbackPage(oauth.oauth.lastCallback, openAiCallbackUrl);
      response.writeHead(oauth.oauth.lastCallback?.status === "success" ? 200 : 400, {
        "Content-Type": "text/html; charset=utf-8"
      });
      response.end(html);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("treema:auth:oauth-complete", {
          provider: OAUTH_HANDOFF_PROVIDERS.OPENAI,
          completion: oauth.completion
        });
      }
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(error.message || "Failed to record OpenAI OAuth callback.");
    }
  });

  await new Promise((resolve) => {
    openAiOAuthServer.once("error", () => {
      openAiOAuthRuntime = {
        available: false,
        callbackPath: OPENAI_OAUTH_CALLBACK_PATH,
        callbackUrl: "",
        hostedCallbackUrl: "https://treesma.com/auth/openai/callback",
        clientId: ""
      };
      openAiOAuthServer = null;
      resolve();
    });
    openAiOAuthServer.listen(OPENAI_OAUTH_LOCAL_PORT, DESKTOP_OAUTH_HANDOFF_HOST, resolve);
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
    return loadAccountSettings(getAccountSettingsRuntimeOptions());
  });

  ipcMain.handle("treema:settings:accounts:github-oauth:start", async (_event, payload = {}) => {
    const { startGitHubDesktopOAuthFlow } = await importRuntimeModules();
    return startGitHubDesktopOAuthFlow(payload);
  });

  ipcMain.handle("treema:settings:accounts:openai-oauth:start", async (_event, payload = {}) => {
    const { startOpenAiOAuthFlow, OPENAI_OAUTH_LOCAL_PORT, buildOpenAiOAuthCallbackUrl } = await importRuntimeModules();
    return startOpenAiOAuthFlow({
      ...payload,
      callbackUrl: openAiOAuthRuntime.callbackUrl || buildOpenAiOAuthCallbackUrl(`http://localhost:${OPENAI_OAUTH_LOCAL_PORT}`)
    });
  });

  ipcMain.handle("treema:settings:accounts:save", async (_event, payload = {}) => {
    const { saveAccountSettings } = await importRuntimeModules();
    return saveAccountSettings(payload.provider, payload.values ?? {}, getAccountSettingsRuntimeOptions());
  });

  ipcMain.handle("treema:settings:accounts:preferences:save", async (_event, payload = {}) => {
    const { saveAccountPreferences } = await importRuntimeModules();
    return saveAccountPreferences(normalizePreferencesPayload(payload), getAccountSettingsRuntimeOptions());
  });

  ipcMain.handle("treema:settings:accounts:test", async (_event, payload = {}) => {
    const { testAccountSettings } = await importRuntimeModules();
    return testAccountSettings(payload.provider, payload.values ?? {}, getAccountSettingsRuntimeOptions());
  });

  ipcMain.handle("treema:settings:accounts:disconnect", async (_event, payload = {}) => {
    const { disconnectAccountSettings } = await importRuntimeModules();
    return disconnectAccountSettings(payload.provider, getAccountSettingsRuntimeOptions());
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
  app.on("second-instance", (_event, argv) => {
    void (async () => {
      const protocolUrl = await parseProtocolUrl(argv);
      if (protocolUrl) {
        enqueueProtocolUrl(protocolUrl);
        await flushPendingProtocolUrls();
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        mainWindow.show();
        mainWindow.focus();
      }
    })();
  });
}

app.on("open-url", (event, targetUrl) => {
  event.preventDefault();
  enqueueProtocolUrl(targetUrl);
  void flushPendingProtocolUrls();
});

if (hasSingleInstanceLock) {
  app.whenReady().then(async () => {
    await registerTreesmaProtocol();
    const initialProtocolUrl = await parseProtocolUrl(process.argv);
    if (initialProtocolUrl) {
      enqueueProtocolUrl(initialProtocolUrl);
    }
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
