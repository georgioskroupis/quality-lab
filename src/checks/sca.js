"use strict";

const fs = require("fs");
const path = require("path");
const { execCmd } = require("../utils/exec");

function hasFile(dir, name) {
  try { return fs.existsSync(path.join(dir, name)); } catch { return false; }
}

function mapSeverity(s) {
  const v = String(s || "").toLowerCase();
  if (v.includes("critical")) return "critical";
  if (v.includes("high")) return "high";
  if (v.includes("moderate") || v.includes("medium")) return "medium";
  if (v.includes("low")) return "low";
  return "info";
}

function confidenceFromSeverity(sev) {
  const v = String(sev || "").toLowerCase();
  if (v === "critical" || v === "high") return "high";
  if (v === "medium" || v === "moderate") return "medium";
  return "low";
}

function normalizeNpmAudit(json) {
  const findings = [];
  if (!json) return findings;
  // npm v7+ has vulnerabilities object; v6 had advisories
  if (json.vulnerabilities && typeof json.vulnerabilities === "object") {
    const viaToArray = (via) => Array.isArray(via) ? via : [via];
    Object.keys(json.vulnerabilities).forEach((name) => {
      const v = json.vulnerabilities[name];
      const severity = mapSeverity(v.severity);
      const title = `SCA: ${name} ${v.severity}`;
      const viaList = (v.via || []).map(x => typeof x === "string" ? x : (x && x.title) || "");
      findings.push({
        check: "sca",
        id: `${name}@${v.range || v.fixAvailable || "*"}`,
        title,
        severity,
        message: viaList.filter(Boolean).join("; "),
        locations: [],
        meta: {
          package: name,
          severity: v.severity,
          range: v.range || null,
          fixAvailable: v.fixAvailable || null,
          via: viaToArray(v.via),
        },
        confidence: confidenceFromSeverity(severity),
      });
    });
  } else if (json.advisories) {
    Object.values(json.advisories).forEach((adv) => {
      findings.push({
        check: "sca",
        id: String(adv.id),
        title: `SCA: ${adv.module_name} ${adv.severity}`,
        severity: mapSeverity(adv.severity),
        message: adv.title,
        locations: [],
        meta: {
          module: adv.module_name,
          vulnerable_versions: adv.vulnerable_versions,
          recommendation: adv.recommendation,
          url: adv.url,
        },
        confidence: confidenceFromSeverity(adv.severity),
      });
    });
  }
  return findings;
}

async function runSCA(baseDir, options = {}) {
  const havePkg = hasFile(baseDir, "package.json");
  if (!havePkg) return { findings: [], warnings: ["SCA: package.json not found"] };
  // Prefer npm audit for MVP; yarn support can be added later
  const res = await execCmd("npm", ["audit", "--json"], { cwd: baseDir, timeoutMs: options.timeoutMs });
  if (res.code !== 0 && !res.stdout) {
    return { findings: [], warnings: ["SCA: npm audit failed", res.stderr.trim()].filter(Boolean) };
  }
  let json = null;
  try {
    json = JSON.parse(res.stdout || "{}");
  } catch (e) {
    return { findings: [], warnings: ["SCA: failed to parse npm audit JSON: " + e.message] };
  }
  const findings = normalizeNpmAudit(json);
  return { findings, warnings: [] };
}

module.exports = { runSCA };
