"use strict";

const { spawn } = require("child_process");

function execCmd(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args || [], { cwd: opts.cwd || process.cwd(), env: opts.env || process.env, shell: false });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let timeout = null;
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timeout = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
      }, opts.timeoutMs);
    }
    child.stdout.on("data", (d) => { stdout = Buffer.concat([stdout, d]); });
    child.stderr.on("data", (d) => { stderr = Buffer.concat([stderr, d]); });
    child.on("error", (error) => {
      if (timeout) clearTimeout(timeout);
      resolve({ code: -1, stdout: stdout.toString("utf8"), stderr: (stderr.toString("utf8") + "\n" + (error && error.message || "")).trim() });
    });
    child.on("close", (code) => {
      if (timeout) clearTimeout(timeout);
      resolve({ code, stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8") });
    });
  });
}

module.exports = { execCmd };
