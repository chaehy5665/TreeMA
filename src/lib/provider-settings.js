const OPENAI_LOGIN_URL = "https://chatgpt.com/auth/login"
const DEFAULT_WEB_APP_ORIGIN = "https://app.treesma.com"
const WEB_APP_ACCOUNTS_PATH = "/settings/accounts"

function queryProviderSettingsElements() {
  return {
    accountStorage: document.querySelector("#settings-account-storage"),
    defaultAnalysisProvider: document.querySelector("#settings-default-analysis-provider"),
    openai: {
      badge: document.querySelector("#settings-openai-badge"),
      login: document.querySelector("#settings-openai-login"),
      apiKey: document.querySelector("#settings-openai-api-key"),
      baseUrl: document.querySelector("#settings-openai-base-url"),
      model: document.querySelector("#settings-openai-model"),
      save: document.querySelector("#settings-openai-save"),
      test: document.querySelector("#settings-openai-test"),
      disconnect: document.querySelector("#settings-openai-disconnect"),
      status: document.querySelector("#settings-openai-status")
    },
    chatgptCodex: {
      badge: document.querySelector("#settings-chatgpt-codex-badge"),
      connect: document.querySelector("#settings-chatgpt-codex-connect"),
      hostedCallbackUrl: document.querySelector("#settings-chatgpt-codex-hosted-callback-url"),
      callbackUrl: document.querySelector("#settings-chatgpt-codex-callback-url"),
      callbackNote: document.querySelector("#settings-chatgpt-codex-callback-note"),
      model: document.querySelector("#settings-chatgpt-codex-model"),
      save: document.querySelector("#settings-chatgpt-codex-save"),
      test: document.querySelector("#settings-chatgpt-codex-test"),
      disconnect: document.querySelector("#settings-chatgpt-codex-disconnect"),
      status: document.querySelector("#settings-chatgpt-codex-status")
    },
    githubCopilot: {
      badge: document.querySelector("#settings-github-copilot-badge"),
      register: document.querySelector("#settings-github-copilot-register"),
      hostedCallbackUrl: document.querySelector("#settings-github-copilot-hosted-callback-url"),
      callbackUrl: document.querySelector("#settings-github-copilot-callback-url"),
      callbackNote: document.querySelector("#settings-github-copilot-callback-note"),
      token: document.querySelector("#settings-github-copilot-token"),
      save: document.querySelector("#settings-github-copilot-save"),
      test: document.querySelector("#settings-github-copilot-test"),
      disconnect: document.querySelector("#settings-github-copilot-disconnect"),
      status: document.querySelector("#settings-github-copilot-status")
    }
  }
}

function getProviderKey(provider) {
  if (provider === "chatgpt-codex") return "chatgptCodex"
  if (provider === "github-copilot") return "githubCopilot"
  return "openai"
}

function getProviderElements(elements, provider) {
  return elements[getProviderKey(provider)]
}

function getProviderSettings(accountSettings, provider) {
  return accountSettings?.providers?.[getProviderKey(provider)] ?? {}
}

