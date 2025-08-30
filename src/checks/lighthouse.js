"use strict";

const { execCmd } = require("../utils/exec");

function classifyLcp(ms) {
  if (ms == null) return { severity: "info", note: "LCP unavailable" };
  if (ms <= 2500) return { severity: "low", note: "Good LCP" };
  if (ms <= 4000) return { severity: "medium", note: "Needs improvement" };
  return { severity: "high", note: "Poor LCP" };
}

async function runLighthouse(baseDir, url, options = {}) {
  if (!url) {
    return { findings: [], warnings: ["lighthouse: missing URL; set QUALITYLAB_URL or provide config later"] };
  }
  const args = [url, "--output=json", "--quiet", "--only-categories=performance", "--chrome-flags=--headless,new-window,no-first-run,no-default-browser-check"];
  // Try lighthouse binary first, else npx
  let res = await execCmd("lighthouse", args, { cwd: baseDir, timeoutMs: options.timeoutMs });
  if (res.code !== 0 || !res.stdout.trim()) {
    res = await execCmd("npx", ["-y", "lighthouse", ...args], { cwd: baseDir, timeoutMs: options.timeoutMs });
  }
  if (!res.stdout.trim()) {
    return { findings: [], warnings: ["lighthouse: CLI produced no output", res.stderr.trim()].filter(Boolean) };
  }
  let report = null;
  try { report = JSON.parse(res.stdout); } catch (e) {
    return { findings: [], warnings: ["lighthouse: failed to parse JSON: " + e.message] };
  }
  const lcp = report && report.audits && report.audits["largest-contentful-paint"] && report.audits["largest-contentful-paint"].numericValue;
  const { severity, note } = classifyLcp(lcp);
  const findings = [{
    check: "performance",
    id: "lcp",
    title: "Largest Contentful Paint",
    severity,
    message: `${note}. LCP=${lcp != null ? Math.round(lcp) : "n/a"} ms`,
    locations: [],
    meta: { lcp },
    confidence: "high"
  }];
  return { findings, warnings: [] };
}

module.exports = { runLighthouse };
