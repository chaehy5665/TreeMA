import { readFile } from "node:fs/promises";
import process from "node:process";

import { validateState } from "../src/lib/validate-state.js";

async function main() {
  const targetPath = process.argv[2];

  if (!targetPath) {
    console.error("Usage: node scripts/validate-state.mjs <path-to-state.json>");
    process.exitCode = 1;
    return;
  }

  const raw = await readFile(targetPath, "utf8");
  const state = JSON.parse(raw);
  const result = validateState(state);

  if (result.valid) {
    console.log(`Valid state: ${targetPath}`);
    return;
  }

  console.error(`Invalid state: ${targetPath}`);
  for (const error of result.errors) {
    console.error(`- ${error.path}: ${error.message}`);
  }
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