export function createProviderSettingsController({
  apiFetch,
  desktopBridge,
  openExternalUrl,
  updateScanActionButtons,
  escapeHtml,
  formatDate,
  getToneCardClass,
  getVerificationToneClass,
  onAccountSettingsChange
}) {
  const elements = queryProviderSettingsElements()
  let accountSettings = null

  function setAccountSettings(nextAccountSettings) {
    accountSettings = nextAccountSettings
    onAccountSettingsChange?.(nextAccountSettings)
  }

  function renderInlineAccountActionStatus(targetEl, message, tone = "ok") {
    if (!targetEl) return
    targetEl.innerHTML = `
      <article class="validation-card ${getToneCardClass(tone)}">
        <strong class="${tone === "error" ? "validation-error" : tone === "warning" ? "validation-warning" : ""}">
          ${escapeHtml(message)}
        </strong>
      </article>
    `
  }

  function renderAccountBadge(targetEl, providerSettings) {
    if (!targetEl) return

    if (providerSettings?.scanReady) {
      targetEl.className = "pill status-active"
      targetEl.textContent = "Connected"
      return
    }

    if (providerSettings?.state === "needs-attention") {
      targetEl.className = "pill status-blocked"
      targetEl.textContent = "Needs Attention"
      return
    }

    if (providerSettings?.state === "saved") {
      targetEl.className = "pill status-ready"
      targetEl.textContent = "Saved"
      return
    }

    if (providerSettings?.state === "oauth-pending") {
      targetEl.className = "pill status-progress"
      targetEl.textContent = "Progress"
      return
    }

    if (providerSettings?.state === "oauth-failed") {
      targetEl.className = "pill status-blocked"
      targetEl.textContent = "OAuth Failed"
      return
    }

    targetEl.className = "pill status-backlog"
    targetEl.textContent = "Disconnected"
  }

  function buildAccountStatusMarkup(providerLabel, providerSettings, disconnectedCopy) {
    const connected = providerSettings?.connected ?? false
    const lastVerification = providerSettings?.lastVerification ?? null

    if (providerSettings?.state === "oauth-pending") {
      return `
        <article class="validation-card ${getToneCardClass("warning")}">
          <strong>${escapeHtml(`${providerLabel} authorization pending`)}</strong>
          <p class="muted">Finish the browser authorization flow to store the local account receipt for this provider.</p>
        </article>
      `
    }

    if (providerSettings?.state === "oauth-failed") {
      return `
        <article class="validation-card ${getToneCardClass("error")}">
          <strong>${escapeHtml(`${providerLabel} authorization failed`)}</strong>
          <p class="muted">${escapeHtml(providerSettings.blockedReason || "Restart the hosted OAuth flow and complete the local handoff to reconnect this provider.")}</p>
        </article>
      `
    }

    if (!connected) {
      return `
        <article class="validation-card">
          <strong>${escapeHtml(`${providerLabel} is not connected`)}</strong>
          <p class="muted">${escapeHtml(disconnectedCopy)}</p>
        </article>
      `
    }

    const metadata = [
      providerSettings.accountLabel ? `Saved as ${providerSettings.accountLabel}.` : "",
      providerSettings.secretPreview ? `Stored secret: ${providerSettings.secretPreview}.` : "",
      providerSettings.accountLogin ? `GitHub account: ${providerSettings.accountLogin}.` : "",
      providerSettings.accountEmail ? `Account email: ${providerSettings.accountEmail}.` : "",
      providerSettings.defaultModel ? `Default model: ${providerSettings.defaultModel}.` : "",
      providerSettings.tokenType ? `Token type: ${providerSettings.tokenType.replaceAll("_", " ")}.` : ""
    ]
      .filter(Boolean)
      .join(" ")

    if (!lastVerification) {
      return `
        <article class="validation-card">
          <strong>${escapeHtml(`${providerLabel} credentials saved`)}</strong>
          <p class="muted">${escapeHtml(`${metadata} Run Save + Test to verify the connection.`)}</p>
        </article>
      `
    }

    const checkedAt = formatDate(lastVerification.checkedAt || providerSettings.lastVerifiedAt)
    return `
      <article class="validation-card ${getToneCardClass(lastVerification.tone || (lastVerification.ok ? "ok" : ""))}">
        <strong class="${escapeHtml(getVerificationToneClass(lastVerification))}">${escapeHtml(lastVerification.message)}</strong>
        <p class="muted">${escapeHtml([lastVerification.detail, metadata].filter(Boolean).join(" "))}</p>
        ${checkedAt ? `<p class="muted">Last checked ${escapeHtml(checkedAt)}</p>` : ""}
      </article>
    `
  }

  function buildGitHubOAuthCallbackNote(oauthSettings) {
    if (!oauthSettings?.available || !oauthSettings.callbackUrl) {
      return "Start the local runtime for desktop handoff, and register the hosted URL in your GitHub OAuth app settings."
    }

    const lastCallback = oauthSettings.lastCallback
    if (!lastCallback) {
      return "Register the hosted URL in your GitHub OAuth app. After GitHub returns there, continue into the local browser app or desktop app to store the masked callback receipt."
    }

    const parts = [
      lastCallback.message || "",
      lastCallback.codePreview ? `Code ${lastCallback.codePreview}.` : "",
      lastCallback.statePreview ? `State ${lastCallback.statePreview}.` : "",
      lastCallback.receivedAt ? `Received ${formatDate(lastCallback.receivedAt)}.` : ""
    ].filter(Boolean)

    return parts.join(" ")
  }

  function buildOpenAiOAuthCallbackNote(oauthSettings) {
    if (!oauthSettings?.available || !oauthSettings.callbackUrl) {
      return "Start TreeMA Desktop to expose the local desktop callback URL. Hosted OAuth still completes on treesma.com."
    }

    const lastCallback = oauthSettings.lastCallback
    if (!lastCallback) {
      return "Hosted OpenAI OAuth completes on treesma.com/auth/openai/callback, then hands control into app.treesma.com or back into TreeMA Desktop."
    }

    const parts = [
      lastCallback.message || "",
      lastCallback.codePreview ? `Code ${lastCallback.codePreview}.` : "",
      lastCallback.statePreview ? `State ${lastCallback.statePreview}.` : "",
      lastCallback.receivedAt ? `Received ${formatDate(lastCallback.receivedAt)}.` : ""
    ].filter(Boolean)

    return parts.join(" ")
  }

  function getGitHubWebAppOrigin() {
    return accountSettings?.providers?.githubCopilot?.oauth?.webAppOrigin || DEFAULT_WEB_APP_ORIGIN
  }

  function buildHostedWebAppUrl(pathname) {
    return new URL(pathname, `${getGitHubWebAppOrigin()}/`).toString()
  }

  async function startGitHubOAuthConnection() {
    if (!desktopBridge?.startGitHubOAuthFlow) {
      await openExternalUrl(buildHostedWebAppUrl(WEB_APP_ACCOUNTS_PATH))
      renderInlineAccountActionStatus(
        elements.githubCopilot.status,
        "Opened app.treesma.com account settings. Continue the hosted GitHub connection flow there."
      )
      return
    }

    const started = await desktopBridge.startGitHubOAuthFlow({
      returnPath: WEB_APP_ACCOUNTS_PATH
    })
    await openExternalUrl(started.authorizeUrl)
    renderInlineAccountActionStatus(
      elements.githubCopilot.status,
      "Opened GitHub OAuth in your browser. After authorization, treesma.com will hand the result back through the treesma:// desktop link."
    )
  }

  async function startChatGptCodexOAuthConnection() {
    if (!desktopBridge?.startOpenAiOAuthFlow) {
      const started = await apiFetch("/api/settings/accounts/chatgpt-codex/oauth/start", {
        method: "POST",
        body: JSON.stringify({
          target: "web",
          returnPath: WEB_APP_ACCOUNTS_PATH
        })
      })
      await openExternalUrl(started.authorizeUrl)
      renderInlineAccountActionStatus(
        elements.chatgptCodex.status,
        "Opened ChatGPT Codex OAuth in your browser. After authorization, app.treesma.com will hand the token set back to the local TreeMA runtime."
      )
      return
    }

    const started = await desktopBridge.startOpenAiOAuthFlow({
      returnPath: WEB_APP_ACCOUNTS_PATH
    })
    await openExternalUrl(started.authorizeUrl)
    renderInlineAccountActionStatus(
      elements.chatgptCodex.status,
      "Opened ChatGPT Codex OAuth in your browser. After authorization, treesma.com will hand the result back through TreeMA Desktop."
    )
  }

  function syncAccountSettingsControls() {
    if (!accountSettings) {
      if (elements.accountStorage) {
        elements.accountStorage.textContent = "Loading local account settings..."
      }
      if (elements.openai.status) elements.openai.status.innerHTML = ""
      if (elements.chatgptCodex.status) elements.chatgptCodex.status.innerHTML = ""
      if (elements.githubCopilot.status) elements.githubCopilot.status.innerHTML = ""
      updateScanActionButtons()
      return
    }

    const openai = accountSettings.providers?.openai ?? {}
    const chatgptCodex = accountSettings.providers?.chatgptCodex ?? {}
    const githubCopilot = accountSettings.providers?.githubCopilot ?? {}
    const defaultAnalysisProvider = accountSettings.defaultAnalysisProvider || "auto"
    const openaiOAuth = chatgptCodex.oauth ?? {}
    const githubOAuth = githubCopilot.oauth ?? {}

    if (elements.accountStorage) {
      elements.accountStorage.textContent = `Stored outside the workspace at ${accountSettings.storagePath}`
    }
    if (elements.defaultAnalysisProvider) {
      elements.defaultAnalysisProvider.value = defaultAnalysisProvider
    }

    elements.openai.baseUrl.value = openai.baseUrl || "https://api.openai.com/v1"
    elements.openai.model.value = openai.defaultModel || "gpt-5.4-mini"
    elements.openai.apiKey.value = ""
    elements.openai.apiKey.placeholder = openai.connected
      ? `Stored key ${openai.secretPreview}. Leave blank to keep it.`
      : "sk-..."
    elements.openai.disconnect.disabled = !openai.connected
    renderAccountBadge(elements.openai.badge, openai)
    elements.openai.status.innerHTML = buildAccountStatusMarkup(
      "OpenAI",
      openai,
      "Start with ChatGPT Plus/Pro login, then save an API key here only when direct OpenAI API access is needed."
    )
    if (openai.blockedReason) {
      renderInlineAccountActionStatus(elements.openai.status, openai.blockedReason, openai.connected ? "warning" : "default")
    }

    elements.chatgptCodex.hostedCallbackUrl.value = openaiOAuth.hostedCallbackUrl || ""
    elements.chatgptCodex.callbackUrl.value = openaiOAuth.callbackUrl || ""
    elements.chatgptCodex.callbackUrl.placeholder = openaiOAuth.available
      ? openaiOAuth.callbackUrl
      : "Start TreeMA Desktop to expose a local callback URL."
    elements.chatgptCodex.callbackNote.textContent = buildOpenAiOAuthCallbackNote(openaiOAuth)
    elements.chatgptCodex.model.value = chatgptCodex.defaultModel || "gpt-5.3-codex"
    elements.chatgptCodex.disconnect.disabled = !chatgptCodex.connected
    renderAccountBadge(elements.chatgptCodex.badge, chatgptCodex)
    elements.chatgptCodex.status.innerHTML = buildAccountStatusMarkup(
      "ChatGPT Codex OAuth",
      chatgptCodex,
      "Use the hosted OAuth flow for this experimental personal-use provider. Tokens stay outside `.treema` and support Project Scan only."
    )
    if (chatgptCodex.blockedReason) {
      renderInlineAccountActionStatus(elements.chatgptCodex.status, chatgptCodex.blockedReason, chatgptCodex.scanReady ? "ok" : chatgptCodex.connected ? "warning" : "default")
    }

    elements.githubCopilot.token.value = ""
    elements.githubCopilot.hostedCallbackUrl.value = githubOAuth.hostedCallbackUrl || ""
    elements.githubCopilot.callbackUrl.value = githubOAuth.callbackUrl || ""
    elements.githubCopilot.callbackUrl.placeholder = githubOAuth.available
      ? githubOAuth.callbackUrl
      : "Start the local app runtime to expose a callback URL."
    elements.githubCopilot.callbackNote.textContent = buildGitHubOAuthCallbackNote(githubOAuth)
    elements.githubCopilot.token.placeholder = githubCopilot.connected
      ? `Stored token ${githubCopilot.secretPreview}. Leave blank to keep it.`
      : "gho_, ghu_, or github_pat_"
    elements.githubCopilot.disconnect.disabled = !githubCopilot.connected
    renderAccountBadge(elements.githubCopilot.badge, githubCopilot)
    elements.githubCopilot.status.innerHTML = buildAccountStatusMarkup(
      "GitHub Copilot",
      githubCopilot,
      "Start from the GitHub Copilot browser setup flow, then save a supported GitHub user token only when this app needs direct verification."
    )
    if (githubCopilot.blockedReason) {
      renderInlineAccountActionStatus(elements.githubCopilot.status, githubCopilot.blockedReason, githubCopilot.connected ? "warning" : "default")
    }
    updateScanActionButtons()
  }

  function setProviderActionBusy(provider, busy) {
    const providerElements = getProviderElements(elements, provider)
    const providerSettings = getProviderSettings(accountSettings, provider)
    const controls = [providerElements.save, providerElements.test, providerElements.disconnect]

    controls.forEach((control) => {
      control.disabled = busy
    })
    providerElements.disconnect.disabled = busy || !providerSettings.connected

    if (provider === "openai") {
      providerElements.login.disabled = busy
    } else if (provider === "chatgpt-codex") {
      providerElements.connect.disabled = busy
    } else {
      providerElements.register.disabled = busy
    }
  }

  function getOpenAiFormPayload() {
    return {
      apiKey: elements.openai.apiKey.value.trim(),
      baseUrl: elements.openai.baseUrl.value.trim(),
      defaultModel: elements.openai.model.value.trim()
    }
  }

  function getGitHubCopilotFormPayload() {
    return {
      githubToken: elements.githubCopilot.token.value.trim()
    }
  }

  function getChatGptCodexFormPayload() {
    return {
      defaultModel: elements.chatgptCodex.model.value.trim()
    }
  }

  async function refreshAccountSettings() {
    try {
      setAccountSettings(await apiFetch("/api/settings/accounts"))
      syncAccountSettingsControls()
      return accountSettings
    } catch (error) {
      if (elements.accountStorage) {
        elements.accountStorage.textContent = error.message
      }
      renderInlineAccountActionStatus(elements.openai.status, "Failed to load account settings.", "error")
      renderInlineAccountActionStatus(elements.chatgptCodex.status, "Failed to load account settings.", "error")
      renderInlineAccountActionStatus(elements.githubCopilot.status, "Failed to load account settings.", "error")
      return null
    }
  }

  async function runAccountProviderAction(provider, action) {
    const providerElements = getProviderElements(elements, provider)
    const pathname =
      action === "save"
        ? `/api/settings/accounts/${provider}`
        : action === "test"
          ? `/api/settings/accounts/${provider}/test`
          : "/api/settings/accounts/disconnect"
    const payload =
      action === "disconnect"
        ? { provider }
        : provider === "openai"
          ? getOpenAiFormPayload()
          : provider === "chatgpt-codex"
            ? getChatGptCodexFormPayload()
            : getGitHubCopilotFormPayload()
    const pendingMessage =
      action === "save" ? "Saving account settings..." : action === "test" ? "Saving and testing..." : "Disconnecting..."

    setProviderActionBusy(provider, true)
    renderInlineAccountActionStatus(providerElements.status, pendingMessage)

    try {
      await apiFetch(pathname, {
        method: "POST",
        body: JSON.stringify(payload)
      })
      await refreshAccountSettings()
    } catch (error) {
      renderInlineAccountActionStatus(providerElements.status, error.message, "error")
    } finally {
      setProviderActionBusy(provider, false)
    }
  }

  function bindEvents() {
    elements.defaultAnalysisProvider?.addEventListener("change", async () => {
      try {
        await apiFetch("/api/settings/accounts/preferences", {
          method: "POST",
          body: JSON.stringify({
            defaultAnalysisProvider: elements.defaultAnalysisProvider.value
          })
        })
        await refreshAccountSettings()
      } catch (error) {
        if (elements.accountStorage) {
          elements.accountStorage.textContent = error.message
        }
      }
    })

    elements.openai.login?.addEventListener("click", async () => {
      try {
        await openExternalUrl(OPENAI_LOGIN_URL)
        renderInlineAccountActionStatus(
          elements.openai.status,
          "Opened OpenAI login in your browser. After login, create or paste an API key below if direct API access is needed."
        )
      } catch (error) {
        renderInlineAccountActionStatus(elements.openai.status, error.message, "error")
      }
    })

    elements.openai.save?.addEventListener("click", async () => {
      await runAccountProviderAction("openai", "save")
    })

    elements.openai.test?.addEventListener("click", async () => {
      await runAccountProviderAction("openai", "test")
    })

    elements.openai.disconnect?.addEventListener("click", async () => {
      await runAccountProviderAction("openai", "disconnect")
    })

    elements.chatgptCodex.connect?.addEventListener("click", async () => {
      try {
        await startChatGptCodexOAuthConnection()
      } catch (error) {
        renderInlineAccountActionStatus(elements.chatgptCodex.status, error.message, "error")
      }
    })

    elements.chatgptCodex.save?.addEventListener("click", async () => {
      await runAccountProviderAction("chatgpt-codex", "save")
    })

    elements.chatgptCodex.test?.addEventListener("click", async () => {
      await runAccountProviderAction("chatgpt-codex", "test")
    })

    elements.chatgptCodex.disconnect?.addEventListener("click", async () => {
      await runAccountProviderAction("chatgpt-codex", "disconnect")
    })

    elements.githubCopilot.register?.addEventListener("click", async () => {
      try {
        await startGitHubOAuthConnection()
      } catch (error) {
        renderInlineAccountActionStatus(elements.githubCopilot.status, error.message, "error")
      }
    })

    elements.githubCopilot.save?.addEventListener("click", async () => {
      await runAccountProviderAction("github-copilot", "save")
    })

    elements.githubCopilot.test?.addEventListener("click", async () => {
      await runAccountProviderAction("github-copilot", "test")
    })

    elements.githubCopilot.disconnect?.addEventListener("click", async () => {
      await runAccountProviderAction("github-copilot", "disconnect")
    })
  }

  function handleOAuthComplete(payload = {}) {
    const providerStatusEl =
      payload.provider === "chatgpt-codex"
        ? elements.chatgptCodex.status
        : payload.provider === "github-copilot"
          ? elements.githubCopilot.status
          : elements.openai.status

    renderInlineAccountActionStatus(
      providerStatusEl,
      payload.completion?.message || "OAuth returned to the desktop app.",
      payload.completion?.ok ? "ok" : "error"
    )
  }

  return {
    bindEvents,
    handleOAuthComplete,
    refreshAccountSettings,
    syncAccountSettingsControls
  }
}
