import { createHash } from "node:crypto";
import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const WORKSPACE_ROOT = process.cwd();
const APP_ROOT = path.join(WORKSPACE_ROOT, "app");
const NEXT_CONFIG_PATH = path.join(WORKSPACE_ROOT, "next.config.js");

const RUNTIME_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx", ".css"]);
const CODE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const TEST_FILE_RE = /\.(?:test|spec)\.[^.]+$/i;
const POSIX_SEP_RE = /\\/g;
const MAX_NODE_SOURCE_REFS = 10;
const MAX_EDGE_VARIABLES = 8;
const MAX_EDGE_REFS = 6;
const MAX_QUERY_TERMS = 12;
const MAX_QUERY_EVIDENCE = 10;
const MAX_QUERY_LINES = 10;
const MAX_LINE_LENGTH = 220;

const AUTH_ROLE_RULES = [
  {
    role: "Admin",
    patterns: [
      /\bisAdmin\b/g,
      /\bapp_admins\b/g,
      /administrator/gi,
      /admin dashboard/gi,
      /must be logged in as an administrator/gi,
      /Unauthorized/gi,
    ],
  },
  {
    role: "Manager",
    patterns: [
      /\bmanager\b/gi,
      /\brestaurant_managers\b/g,
      /manager dashboard/gi,
      /invite link/gi,
    ],
  },
  {
    role: "Authenticated user",
    patterns: [
      /\bgetSession\b/g,
      /\bgetUser\b/g,
      /\bsigned in\b/gi,
      /\bauth session\b/gi,
      /\bsession\b/gi,
      /\blogged in\b/gi,
    ],
  },
  {
    role: "Diner",
    patterns: [
      /\bdiner\b/gi,
      /\bguest\b/gi,
      /\bfavorites\b/gi,
      /\bmy dishes\b/gi,
      /\border feedback\b/gi,
    ],
  },
  {
    role: "Server staff",
    patterns: [
      /\bserver tablet\b/gi,
      /\bserver station\b/gi,
      /\bserver-tabs\b/g,
    ],
  },
  {
    role: "Kitchen staff",
    patterns: [
      /\bkitchen tablet\b/gi,
      /\bkitchen line\b/gi,
      /\bkitchen monitor\b/gi,
    ],
  },
];

const STOP_WORDS = new Set([
  "a",
  "about",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "current",
  "does",
  "file",
  "files",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "its",
  "lines",
  "me",
  "of",
  "on",
  "or",
  "question",
  "show",
  "system",
  "that",
  "the",
  "this",
  "to",
  "use",
  "used",
  "uses",
  "using",
  "what",
  "where",
  "which",
  "who",
  "why",
  "with",
]);

const snapshotCache = {
  version: "",
  snapshot: null,
};

function asText(value) {
  return String(value || "").trim();
}

function toPosixPath(value) {
  return asText(value).replace(POSIX_SEP_RE, "/");
}

function toRelativePath(absolutePath) {
  return toPosixPath(path.relative(WORKSPACE_ROOT, absolutePath));
}

function withoutExtension(filePath) {
  const extension = path.posix.extname(filePath);
  return extension ? filePath.slice(0, -extension.length) : filePath;
}

