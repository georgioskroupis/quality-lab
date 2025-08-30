#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const threshold = String(process.argv[2] || 'none').toLowerCase();
const rank = { none: 0, info: 1, low: 2, medium: 3, high: 4, critical: 5 };
const tRank = rank[threshold] ?? 0;

const base = process.env.QUALITYLAB_OUT_DIR || path.resolve(process.cwd(), "qualitylab-report");
const p = path.resolve(base, "findings.json");
let arr = [];
try { arr = JSON.parse(fs.readFileSync(p, "utf8")); } catch { arr = []; }

let hit = false;
for (const f of arr) {
  const s = String(f.severity || 'info').toLowerCase();
  if ((rank[s] ?? 0) >= tRank && tRank > 0) { hit = true; break; }
}

if (hit) {
  console.error(`qualitylab: fail-on threshold '${threshold}' met`);
  process.exit(1);
} else {
  console.log(`qualitylab: fail-on threshold '${threshold}' not met`);
}
