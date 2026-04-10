const { contextBridge, ipcRenderer } = require("electron");

function invoke(channel, payload) {
  return ipcRenderer.invoke(channel, payload);
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
  saveAccountSettings(provider, values) {
    return invoke("treema:settings:accounts:save", { provider, values });
  },
  testAccountSettings(provider, values) {
    return invoke("treema:settings:accounts:test", { provider, values });
  },
  disconnectAccountSettings(provider) {
    return invoke("treema:settings:accounts:disconnect", { provider });
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
  analyzeProject(projectPath, mode) {
    return invoke("treema:project:analyze", { projectPath, mode });
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
