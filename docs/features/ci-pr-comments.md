# CI: PR cost-diff comments

[← Docs index](../README.md)

`.github/workflows/terraform-cost.yml` runs on every pull request that touches a `.tf` file and comments the estimated monthly cost, plus the delta vs. the PR's base branch, directly on the PR — updating the same comment on subsequent pushes rather than spamming a new one each time.

```
💰 Terraform Cost Estimate
$1,384.74/mo (base: $1,330.05/mo) — 📈 +$54.69/mo

| Provider | Monthly |
|---|---|
| AWS | $700.30/mo |
| Microsoft Azure | $360.10/mo |
| Google Cloud | $340.10/mo |

32 cost-relevant resources across 11 file(s).
```

**How it works:** `scripts/ci-cost-report.js` is a small headless CLI wrapper that reuses `src/core/terraform-parser.js` + `src/core/cost-calculator.js` directly — the same production code the VS Code extension itself runs, not a second implementation to drift out of sync with the first. Both modules only ever touch `vscode.workspace.getConfiguration(...).get(key, default)`, never any other `vscode` API, as long as `TerraformCostCalculator.initialize()` is never called (which the CLI deliberately never does — that's what would otherwise try to shell out to a real `infracost` binary that won't exist in CI) — so a one-function stub returning the caller's own default for every config key is enough to run them standalone. The workflow checks out both the PR branch and its base into separate directories, runs the CLI against each, and diffs the totals.

**Try it**: `node scripts/ci-cost-report.js test/fixtures/complex-project` locally — should print the same `$1,330.05` total documented in that fixture's own README, since it's the identical calculation path.

**Verified on GitHub**: the workflow first ran for real on [PR #1](https://github.com/SnakeyEye497/terraformCost/pull/1) and posted its comment successfully. Note that it scans every `.tf` file in the repository, including `examples/` and `test/fixtures/`, so in this repo the comment reflects those sample projects.
