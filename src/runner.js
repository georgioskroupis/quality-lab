"use strict";

const path = require("path");
const { runSCA } = require("./checks/sca");
const { runSecrets } = require("./checks/secrets");
const { runComplexity } = require("./checks/complexity");
const { runLighthouse } = require("./checks/lighthouse");
const { runSemgrep } = require("./checks/semgrep");
const { runOpenApiDrift } = require("./checks/contract");

async function runPlannedChecks(baseDir, planned, since, options = {}) {
  const findings = [];
  const warnings = [];
  const startedAt = Date.now();
  const timeBudgetMs = options.timeBudgetMs || null;
  let executed = 0;
  const skipped = [];
  for (const item of planned) {
    try {
      const now = Date.now();
      if (timeBudgetMs != null && now - startedAt >= timeBudgetMs) {
        skipped.push({ check: item.check, reason: "time budget exceeded" });
        continue;
      }
      const remaining = timeBudgetMs != null ? Math.max(0, timeBudgetMs - (now - startedAt)) : null;
      if (item.check === "sca") {
        if (!item.available) { warnings.push(`${item.check}: not available - ${item.reason || "unavailable"}`); continue; }
        const r = await runSCA(item.cwd || baseDir, { timeoutMs: remaining });
        findings.push(...r.findings);
        warnings.push(...(r.warnings || []));
        executed++;
      } else if (item.check === "secrets") {
        // Always run; falls back to regex if gitleaks missing
        const r = await runSecrets(item.cwd || baseDir, { patterns: options.paths, timeoutMs: remaining });
        findings.push(...r.findings);
        warnings.push(...(r.warnings || []));
        executed++;
      } else if (item.check === "complexity") {
        // Attempt via npx even if not pre-detected
        const r = await runComplexity(item.cwd || baseDir, { patterns: options.paths, timeoutMs: remaining });
        findings.push(...r.findings);
        warnings.push(...(r.warnings || []));
        executed++;
      } else if (item.check === "lighthouse") {
        if (!item.available) { warnings.push(`${item.check}: not available - ${item.reason || "unavailable"}`); continue; }
        const url = process.env.QUALITYLAB_URL || null;
        const r = await runLighthouse(item.cwd || baseDir, url, { timeoutMs: remaining });
        findings.push(...r.findings);
        warnings.push(...(r.warnings || []));
        executed++;
      } else if (item.check === "semgrep") {
        if (!item.available) { warnings.push(`${item.check}: not available - ${item.reason || "unavailable"}`); continue; }
        const r = await runSemgrep(item.cwd || baseDir, { patterns: options.paths, timeoutMs: remaining });
        findings.push(...r.findings);
        warnings.push(...(r.warnings || []));
        executed++;
      } else if (item.check === "contract") {
        if (!item.available) { warnings.push(`${item.check}: not available - ${item.reason || "unavailable"}`); continue; }
        const r = await runOpenApiDrift(item.cwd || baseDir, since, { timeoutMs: remaining });
        findings.push(...r.findings);
        warnings.push(...(r.warnings || []));
        executed++;
      }
    } catch (e) {
      warnings.push(`${item.check}: execution error - ${e.message}`);
    }
  }
  const durationMs = Date.now() - startedAt;
  return { findings, warnings, runtime: { durationMs, executed, skipped } };
}

module.exports = { runPlannedChecks };
