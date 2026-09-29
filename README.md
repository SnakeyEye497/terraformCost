# Matali - Terraform Cost Calculator

> **Ride the cloud, not the cost**

A VS Code extension that estimates the monthly/yearly cost of your Terraform infrastructure **as you write it** — inline next to each resource, as a total-cost header at the top of the file, and as a running total in the status bar. Supports AWS, GCP, and Azure, with optional [Infracost](https://www.infracost.io) integration for accurate live pricing (falls back to built-in estimated pricing if no API key is configured).

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## What this project is

It's a plain-JavaScript VS Code extension (no TypeScript, no bundler required to run it) built around a small pipeline:

```
.tf file text (active file; every .tf file via src/workspace-scanner.js,
   which resolves local module calls via src/module-resolver.js; or a
   `terraform show -json` plan via src/plan-parser.js)
   -> src/terraform-parser.js       parses HCL into resources/variables
   -> src/cost-calculator.js        looks up/estimates monthly cost per resource
        (optionally via src/infracost-integration.js, the Infracost CLI)
   -> src/cost-decorator.js         renders inline decorations + total-cost header
   -> src/status-bar-manager.js     shows the running total in the status bar
   -> src/cost-dashboard.js         charts for the active file, the whole workspace, or a loaded plan
   -> src/budget-manager.js         compares total cost against terraform.budget.json
        (optionally -> src/notification-manager.js, posts Slack/Teams alerts on threshold crossings)
   -> src/capacity-manager.js       reads expected load from terraform.capacity.json
   -> src/cost-history-manager.js   reads/appends recorded snapshots in terraform-cost-history.json
   -> src/ai-advisor.js             (optional) asks Gemini/Claude/GPT/DeepSeek/Groq for cost AND scaling suggestions
   -> src/excel-exporter.js         builds a multi-sheet .xlsx report from all of the above
   -> src/error-handler.js          centralizes error logging/reporting

scripts/ci-cost-report.js reuses terraform-parser.js + cost-calculator.js
headlessly (outside the extension host) for .github/workflows/terraform-cost.yml
```

All of this is wired together in [extension.js](extension.js), the extension's entry point.

## What's currently implemented

✅ **Working and test-covered** (19/19 tests passing — parser, cost-calculator, integration, and config tests):

- **Terraform/HCL parsing** — resources, variables, numeric/boolean attributes, variable-reference resolution.
- **Cost calculation** for:
  - **AWS**: EC2 instances, RDS databases, S3 buckets, EBS volumes, NAT gateways, Load Balancers (`lb`/`alb`/`nlb`)
  - **GCP**: Compute Engine instances, Cloud SQL, Cloud Storage, Persistent Disks
  - **Azure**: Virtual Machines, SQL Databases, Storage Accounts, Managed Disks
- **Inline cost decorations** next to each resource, live as you type (debounced, default 2s).
- **Total infrastructure cost header** at the top of the file (green/yellow/red depending on budget status).
- **Status bar total cost** display.
- **Optional Infracost CLI integration** for real pricing data (falls back to built-in estimates automatically if the CLI/API key isn't available — see `infracostAvailable` in the activation log).
- **Budget thresholds** via an optional `terraform.budget.json` file per workspace — `limit_1/2/3` turn the header yellow with a budget-message block, `final_limit` turns it red and raises an error diagnostic + popup. Threshold-crossing is watched live (the extension re-evaluates when the budget file is created/changed/deleted).
- **AI cost optimization suggestions** — pick a provider (Gemini, Claude, GPT, DeepSeek, or Groq), save its API key securely, and get concrete, resource-specific suggestions (rightsizing, reserved capacity, architecture swaps) for the active file's actual resources and costs. User-triggered only, not automatic. See [AI cost optimization](#ai-cost-optimization) below.
- **Workspace-wide dashboard** — a **This file / Whole workspace** toggle scans every `.tf` file (via `src/workspace-scanner.js`) and re-aggregates the same charts across the whole project, plus a cost-by-file/module breakdown that only makes sense at that scope. See [Cost dashboard](#cost-dashboard) below.
- **AI capacity & scaling suggestions** — tell it expected load (users/day, requests/day, growth) via an interactive input wizard, saved to `terraform.capacity.json`, and get scale-up/scale-down suggestions reasoned against that load rather than just cost. Same AI provider/key as cost suggestions; separate, explicit trigger. See [Capacity & scaling](#capacity--scaling) below.
- **Excel cost report export** — a multi-sheet `.xlsx` (Summary, per-resource Resources sheet, By Provider, By Resource Type, By File/Module for workspace scope, 12-Month Forecast, Budget, Capacity Inputs, and cached AI/Scaling Suggestions if you've run either this session) for sharing with people who don't use VS Code. See [Exporting a cost report](#exporting-a-cost-report) below.
- **GitHub Action for PR cost-diff comments** — `.github/workflows/terraform-cost.yml` comments the estimated monthly cost (and the delta vs. the PR's base branch) on every PR touching a `.tf` file, using the *same* parser/calculator the extension itself uses via a small headless CLI wrapper (`scripts/ci-cost-report.js`), not a second implementation. See [CI: PR cost-diff comments](#ci-pr-cost-diff-comments) below.
- **Scope-aware AI suggestions** — the AI cost/scaling cards analyze whichever scope the dashboard currently shows: the active file, or (switch to "Whole workspace" first) every resource across the entire project, each suggestion tagged with its source file. Workspace-scope calls cap at the 150 highest-cost resources to avoid silently exceeding a provider's context window on a large project.
- **Slack/Teams budget alert webhooks** — an optional `terraform.budget.json` threshold crossing can also post to a Slack or Microsoft Teams incoming webhook, not just the in-editor popup — same anti-spam "only on crossing into a higher level" logic as the popup, one source of truth for both. See [Budget alert webhooks](#budget-alert-webhooks) below.
- **Module-graph resolution** — workspace scope follows local `module "x" { source = "./..." }` calls the way real Terraform does: a module's variables come from what its caller actually passed in (falling back to the module's own `default`), and a module instantiated twice with different values produces two correctly-different resolved resource sets, not one shared/flattened one. See [Module-graph resolution](#module-graph-resolution) below.
- **`terraform plan`-based costing** — load a real `terraform show -json` plan (or a binary `.tfplan`, auto-converted if `terraform` is on PATH) and cost exactly what will exist after it applies — accurate for anything static parsing can't evaluate (`count`/`for_each`, computed values, module outputs), since Terraform's own plan engine already resolved all of it. See [Terraform plan-based costing](#terraform-plan-based-costing) below.
- **Cost history tracking** — explicitly record a timestamped snapshot of the current scope's total to `terraform-cost-history.json`, and see real recorded totals (not a projection) as a trend chart in the dashboard. See [Cost history](#cost-history) below.
- **Commands** wired up in the Command Palette: `Calculate Costs`, `Toggle Cost Display`, `Refresh Cost Estimates`, `Toggle Total Cost Header`, `Show Cost Dashboard`, `Show Workspace Cost Dashboard`, `Get AI Cost Optimization Suggestions`, `Set/Clear AI Provider API Key`, `Get Scaling Suggestions`, `Set Capacity & Scaling Inputs`, `Export Cost Report (Excel)`, `Set/Clear Budget Alert Webhook`, `Calculate Costs from Terraform Plan`, `Record Cost Snapshot`.
- **Error handling/logging** via `src/error-handler.js`, including `clearErrorLog` / `exportErrorLog` commands — these two are registered in code but not yet declared in `package.json`'s `contributes.commands`, so they run from the Command Palette under their raw id rather than a friendly title.
- **20+ configuration settings** (see table below).

⚠️ **Known gaps / not yet done:**

- **No `webpack.config.js`** — `npm run package` / `compile` / `watch` reference webpack but there's no config for it in the repo, so those scripts currently fail. The extension doesn't need bundling to run or test (it `require()`s `src/*.js` directly), so this only matters for producing a packaged `.vsix` for the Marketplace.
- **Not published anywhere** — `package.json` still has placeholder `publisher: "UnknownPublisher"` and a `yourusername` GitHub URL.
- **`npm audit`** currently reports 7 vulnerabilities (3 moderate, 4 high) — most in dev-only tooling (eslint 8.x line, etc.), plus one new one from adding `exceljs`: it depends on a `uuid` version with a buffer-bounds issue (only triggers if code passes a custom undersized buffer into uuid generation — unlikely how `exceljs` uses it internally, but real). None exploit-relevant for local development; worth revisiting before a real release. `npm audit fix --force` would resolve the `exceljs` one but downgrades it to 3.4.0, a breaking change — not applied.
- **18 `no-unused-vars` ESLint warnings** (0 errors) — cosmetic cleanup, not blocking.
- **The formal 19-test `npm test` suite only covers the parser/calculator**, not most of the newer UI-facing features (the scope toggle, AI cost/scaling suggestions, the capacity wizard). Those are syntax-checked and lint-clean but only verified by hand via F5, not by an automated regression suite — a real gap if this grows further. Several of the newer *non-UI* modules do have real (if informal, one-off) verification behind them, just not wired into `npm test`: the Excel exporter (build → write → reopen with `exceljs`'s own reader → check every sheet), `src/module-resolver.js` (8 scenarios including the specific mutation bug two instantiations of one module could hit), and `terraform plan`-based costing (verified against a genuine `terraform init && plan && show -json` run, not a hand-authored JSON).
- **Module-graph resolution only covers local module sources.** A registry/git/other remote `module` source (anything not starting with `./` or `../`) can't be resolved statically — a resource that lives only inside one simply won't be found by workspace scope. `count`/`for_each` on a `module` block itself also isn't handled. Load a real `terraform show -json` plan instead (see below) for a project that leans on remote modules — Terraform's own plan engine has already resolved all of that by the time that JSON exists.
- **The GitHub Action (`.github/workflows/terraform-cost.yml`) has never actually run on GitHub's runners.** Its logic is verified locally — the CLI script against real fixtures, the comment create/update logic against mocked GitHub API calls — but live execution needs a real PR, which requires a push that wasn't made autonomously. First real PR touching a `.tf` file will be the first real test.
- **Slack/Teams budget webhooks have never posted to a real channel.** Payload construction and error handling are verified against a mocked `fetch` (both providers, an HTTP-error case, and a missing-URL case) — but there's no real Slack/Teams webhook URL to test actual delivery against. Also: Microsoft has been deprecating classic Office 365 Connector webhooks in Teams in favor of Workflows/Power Automate, so the Teams integration's `MessageCard` format may need updating depending on how a given Teams workspace is configured — worth checking before relying on it.
- **Budget webhooks only fire on file-scope threshold crossings**, the same trigger point the in-editor popup already uses. Workspace-scope's budget meter is visual-only in the dashboard and doesn't independently post an alert.

## Installation (cloning from GitHub)

```bash
git clone <this-repo-url>
cd terraformCost
npm install
```

That's it for getting the code runnable — `npm install` pulls in everything needed for linting, testing, and running the extension in a VS Code Extension Development Host (see [RUNNING.md](RUNNING.md)).

**Requirements:**
- [Node.js](https://nodejs.org) (tested on v22+) and npm
- VS Code `^1.85.0`
- Internet access the *first* time you run `npm test` — it downloads a standalone copy of VS Code (~330MB) to `.vscode-test/` to run the extension host tests in. Cached after that.
- (Optional) An [Infracost API key](https://www.infracost.io) for accurate live pricing — without one, the extension uses its built-in fallback pricing tables.
- (Optional) An API key for AI cost optimization suggestions — from [Google AI Studio](https://aistudio.google.com/apikey) (Gemini), [Anthropic](https://console.anthropic.com/) (Claude), [OpenAI](https://platform.openai.com/) (GPT), [DeepSeek](https://platform.deepseek.com/) (low-cost, no minimum spend), or [Groq](https://console.groq.com/) (genuinely free tier, no card required — the easiest one to try first). Note: a Gemini key created through Cloud/Vertex billing rather than the plain AI Studio flow may require a prepay balance before it can generate content at all; the free-tier AI Studio key usually doesn't.

There is no published `.vsix` / Marketplace listing yet, so the only way to use the extension today is to run it from source — see **[RUNNING.md](RUNNING.md)** for the step-by-step walkthrough (Run Extension via F5, the commands to try, and what to expect).

## Configuration

Access via VS Code Settings (`Ctrl+,`) → search "Terraform Cost", or edit `settings.json` directly.

| Setting | Default | Description |
|---------|---------|-------------|
| `terraformCost.enabled` | `true` | Enable/disable extension |
| `terraformCost.useInfracost` | `true` | Use Infracost for accurate pricing |
| `terraformCost.infracostApiKey` | `""` | Your Infracost API key |
| `terraformCost.providers` | `["aws","gcp","azure"]` | Cloud providers to support |
| `terraformCost.currency` | `USD` | Display currency (USD, EUR, GBP, JPY) |
| `terraformCost.region` | `{aws:us-east-1, gcp:us-central1, azure:eastus}` | Default region per provider |
| `terraformCost.updateInterval` | `2000` | Delay before recalculating (ms) |
| `terraformCost.showInlineDecorations` | `true` | Show costs inline |
| `terraformCost.showStatusBar` | `true` | Show total in status bar |
| `terraformCost.showTotalCostHeader` | `true` | Show cost summary at top |
| `terraformCost.useSeparateBudgetDecoration` | `true` | Show budget messages as a separate block under the total header |
| `terraformCost.expensiveThreshold` | `100` | Threshold (USD/mo) to highlight expensive resources |
| `terraformCost.ai.provider` | `none` | AI provider for cost suggestions: `none`, `gemini`, `claude`, `openai`, `deepseek`, `groq` |
| `terraformCost.ai.model` | `""` | Override the default model id for the selected AI provider |

API keys for the AI provider are **not** a setting — set them via the `Terraform Cost: Set AI Provider API Key` command, which stores them in VS Code's SecretStorage rather than plain-text `settings.json` (unlike `infracostApiKey`, which currently is a plain string setting).

### Cost indicators

- 🟢 Green — < $10/month
- 🟡 Yellow — $10–50/month
- 🟠 Orange — $50–100/month
- 🔴 Red — > $100/month

### Optional budgeting (`terraform.budget.json`)

Drop a `terraform.budget.json` in your workspace root (or any parent folder of your `.tf` files):

```json
{
  "final_limit": 2000.00,
  "limit_1": 100.00,
  "limit_2": 500.00,
  "limit_3": 1000.00
}
```

- `limit_1/2/3` reached → header turns yellow, a budget-message block appears.
- `final_limit` reached → header turns red, an error diagnostic + popup appears.
- Notifications only fire when crossing into a *higher* threshold (no spam).
- Delete the file to disable the feature for that workspace.

## Commands

| Command | What it does |
|---|---|
| `Terraform Cost: Calculate Costs` | Manually (re-)calculate costs for the active file |
| `Terraform Cost: Refresh Cost Estimates` | Clears the cost cache and recalculates all open Terraform files |
| `Terraform Cost: Toggle Cost Display` | Show/hide inline cost decorations |
| `Terraform Cost: Toggle Total Cost Header` | Show/hide the total-cost header at the top of the file |
| `Terraform Cost: Show Cost Dashboard` | Opens a visual dashboard (see below), defaulting to the active Terraform file |
| `Terraform Cost: Show Workspace Cost Dashboard` | Same dashboard, opened straight into "whole workspace" scope |
| `Terraform Cost: Get AI Cost Optimization Suggestions` | Asks the configured AI provider for suggestions on whichever scope the dashboard currently shows (file or whole workspace) |
| `Terraform Cost: Set AI Provider API Key` | Pick a provider (Gemini/Claude/GPT/DeepSeek/Groq) and securely save its API key |
| `Terraform Cost: Clear AI Provider API Key` | Remove a saved AI provider API key |
| `Terraform Cost: Get Scaling Suggestions` | Asks the configured AI provider whether the current scope's resources are right-sized for your expected load |
| `Terraform Cost: Set Capacity & Scaling Inputs` | Interactive wizard for expected users/requests/growth, saved to `terraform.capacity.json` |
| `Terraform Cost: Export Cost Report (Excel)` | Prompts for scope, then saves a multi-sheet `.xlsx` cost report via a native save dialog |
| `Terraform Cost: Set Budget Alert Webhook (Slack/Teams)` | Pick Slack or Teams and securely save an incoming webhook URL for budget-threshold alerts |
| `Terraform Cost: Clear Budget Alert Webhook` | Remove the saved webhook and disable alerts |
| `Terraform Cost: Calculate Costs from Terraform Plan` | Pick a `terraform show -json` plan (or binary `.tfplan`) and cost every resource that will exist after it applies |
| `Terraform Cost: Record Cost Snapshot` | Append the current scope's total to `terraform-cost-history.json` for the dashboard's Cost History chart |

Access via Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).

## Cost dashboard

`Terraform Cost: Show Cost Dashboard` (or the graph icon in a `.tf` file's editor toolbar) opens a webview panel with a **This file / Whole workspace** toggle at the top, and:

- A **hero total** (monthly/yearly/hourly cost, resource + provider counts — plus a files-scanned count in workspace scope), animated on every update.
- A **donut chart** — cost broken down by resource type (top 5 + "Other"), with a legend and a "View as table" toggle.
- A **bar chart** — cost by cloud provider (AWS / GCP / Azure).
- **Workspace scope only**: a **cost-by-file/module** bar chart — which file in a multi-file project is actually driving the bill.
- A **12-month forecast** — cumulative spend if usage stays flat vs. an illustrative ~5%/month growth scenario, with a hover crosshair/tooltip.
- A **budget meter** (only shown when a `terraform.budget.json` applies) showing spend against your configured limits.

**File scope** reuses the same cost calculation the inline decorations use, and re-renders automatically whenever you edit/save the tracked file or switch to another Terraform file (see `buildDashboardAggregate` / `updateDashboard` in [extension.js](extension.js)).

**Workspace scope** is powered by `src/workspace-scanner.js`, which finds every `.tf` file in the workspace (excluding `.terraform/`, `node_modules/`, `.git/`), resolves resources the way real Terraform would — following local `module` calls (see [Module-graph resolution](#module-graph-resolution) below) — and tags each with its source file. Because scanning every file is more expensive than recalculating one, workspace scope only refreshes on file save, on switching into that scope, or the panel's manual **Refresh** button — not on every keystroke the way file scope does.

Both scopes share the same rendering code (`src/cost-dashboard.js`, a `vscode.WebviewPanel`, vanilla HTML/CSS/SVG/JS — no chart library, no network calls); only the data feeding it differs.

## Module-graph resolution

Workspace scope doesn't just flatten every file's resources into one list — `src/module-resolver.js` follows local `module "x" { source = "./..." }` calls the way real Terraform does:

- A module's variables come from what its caller actually passed in (`instance_type = "m5.xlarge"` in the `module` block), falling back to the module's own `default` only if the caller didn't pass one.
- A module instantiated **more than once** — e.g. `module "prod" { source = "./modules/app", instance_type = "m5.xlarge" }` and `module "dev" { source = "./modules/app", instance_type = "t3.micro" }` — produces **two independently-resolved resource sets**, not one shared/flattened one. (This needed a specific fix: the naive approach mutates parsed resource objects in place, so a second instantiation would silently inherit the first's already-resolved values — module-resolver.js deep-clones before resolving each instantiation to avoid that.)
- A caller can forward its own variable straight into a child module (`foo = var.bar`) and it resolves correctly against the caller's own scope.
- Nested modules (a module that itself calls further modules) work, with a cycle guard and a depth limit (12) against a module accidentally referencing itself.
- Each resolved resource is tagged with a `modulePath` (e.g. `app.compute` for a nested call) shown throughout the dashboard, export, and AI suggestions alongside — or in place of — the source file.

**What's out of scope, deliberately**: remote module sources (Terraform Registry, git, S3 — anything not starting with `./` or `../`) can't be resolved statically; a resource that lives only inside one won't be found by workspace scope. Neither is `count`/`for_each` on a `module` block itself. For a project that leans on either, load a real [`terraform` plan](#terraform-plan-based-costing) instead — Terraform's own plan engine has already resolved all of that.

**Verification**: `src/module-resolver.js` has no `vscode` dependency (pure functions over already-parsed content), so it's directly unit-tested — 8 scenarios including no-modules (must match old behavior exactly), single/multiple instantiation, variable passthrough, nesting, a remote source (skipped gracefully, not a crash), and cycle detection. Also re-run against the real `test-fixtures/complex-project` fixture end-to-end and confirmed it produces the *exact* previously-verified total ($1,345.81, 31 resources) — a genuine regression check, not an assumption, since that fixture's module calls happen to pass no overrides.

## AI cost optimization

An "✨ AI cost optimization suggestions" card in the dashboard (and the `Terraform Cost: Get AI Cost Optimization Suggestions` command) sends the active file's resources + calculated costs to a user-chosen LLM and asks for concrete, resource-specific suggestions — rightsizing, reserved instances/savings plans, storage tier changes, architecture swaps (e.g. NAT Gateway → VPC endpoint) — each with an estimated monthly saving where the model can reasonably infer one.

**Setup:**
1. Run `Terraform Cost: Set AI Provider API Key`, pick **Gemini**, **Claude**, or **GPT**, and paste your key. This also sets `terraformCost.ai.provider` to match. Keys are stored via VS Code's `SecretStorage`, not in `settings.json`.
2. Run `Terraform Cost: Get AI Cost Optimization Suggestions` (or click "✨ Ask AI for suggestions" in the dashboard).

**Design notes:**
- **Explicitly user-triggered, never automatic** — it doesn't fire on every keystroke or file save, so it never silently burns API quota/cost.
- **Follows the dashboard's current scope** — analyzes the active file when the dashboard is in file scope, or every resource across the whole workspace when it's in workspace scope (no separate toggle to remember; whatever charts you're looking at is what gets analyzed). Workspace-scope calls cap at the 150 highest-cost resources to avoid silently blowing past a provider's context window on a very large project, and note the truncation in the prompt when it happens. Each suggestion is tagged with its source file (looked up from the original resource list, not trusted from the model's own response) so a workspace-wide suggestion is actually actionable — you know which file to go edit.
- **Provider-agnostic**: `src/ai-advisor.js` has one thin adapter per API shape (`fetch` calls to Gemini's `generateContent`, Anthropic's Messages API, and one shared OpenAI-compatible chat-completions adapter reused by OpenAI, DeepSeek, and Groq — no SDKs, keeps the extension small) behind a single `getSuggestions()` interface.
- **Defensive response parsing**: the model is asked to return strict JSON; if it doesn't, the raw text is still surfaced as a single suggestion rather than silently failing.
- Rendered suggestions are HTML-escaped in the webview before display, since they're untrusted model output.

## Capacity & scaling

A separate "📈 Capacity & scaling suggestions" card asks a different question than cost: *given this resource is a `t3.medium`, and I expect 50k requests/day and 500 concurrent users, is that the right size?* It reasons about under-provisioning (bottleneck risk) as well as over-provisioning (paying for headroom nobody uses).

**Setup:**
1. Run `Terraform Cost: Set Capacity & Scaling Inputs` (or click **Set capacity inputs** in the dashboard card). A short wizard asks for expected daily users, requests/day, peak requests/second, and expected growth %/month — all optional, leave any blank to skip. Saved to `terraform.capacity.json` at the workspace root (same directory-walk-up pattern as `terraform.budget.json`).
2. Run `Terraform Cost: Get Scaling Suggestions` (or click **Get scaling suggestions** in the dashboard). Uses the same AI provider/key as cost suggestions — no separate setup.

Example `terraform.capacity.json`:
```json
{
  "expected_users": 5000,
  "requests_per_day": 200000,
  "peak_requests_per_second": 50,
  "growth_rate_percent": 10
}
```

**Design notes:**
- **AI-required, deliberately no hardcoded sizing tables.** A hand-maintained "a `t3.medium` handles ~X req/s" lookup table would hit the exact same staleness problem the AI model-id defaults already did (see `src/ai-advisor.js`'s comments) — except with no live endpoint to catch it drifting. Letting the model reason over the numbers, clearly framed as a rough estimate, was judged more honest than a lookup table with false authority.
- Same explicitly-user-triggered, dashboard-scope-following behavior as cost suggestions (see [Scope-aware AI suggestions](#ai-cost-optimization) above) — follows file, workspace, or a loaded plan, whichever the dashboard currently shows.
- Response shape mirrors cost suggestions but with `action: "scale_up" | "scale_down" | "keep"` and `suggestedChange` instead of `category`/`estimatedMonthlySavings` — see `buildScalingPrompt` / `parseScalingSuggestions` in `src/ai-advisor.js`.

## Terraform plan-based costing

Static parsing (everything above) can't evaluate `count`/`for_each`, conditionals, function calls, or module outputs — it leaves those as unresolved placeholders. A real Terraform plan has already evaluated all of that. `Terraform Cost: Calculate Costs from Terraform Plan` loads one and costs exactly what will exist after it applies, using the *exact same* `cost-calculator.js` every other scope uses — plan JSON just feeds it fully-resolved attributes instead of static-parser output, so there's no second pricing engine to keep in sync.

**Setup:**
1. Generate a plan JSON: `terraform plan -out=plan.tfplan && terraform show -json plan.tfplan > plan.json`.
2. Run `Terraform Cost: Calculate Costs from Terraform Plan` and pick the `.json` file — or pick the binary `.tfplan` directly, and the extension will run `terraform show -json` for you automatically *if* the `terraform` CLI is on your PATH (if it isn't, you'll get a clear message asking you to run step 1 yourself and pick the resulting `.json` instead — it never fails silently or guesses).
3. The dashboard opens in a new **plan** scope — same donut/bars/forecast/budget charts as file/workspace scope, plus AI suggestions and Excel export both follow it too (a plan resource's module address shows up the same way a workspace resource's source file does).

**Design notes:**
- Only resources that will actually exist *after* the plan applies are included — a pure delete (`change.after === null`) contributes nothing to the post-apply total and is excluded; create/update/no-op all count.
- **Verified against a genuine `terraform init && terraform plan && terraform show -json` run** (`test-fixtures/sample-plan/`, included in the repo along with the `.tf` that generated it), not a hand-authored synthetic JSON — the resulting cost matched a hand-calculated expected total exactly. Worth knowing while testing this yourself: `terraform plan` piped through something like `| tail -N` masks its real exit code with the pipe's — check the exit code directly, or you'll see a false "success" even when plan failed with schema errors.
- Budget/capacity/cost-history for plan scope are looked up relative to the *plan file's own directory*, since a loaded plan isn't tied to a specific workspace folder the way file/workspace scope are.

## Exporting a cost report

`Terraform Cost: Export Cost Report (Excel)` (or the **Export** button in the dashboard's topbar) generates a real multi-sheet `.xlsx` — for sharing the numbers with someone who doesn't use VS Code, or as a snapshot to attach to a ticket/PR/report.

1. Run the command. If a workspace folder is open, you're asked **This file** or **Whole workspace** first (same two scopes as the dashboard).
2. It recomputes fresh data for that scope, then a native **Save As** dialog opens with a sensible default filename (`<project-name>-cost-report-<date>.xlsx`).
3. Once saved, a toast offers **Reveal in Folder**.

**Sheets included** (only the ones that actually apply to your project — an empty budget file doesn't produce an empty Budget sheet):
- **Summary** — project name, scope, generation date, total monthly/yearly/hourly cost, budget status, capacity inputs, all in one glance
- **Resources** — every resource, one row each: type, name, provider, source file (workspace scope), monthly/yearly cost, sorted highest-cost-first
- **By Provider**, **By Resource Type** — full breakdowns (not the dashboard's top-5-truncated chart versions)
- **By File/Module** — workspace scope only
- **12-Month Forecast** — the same flat vs. growth-scenario numbers as the dashboard's forecast chart
- **Budget**, **Capacity Inputs** — only if those config files exist for the project
- **Cost History** — only if you've recorded at least one snapshot (see [Cost history](#cost-history) below)
- **AI Cost Suggestions**, **AI Scaling Suggestions** — only if you've actually run either this session; the export never triggers a fresh AI call itself, it just includes the last successful result if there is one

**Design notes:**
- Built with [`exceljs`](https://www.npmjs.com/package/exceljs) (`src/excel-exporter.js`) — the one runtime dependency this project has beyond `debounce`. Adding a real `.xlsx` writer isn't something worth hand-rolling; a plain CSV would satisfy "opens in Excel" but not really what "export an Excel report" means for something meant to be shared with stakeholders.
- `src/excel-exporter.js` has zero knowledge of `vscode`, the parser, or the calculator — it's handed a plain data object and lays out whatever's in it. Verified end-to-end (built a workbook, wrote it, reopened it with `exceljs`'s own reader, checked every sheet round-tripped correctly) before wiring it into the command.
- By-provider/by-type sheets are computed fresh from the full resource list at export time, not reused from the dashboard's aggregates — the dashboard intentionally truncates "by type" to top-5-plus-Other for chart legibility, but a report shouldn't silently drop data.

## CI: PR cost-diff comments

`.github/workflows/terraform-cost.yml` runs on every pull request that touches a `.tf` file and comments the estimated monthly cost, plus the delta vs. the PR's base branch, directly on the PR — updating the same comment on subsequent pushes rather than spamming a new one each time.

```
💰 Terraform Cost Estimate
$1,400.50/mo (base: $1,345.81/mo) — 📈 +$54.69/mo

| Provider | Monthly |
|---|---|
| AWS | $700.30/mo |
| Microsoft Azure | $360.10/mo |
| Google Cloud | $340.10/mo |

32 cost-relevant resources across 11 file(s).
```

**How it works:** `scripts/ci-cost-report.js` is a small headless CLI wrapper that reuses `src/terraform-parser.js` + `src/cost-calculator.js` directly — the same production code the VS Code extension itself runs, not a second implementation to drift out of sync with the first. Both modules only ever touch `vscode.workspace.getConfiguration(...).get(key, default)`, never any other `vscode` API, as long as `TerraformCostCalculator.initialize()` is never called (which the CLI deliberately never does — that's what would otherwise try to shell out to a real `infracost` binary that won't exist in CI) — so a one-function stub returning the caller's own default for every config key is enough to run them standalone. The workflow checks out both the PR branch and its base into separate directories, runs the CLI against each, and diffs the totals.

**Try it**: `node scripts/ci-cost-report.js test-fixtures/complex-project` locally — should print the same `$1,345.81` total documented in that fixture's own README, since it's the identical calculation path.

**Honest limitation**: the CLI script and the PR-comment logic are both verified locally (the CLI against real fixtures with known-correct numbers; the comment-building/create-vs-update logic executed against mocked GitHub API calls) — but the workflow's actual execution on GitHub's runners has not been verified, since that requires pushing a branch and opening a real PR, which wasn't done autonomously. Open a test PR against a `.tf` file to see it run for real the first time.

## Budget alert webhooks

A budget threshold crossing (`terraform.budget.json`) can post to a Slack or Microsoft Teams incoming webhook, not just show the in-editor popup — useful for a team channel that doesn't have everyone in VS Code watching for it.

**Setup:**
1. Create an incoming webhook URL in Slack ([api.slack.com/messaging/webhooks](https://api.slack.com/messaging/webhooks)) or Teams (a channel's connector settings), then run `Terraform Cost: Set Budget Alert Webhook (Slack/Teams)` and paste it in. Stored via `SecretStorage`, same as the AI provider keys — never in `settings.json`. This also sets `terraformCost.notifications.provider` to match.
2. That's it — the next time a threshold in `terraform.budget.json` is crossed, both the existing popup *and* the webhook fire together.

**Design notes:**
- **Same trigger point as the existing popup, not a parallel schedule.** `checkBudgetAndWarn()` already tracks "have we notified for this level yet" per file to avoid spamming a popup on every keystroke; the webhook fires from that exact same `level > prev` check, so there's one source of truth for "did we already alert on this," not two mechanisms that could drift out of sync.
- **Verified against a mocked `fetch`, not a real channel** — both providers' payload shapes, an HTTP-error case, and a missing-URL case were all confirmed to behave correctly, but there's no real Slack/Teams webhook to test actual delivery against. See the Known Gaps note about Teams' `MessageCard` format specifically.
- File-scope only, matching the existing popup's scope — the workspace dashboard's budget meter is visual-only and doesn't independently trigger an alert.

## Cost history

The 12-month forecast chart is a projection ("if usage stays flat vs. grows ~5%/month"), never real data. This is the actual-data counterpart: `Terraform Cost: Record Cost Snapshot` (or the **Record snapshot** button in the dashboard's new Cost History card) appends `{ timestamp, scope, label, totalMonthly, resourceCount }` to `terraform-cost-history.json`, and once there are 2+ recorded snapshots, the dashboard renders them as a real trend line — hover for the exact date/cost/resource-count at any point.

**Design notes:**
- **Explicitly user-triggered, never automatic** — same boundary as AI suggestions and export. There's no background scheduler recording a snapshot on every save; you decide when a data point is worth capturing (e.g. before/after a change, or periodically).
- Follows whichever scope the dashboard currently shows (file/workspace/plan) — same `resolveAiAnalysisTarget()` used by AI suggestions supplies the current total, so there's one shared notion of "what am I looking at right now" across all three features, not three separate ones.
- Capped at 200 entries per project (oldest dropped first) to avoid unbounded file growth.
- `terraform-cost-history.json` is plain JSON at the workspace root (or the active file's/plan's own directory if no workspace is open) — commit it to track cost over time alongside the infrastructure changes that caused it, or gitignore it if you'd rather keep it purely local; the extension doesn't take a position on that for you.
- **Verified via `src/cost-history-manager.js`'s own standalone tests** (append/reload round-trips correctly; the 200-entry cap prunes oldest-first and keeps the newest) and an Excel round-trip test for the new Cost History sheet — not just syntax-checked.

## Development

| Task | Command |
|---|---|
| Lint | `npm run lint` |
| Run tests (downloads a VS Code test instance on first run) | `npm test` |
| Run the extension interactively | See [RUNNING.md](RUNNING.md) |

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgments

- [Infracost](https://www.infracost.io) — accurate cloud cost data
- The VS Code extension API team

---

**Made for DevOps engineers who care about cloud costs.**