function humanizeToken(value) {
  return asText(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value) {
  return humanizeToken(value)
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function clampText(value, limit = MAX_LINE_LENGTH) {
  const compact = asText(value).replace(/\s+/g, " ");
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, Math.max(limit - 1, 1)).trimEnd()}…`;
}

function uniqueBy(items, getKey) {
  const seen = new Set();
  const nextItems = [];
  for (const item of items) {
    const key = getKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    nextItems.push(item);
  }
  return nextItems;
}

function fileExistsMaybe(filePath) {
  return access(filePath).then(
    () => true,
    () => false,
  );
}

async function walkRuntimeFiles(directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkRuntimeFiles(absolutePath)));
      continue;
    }
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (!RUNTIME_EXTENSIONS.has(extension)) continue;
    if (TEST_FILE_RE.test(entry.name)) continue;
    results.push(absolutePath);
  }

  return results;
}

async function buildRuntimeManifest() {
  const absolutePaths = await walkRuntimeFiles(APP_ROOT);
  if (await fileExistsMaybe(NEXT_CONFIG_PATH)) {
    absolutePaths.push(NEXT_CONFIG_PATH);
  }
  const items = await Promise.all(
    absolutePaths.map(async (absolutePath) => {
      const stats = await stat(absolutePath);
      return {
        absolutePath,
        relativePath: toRelativePath(absolutePath),
        mtimeMs: Math.round(stats.mtimeMs),
        size: stats.size,
      };
    }),
  );

  items.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  const version = createHash("sha1")
    .update(
      items
        .map((item) => `${item.relativePath}:${item.mtimeMs}:${item.size}`)
        .join("|"),
    )
    .digest("hex")
    .slice(0, 12);

  return { version, items };
}

function inferDirectorySubtype(relativePath, childFiles) {
  if (relativePath === "app") return "workspace";
  if (relativePath === "next.config.js") return "config";
  if (relativePath.startsWith("app/api")) return "api-group";
  if (relativePath.startsWith("app/components")) return "shared-ui";
  if (relativePath.startsWith("app/lib")) return "shared-runtime";
  if (relativePath.startsWith("app/runtime")) return "runtime-support";
  if (childFiles.some((file) => file.relativePath.endsWith("/page.js"))) return "route-surface";
  return "module-group";
}

function inferFileSubtype(relativePath) {
  if (relativePath === "next.config.js") return "config";
  if (relativePath.endsWith("/page.js")) return "route-entry";
  if (relativePath.endsWith("/route.js")) return "api-route";
  if (relativePath.endsWith(".css")) return "style";
  if (/Client\.[jt]sx?$/u.test(relativePath)) return "client";
  if (/use[A-Z].*\.[jt]sx?$/u.test(path.posix.basename(relativePath))) return "hook";
  if (/services?\//u.test(relativePath)) return "service";
  return "module";
}

function inferNodeLabel(relativePath) {
  if (relativePath === "app") return "Clarivore Runtime";
  if (relativePath === "next.config.js") return "Next Config";
  const base = path.posix.basename(relativePath);
  if (base === "page.js") {
    return `${titleCase(path.posix.basename(path.posix.dirname(relativePath)))} Page`;
  }
  if (base === "route.js") {
    return `${titleCase(path.posix.basename(path.posix.dirname(relativePath)))} Route`;
  }
  return titleCase(withoutExtension(base));
}

function buildNodeDescription({ kind, subtype, relativePath, descendantFiles }) {
  if (kind === "workspace") {
    return "Live runtime snapshot of the active Next.js app directory plus Next config.";
  }
  if (kind === "directory") {
    const fileCount = descendantFiles.length;
    if (subtype === "route-surface") {
      return `${inferNodeLabel(relativePath)} route surface with ${fileCount} runtime file${fileCount === 1 ? "" : "s"}.`;
    }
    if (subtype === "api-group") {
      return `${inferNodeLabel(relativePath)} API group with ${fileCount} runtime file${fileCount === 1 ? "" : "s"}.`;
    }
    if (subtype === "shared-ui") {
      return `${inferNodeLabel(relativePath)} shared UI system with ${fileCount} runtime file${fileCount === 1 ? "" : "s"}.`;
    }
    if (subtype === "shared-runtime") {
      return `${inferNodeLabel(relativePath)} shared runtime services with ${fileCount} runtime file${fileCount === 1 ? "" : "s"}.`;
    }
    if (subtype === "runtime-support") {
      return `${inferNodeLabel(relativePath)} browser/runtime helpers with ${fileCount} runtime file${fileCount === 1 ? "" : "s"}.`;
    }
    return `${inferNodeLabel(relativePath)} system with ${fileCount} runtime file${fileCount === 1 ? "" : "s"}.`;
  }
  if (kind === "file") {
    if (subtype === "route-entry") return "Next.js route entry file.";
    if (subtype === "api-route") return "Next.js API route handler.";
    if (subtype === "client") return "Client-side runtime surface.";
    if (subtype === "hook") return "React hook module.";
    if (subtype === "service") return "Service/helper module.";
    if (subtype === "style") return "Runtime stylesheet.";
    if (subtype === "config") return "Next.js runtime configuration.";
    return "Runtime module file.";
  }
  return "Top-level symbol in the current file.";
}

function buildNodeId(kind, relativePath, symbolName = "") {
  if (kind === "workspace") return "workspace:clarivore-runtime";
  if (kind === "directory") return `dir:${relativePath}`;
  if (kind === "file") return `file:${relativePath}`;
  return `symbol:${relativePath}#${symbolName}`;
}

function getScriptKind(absolutePath) {
  const extension = path.extname(absolutePath).toLowerCase();
  if (extension === ".ts") return ts.ScriptKind.TS;
  if (extension === ".tsx") return ts.ScriptKind.TSX;
  if (extension === ".jsx") return ts.ScriptKind.JSX;
  return ts.ScriptKind.JSX;
}

function lineRangeFromNode(sourceFile, node) {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return {
    startLine: start.line + 1,
    endLine: end.line + 1,
  };
}

function createLineExcerpt(text, startLine, endLine, pad = 1) {
  const lines = String(text || "").split(/\r?\n/u);
  const from = Math.max(Number(startLine || 1) - 1 - pad, 0);
  const to = Math.min(Number(endLine || startLine || 1) - 1 + pad, lines.length - 1);
  const excerpt = [];
  for (let index = from; index <= to; index += 1) {
    excerpt.push(`${index + 1}: ${clampText(lines[index] || "")}`);
  }
  return excerpt.join("\n");
}

function printNodeText(sourceFile, node) {
  return clampText(node.getText(sourceFile).replace(/\s+/g, " "));
}

function normalizeVariableName(name, usageKind) {
  if (name) return asText(name);
  if (usageKind === "prop") return "prop";
  if (usageKind === "option") return "option";
  return "argument";
}

function describeVariable(variable, targetLabel) {
  const baseName = humanizeToken(variable.name || variable.value || variable.usageKind);
  if (variable.usageKind === "prop") {
    return `${baseName} is passed into ${targetLabel} as a component prop.`;
  }
  if (variable.usageKind === "option") {
    return `${baseName} is passed into ${targetLabel} inside an options object.`;
  }
  return `${baseName} is passed into ${targetLabel} as a call argument.`;
}

function summarizeJsxAttribute(attribute, sourceFile) {
  const name = asText(attribute?.name?.getText(sourceFile));
  if (!name) return null;
  if (!attribute.initializer) {
    return {
      name,
      value: "true",
      usageKind: "prop",
    };
  }
  if (ts.isStringLiteral(attribute.initializer)) {
    return {
      name,
      value: clampText(attribute.initializer.text),
      usageKind: "prop",
    };
  }
  if (ts.isJsxExpression(attribute.initializer)) {
    return {
      name,
      value: clampText(attribute.initializer.expression?.getText(sourceFile) || ""),
      usageKind: "prop",
    };
  }
  return {
    name,
    value: clampText(attribute.initializer.getText(sourceFile)),
    usageKind: "prop",
  };
}

function summarizeCallArguments(args, sourceFile) {
  const items = [];
  args.forEach((argument, index) => {
    if (ts.isObjectLiteralExpression(argument)) {
      argument.properties.forEach((property) => {
        if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
          return;
        }
        const name = ts.isPropertyAssignment(property)
          ? asText(property.name?.getText(sourceFile))
          : asText(property.name?.getText(sourceFile));
        const value = ts.isPropertyAssignment(property)
          ? clampText(property.initializer?.getText(sourceFile))
          : clampText(property.name?.getText(sourceFile));
        if (!name) return;
        items.push({
          name,
          value,
          usageKind: "option",
        });
      });
      return;
    }
    items.push({
      name: `arg${index + 1}`,
      value: clampText(argument.getText(sourceFile)),
      usageKind: "argument",
    });
  });
  return items;
}

