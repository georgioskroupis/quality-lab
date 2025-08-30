#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { loadConfig } = require("../src/config");
const { resolvePlannedChecks } = require("../src/packs/registry");
const { runPlannedChecks } = require("../src/runner");
const { simplifyFindings, writeReport } = require("../src/report");
const { loadState } = require("../src/state");

const VERSION = "0.0.1";

function printHelp() {
  const help = `
qualitylab ${VERSION}

Usage:
  qualitylab scan <path> [--json] [--since <rev>] [--paths <glob[,glob...]>] [--time-budget <dur>]

Examples:
  qualitylab scan .
  qualitylab scan . --json > report.json
  qualitylab scan . --since HEAD~1
  qualitylab scan . --paths apps/api/** --time-budget 5m

Description:
  Runs a placeholder scan and emits an empty findings report.
  Use --json to output a JSON report suitable for redirecting to a file.
`;
  process.stdout.write(help);
}

function parseArgs(argv) {
  const out = { command: null, targetPath: ".", json: false, since: null, help: false, paths: [], timeBudgetMs: null };
  if (argv.length === 0) {
    out.help = true;
    return out;
  }
  const [cmd, ...rest] = argv;
  if (cmd === "--help" || cmd === "-h") {
    out.help = true;
    return out;
  }
  out.command = cmd;

  let i = 0;
  while (i < rest.length) {
    const token = rest[i];
    if (!token) { i++; continue; }

    if (token === "--help" || token === "-h") {
      out.help = true; i++; continue;
    }
    if (token === "--json") {
      out.json = true; i++; continue;
    }
    if (token === "--since") {
      const val = rest[i + 1];
      if (!val || val.startsWith("-")) {
        throw new Error("--since requires a value (e.g., HEAD~1)");
      }
      out.since = val; i += 2; continue;
    }
    if (token === "--paths") {
      const val = rest[i + 1];
      if (!val || val.startsWith("-")) {
        throw new Error("--paths requires a value (comma-separated globs)");
      }
      out.paths = val.split(",").map(s => s.trim()).filter(Boolean);
      i += 2; continue;
    }
    if (token === "--time-budget") {
      const val = rest[i + 1];
      if (!val || val.startsWith("-")) {
        throw new Error("--time-budget requires a value (e.g., 5m, 30s)");
      }
      out.timeBudgetMs = parseDurationMs(val);
      if (out.timeBudgetMs == null) throw new Error("--time-budget invalid duration");
      i += 2; continue;
    }
    // First non-flag after command is the target path
    if (out.targetPath === "." && !token.startsWith("-")) {
      out.targetPath = token; i++; continue;
    }
    // Unknown flag or extra args
    if (token.startsWith("-")) {
      throw new Error(`Unknown option: ${token}`);
    } else {
      throw new Error(`Unexpected argument: ${token}`);
    }
  }
  return out;
}

