"use strict";

const fs = require("fs");
const path = require("path");
const { execCmd } = require("../utils/exec");

function walkFiles(dir, acc, maxFiles = 1000, relBase = dir, patterns = []) {
  if (acc.list.length >= maxFiles) return;
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (acc.list.length >= maxFiles) return;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if ([".git", "node_modules", "dist", "build", ".next", ".cache"].includes(e.name)) continue;
      walkFiles(p, acc, maxFiles, relBase, patterns);
    } else if (e.isFile()) {
      const rel = path.relative(relBase, p) || e.name;
      if (!patterns || !patterns.length || matchesGlobs(rel, patterns)) {
        acc.list.push(p);
      }
    }
  }
}

function globToRegExp(glob) {
  let g = String(glob).replace(/[.+^${}()|\\]/g, "\\$&");
  g = g.replace(/\*\*/g, ".*");
  g = g.replace(/\*/g, "[^/]*");
  return new RegExp("^" + g + "$");
}

function matchesGlobs(relPath, patterns) {
  const unix = relPath.split(path.sep).join("/");
  return patterns.some(p => globToRegExp(p).test(unix));
}

function regexScanFile(file, patterns) {
  let findings = [];
  let content = "";
  try { content = fs.readFileSync(file, "utf8"); } catch { return findings; }
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const p of patterns) {
      const m = line.match(p.regex);
      if (m) {
        findings.push({
          check: "secrets",
          id: p.id,
          title: `Secret pattern: ${p.id}`,
          severity: p.severity,
          message: `Matched pattern ${p.id}`,
          locations: [{ file, line: i + 1 }],
          meta: { excerpt: line.slice(0, 200), source: "regex" },
          confidence: "low"
        });
      }
    }
  }
  return findings;
}

async function runGitleaks(baseDir) {
  const res = await execCmd("gitleaks", ["detect", "--no-git", "--report-format", "json"], { cwd: baseDir });
  if (res.code !== 0 && !res.stdout) {
    return { findings: [], warnings: ["secrets: gitleaks failed", res.stderr.trim()].filter(Boolean) };
  }
  let arr = [];
  try { arr = JSON.parse(res.stdout || "[]"); } catch (e) {
    return { findings: [], warnings: ["secrets: failed to parse gitleaks JSON: " + e.message] };
  }
  const findings = (Array.isArray(arr) ? arr : []).map((f) => ({
    check: "secrets",
    id: f.RuleID || f.RuleID === 0 ? String(f.RuleID) : f.Description || "gitleaks",
    title: f.Description || "Potential secret",
    severity: "high",
    message: f.Secret || f.Match || "Potential secret detected",
    locations: [{ file: f.File || f.Path || f.FilePath || "", line: f.StartLine || f.Line || 0 }],
    meta: { tags: f.Tags || [], entropy: f.Entropy || undefined, source: "gitleaks" },
    confidence: "high"
  }));
  return { findings, warnings: [] };
}

async function runSecrets(baseDir, options = {}) {
  // Attempt gitleaks; if not present or fails, fallback to regex scan
  const tryGitleaks = await execCmd(process.platform === "win32" ? "where" : "which", ["gitleaks"]);
  if (tryGitleaks.code === 0) {
    const r = await runGitleaks(baseDir);
    if (r.findings.length || !options.forceRegexFallback) return r;
  }

  // Regex fallback
  const patterns = [
    { id: "aws-access-key", severity: "high", regex: /AKIA[0-9A-Z]{16}/ },
    { id: "generic-password", severity: "medium", regex: /(password|passwd|pwd)\s*[:=]\s*[^\s"']{6,}/i },
    { id: "generic-secret", severity: "medium", regex: /(secret|api[_-]?key)\s*[:=]\s*[^\s"']{6,}/i },
    { id: "private-key", severity: "high", regex: /-----BEGIN (RSA|DSA|EC|OPENSSH) PRIVATE KEY-----/ }
  ];
  const acc = { list: [] };
  walkFiles(baseDir, acc, options.maxFiles || 2000, baseDir, options.patterns || []);
  let findings = [];
  for (const file of acc.list) {
    findings = findings.concat(regexScanFile(file, patterns));
  }
  return { findings, warnings: [] };
}

module.exports = { runSecrets };
