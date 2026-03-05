import fs from "node:fs";
import path from "node:path";

const rootEnvCandidates = [
  ".env.local",
  ".env",
  path.join("..", "..", ".env.local"),
  path.join("..", "..", ".env")
];

const envCache = new Map<string, string | null>();

export function readServerEnvValue(key: string): string | null {
  const direct = process.env[key]?.trim();

  if (direct) {
    return direct;
  }

  if (envCache.has(key)) {
    return envCache.get(key) ?? null;
  }

  for (const relativePath of rootEnvCandidates) {
    const filePath = path.resolve(process.cwd(), relativePath);

    if (!fs.existsSync(filePath)) {
      continue;
    }

    const value = readEnvFileValue(filePath, key);

    if (value) {
      envCache.set(key, value);
      return value;
    }
  }

  envCache.set(key, null);
  return null;
}

export function hasServerEnvValue(key: string): boolean {
  return readServerEnvValue(key) !== null;
}

function readEnvFileValue(filePath: string, key: string): string | null {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);

    if (!match || match[1] !== key) {
      continue;
    }

    const rawValue = match[2].trim();

    if (!rawValue) {
      return null;
    }

    if ((rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
      return rawValue.slice(1, -1).trim() || null;
    }

    return rawValue;
  }

  return null;
}
