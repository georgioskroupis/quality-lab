"use strict";

const fs = require("fs");
const path = require("path");
const { execCmd } = require("../utils/exec");

function discoverSpec(baseDir) {
  const candidates = [
    "openapi.yaml","openapi.yml","openapi.json",
    "swagger.yaml","swagger.yml","swagger.json"
  ];
  for (const name of candidates) {
    const p = path.join(baseDir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function changedFilesSince(baseDir, since) {
  if (!since) return [];
  const res = await execCmd("git", ["diff", "--name-only", since, "--", "."], { cwd: baseDir });
  if (res.code !== 0) return [];
  return res.stdout.split(/\r?\n/).filter(Boolean);
}

function isCodeChange(file) {
  const f = file.toLowerCase();
  if (f.includes("openapi") || f.includes("swagger") || f.includes("/spec") || f.endsWith(".yaml") || f.endsWith(".yml")) return false;
  const dirs = ["src/", "app/", "api/", "routes/", "controllers/"]; // heuristic
  const exts = [".ts", ".js", ".tsx", ".jsx", ".go", ".py", ".java", ".rb"];
  return dirs.some(d => f.includes(d)) && exts.some(e => f.endsWith(e));
}

function isSpecChange(file) {
  const f = file.toLowerCase();
  return f.includes("openapi") || f.includes("swagger") || f.includes("/spec/") || f.endsWith("openapi.yaml") || f.endsWith("openapi.yml") || f.endsWith("swagger.yaml") || f.endsWith("swagger.yml") || f.endsWith("openapi.json") || f.endsWith("swagger.json");
}

async function runOpenApiDrift(baseDir, since) {
  const spec = discoverSpec(baseDir);
  if (!since) {
    return { findings: [], warnings: ["contract: --since not provided; skipping drift assessment" ] };
  }
  const changed = await changedFilesSince(baseDir, since);
  if (!changed.length) return { findings: [], warnings: [] };

  const codeChanged = changed.some(isCodeChange);
  const specChanged = changed.some(isSpecChange);

  const findings = [];
  if (codeChanged && !specChanged) {
    findings.push({
      check: "contract",
      id: "openapi-drift",
      title: "Potential OpenAPI drift: code changed, spec not updated",
      severity: "medium",
      message: "Detected code changes in API areas without corresponding OpenAPI spec changes.",
      locations: [],
      meta: { since, specPresent: !!spec, changed },
      confidence: "medium"
    });
  }
  // Optionally, warn if spec exists but invalid JSON for .json
  if (spec && spec.endsWith(".json")) {
    try { JSON.parse(fs.readFileSync(spec, "utf8")); } catch (e) {
      findings.push({
        check: "contract",
        id: "openapi-invalid-json",
        title: "OpenAPI spec JSON is invalid",
        severity: "high",
        message: e.message,
        locations: [{ file: spec, line: 1 }],
        meta: {},
        confidence: "high"
      });
    }
  }
  return { findings, warnings: [] };
}

module.exports = { runOpenApiDrift };
