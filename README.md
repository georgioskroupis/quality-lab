Quality Lab CLI (MVP skeleton)

Commands
- `qualitylab scan <path> [--json] [--since <rev>]`

Examples
- `qualitylab scan .`
- `qualitylab scan . --json > report.json`
- `qualitylab scan . --since HEAD~1`
- Set a URL for Lighthouse: `QUALITYLAB_URL=https://example.com qualitylab scan . --json`

Behavior
- Runs a scan and emits a report with `findings` and `planned` checks.
- `--json` outputs a JSON report to stdout for redirecting.
- Loads `.qualitylab.yml` from repo root (or nearest parent) with minimal schema:
  - `packs: [web-saas@1]`
  - `checks: [sca, secrets, complexity, lighthouse]`
- If missing/invalid, falls back to defaults: `packs: []`, `checks: []` and records a warning.
- Minimal pack registry: hardcoded `web-saas@1` maps checks → runners and executes where possible:
  - `sca` → `npm audit --json` (requires `package.json`). Parses JSON to SCA findings.
  - `secrets` → `gitleaks detect --no-git --report-format json` if available; otherwise regex fallback over repo files.
  - `complexity` → attempts `npx -y eslint` with `complexity` rule (tries even if ESLint isn’t pre-installed).
  - `lighthouse` → `lighthouse` (or `npx lighthouse`) with `--output=json` (requires URL via `QUALITYLAB_URL`). Reports LCP only.
- External tools may require network/installation. If a tool is unavailable, the runner either falls back (secrets) or records a warning (others).

Packs
- Available packs (MVP):
  - `web-saas@1` (web app focus): sca, secrets, complexity, lighthouse
  - `api@1` (backend/API focus): sca, secrets, complexity
  - `api-service@1` (service security focus): sca, secrets, complexity, semgrep, contract drift (OpenAPI)

Notes on new checks
- `semgrep` (api-service@1): requires `semgrep` in PATH; runs `semgrep --config p/owasp-top-ten --json` and parses results.
- `contract` (api-service@1): basic OpenAPI drift heuristic. Requires `--since` to compare changed files; if API code changed without spec changes, emits a medium-severity finding.

Reports
- After each scan, exports to `./qualitylab-report/`:
  - `findings.json`: simplified array with fields `{ id, severity, title, file, confidence }`
  - `index.html`: Action Board (interactive) with filters and per-finding actions
    - Filters: severity, confidence, state (active/accepted/false positive/snoozed)
    - Actions:
      - Accept → Ticket: mark finding as accepted and include in downloadable `tickets.json`
      - False Positive: mark as false positive
      - Snooze 7d: temporarily snooze; will show as snoozed until expiry
    - Use "Download State JSON" to save changes.
  - `state.json`: a copy of the current state embedded for convenience

Persisting state
- Optional repo state file: `.qualitylab/state.json`
  - Place the downloaded `state.json` there to persist across runs and CI.
  - State keys are stable: `check|id|file`. You can review/edit manually.

Local usage
- Run via Node: `node bin/qualitylab.js scan . --json`
- Or add a global link: `npm link` then use `qualitylab` directly.

Config
- Place `.qualitylab.yml` at repo root. MVP supports inline array syntax on one line per key:
  - `packs: [web-saas@1]`
  - `checks: [sca, secrets]`
- Unknown or malformed values are ignored with a warning; defaults are used.

CI (GitHub Actions)
- Add a workflow that checks out your repo and uses this action to scan, upload the Action Board, comment on PRs, and optionally fail on a threshold.

Example workflow: `.github/workflows/qualitylab.yml`

```yaml
name: Quality Lab
on:
  pull_request:
  push:
    branches: [ main ]

permissions:
  contents: read
  pull-requests: write

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: qualitylab/scan@v1
        with:
          fail-on: critical
          comment-pr: true
          lighthouse-url: https://example.com
```

Inputs
- `fail-on`: fail the job if any finding is at or above the given severity (`critical|high|medium|low|info|none`).
- `comment-pr`: if `true`, posts a summary comment on pull requests.
- `lighthouse-url`: optional target URL for Lighthouse.