function collectAuthEvidence(text, relativePath) {
  const lines = String(text || "").split(/\r?\n/u);
  const evidence = [];
  AUTH_ROLE_RULES.forEach((rule) => {
    const matchedLines = [];
    lines.forEach((line, index) => {
      if (matchedLines.length >= 4) return;
      const compact = asText(line);
      if (!compact) return;
      if (rule.patterns.some((pattern) => pattern.test(compact))) {
        matchedLines.push({
          role: rule.role,
          reason: compact,
          filePath: relativePath,
          startLine: index + 1,
          endLine: index + 1,
        });
      }
      rule.patterns.forEach((pattern) => {
        pattern.lastIndex = 0;
      });
    });
    evidence.push(...matchedLines);
  });
  return evidence;
}

function collectTopLevelSymbols(sourceFile) {
  const symbols = [];
  sourceFile.statements.forEach((statement) => {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      const name = asText(statement.name.getText(sourceFile));
      const range = lineRangeFromNode(sourceFile, statement);
      symbols.push({
        name,
        label: titleCase(name),
        kind: "function",
        exported: statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
        ...range,
      });
      return;
    }
    if (ts.isClassDeclaration(statement) && statement.name) {
      const name = asText(statement.name.getText(sourceFile));
      const range = lineRangeFromNode(sourceFile, statement);
      symbols.push({
        name,
        label: titleCase(name),
        kind: "class",
        exported: statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
        ...range,
      });
      return;
    }
    if (!ts.isVariableStatement(statement)) return;
    const isExported = statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
    statement.declarationList.declarations.forEach((declaration) => {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) return;
      const initializer = declaration.initializer;
      const shouldKeep =
        ts.isArrowFunction(initializer) ||
        ts.isFunctionExpression(initializer) ||
        ts.isObjectLiteralExpression(initializer) ||
        ts.isClassExpression(initializer) ||
        isExported;
      if (!shouldKeep) return;
      const name = asText(declaration.name.getText(sourceFile));
      const range = lineRangeFromNode(sourceFile, declaration);
      symbols.push({
        name,
        label: titleCase(name),
        kind: ts.isObjectLiteralExpression(initializer) ? "object" : "function",
        exported: isExported,
        ...range,
      });
    });
  });
  return symbols;
}

function buildPrimaryFileRefs(fileInfo) {
  const refs = [];
  fileInfo.symbols.slice(0, 5).forEach((symbol) => {
    refs.push({
      filePath: fileInfo.relativePath,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
      label: `${symbol.label} (${symbol.kind})`,
    });
  });
  fileInfo.authEvidence.slice(0, 3).forEach((evidence) => {
    refs.push({
      filePath: evidence.filePath,
      startLine: evidence.startLine,
      endLine: evidence.endLine,
      label: `${evidence.role} access evidence`,
    });
  });
  if (!refs.length) {
    refs.push({
      filePath: fileInfo.relativePath,
      startLine: 1,
      endLine: Math.min(fileInfo.lineCount, 6),
      label: inferNodeLabel(fileInfo.relativePath),
    });
  }
  return uniqueBy(refs, (ref) => `${ref.filePath}:${ref.startLine}:${ref.endLine}:${ref.label}`);
}

function collectJavaScriptMetadata({ absolutePath, relativePath, content }) {
  const sourceFile = ts.createSourceFile(
    relativePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(absolutePath),
  );
  const imports = [];
  const importSpecifiersByLocalName = new Map();
  const symbols = collectTopLevelSymbols(sourceFile);
  const symbolNames = new Set(symbols.map((symbol) => symbol.name));
  const symbolEdges = [];

  sourceFile.statements.forEach((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      return;
    }
    const moduleSource = asText(statement.moduleSpecifier.text);
    const range = lineRangeFromNode(sourceFile, statement);
    const specifiers = [];
    const clause = statement.importClause || null;
    if (clause?.name) {
      const localName = asText(clause.name.getText(sourceFile));
      const specifier = {
        localName,
        importedName: "default",
        kind: "default",
        usages: [],
      };
      specifiers.push(specifier);
      importSpecifiersByLocalName.set(localName, specifier);
    }
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      clause.namedBindings.elements.forEach((element) => {
        const localName = asText(element.name.getText(sourceFile));
        const importedName = asText(element.propertyName?.getText(sourceFile) || localName);
        const specifier = {
          localName,
          importedName,
          kind: "named",
          usages: [],
        };
        specifiers.push(specifier);
        importSpecifiersByLocalName.set(localName, specifier);
      });
    }
    if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      const localName = asText(clause.namedBindings.name.getText(sourceFile));
      const specifier = {
        localName,
        importedName: "*",
        kind: "namespace",
        usages: [],
      };
      specifiers.push(specifier);
      importSpecifiersByLocalName.set(localName, specifier);
    }
    imports.push({
      moduleSource,
      startLine: range.startLine,
      endLine: range.endLine,
      specifiers,
      isExternal: !moduleSource.startsWith("."),
    });
  });

  function visit(node, currentSymbolName = "") {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tagName = asText(node.tagName?.getText(sourceFile));
      if (!currentSymbolName && importSpecifiersByLocalName.has(tagName)) {
        const specifier = importSpecifiersByLocalName.get(tagName);
        const range = lineRangeFromNode(sourceFile, node);
        const variables = (node.attributes?.properties || [])
          .map((attribute) => summarizeJsxAttribute(attribute, sourceFile))
          .filter(Boolean);
        specifier.usages.push({
          usageKind: "component",
          line: range.startLine,
          variables,
        });
      }
      if (currentSymbolName && symbolNames.has(tagName) && tagName !== currentSymbolName) {
        const range = lineRangeFromNode(sourceFile, node);
        symbolEdges.push({
          sourceSymbol: currentSymbolName,
          targetSymbol: tagName,
          line: range.startLine,
          usageKind: "component",
        });
      }
    }

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const calleeName = asText(node.expression.getText(sourceFile));
      if (!currentSymbolName && importSpecifiersByLocalName.has(calleeName)) {
        const specifier = importSpecifiersByLocalName.get(calleeName);
        const range = lineRangeFromNode(sourceFile, node);
        specifier.usages.push({
          usageKind: "call",
          line: range.startLine,
          variables: summarizeCallArguments(node.arguments, sourceFile),
        });
      }
      if (currentSymbolName && symbolNames.has(calleeName) && calleeName !== currentSymbolName) {
        const range = lineRangeFromNode(sourceFile, node);
        symbolEdges.push({
          sourceSymbol: currentSymbolName,
          targetSymbol: calleeName,
          line: range.startLine,
          usageKind: "call",
        });
      }
    }

    ts.forEachChild(node, (child) => visit(child, currentSymbolName));
  }

  visit(sourceFile, "");

  symbols.forEach((symbol) => {
    let declarationNode = null;
    sourceFile.statements.forEach((statement) => {
      if (declarationNode) return;
      if (ts.isFunctionDeclaration(statement) && statement.name?.getText(sourceFile) === symbol.name) {
        declarationNode = statement;
        return;
      }
      if (ts.isClassDeclaration(statement) && statement.name?.getText(sourceFile) === symbol.name) {
        declarationNode = statement;
        return;
      }
      if (!ts.isVariableStatement(statement)) return;
      statement.declarationList.declarations.forEach((declaration) => {
        if (declarationNode) return;
        if (!ts.isIdentifier(declaration.name)) return;
        if (declaration.name.getText(sourceFile) === symbol.name) {
          declarationNode = declaration;
        }
      });
    });
    if (declarationNode) {
      visit(declarationNode, symbol.name);
    }
  });

  return {
    imports,
    symbols,
    symbolEdges: uniqueBy(
      symbolEdges,
      (edge) => `${edge.sourceSymbol}:${edge.targetSymbol}:${edge.line}:${edge.usageKind}`,
    ),
  };
}

