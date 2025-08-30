"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_CONFIG = Object.freeze({ packs: [], checks: [] });

function findConfigRoot(startPath) {
  let dir = path.resolve(startPath);
  try {
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) {
      dir = path.dirname(dir);
    }
  } catch {
    // Non-existent path; treat as cwd
    dir = process.cwd();
  }

  // Walk up until filesystem root looking for .qualitylab.yml
  while (true) {
    const candidate = path.join(dir, ".qualitylab.yml");
    if (fs.existsSync(candidate)) {
      return { root: dir, configPath: candidate };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached root
    dir = parent;
  }
  return { root: null, configPath: null };
}

function stripComments(line) {
  // Remove YAML-style comments (# ...), ignoring # inside quotes (simple heuristic)
  let inSingle = false, inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    if (ch === '"' && !inSingle) inDouble = !inDouble;
    if (ch === "#" && !inSingle && !inDouble) {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseInlineArray(value) {
  // Expect something like: [a, b, "c"]
  const arr = [];
  const inner = value.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (!inner.trim()) return arr;
  const parts = inner.split(",").map(s => s.trim()).filter(Boolean);
  for (const p of parts) {
    let v = p;
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (v) arr.push(v);
  }
  return arr;
}

function safeParseMinimalYaml(content) {
  // Minimal parser that only understands two top-level keys with inline arrays
  const result = {};
  const warnings = [];

  const lines = content.split(/\r?\n/).map(stripComments).map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    const m = line.match(/^(packs|checks)\s*:\s*(.+)$/);
    if (!m) continue;
    const key = m[1];
    const raw = m[2];
    if (!raw.startsWith("[")) {
      warnings.push(`Ignoring ${key}: only inline array syntax is supported in MVP.`);
      continue;
    }
    result[key] = parseInlineArray(raw);
  }
  return { value: result, warnings };
}

function validateConfig(raw) {
  const warnings = [];
  const out = { packs: [], checks: [] };

  if (Array.isArray(raw.packs) && raw.packs.every(s => typeof s === "string" && s.trim().length > 0)) {
    out.packs = raw.packs;
  } else if (raw.packs !== undefined) {
    warnings.push("Invalid 'packs' value; expected array of non-empty strings. Using default [].");
  }

  if (Array.isArray(raw.checks) && raw.checks.every(s => typeof s === "string" && s.trim().length > 0)) {
    out.checks = raw.checks;
  } else if (raw.checks !== undefined) {
    warnings.push("Invalid 'checks' value; expected array of non-empty strings. Using default [].");
  }

  return { config: out, warnings };
}

function loadConfig(startPath) {
  const loc = findConfigRoot(startPath);
  const meta = { root: loc.root, path: loc.configPath };
  if (!loc.configPath) {
    return { config: DEFAULT_CONFIG, meta, warnings: ["No .qualitylab.yml found; using defaults."] };
  }

  try {
    const rawText = fs.readFileSync(loc.configPath, "utf8");
    const { value, warnings: parseWarnings } = safeParseMinimalYaml(rawText);
    const { config, warnings: valWarnings } = validateConfig(value);
    const merged = { packs: config.packs ?? DEFAULT_CONFIG.packs, checks: config.checks ?? DEFAULT_CONFIG.checks };
    return { config: merged, meta, warnings: [...parseWarnings, ...valWarnings] };
  } catch (e) {
    return { config: DEFAULT_CONFIG, meta, warnings: [`.qualitylab.yml read/parse error: ${e.message}. Using defaults.`] };
  }
}

module.exports = {
  DEFAULT_CONFIG,
  findConfigRoot,
  loadConfig,
};

