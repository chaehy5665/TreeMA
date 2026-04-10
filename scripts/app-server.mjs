import { createReadStream } from "node:fs";
import { execFile } from "node:child_process";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { analyzeProject, persistProjectAnalysis } from "./lib/project-analysis.mjs";
import {
  disconnectAccountSettings,
  loadAccountSettings,
  saveAccountSettings,
  testAccountSettings
} from "./lib/account-settings.mjs";
import { exists, initWorkspace, loadWorkspace, snapshotWorkspace } from "./lib/treema-workspace.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 4173);
const execFileAsync = promisify(execFile);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function safePathname(pathname) {
  const relative = pathname === "/" ? "/index.html" : pathname;
  const resolved = path.resolve(rootDir, `.${relative}`);
  if (!resolved.startsWith(rootDir)) {
    return null;
  }
  return resolved;
}

function isCanceledSelection(error) {
  const message = String(error?.stderr || error?.message || "");
  return message.includes("User canceled") || message.includes("user canceled");
}

async function selectDirectoryWithDialog() {
  if (process.platform === "darwin") {
    try {
      const { stdout } = await execFileAsync("osascript", [
        "-e",
        'tell application "System Events"',
        "-e",
        "activate",
        "-e",
        'POSIX path of (choose folder with prompt "Select a project folder for Treema")',
        "-e",
        "end tell"
      ]);
      return stdout.trim();
    } catch (error) {
      if (isCanceledSelection(error)) {
        return "";
      }
      throw new Error("Failed to open the macOS folder picker.");
    }
  }

  if (process.platform === "win32") {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms;
      $dialog = New-Object System.Windows.Forms.FolderBrowserDialog;
      $dialog.Description = 'Select a project folder for Treema';
      $dialog.UseDescriptionForTitle = $true;
      if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        Write-Output $dialog.SelectedPath
      }
    `;
    try {
      const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-Command", script]);
      return stdout.trim();
    } catch {
      throw new Error("Failed to open the Windows folder picker.");
    }
  }

  if (process.platform === "linux") {
    try {
      const { stdout } = await execFileAsync("zenity", [
        "--file-selection",
        "--directory",
        "--title=Select a project folder for Treema"
      ]);
      return stdout.trim();
    } catch (error) {
      if (isCanceledSelection(error) || error?.code === 1) {
        return "";
      }
    }

    try {
      const { stdout } = await execFileAsync("kdialog", [
        "--getexistingdirectory",
        ".",
        "--title",
        "Select a project folder for Treema"
      ]);
      return stdout.trim();
    } catch (error) {
      if (error?.code === 1) {
        return "";
      }
      throw new Error("Failed to open the Linux folder picker. Install zenity or kdialog.");
    }
  }

  throw new Error(`Folder picker is not supported on this platform: ${process.platform}`);
}

async function serveStatic(request, response, pathname) {
  const filePath = safePathname(pathname);
  if (!filePath) {
    sendJson(response, 403, { error: "Forbidden path" });
    return;
  }

  try {
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": contentType });
    createReadStream(filePath).pipe(response);
  } catch {
    sendJson(response, 404, { error: "Not found" });
  }
}

async function handleApi(request, response, url) {
  try {
    if (request.method === "GET" && url.pathname === "/api/settings/accounts") {
      const settings = await loadAccountSettings();
      sendJson(response, 200, settings);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/workspace") {
      const projectPath = url.searchParams.get("projectPath");
      if (!projectPath) {
        sendJson(response, 400, { error: "projectPath is required" });
        return;
      }
      const workspace = await loadWorkspace(projectPath);
      sendJson(response, 200, workspace);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/system/select-directory") {
      const projectPath = await selectDirectoryWithDialog();
      sendJson(response, 200, { projectPath });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/settings/accounts/openai") {
      const body = await readBody(request);
      const settings = await saveAccountSettings("openai", body);
      sendJson(response, 200, settings);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/settings/accounts/openai/test") {
      const body = await readBody(request);
      const settings = await testAccountSettings("openai", body);
      sendJson(response, 200, settings);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/settings/accounts/github-copilot") {
      const body = await readBody(request);
      const settings = await saveAccountSettings("github-copilot", body);
      sendJson(response, 200, settings);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/settings/accounts/github-copilot/test") {
      const body = await readBody(request);
      const settings = await testAccountSettings("github-copilot", body);
      sendJson(response, 200, settings);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/settings/accounts/disconnect") {
      const body = await readBody(request);
      if (!body.provider) {
        sendJson(response, 400, { error: "provider is required" });
        return;
      }
      const settings = await disconnectAccountSettings(body.provider);
      sendJson(response, 200, settings);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/workspace/init") {
      const body = await readBody(request);
      if (!body.projectPath) {
        sendJson(response, 400, { error: "projectPath is required" });
        return;
      }
      const result = await initWorkspace(body.projectPath, body.projectName);
      const workspace = await loadWorkspace(result.projectRoot);
      sendJson(response, 200, workspace);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/workspace/snapshot") {
      const body = await readBody(request);
      if (!body.projectPath || !body.summary) {
        sendJson(response, 400, { error: "projectPath and summary are required" });
        return;
      }
      await snapshotWorkspace(body.projectPath, {
        summary: body.summary,
        focus: body.focus ?? [],
        next: body.next ?? [],
        risk: body.risks ?? []
      });
      const workspace = await loadWorkspace(body.projectPath);
      sendJson(response, 200, workspace);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/project/analyze") {
      const body = await readBody(request);
      if (!body.projectPath) {
        sendJson(response, 400, { error: "projectPath is required" });
        return;
      }

      const analysis = await analyzeProject(body.projectPath, {
        mode: body.mode
      });
      let saved = null;

      if (await exists(path.join(analysis.projectRoot, ".treema"))) {
        try {
          saved = await persistProjectAnalysis(analysis.projectRoot, analysis);
        } catch {
          saved = null;
        }
      }

      sendJson(response, 200, { analysis, saved });
      return;
    }

    sendJson(response, 404, { error: "API route not found" });
  } catch (error) {
    const statusCode = error?.code === "PROJECT_SCAN_UNAVAILABLE" ? 400 : 500;
    sendJson(response, statusCode, {
      error: error.message,
      code: error?.code || "SERVER_ERROR",
      details: error?.details || null
    });
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || `127.0.0.1:${port}`}`);
  if (url.pathname.startsWith("/api/")) {
    await handleApi(request, response, url);
    return;
  }

  await serveStatic(request, response, url.pathname);
});

server.listen(port, () => {
  console.log(`Treema server running at http://127.0.0.1:${port}`);
});