async function parseRuntimeFile(manifestItem) {
  const content = await readFile(manifestItem.absolutePath, "utf8");
  const relativePath = manifestItem.relativePath;
  const lineCount = String(content).split(/\r?\n/u).length;
  const fileInfo = {
    id: buildNodeId("file", relativePath),
    absolutePath: manifestItem.absolutePath,
    relativePath,
    label: inferNodeLabel(relativePath),
    kind: "file",
    subtype: inferFileSubtype(relativePath),
    description: "",
    lineCount,
    content,
    imports: [],
    symbols: [],
    symbolEdges: [],
    authEvidence: collectAuthEvidence(content, relativePath),
    primaryRefs: [],
    mtimeMs: manifestItem.mtimeMs,
    size: manifestItem.size,
  };

  if (CODE_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) {
    const metadata = collectJavaScriptMetadata({
      absolutePath: manifestItem.absolutePath,
      relativePath,
      content,
    });
    fileInfo.imports = metadata.imports;
    fileInfo.symbols = metadata.symbols;
    fileInfo.symbolEdges = metadata.symbolEdges;
  }

  fileInfo.primaryRefs = buildPrimaryFileRefs(fileInfo);
  fileInfo.description = buildNodeDescription({
    kind: "file",
    subtype: fileInfo.subtype,
    relativePath,
    descendantFiles: [fileInfo],
  });

  return fileInfo;
}

function resolveLocalImportPath(sourceRelativePath, moduleSource, filePathSet) {
  if (!moduleSource.startsWith(".")) return "";
  const sourceDirectory = path.posix.dirname(sourceRelativePath);
  const rawTarget = toPosixPath(path.posix.normalize(path.posix.join(sourceDirectory, moduleSource)));
  const candidates = [
    rawTarget,
    ...Array.from(RUNTIME_EXTENSIONS).map((extension) => `${rawTarget}${extension}`),
    ...Array.from(RUNTIME_EXTENSIONS).map((extension) => path.posix.join(rawTarget, `index${extension}`)),
  ];
  const resolved = candidates.find((candidate) => filePathSet.has(candidate));
  return resolved || "";
}

function deriveFileEdges(fileInfos) {
  const filePathSet = new Set(fileInfos.map((file) => file.relativePath));
  const edges = [];

  fileInfos.forEach((sourceFile) => {
    sourceFile.imports.forEach((importRow) => {
      const targetPath = resolveLocalImportPath(
        sourceFile.relativePath,
        importRow.moduleSource,
        filePathSet,
      );
      if (!targetPath) return;

      const targetLabel = inferNodeLabel(targetPath);
      const variables = uniqueBy(
        importRow.specifiers
          .flatMap((specifier) =>
            specifier.usages.flatMap((usage) =>
              (usage.variables || []).map((variable) => ({
                ...variable,
                name: normalizeVariableName(variable.name, variable.usageKind),
                line: usage.line,
                targetLabel,
                specifier: specifier.localName,
                description: describeVariable(variable, targetLabel),
              })),
            ),
          )
          .slice(0, MAX_EDGE_VARIABLES),
        (variable) =>
          `${variable.name}:${variable.value}:${variable.usageKind}:${variable.line}:${variable.specifier}`,
      );

      const usageRefs = uniqueBy(
        importRow.specifiers
          .flatMap((specifier) =>
            specifier.usages.map((usage) => ({
              filePath: sourceFile.relativePath,
              startLine: usage.line,
              endLine: usage.line,
              label: `${specifier.localName} ${usage.usageKind}`,
            })),
          )
          .slice(0, MAX_EDGE_REFS),
        (ref) => `${ref.filePath}:${ref.startLine}:${ref.label}`,
      );

      const importedSymbols = importRow.specifiers.map((specifier) => specifier.localName).filter(Boolean);
      const labelTokens = variables.length
        ? variables.slice(0, 3).map((variable) => variable.name)
        : importedSymbols.slice(0, 3);
      const label = labelTokens.length
        ? labelTokens.join(", ")
        : importedSymbols.length
          ? importedSymbols.join(", ")
          : "runtime import";

      edges.push({
        sourceFilePath: sourceFile.relativePath,
        targetFilePath: targetPath,
        importedSymbols,
        variables,
        refs: usageRefs,
        weight: Math.max(importedSymbols.length + variables.length, 1),
        label: clampText(label, 48),
      });
    });
  });

  return edges;
}

