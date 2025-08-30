"use strict";

const { execCmd } = require("../utils/exec");

function mapSeverity(s) {
  const v = String(s || "").toLowerCase();
  if (v === "error") return "high";
  if (v === "warning" || v === "warn") return "medium";
  return "info";
}

async function runSemgrep(baseDir, options = {}) {
  // Use OWASP Top Ten ruleset by default
  const args = ["--config", "p/owasp-top-ten", "--json", ...(options.patterns && options.patterns.length ? options.patterns : ["."] )];
  const res = await execCmd("semgrep", args, { cwd: baseDir, timeoutMs: options.timeoutMs });
  if (!res.stdout.trim()) {
    return { findings: [], warnings: ["semgrep: CLI produced no output", res.stderr.trim()].filter(Boolean) };
  }
  let data = null;
  try { data = JSON.parse(res.stdout); } catch (e) {
    return { findings: [], warnings: ["semgrep: failed to parse JSON: " + e.message] };
  }
  const results = Array.isArray(data && data.results) ? data.results : [];
  const findings = results.map(r => ({
    check: "semgrep",
    id: r.check_id || "semgrep",
    title: (r.extra && r.extra.message) || r.extra && r.extra.metadata && r.extra.metadata.shortlink || "Semgrep finding",
    severity: mapSeverity(r.extra && r.extra.severity),
    message: r.extra && r.extra.message || "",
    locations: [{ file: r.path || "", line: r.start && r.start.line || 0, column: r.start && r.start.col || 0 }],
    meta: { rule: r.check_id, metadata: r.extra && r.extra.metadata },
    confidence: "medium" // limited ruleset (OWASP Top Ten)
  }));
  return { findings, warnings: [] };
}

module.exports = { runSemgrep };