function parseDurationMs(s) {
  const m = String(s).trim().match(/^(\d+)(ms|s|m|h)?$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = (m[2] || "s").toLowerCase();
  if (unit === "ms") return n;
  if (unit === "s") return n * 1000;
  if (unit === "m") return n * 60 * 1000;
  if (unit === "h") return n * 60 * 60 * 1000;
  return null;
}

function makePlaceholderReport(targetPath, since, configLoad, planResult, runResult) {
  return {
    version: VERSION,
    command: "scan",
    targetPath,
    since: since || null,
    config: {
      packs: configLoad.config.packs,
      checks: configLoad.config.checks,
      path: configLoad.meta.path,
    },
    planned: planResult.plan,
    findings: runResult ? runResult.findings : [],
    summary: {
      count: runResult ? runResult.findings.length : 0,
      generatedAt: new Date().toISOString()
    },
    warnings: [...configLoad.warnings, ...planResult.warnings, ...(runResult ? runResult.warnings : [])],
    runtime: runResult && runResult.runtime ? runResult.runtime : { durationMs: 0, executed: 0, skipped: [] }
  };
}

async function run() {
  try {
    const args = parseArgs(process.argv.slice(2));

    if (args.help || !args.command) {
      printHelp();
      process.exit(0);
    }

    if (args.command !== "scan") {
      process.stderr.write(`Unknown command: ${args.command}\n`);
      printHelp();
      process.exit(1);
    }

    // Resolve and validate path, but do not scan yet (placeholder)
    const resolvedPath = path.resolve(process.cwd(), args.targetPath || ".");
    if (!fs.existsSync(resolvedPath)) {
      process.stderr.write(`Path not found: ${args.targetPath}\n`);
      process.exit(2);
    }

    const cfg = loadConfig(resolvedPath);
    let baseDir = cfg.meta.root || resolvedPath;
    const repoRoot = cfg.meta.root || resolvedPath;
    // Governance: compute config hash and compare to previous
    const currentHash = computeConfigHash(cfg);
    const prevHash = readPreviousConfigHash(repoRoot);
    const policyChanged = !!(prevHash && prevHash !== currentHash);
    // Persist current for next run
    writeCurrentConfigHash(repoRoot, currentHash);
    // Focus baseDir if paths contain a clear subdir (prefix before wildcard)
    if (args.paths && args.paths.length) {
      const focus = deriveFocusedCwd(baseDir, args.paths);
      if (focus) baseDir = focus;
    }
    const plan = resolvePlannedChecks(baseDir, cfg.config.packs, cfg.config.checks, { since: args.since, paths: args.paths });
    const runResult = await runPlannedChecks(baseDir, plan.plan, args.since, { paths: args.paths, timeBudgetMs: args.timeBudgetMs });
    const report = makePlaceholderReport(args.targetPath || ".", args.since, cfg, plan, runResult);
    // Attach governance info and cost estimate
    report.governance = {
      configHash: {
        current: currentHash,
        previous: prevHash || null,
        changed: policyChanged
      }
    };
    const cpuMinutes = (report.runtime.durationMs || 0) / 60000;
    report.summary.cost = { cpuMinutes };

    // Export reports to ./qualitylab-report/
    const outDir = path.resolve(process.cwd(), "qualitylab-report");
    const simplified = simplifyFindings(report.findings);
    // Load persisted state from repo (optional)
    // repoRoot defined above
    const state = loadState(repoRoot);
    const outputs = writeReport(outDir, simplified, report, state);

    if (args.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    } else {
      const sinceText = report.since ? ` since ${report.since}` : "";
      const policyLine = `Policy hash: ${shortHash(currentHash)}` + (policyChanged ? `\nPolicy change detected: .qualitylab.yml modified (hash ${shortHash(prevHash)} → ${shortHash(currentHash)})\n` : "\n");
      process.stdout.write(
        `Scanned ${report.targetPath}${sinceText}. Findings: ${report.summary.count}.\n` +
        (report.config.path ? `Config: ${report.config.path}.\n` : "Config: <defaults>.\n") +
        policyLine +
        `Planned checks: ${report.planned.length}.\n` +
        `Scan complete in ${formatDuration(report.runtime.durationMs)} (approx ${cpuMinutes.toFixed(2)} CPU-min)\n` +
        `Checks executed: ${report.runtime.executed}/${report.planned.length}\n` +
        (report.runtime.skipped.length ? `Skipped: ${report.runtime.skipped.map(s => `${s.check} (${s.reason})`).join(", ")}\n` : "") +
        `Wrote JSON + HTML to ${outDir}. Use --json for full payload.\n`
      );
    }
    process.exit(0);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

run();
function deriveFocusedCwd(baseDir, patterns) {
  if (!patterns || !patterns.length) return null;
  // Find first pattern, take prefix until first wildcard
  const first = patterns[0];
  const idx = Math.min(...["*", "?", "["].map(ch => { const i = first.indexOf(ch); return i < 0 ? Infinity : i; }));
  if (!isFinite(idx) || idx <= 0) return null;
  let prefix = first.slice(0, idx);
  // Trim trailing slashes/wildcards
  prefix = prefix.replace(/\/$/, "");
  const candidate = path.resolve(baseDir, prefix);
  try {
    const st = fs.statSync(candidate);
    if (st.isDirectory()) return candidate;
  } catch {}
  return null;
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function computeConfigHash(cfg) {
  try {
    if (cfg.meta && cfg.meta.path && fs.existsSync(cfg.meta.path)) {
      const raw = fs.readFileSync(cfg.meta.path, "utf8");
      return sha256Hex(raw);
    }
  } catch {}
  // Hash effective config object when file not present
  return sha256Hex(JSON.stringify(cfg.config || {}));
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function readPreviousConfigHash(repoRoot) {
  const dir = path.join(repoRoot, ".qualitylab");
  const file = path.join(dir, ".config-hash");
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return null; }
}

function writeCurrentConfigHash(repoRoot, hash) {
  const dir = path.join(repoRoot, ".qualitylab");
  const file = path.join(dir, ".config-hash");
  try { ensureDir(dir); fs.writeFileSync(file, hash + "\n", "utf8"); } catch {}
}

function shortHash(h) { return (h || "").slice(0, 6); }

function formatDuration(ms) {
  if (ms == null) return "0s";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h${m}m${sec}s`;
  if (m) return `${m}m${sec}s`;
  return `${sec}s`;
}