function ensureDirectoryNode(treeNodes, childIdsByParent, relativePath) {
  if (treeNodes.has(relativePath)) return treeNodes.get(relativePath);
  if (relativePath === "app") {
    const node = {
      id: buildNodeId("workspace", relativePath),
      relativePath,
      label: inferNodeLabel(relativePath),
      kind: "workspace",
      subtype: "workspace",
      parentId: "",
      childIds: [],
      descendantFiles: [],
      description: "",
    };
    treeNodes.set(relativePath, node);
    return node;
  }

  const parentPath = path.posix.dirname(relativePath);
  const parentNode = ensureDirectoryNode(treeNodes, childIdsByParent, parentPath);
  const node = {
    id: buildNodeId("directory", relativePath),
    relativePath,
    label: inferNodeLabel(relativePath),
    kind: "directory",
    subtype: "module-group",
    parentId: parentNode.id,
    childIds: [],
    descendantFiles: [],
    description: "",
  };
  treeNodes.set(relativePath, node);
  const parentChildren = childIdsByParent.get(parentNode.id) || [];
  parentChildren.push(node.id);
  childIdsByParent.set(parentNode.id, parentChildren);
  return node;
}

function buildTree(fileInfos) {
  const treeNodes = new Map();
  const childIdsByParent = new Map();
  const nodeById = new Map();
  const fileInfoByPath = new Map(fileInfos.map((file) => [file.relativePath, file]));
  const fileNodeIds = [];

  const rootNode = ensureDirectoryNode(treeNodes, childIdsByParent, "app");
  nodeById.set(rootNode.id, rootNode);

  fileInfos.forEach((fileInfo) => {
    if (fileInfo.relativePath === "next.config.js") {
      const configNode = {
        id: fileInfo.id,
        relativePath: fileInfo.relativePath,
        label: fileInfo.label,
        kind: "file",
        subtype: fileInfo.subtype,
        parentId: rootNode.id,
        childIds: [],
        descendantFiles: [fileInfo.relativePath],
        description: fileInfo.description,
      };
      nodeById.set(configNode.id, configNode);
      const rootChildren = childIdsByParent.get(rootNode.id) || [];
      rootChildren.push(configNode.id);
      childIdsByParent.set(rootNode.id, rootChildren);
      fileNodeIds.push(configNode.id);
      return;
    }

    const directoryPath = path.posix.dirname(fileInfo.relativePath);
    const parentDirectory = ensureDirectoryNode(treeNodes, childIdsByParent, directoryPath);
    const fileNode = {
      id: fileInfo.id,
      relativePath: fileInfo.relativePath,
      label: fileInfo.label,
      kind: "file",
      subtype: fileInfo.subtype,
      parentId: parentDirectory.id,
      childIds: [],
      descendantFiles: [fileInfo.relativePath],
      description: fileInfo.description,
    };
    nodeById.set(fileNode.id, fileNode);
    const directoryChildren = childIdsByParent.get(parentDirectory.id) || [];
    directoryChildren.push(fileNode.id);
    childIdsByParent.set(parentDirectory.id, directoryChildren);
    fileNodeIds.push(fileNode.id);

    fileInfo.symbols.forEach((symbol) => {
      const symbolNode = {
        id: buildNodeId("symbol", fileInfo.relativePath, symbol.name),
        relativePath: `${fileInfo.relativePath}#${symbol.name}`,
        label: symbol.label,
        symbolName: symbol.name,
        kind: "symbol",
        subtype: symbol.kind,
        parentId: fileNode.id,
        childIds: [],
        descendantFiles: [fileInfo.relativePath],
        description: "Top-level file subdivision.",
        startLine: symbol.startLine,
        endLine: symbol.endLine,
      };
      nodeById.set(symbolNode.id, symbolNode);
      fileNode.childIds.push(symbolNode.id);
    });
  });

  for (const [relativePath, treeNode] of treeNodes.entries()) {
    if (relativePath === "app") continue;
    nodeById.set(treeNode.id, treeNode);
  }

  nodeById.forEach((node) => {
    if (node.kind === "file" || node.kind === "symbol") return;
    node.childIds = childIdsByParent.get(node.id) || [];
  });

  function collectDescendantFiles(nodeId) {
    const node = nodeById.get(nodeId);
    if (!node) return [];
    if (node.kind === "file" || node.kind === "symbol") {
      return node.descendantFiles || [];
    }
    const descendants = uniqueBy(
      node.childIds.flatMap((childId) => collectDescendantFiles(childId)),
      (filePath) => filePath,
    );
    node.descendantFiles = descendants;
    return descendants;
  }

  collectDescendantFiles(rootNode.id);

  nodeById.forEach((node) => {
    if (node.kind === "directory" || node.kind === "workspace") {
      const descendantFiles = node.descendantFiles
        .map((filePath) => fileInfoByPath.get(filePath))
        .filter(Boolean);
      node.subtype = inferDirectorySubtype(node.relativePath, descendantFiles);
    }
    const descendantFiles = node.descendantFiles
      .map((filePath) => fileInfoByPath.get(filePath))
      .filter(Boolean);
    node.description = buildNodeDescription({
      kind: node.kind,
      subtype: node.subtype,
      relativePath: node.relativePath,
      descendantFiles,
    });
  });

  return {
    rootNodeId: rootNode.id,
    nodeById,
    fileInfoByPath,
    fileNodeIds,
  };
}

