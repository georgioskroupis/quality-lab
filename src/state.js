"use strict";

const fs = require("fs");
const path = require("path");

function statePath(repoRoot) {
  return path.join(repoRoot, ".qualitylab", "state.json");
}

function loadState(repoRoot) {
  const p = statePath(repoRoot);
  try {
    const txt = fs.readFileSync(p, "utf8");
    const data = JSON.parse(txt);
    return normalizeState(data);
  } catch {
    return { entries: {} };
  }
}

function normalizeState(data) {
  if (!data) return { entries: {} };
  if (Array.isArray(data.entries)) {
    const map = {};
    for (const e of data.entries) {
      if (e && e.key) map[e.key] = e;
    }
    return { entries: map };
  }
  if (data.entries && typeof data.entries === "object") {
    return { entries: data.entries };
  }
  return { entries: {} };
}

function keyForFinding(f) {
  const check = f.check || "";
  const id = f.id || "";
  const file = (Array.isArray(f.locations) && f.locations[0] && f.locations[0].file) ? f.locations[0].file : (f.file || "");
  return [check, id, file].join("|");
}

function attachState(findings, state) {
  const out = [];
  const entries = (state && state.entries) || {};
  for (const f of findings || []) {
    const key = keyForFinding(f);
    const st = entries[key] || null;
    out.push({ finding: f, key, state: st });
  }
  return out;
}

module.exports = { loadState, attachState, keyForFinding, statePath };

