const { contextBridge, ipcRenderer } = require("electron");

function invoke(channel, payload) {
  return ipcRenderer.invoke(channel, payload);
}

function normalizeObjectPayload(payload = {}) {
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
}

function normalizeProviderPayload(providerOrPayload, values = {}) {
  if (providerOrPayload && typeof providerOrPayload === "object" && !Array.isArray(providerOrPayload)) {
    return {
      provider: providerOrPayload.provider,
      values: normalizeObjectPayload(providerOrPayload.values)
    };
  }

  return {
    provider: providerOrPayload,
    values: normalizeObjectPayload(values)
  };
}

function normalizeAnalyzePayload(projectPathOrPayload, mode = "project") {
  if (projectPathOrPayload && typeof projectPathOrPayload === "object" && !Array.isArray(projectPathOrPayload)) {
    return normalizeObjectPayload(projectPathOrPayload);
  }

  return {
    projectPath: projectPathOrPayload,
    mode
  };
}

contextBridge.exposeInMainWorld("treemaDesktop", {
  isElectron: true,
  openExternal(targetUrl) {
    return invoke("treema:system:open-external", targetUrl);
  },
  loadAccountSettings() {
    return invoke("treema:settings:accounts:load");
  },
  startGitHubOAuthFlow(values) {
    return invoke("treema:settings:accounts:github-oauth:start", values);
  },
  startOpenAiOAuthFlow(values) {
    return invoke("treema:settings:accounts:openai-oauth:start", values);
  },
  saveAccountSettings(providerOrPayload, values) {
    return invoke("treema:settings:accounts:save", normalizeProviderPayload(providerOrPayload, values));
  },
  saveAccountPreferences(payload) {
    return invoke("treema:settings:accounts:preferences:save", normalizeObjectPayload(payload));
  },
  testAccountSettings(providerOrPayload, values) {
    return invoke("treema:settings:accounts:test", normalizeProviderPayload(providerOrPayload, values));
  },
  disconnectAccountSettings(providerOrPayload) {
    const payload =
      providerOrPayload && typeof providerOrPayload === "object" && !Array.isArray(providerOrPayload)
        ? providerOrPayload
        : { provider: providerOrPayload };
    return invoke("treema:settings:accounts:disconnect", payload);
  },
  selectDirectory() {
    return invoke("treema:select-directory");
  },
  loadWorkspace(projectPath) {
    return invoke("treema:workspace:load", projectPath);
  },
  initWorkspace(projectPath, projectName) {
    return invoke("treema:workspace:init", { projectPath, projectName });
  },
  snapshotWorkspace(payload) {
    return invoke("treema:workspace:snapshot", payload);
  },
  analyzeProject(projectPathOrPayload, mode) {
    return invoke("treema:project:analyze", normalizeAnalyzePayload(projectPathOrPayload, mode));
  },
  onOAuthComplete(callback) {
    if (typeof callback !== "function") {
      return () => {};
    }
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("treema:auth:oauth-complete", listener);
    return () => {
      ipcRenderer.removeListener("treema:auth:oauth-complete", listener);
    };
  }
});