function aggregateNodeAuth(fileInfoByPath, descendantFiles) {
  const items = descendantFiles
    .flatMap((filePath) => fileInfoByPath.get(filePath)?.authEvidence || [])
    .map((item) => ({
      ...item,
      excerpt: "",
    }));
  const grouped = new Map();
  items.forEach((item) => {
    const group = grouped.get(item.role) || [];
    group.push(item);
    grouped.set(item.role, group);
  });
  return Array.from(grouped.entries())
    .map(([role, refs]) => ({
      role,
      refs: refs.slice(0, 3),
    }))
    .sort((left, right) => right.refs.length - left.refs.length);
}

function buildBreadcrumb(nodeById, nodeId) {
  const items = [];
  let cursor = nodeById.get(nodeId) || null;
  while (cursor) {
    items.push({
      id: cursor.id,
      label: cursor.label,
      kind: cursor.kind,
    });
    cursor = cursor.parentId ? nodeById.get(cursor.parentId) || null : null;
  }
  return items.reverse();
}

function sortChildNodes(nodeById, childIds) {
  const priorityByKind = {
    directory: 0,
    file: 1,
    symbol: 2,
  };
  return childIds
    .map((childId) => nodeById.get(childId))
    .filter(Boolean)
    .sort((left, right) => {
      const leftPriority = priorityByKind[left.kind] ?? 9;
      const rightPriority = priorityByKind[right.kind] ?? 9;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      return left.label.localeCompare(right.label);
    });
}

function findImmediateChildForFile(nodeById, currentNode, filePath) {
  const childNodes = currentNode.childIds.map((childId) => nodeById.get(childId)).filter(Boolean);
  for (const childNode of childNodes) {
    if ((childNode.descendantFiles || []).includes(filePath)) {
      return childNode;
    }
  }
  return null;
}

function buildAggregatedEdges(snapshot, currentNode, fileEdges) {
  if (currentNode.kind === "file") {
    const fileInfo = snapshot.fileInfoByPath.get(currentNode.relativePath);
    if (!fileInfo) return [];
    const symbolByName = new Map(fileInfo.symbols.map((symbol) => [symbol.name, symbol]));
    const grouped = new Map();

    fileInfo.symbolEdges.forEach((edge) => {
      const sourceSymbol = symbolByName.get(edge.sourceSymbol);
      const targetSymbol = symbolByName.get(edge.targetSymbol);
      if (!sourceSymbol || !targetSymbol) return;
      const sourceId = buildNodeId("symbol", fileInfo.relativePath, sourceSymbol.name);
      const targetId = buildNodeId("symbol", fileInfo.relativePath, targetSymbol.name);
      const key = `${sourceId}:${targetId}`;
      const group = grouped.get(key) || {
        id: key,
        source: sourceId,
        target: targetId,
        label: edge.usageKind,
        variables: [],
        refs: [],
        weight: 0,
      };
      group.weight += 1;
      group.refs.push({
        filePath: fileInfo.relativePath,
        startLine: edge.line,
        endLine: edge.line,
        label: `${edge.sourceSymbol} ${edge.usageKind}`,
      });
      grouped.set(key, group);
    });

    return Array.from(grouped.values()).map((edge) => ({
      ...edge,
      refs: uniqueBy(edge.refs, (ref) => `${ref.filePath}:${ref.startLine}:${ref.label}`).slice(
        0,
        MAX_EDGE_REFS,
      ),
    }));
  }

  const grouped = new Map();
  fileEdges.forEach((edge) => {
    if (!(currentNode.descendantFiles || []).includes(edge.sourceFilePath)) return;
    if (!(currentNode.descendantFiles || []).includes(edge.targetFilePath)) return;
    const sourceChild = findImmediateChildForFile(snapshot.nodeById, currentNode, edge.sourceFilePath);
    const targetChild = findImmediateChildForFile(snapshot.nodeById, currentNode, edge.targetFilePath);
    if (!sourceChild || !targetChild) return;
    if (sourceChild.id === targetChild.id) return;

    const key = `${sourceChild.id}:${targetChild.id}`;
    const group = grouped.get(key) || {
      id: key,
      source: sourceChild.id,
      target: targetChild.id,
      label: "",
      variables: [],
      refs: [],
      weight: 0,
      importedSymbols: new Set(),
    };
    group.weight += edge.weight;
    edge.importedSymbols.forEach((symbol) => group.importedSymbols.add(symbol));
    group.variables.push(...edge.variables);
    group.refs.push(...edge.refs);
    grouped.set(key, group);
  });

  return Array.from(grouped.values())
    .map((edge) => {
      const variables = uniqueBy(
        edge.variables,
        (variable) =>
          `${variable.name}:${variable.value}:${variable.usageKind}:${variable.line}:${variable.specifier}`,
      ).slice(0, MAX_EDGE_VARIABLES);
      const labelTokens = variables.length
        ? variables.slice(0, 3).map((variable) => variable.name)
        : Array.from(edge.importedSymbols).slice(0, 3);
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: clampText(labelTokens.join(", ") || "dependency", 48),
        variables,
        refs: uniqueBy(edge.refs, (ref) => `${ref.filePath}:${ref.startLine}:${ref.label}`).slice(
          0,
          MAX_EDGE_REFS,
        ),
        weight: edge.weight,
      };
    })
    .sort((left, right) => right.weight - left.weight);
}

