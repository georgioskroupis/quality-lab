#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const base = process.env.QUALITYLAB_OUT_DIR || path.resolve(process.cwd(), "qualitylab-report");
const p = path.resolve(base, "findings.json");
let arr = [];
try { arr = JSON.parse(fs.readFileSync(p, "utf8")); } catch { arr = []; }

const rank = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
for (const f of arr) {
  const s = String(f.severity || 'info').toLowerCase();
  if (counts[s] != null) counts[s]++;
}
const total = arr.length;
const top = arr.slice().sort((a, b) => (rank[b.severity]||0)-(rank[a.severity]||0) || (b.confidence||0)-(a.confidence||0)).slice(0, 10);

function lineItems(items) {
  if (!items.length) return "- No findings";
  return items.map(f => `- [${(f.severity||'info').toUpperCase()}] ${f.title}${f.file?` — ${f.file}`:''} (id: ${f.id})`).join("\n");
}

const md = `### Quality Lab — Summary\n\n` +
`Critical: ${counts.critical} • High: ${counts.high}\n\n` +
`Findings: ${total} (critical: ${counts.critical}, high: ${counts.high}, medium: ${counts.medium}, low: ${counts.low}, info: ${counts.info})\n\n` +
`Top 10:\n\n${lineItems(top)}\n\n` +
`Artifacts: qualitylab-report/index.html`;

process.stdout.write(md + "\n");
