#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { optimize } from "svgo";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const diagramsDir = path.join(repoRoot, "docs", "manager-flows", "generated");

async function listSvgFiles() {
  let entries = [];
  try {
    entries = await fs.readdir(diagramsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".svg"))
    .map((entry) => path.join(diagramsDir, entry.name))
    .sort();
}

function optimizeSvg(svgContent, svgPath) {
  return optimize(svgContent, {
    path: svgPath,
    multipass: true,
    plugins: [
      { name: "preset-default" },
      "sortAttrs",
      "removeDimensions",
    ],
  });
}

async function main() {
  const files = await listSvgFiles();
  if (!files.length) {
    console.log("No generated SVG files found to optimize.");
    return;
  }

  for (const svgPath of files) {
    const before = await fs.readFile(svgPath, "utf8");
    const result = optimizeSvg(before, svgPath);
    await fs.writeFile(svgPath, result.data, "utf8");

    const afterSize = Buffer.byteLength(result.data, "utf8");
    const beforeSize = Buffer.byteLength(before, "utf8");
    const delta = beforeSize - afterSize;
    const rel = path.relative(repoRoot, svgPath);

    console.log(`${rel}: ${beforeSize} -> ${afterSize} bytes (${delta >= 0 ? "-" : "+"}${Math.abs(delta)})`);
  }
}

main().catch((error) => {
  console.error("Failed to optimize generated SVG files:", error?.message || error);
  process.exit(1);
});
