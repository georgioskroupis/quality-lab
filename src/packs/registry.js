"use strict";

const fs = require("fs");
const path = require("path");

function binInPath(bin) {
  const parts = (process.env.PATH || "").split(path.delimiter);
  for (const p of parts) {
    const full = path.join(p, bin + (process.platform === "win32" ? ".cmd" : ""));
    if (fs.existsSync(full)) return true;
  }
  return false;
}

function hasFile(dir, file) {
  try {
    return fs.existsSync(path.join(dir, file));
  } catch {
    return false;
  }
}

// Hardcoded pack: web-saas@1
function resolveWebSaas1(baseDir, checks, opts = {}) {
  const planned = [];

  const requested = new Set(checks && checks.length ? checks : ["sca", "secrets", "complexity", "lighthouse"]);

  if (requested.has("sca")) {
    const available = hasFile(baseDir, "package.json");
    planned.push({
      check: "sca",
      runner: "npm-audit",
      pack: "web-saas@1",
      available,
      reason: available ? "" : "No package.json found",
      command: ["npm", "audit", "--json"],
      cwd: baseDir,
    });
  }

  if (requested.has("secrets")) {
    const available = binInPath("gitleaks");
    planned.push({
      check: "secrets",
      runner: "gitleaks",
      pack: "web-saas@1",
      available,
      reason: available ? "" : "gitleaks binary not found in PATH",
      command: ["gitleaks", "detect", "--no-git", "--format", "json"],
      cwd: baseDir,
    });
  }

  if (requested.has("complexity")) {
    const hasEslint = hasFile(baseDir, "node_modules/.bin/eslint") || binInPath("eslint") || hasFile(baseDir, ".eslintrc") || hasFile(baseDir, ".eslintrc.json") || hasFile(baseDir, ".eslintrc.js");
    planned.push({
      check: "complexity",
      runner: "eslint-complexity",
      pack: "web-saas@1",
      available: hasEslint,
      reason: hasEslint ? "" : "ESLint not detected",
      command: ["npx", "-y", "eslint", "--format", "json", "--rule", "complexity: [\"error\", {\"max\": 10}]", "."],
      cwd: baseDir,
    });
  }

  if (requested.has("lighthouse")) {
    const hasLH = binInPath("lighthouse") || binInPath("npx");
    const url = opts.targetUrl || process.env.QUALITYLAB_URL || null;
    const available = !!(hasLH && url);
    planned.push({
      check: "lighthouse",
      runner: "lighthouse-cli",
      pack: "web-saas@1",
      available,
      reason: available ? "" : (!url ? "Missing target URL (set QUALITYLAB_URL)" : "lighthouse not available"),
      command: url ? [hasLH && binInPath("lighthouse") ? "lighthouse" : "npx", "lighthouse", url, "--output=json", "--quiet"] : null,
      cwd: baseDir,
    });
  }

  return planned;
}

// Minimal second pack: api@1 (focus on backend services)
function resolveApi1(baseDir, checks, opts = {}) {
  const planned = [];
  const requested = new Set(checks && checks.length ? checks : ["sca", "secrets", "complexity"]);

  if (requested.has("sca")) {
    const available = hasFile(baseDir, "package.json");
    planned.push({
      check: "sca",
      runner: "npm-audit",
      pack: "api@1",
      available,
      reason: available ? "" : "No package.json found",
      command: ["npm", "audit", "--json"],
      cwd: baseDir,
    });
  }

  if (requested.has("secrets")) {
    const available = binInPath("gitleaks");
    planned.push({
      check: "secrets",
      runner: "gitleaks",
      pack: "api@1",
      available,
      reason: available ? "" : "gitleaks binary not found in PATH",
      command: ["gitleaks", "detect", "--no-git", "--format", "json"],
      cwd: baseDir,
    });
  }

  if (requested.has("complexity")) {
    const hasEslint = binInPath("eslint") || hasFile(baseDir, "node_modules/.bin/eslint");
    planned.push({
      check: "complexity",
      runner: "eslint-complexity",
      pack: "api@1",
      available: hasEslint,
      reason: hasEslint ? "" : "ESLint not detected",
      command: ["npx", "-y", "eslint", "--format", "json", "--rule", "complexity: [\"error\", {\"max\": 10}]", "."],
      cwd: baseDir,
    });
  }

  // No lighthouse in api pack
  return planned;
}

// API Service pack: adds semgrep and contract drift check
function resolveApiService1(baseDir, checks, opts = {}) {
  const planned = [];
  const requested = new Set(checks && checks.length ? checks : ["sca", "secrets", "complexity", "semgrep", "contract"]);

  // Reuse similar heuristics as other packs
  if (requested.has("sca")) {
    const available = hasFile(baseDir, "package.json");
    planned.push({ check: "sca", runner: "npm-audit", pack: "api-service@1", available, reason: available ? "" : "No package.json found", command: ["npm", "audit", "--json"], cwd: baseDir });
  }
  if (requested.has("secrets")) {
    const available = binInPath("gitleaks");
    planned.push({ check: "secrets", runner: "gitleaks", pack: "api-service@1", available, reason: available ? "" : "gitleaks binary not found in PATH", command: ["gitleaks", "detect", "--no-git", "--format", "json"], cwd: baseDir });
  }
  if (requested.has("complexity")) {
    const hasEslint = hasFile(baseDir, "node_modules/.bin/eslint") || binInPath("eslint");
    planned.push({ check: "complexity", runner: "eslint-complexity", pack: "api-service@1", available: hasEslint, reason: hasEslint ? "" : "ESLint not detected", command: ["npx", "-y", "eslint", "--format", "json", "--rule", "complexity: [\"error\", {\"max\": 10}]", "."], cwd: baseDir });
  }
  if (requested.has("semgrep")) {
    const available = binInPath("semgrep");
    planned.push({ check: "semgrep", runner: "semgrep-security", pack: "api-service@1", available, reason: available ? "" : "semgrep not found in PATH", command: ["semgrep", "--config", "p/owasp-top-ten", "--json"], cwd: baseDir });
  }
  if (requested.has("contract")) {
    const hasSince = !!(opts && opts.since);
    planned.push({ check: "contract", runner: "openapi-drift", pack: "api-service@1", available: hasSince, reason: hasSince ? "" : "requires --since to assess drift", command: ["git", "diff", "--name-only", opts && opts.since ? opts.since : "HEAD~1"], cwd: baseDir });
  }
  return planned;
}

function resolvePack(baseDir, packId, checks, opts) {
  if (packId === "web-saas@1") {
    return resolveWebSaas1(baseDir, checks, opts);
  }
  if (packId === "api@1") {
    return resolveApi1(baseDir, checks, opts);
  }
  if (packId === "api-service@1") {
    return resolveApiService1(baseDir, checks, opts);
  }
  return [];
}

function resolvePlannedChecks(baseDir, packs, checks, opts) {
  const plan = [];
  const warnings = [];
  const uniqPacks = Array.from(new Set(packs && packs.length ? packs : ["web-saas@1"]));
  for (const p of uniqPacks) {
    const items = resolvePack(baseDir, p, checks, opts);
    if (!items.length) warnings.push(`Unknown or empty pack: ${p}`);
    plan.push(...items);
  }
  if (!plan.length) warnings.push("No checks planned.");
  return { plan, warnings };
}

module.exports = {
  resolvePlannedChecks,
};
