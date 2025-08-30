"use strict";

const { execCmd } = require("../utils/exec");

async function runComplexity(baseDir, options = {}) {
  // Use npx to invoke eslint with inline rule for complexity
  const args = [
    "-y",
    "eslint",
    "--format",
    "json",
    "--rule",
    "complexity: [\"error\", {\"max\": 10}]",
    ...(options.patterns && options.patterns.length ? options.patterns : ["."])
  ];
  const res = await execCmd("npx", args, { cwd: baseDir, timeoutMs: options.timeoutMs });
  // ESLint exits non-zero when there are errors; still has JSON in stdout
  if (!res.stdout.trim()) {
    return { findings: [], warnings: ["complexity: eslint not available or produced no output", res.stderr.trim()].filter(Boolean) };
  }
  let reports = [];
  try { reports = JSON.parse(res.stdout); } catch (e) {
    return { findings: [], warnings: ["complexity: failed to parse eslint JSON: " + e.message] };
  }
  const findings = [];
  for (const file of reports) {
    if (!file || !Array.isArray(file.messages)) continue;
    for (const m of file.messages) {
      if (m.ruleId === "complexity" && m.severity >= 1) {
        findings.push({
          check: "complexity",
          id: `complexity:${file.filePath}:${m.line || 0}`,
          title: "Cyclomatic complexity threshold exceeded",
          severity: "medium",
          message: m.message,
          locations: [{ file: file.filePath, line: m.line || 0, column: m.column || 0 }],
          meta: { ruleId: m.ruleId },
          confidence: "medium"
        });
      }
    }
  }
  return { findings, warnings: [] };
}

module.exports = { runComplexity };
