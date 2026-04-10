import process from "node:process";
import path from "node:path";
import { analyzeProject, persistProjectAnalysis } from "./lib/project-analysis.mjs";
import { exists, initWorkspace, parseOptions, snapshotWorkspace } from "./lib/treema-workspace.mjs";
import { SCAN_MODES } from "./lib/analysis/contracts.mjs";

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function printHelp() {
  console.log(`Treema CLI

Usage:
  node scripts/treema.mjs init <target-dir> [project-name]
  node scripts/treema.mjs snapshot <target-dir> --summary "..." [--focus "..."] [--next "..."] [--risk "..."]
  node scripts/treema.mjs analyze <target-dir> [--mode project|quick] [--quick]
`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "init") {
    const [targetDir, projectName] = rest;
    if (!targetDir) {
      fail("init requires <target-dir>");
      return;
    }
    const result = await initWorkspace(targetDir, projectName);
    console.log(`Initialized Treema workspace in ${result.treemaDir}`);
    return;
  }

  if (command === "snapshot") {
    const options = parseOptions(rest);
    const [targetDir] = options._;
    if (!targetDir) {
      fail("snapshot requires <target-dir>");
      return;
    }
    const result = await snapshotWorkspace(targetDir, options);
    console.log(`Updated Treema snapshot in ${result.treemaDir}`);
    return;
  }

  if (command === "analyze") {
    const options = parseOptions(rest);
    const [targetDir] = options._;
    if (!targetDir) {
      fail("analyze requires <target-dir>");
      return;
    }
    const mode = options.quick ? SCAN_MODES.QUICK : options.mode === SCAN_MODES.QUICK ? SCAN_MODES.QUICK : SCAN_MODES.PROJECT;
    const analysis = await analyzeProject(targetDir, { mode });
    console.log(`${mode === SCAN_MODES.QUICK ? "Quick Scan" : "Project Scan"} completed for ${analysis.projectRoot}`);
    console.log(`Gate status: ${analysis.rootManifest.gate.status}`);
    if (await exists(path.join(analysis.projectRoot, ".treema"))) {
      const result = await persistProjectAnalysis(analysis.projectRoot, analysis);
      console.log(`Saved manifest: ${result.manifestPath}`);
      console.log(
        `Execution artifacts: ${analysis.rootManifest.gate.executionArtifactsEmitted ? "emitted" : "suppressed"}`
      );
    } else {
      console.log("No .treema workspace found. Analysis was generated in memory only.");
    }
    return;
  }

  fail(`Unknown command: ${command}`);
  printHelp();
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