function buildSourceRefsForNode(snapshot, node) {
  if (node.kind === "symbol") {
    const filePath = node.relativePath.split("#")[0];
    const fileInfo = snapshot.fileInfoByPath.get(filePath);
    if (!fileInfo) return [];
    return [
      {
        filePath,
        startLine: node.startLine,
        endLine: node.endLine,
        label: node.label,
        excerpt: createLineExcerpt(fileInfo.content, node.startLine, node.endLine),
      },
    ];
  }

  if (node.kind === "file") {
    const fileInfo = snapshot.fileInfoByPath.get(node.relativePath);
    if (!fileInfo) return [];
    return fileInfo.primaryRefs.slice(0, MAX_NODE_SOURCE_REFS).map((ref) => ({
      ...ref,
      excerpt: createLineExcerpt(fileInfo.content, ref.startLine, ref.endLine),
    }));
  }

  const refs = [];
  (node.descendantFiles || []).forEach((filePath) => {
    const fileInfo = snapshot.fileInfoByPath.get(filePath);
    if (!fileInfo) return;
    fileInfo.primaryRefs.forEach((ref) => {
      refs.push({
        ...ref,
        excerpt: createLineExcerpt(fileInfo.content, ref.startLine, ref.endLine),
      });
    });
  });

  return uniqueBy(refs, (ref) => `${ref.filePath}:${ref.startLine}:${ref.endLine}:${ref.label}`)
    .sort((left, right) => {
      const leftScore = left.label.includes("access evidence") ? -1 : 0;
      const rightScore = right.label.includes("access evidence") ? -1 : 0;
      if (leftScore !== rightScore) return leftScore - rightScore;
      return left.filePath.localeCompare(right.filePath) || left.startLine - right.startLine;
    })
    .slice(0, MAX_NODE_SOURCE_REFS);
}

function formatNodeSummary(node, snapshot) {
  if (node.kind === "symbol") {
    return `Lines ${node.startLine}-${node.endLine}`;
  }
  if (node.kind === "file") {
    const fileInfo = snapshot.fileInfoByPath.get(node.relativePath);
    if (!fileInfo) return "Runtime file";
    return `${fileInfo.lineCount} lines${fileInfo.symbols.length ? ` · ${fileInfo.symbols.length} blocks` : ""}`;
  }
  const fileCount = (node.descendantFiles || []).length;
  return `${fileCount} runtime file${fileCount === 1 ? "" : "s"}${node.childIds.length ? ` · ${node.childIds.length} subdivisions` : ""}`;
}

function enrichAuthEvidence(snapshot, authGroups) {
  return authGroups.map((group) => ({
    role: group.role,
    refs: group.refs.map((ref) => {
      const fileInfo = snapshot.fileInfoByPath.get(ref.filePath);
      return {
        ...ref,
        excerpt: fileInfo
          ? createLineExcerpt(fileInfo.content, ref.startLine, ref.endLine, 0)
          : "",
      };
    }),
  }));
}

export async function getRuntimeSystemsSnapshot() {
  const manifest = await buildRuntimeManifest();
  if (snapshotCache.snapshot && snapshotCache.version === manifest.version) {
    return snapshotCache.snapshot;
  }

  const fileInfos = await Promise.all(manifest.items.map((item) => parseRuntimeFile(item)));
  const fileEdges = deriveFileEdges(fileInfos);
  const tree = buildTree(fileInfos);

  const snapshot = {
    version: manifest.version,
    generatedAt: new Date().toISOString(),
    fileEdges,
    ...tree,
  };

  snapshotCache.version = manifest.version;
  snapshotCache.snapshot = snapshot;
  return snapshot;
}

export async function getRuntimeSystemsVersion() {
  const manifest = await buildRuntimeManifest();
  return {
    version: manifest.version,
    generatedAt: new Date().toISOString(),
  };
}

export async function buildRuntimeSystemsView(nodeId) {
  const snapshot = await getRuntimeSystemsSnapshot();
  const currentNode = snapshot.nodeById.get(asText(nodeId)) || snapshot.nodeById.get(snapshot.rootNodeId);
  const childNodes = sortChildNodes(snapshot.nodeById, currentNode.childIds || []);
  const auth = enrichAuthEvidence(
    snapshot,
    aggregateNodeAuth(snapshot.fileInfoByPath, currentNode.descendantFiles || []),
  );
  const edges = buildAggregatedEdges(snapshot, currentNode, snapshot.fileEdges);

  return {
    version: snapshot.version,
    generatedAt: snapshot.generatedAt,
    currentNode: {
      id: currentNode.id,
      label: currentNode.label,
      kind: currentNode.kind,
      subtype: currentNode.subtype,
      relativePath: currentNode.relativePath,
      description: currentNode.description,
      summary: formatNodeSummary(currentNode, snapshot),
      childCount: childNodes.length,
      descendantFileCount: (currentNode.descendantFiles || []).length,
      isLeaf: childNodes.length === 0,
    },
    breadcrumb: buildBreadcrumb(snapshot.nodeById, currentNode.id),
    graph: {
      nodes: childNodes.map((node) => ({
        id: node.id,
        label: node.label,
        kind: node.kind,
        subtype: node.subtype,
        relativePath: node.relativePath,
        description: node.description,
        summary: formatNodeSummary(node, snapshot),
        childCount: (node.childIds || []).length,
        descendantFileCount: (node.descendantFiles || []).length,
        authRoles: aggregateNodeAuth(snapshot.fileInfoByPath, node.descendantFiles || [])
          .map((group) => group.role)
          .slice(0, 3),
        isLeaf: !node.childIds?.length,
      })),
      edges,
    },
    details: {
      summary: formatNodeSummary(currentNode, snapshot),
      auth,
      sourceRefs: buildSourceRefsForNode(snapshot, currentNode),
      handoffs: edges,
    },
  };
}

function tokenizeQuestion(question) {
  return uniqueBy(
    asText(question)
      .toLowerCase()
      .split(/[^a-z0-9_/-]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !STOP_WORDS.has(token))
      .slice(0, MAX_QUERY_TERMS),
    (token) => token,
  );
}

function scoreText(queryTerms, text) {
  const lower = asText(text).toLowerCase();
  let score = 0;
  queryTerms.forEach((term) => {
    if (!term) return;
    if (lower.includes(term)) score += term.length >= 6 ? 3 : 2;
  });
  return score;
}

