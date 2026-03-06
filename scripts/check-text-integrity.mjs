import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const textExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".css",
  ".html",
  ".yml",
  ".yaml",
  ".svg",
  ".txt"
]);
const ignoredDirectories = new Set([".git", "node_modules", ".next", ".tmp"]);
const suspiciousPatterns = [
  { pattern: /\u00d0/u, label: "contains mojibake marker U+00D0" },
  { pattern: /\u00d1/u, label: "contains mojibake marker U+00D1" },
  { pattern: /\ufffd/u, label: "contains replacement character U+FFFD" }
];

const issues = [];
scanDirectory(root);

if (issues.length > 0) {
  console.error("Text integrity check failed:\n");

  for (const issue of issues) {
    console.error(`- ${issue.file}: ${issue.message}`);
  }

  process.exit(1);
}

console.log("Text integrity check passed.");

function scanDirectory(directoryPath) {
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) {
      continue;
    }

    const fullPath = join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      scanDirectory(fullPath);
      continue;
    }

    if (!entry.isFile() || !shouldCheckFile(entry.name, fullPath)) {
      continue;
    }

    checkFile(fullPath);
  }
}

function shouldCheckFile(fileName, fullPath) {
  const lowerName = fileName.toLowerCase();
  const extension = lowerName.includes(".") ? lowerName.slice(lowerName.lastIndexOf(".")) : "";
  const relativePath = relative(root, fullPath).replaceAll("\\", "/");

  if (textExtensions.has(extension)) {
    return true;
  }

  return lowerName === "readme" || lowerName === "license" || relativePath === ".gitignore" || relativePath === ".editorconfig" || relativePath === ".gitattributes";
}

function checkFile(filePath) {
  const buffer = readFileSync(filePath);
  const relativePath = relative(root, filePath).replaceAll("\\", "/");

  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    issues.push({ file: relativePath, message: "has a UTF-8 BOM" });
  }

  const text = buffer.toString("utf8");

  if (text.includes("\r\n")) {
    issues.push({ file: relativePath, message: "contains CRLF line endings" });
  }

  for (const entry of suspiciousPatterns) {
    if (entry.pattern.test(text)) {
      issues.push({ file: relativePath, message: entry.label });
      break;
    }
  }

  if (!text.endsWith("\n")) {
    issues.push({ file: relativePath, message: "is missing a final newline" });
  }
}
