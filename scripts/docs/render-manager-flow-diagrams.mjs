#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

const srcDir = path.join(repoRoot, "docs", "manager-flows", "src");
const outDir = path.join(repoRoot, "docs", "manager-flows", "generated");
const mermaidConfigPath = path.join(repoRoot, "docs", "manager-flows", "mermaid.config.json");
const puppeteerConfigPath = path.join(repoRoot, "docs", "manager-flows", "puppeteer.config.json");

function runCommand(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

async function listMermaidSources() {
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mmd"))
    .map((entry) => entry.name)
    .sort();
}

async function ensureOutputDir() {
  await fs.mkdir(outDir, { recursive: true });
}

async function renderFile(fileName) {
  const inputPath = path.join(srcDir, fileName);
  const outputPath = path.join(outDir, fileName.replace(/\.mmd$/u, ".svg"));

  const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const args = [
    "mmdc",
    "-i",
    inputPath,
    "-o",
    outputPath,
    "-c",
    mermaidConfigPath,
    "-p",
    puppeteerConfigPath,
    "--backgroundColor",
    "transparent",
    "--scale",
    "2",
  ];

  await runCommand(npxCmd, args, repoRoot);
  return outputPath;
}

async function main() {
  await ensureOutputDir();

  const files = await listMermaidSources();
  if (!files.length) {
    console.log("No Mermaid source files found.");
    return;
  }

  const rendered = [];
  for (const fileName of files) {
    console.log(`Rendering ${fileName} ...`);
    const outPath = await renderFile(fileName);
    rendered.push(path.relative(repoRoot, outPath));
  }

  console.log("\nRendered manager flow diagrams:");
  rendered.forEach((filePath) => console.log(`- ${filePath}`));
}

main().catch((error) => {
  console.error("Failed to render manager flow diagrams:", error?.message || error);
  process.exit(1);
});