function buildQuestionEvidence(snapshot, currentNode, question) {
  const queryTerms = tokenizeQuestion(question);
  const sourceRefs = buildSourceRefsForNode(snapshot, currentNode);
  const handoffs = buildAggregatedEdges(snapshot, currentNode, snapshot.fileEdges);
  const auth = enrichAuthEvidence(
    snapshot,
    aggregateNodeAuth(snapshot.fileInfoByPath, currentNode.descendantFiles || []),
  );
  const childNodes = sortChildNodes(snapshot.nodeById, currentNode.childIds || []);

  const evidence = [];

  childNodes.forEach((node) => {
    evidence.push({
      type: "child-node",
      score:
        scoreText(queryTerms, `${node.label} ${node.description} ${node.relativePath}`) +
        (currentNode.childIds.length ? 1 : 0),
      text: `${node.label}: ${node.description} (${node.relativePath}).`,
      refs: [],
    });
  });

  sourceRefs.forEach((ref) => {
    evidence.push({
      type: "source-ref",
      score: scoreText(queryTerms, `${ref.filePath} ${ref.label} ${ref.excerpt}`) + 2,
      text: `${ref.label} in ${ref.filePath}:${ref.startLine}-${ref.endLine}\n${ref.excerpt}`,
      refs: [ref],
    });
  });

  handoffs.forEach((handoff) => {
    const sourceNode = snapshot.nodeById.get(handoff.source);
    const targetNode = snapshot.nodeById.get(handoff.target);
    const variableText = handoff.variables
      .map((variable) => `${variable.name}=${variable.value}`)
      .join(", ");
    evidence.push({
      type: "handoff",
      score:
        scoreText(
          queryTerms,
          `${sourceNode?.label || ""} ${targetNode?.label || ""} ${variableText}`,
        ) + 2,
      text: `${sourceNode?.label || "Source"} -> ${targetNode?.label || "Target"}: ${
        variableText || handoff.label
      }`,
      refs: handoff.refs,
    });
  });

  auth.forEach((group) => {
    const reasons = group.refs.map((ref) => `${ref.filePath}:${ref.startLine} ${ref.reason}`).join(" | ");
    evidence.push({
      type: "auth",
      score: scoreText(queryTerms, `${group.role} ${reasons}`) + 3,
      text: `${group.role} authorization evidence: ${reasons}`,
      refs: group.refs,
    });
  });

  return evidence
    .filter((item) => item.score > 0 || item.type === "auth")
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_QUERY_EVIDENCE);
}

function buildDeterministicAnswer(snapshot, currentNode, question, evidence) {
  const lowerQuestion = asText(question).toLowerCase();
  const wantsAuth =
    lowerQuestion.includes("auth") ||
    lowerQuestion.includes("authorize") ||
    lowerQuestion.includes("permission") ||
    lowerQuestion.includes("role");
  const wantsVariables =
    lowerQuestion.includes("variable") ||
    lowerQuestion.includes("pass") ||
    lowerQuestion.includes("prop") ||
    lowerQuestion.includes("data flow");
  const wantsCode =
    lowerQuestion.includes("line") ||
    lowerQuestion.includes("file") ||
    lowerQuestion.includes("code") ||
    lowerQuestion.includes("where");

  const lines = [];
  lines.push(
    `Current workspace snapshot \`${snapshot.version}\` for ${currentNode.label} shows the following evidence:`,
  );

  if (wantsAuth) {
    const authEvidence = evidence.filter((item) => item.type === "auth");
    if (authEvidence.length) {
      authEvidence.slice(0, 3).forEach((item) => lines.push(`- ${item.text}`));
    } else {
      lines.push("- No explicit authorization guard was detected in the current node’s files.");
    }
  }

  if (wantsVariables) {
    const handoffs = evidence.filter((item) => item.type === "handoff");
    if (handoffs.length) {
      handoffs.slice(0, 4).forEach((item) => lines.push(`- ${item.text}`));
    } else {
      lines.push("- No direct variable hand-off was detected between the currently displayed blocks.");
    }
  }

  if (wantsCode || (!wantsAuth && !wantsVariables)) {
    const codeEvidence = evidence.filter((item) => item.type === "source-ref" || item.type === "child-node");
    if (codeEvidence.length) {
      codeEvidence.slice(0, 4).forEach((item) => lines.push(`- ${item.text}`));
    } else {
      lines.push("- The current node does not have narrower subdivisions; use the source refs in the panel for exact lines.");
    }
  }

  if (evidence.length) {
    const refs = uniqueBy(
      evidence.flatMap((item) => item.refs || []),
      (ref) => `${ref.filePath}:${ref.startLine}:${ref.endLine}`,
    ).slice(0, 5);
    if (refs.length) {
      lines.push("");
      lines.push("Most relevant code references:");
      refs.forEach((ref) => {
        lines.push(`- ${ref.filePath}:${ref.startLine}-${ref.endLine}`);
      });
    }
  }

  return lines.join("\n");
}

export async function answerRuntimeSystemsQuestion({ nodeId, question }) {
  const snapshot = await getRuntimeSystemsSnapshot();
  const currentNode = snapshot.nodeById.get(asText(nodeId)) || snapshot.nodeById.get(snapshot.rootNodeId);
  const evidence = buildQuestionEvidence(snapshot, currentNode, question);
  const answer = buildDeterministicAnswer(snapshot, currentNode, question, evidence);

  return {
    version: snapshot.version,
    currentNode: {
      id: currentNode.id,
      label: currentNode.label,
      relativePath: currentNode.relativePath,
    },
    answer,
    evidence: evidence.map((item) => ({
      type: item.type,
      text: item.text
        .split("\n")
        .slice(0, MAX_QUERY_LINES)
        .join("\n"),
      refs: item.refs || [],
    })),
  };
}
