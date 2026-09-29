# Running Matali Interactively (Option A: VS Code Extension Development Host)

This is the recommended way to actually *see* the extension working — it opens a second, live VS Code window with Matali loaded, so you can open Terraform files and watch cost estimates appear as you type.

## Prerequisites

```bash
git clone <this-repo-url>
cd terraformCost
npm install
```

(See [README.md](README.md) for full requirements.)

## Step by step

1. **Open the project folder in VS Code:**
   ```bash
   code "path/to/terraformCost"
   ```

2. **Open the Run and Debug panel** (`Ctrl+Shift+D` / `Cmd+Shift+D`), or just press **F5**.

   This repo ships a [.vscode/launch.json](.vscode/launch.json) with two configs:
   - **Run Extension** ← the one you want (selected by default)
   - **Extension Tests** — runs the automated Mocha suite instead (same as `npm test`)

3. **Press F5.** VS Code will:
   - Compile nothing (the extension runs straight from `src/*.js`, no build step)
   - Launch a new window titled **[Extension Development Host]**
   - Load Matali into it automatically

4. **In the new Extension Development Host window**, open a Terraform file to see it in action:
   - File → Open File → pick [example.tf](example.tf) from this repo (it already has AWS/GCP resources in it), **or**
   - Open/create any `.tf` file of your own.

   You should see:
   - 💰 inline cost estimates next to each resource (e.g. `# 💰 $30.37/mo ($364.42/yr)`)
   - A **total infrastructure cost header** at the top of the file
   - A running total in the **status bar** (bottom right)

## The 5-minute tour

If you just want to see everything at once (good for a demo, or to sanity-check a fresh clone actually works) rather than exploring feature-by-feature:

1. F5 → **Run Extension**.
2. In the Dev Host window: **File → Open Folder** → [test-fixtures/complex-project](test-fixtures/complex-project).
3. Open `modules/compute/main.tf` — inline `💰 ...` costs appear next to each resource, plus a total header at the top of that one file.
4. `Ctrl+Shift+P` → **Terraform Cost: Show Workspace Cost Dashboard**. Watch it scan all 11 files, then land on: a ~$1,346/mo hero total, donut/provider/file-by-file charts, and a budget meter already sitting at "yellow, near limit" — no setup needed, that's what the fixture is tuned for.
5. `Ctrl+Shift+P` → **Terraform Cost: Set AI Provider API Key** → **Groq** (free, no card) → paste a key from [console.groq.com](https://console.groq.com/).
6. Open `modules/compute/main.tf` (where `batch_processor` — an `m5.xlarge` for what's tagged as a batch job — lives), then `Ctrl+Shift+P` → **Terraform Cost: Get AI Cost Optimization Suggestions**. It should flag it.
7. `Ctrl+Shift+P` → **Terraform Cost: Get Scaling Suggestions** — same idea, but reasoned against the fixture's `terraform.capacity.json` load figures instead of just cost.
8. Bump `batch_processor`'s `instance_type` to something even bigger and save — watch the budget meter go red, and the AI suggestion change on your next ask.
9. Click **Export** in the dashboard's topbar → **Whole workspace** → save. Open the resulting `.xlsx` — everything you just saw is now a 10-sheet spreadsheet, including the AI/scaling suggestions from steps 6–7.
10. Click **Record snapshot** in the dashboard's Cost History card, change an instance size, save, and record a second snapshot — a real line chart appears tracking that jump.
11. `Ctrl+Shift+P` → **Terraform Cost: Calculate Costs from Terraform Plan** → pick [test-fixtures/sample-plan/plan.json](test-fixtures/sample-plan/plan.json) — a genuine `terraform show -json` output — and watch the dashboard switch to plan scope at **$95.86/mo** across 4 resources.

That's the whole extension, one file at a time, start to finish.

## Commands to try

Open the Command Palette in the Dev Host window (`Ctrl+Shift+P` / `Cmd+Shift+P`) and search **"Terraform Cost"**:

| Command | What you'll see |
|---|---|
| **Terraform Cost: Calculate Costs** | Forces an immediate recalculation of the active file; shows an info toast "Terraform costs calculated!" |
| **Terraform Cost: Refresh Cost Estimates** | Clears the cost cache first, then recalculates everything open — use this after changing settings like currency or region |
| **Terraform Cost: Toggle Cost Display** | Hides/shows the inline `💰 ...` decorations next to resources |
| **Terraform Cost: Toggle Total Cost Header** | Hides/shows the summary line at the top of the file |
| **Terraform Cost: Show Cost Dashboard** | Opens a webview with a cost-breakdown donut chart, a per-provider bar chart, and a 12-month forecast chart (plus a budget meter if `terraform.budget.json` applies) — see below |
| **Terraform Cost: Show Workspace Cost Dashboard** | Same dashboard, opened straight into "Whole workspace" scope — see below |
| **Terraform Cost: Get AI Cost Optimization Suggestions** | Asks your configured AI provider for suggestions on the active file, shown in the dashboard — see below |
| **Terraform Cost: Set AI Provider API Key** | Pick Gemini/Claude/GPT and securely save its API key |
| **Terraform Cost: Set Capacity & Scaling Inputs** | Short wizard for expected users/requests/growth, saved to `terraform.capacity.json` |
| **Terraform Cost: Get Scaling Suggestions** | Asks your AI provider whether the active file's resources are right-sized for that expected load — see below |
| **Terraform Cost: Export Cost Report (Excel)** | Prompts for scope, then saves a multi-sheet `.xlsx` via a native Save As dialog — see below |
| **Terraform Cost: Set Budget Alert Webhook (Slack/Teams)** | Save an incoming webhook URL for budget-threshold alerts — see below |
| **Terraform Cost: Clear Budget Alert Webhook** | Remove the saved webhook |
| **Terraform Cost: Calculate Costs from Terraform Plan** | Pick a real `terraform show -json` plan and cost exactly what it'll create — see below |
| **Terraform Cost: Record Cost Snapshot** | Appends the current scope's total to a real cost-history trend chart — see below |

### Trying the cost dashboard

1. With `example.tf` open and active, run **Terraform Cost: Show Cost Dashboard** (or click the graph icon at the top-right of the editor).
2. It opens beside your file and fills in: total monthly/yearly/hourly cost, a donut of cost-by-resource-type, a bar chart of cost-by-provider (AWS/GCP/Azure — `example.tf` has all three), and a 12-month forecast chart. Hover the forecast chart for a tooltip; click "View as table" under a chart for an accessible table view.
3. Edit/save `example.tf` (e.g. bump `instance_type` to `m5.xlarge`) — the dashboard updates itself, no need to re-run the command.

You can also change settings live and watch it react: `Ctrl+,` → search "Terraform Cost" → try changing `terraformCost.currency` to `EUR` or `terraformCost.expensiveThreshold` to `10`, and switch back to your `.tf` file — it updates automatically.

### Trying the workspace-wide dashboard

1. In the Dev Host window, make sure a folder (not just a loose file) is open — File → Open Folder → [test-fixtures/complex-project](test-fixtures/complex-project) is the one built for exactly this (11 files, ~26 resources across AWS/GCP/Azure, real non-zero costs verified against the actual calculator — see its own [README](test-fixtures/complex-project/README.md) for the full breakdown and what to expect). Any real multi-file Terraform project works too.
2. Click the **Whole workspace** button at the top of the dashboard (or run **Terraform Cost: Show Workspace Cost Dashboard** directly). It scans every `.tf` file, so it takes a moment on a large project — the header shows "Scanning workspace…" while that happens.
3. Everything updates to span all files: the hero total, donut, provider bars, forecast — plus a new **Cost by file/module** bar chart that isn't there in file scope, showing which file is actually driving the bill.
4. Edit and save any `.tf` file in the project — the workspace view refreshes automatically (on save only, not on every keystroke, since re-scanning the whole project on every keystroke would be wasteful).
5. Switch back to **This file** any time to return to the single-file view.

Note: the AI suggestions and scaling cards follow the dashboard's **current scope** — switch to "Whole workspace" first, then ask, and it reasons over every resource across the project (tagging each suggestion with its source file), not just the active file.

### Trying AI cost optimization suggestions

1. Run **Terraform Cost: Set AI Provider API Key**, pick a provider, and paste in a key. This is stored securely, not in `settings.json`.
   - Cheapest to start with: **[Groq](https://console.groq.com/)** — genuinely free tier, no card required.
   - Also cheap: **[DeepSeek](https://platform.deepseek.com/)** — pay-as-you-go, fractions of a cent per request, no minimum spend.
   - Gemini/Claude/GPT also work — for Gemini specifically, use a plain key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) rather than one provisioned through Cloud/Vertex billing, which may demand a prepay balance before it'll generate anything.
2. With `example.tf` open, run **Terraform Cost: Get AI Cost Optimization Suggestions** (or open the dashboard and click "✨ Ask AI for suggestions").
3. The dashboard opens/updates with a spinner, then a list of suggestion cards — each names a resource, a category (rightsizing/reserved capacity/storage/architecture), the suggestion itself, and an estimated monthly saving when the model gives one.
4. Try it again after editing a resource (e.g. bumping an instance to something oversized) to see the suggestions change.

### Trying capacity & scaling suggestions

Uses the same AI provider/key you just set up above — no separate setup needed.

1. Run **Terraform Cost: Set Capacity & Scaling Inputs** (or click **Set capacity inputs** in the new "📈 Capacity & scaling suggestions" card). It asks four questions one at a time — expected daily users, requests/day, peak requests/second, growth %/month — press Enter to accept, leave blank + Enter to skip any of them, or Escape to cancel the whole thing.
   - [test-fixtures/complex-project](test-fixtures/complex-project) already ships a `terraform.capacity.json` — you can skip this step and go straight to step 2 there. It's currently tuned quite small (a few hundred users, low four-figure requests/day), which makes nearly every beefy instance in the fixture a plausible scale-down candidate, not just the 3 deliberately-oversized ones — a sharper test than a load that only catches the intentional bait. Feel free to hand-edit it to whatever load tells the story you want (see "Editing the config files directly" below). Against plain `example.tf`, try something that'll produce an obvious mismatch, e.g. requests/day in the millions (should suggest scaling up) or a tiny number like 50 (should suggest scaling down something).
2. Run **Terraform Cost: Get Scaling Suggestions** (or click **Get scaling suggestions** in the card).
3. You'll see suggestion cards with a **Scale up** / **Scale down** / **Keep as-is** badge per resource, a suggested change (e.g. `t3.medium -> t3.large`), and the model's reasoning referencing the actual numbers you gave it.
4. The card also shows a compact summary of your saved inputs (e.g. "5,000 users · 200,000 req/day · +10%/mo growth") any time the dashboard is open, without needing to click anything.
5. Re-run **Set Capacity & Scaling Inputs** any time to change the numbers — it pre-fills your previous answers.

### Trying workspace-wide AI suggestions

The AI cost/scaling cards follow whatever scope the dashboard is currently in — no separate toggle.

1. In [test-fixtures/complex-project](test-fixtures/complex-project)'s dashboard, click **Whole workspace**, then **Ask AI for suggestions**.
2. It reasons over all ~26 resources across the project at once (capped at 150 highest-cost resources for a much larger project) — notice each suggestion card now shows a `📄 modules/compute/main.tf`-style file tag so you know exactly where to go make the change, looked up from the actual resource list rather than trusted from the model's own response.
3. Click **This file** to switch back — ask again, and it's back to just the active file's resources.

### Trying the Excel export

1. In [test-fixtures/complex-project](test-fixtures/complex-project), run **Terraform Cost: Get AI Cost Optimization Suggestions** and **Get Scaling Suggestions** first (optional, but their results get included in the report if you have them — see steps 6–7 of the 5-minute tour above).
2. Run **Terraform Cost: Export Cost Report (Excel)** (or click **Export** in the dashboard's topbar). Choose **Whole workspace** when prompted.
3. A Save As dialog opens with a default filename like `complex-project-cost-report-2026-09-14.xlsx`. Save it anywhere.
4. Click **Reveal in Folder** on the confirmation toast, then open the file in Excel (or LibreOffice Calc, Google Sheets, etc.). You should see 10 sheets: Summary, Resources (~26 rows, sorted by cost), By Provider, By Resource Type, By File-Module, 12-Month Forecast, Budget, Capacity Inputs, and — if you did step 1 — AI Cost Suggestions and AI Scaling Suggestions (now with a Source File column too).
5. Try it again with **This file** scope on a single module file (e.g. `modules/compute/main.tf`) — notice the Resources sheet drops the Source File column and there's no By File-Module sheet, since those only make sense workspace-wide.

### Trying budget alert webhooks

1. Get a Slack incoming webhook URL ([api.slack.com/messaging/webhooks](https://api.slack.com/messaging/webhooks) — fastest to set up for a quick test) or a Teams channel connector URL.
2. Run **Terraform Cost: Set Budget Alert Webhook (Slack/Teams)**, pick the platform, paste the URL.
3. In [test-fixtures/complex-project](test-fixtures/complex-project), edit `terraform.budget.json` to lower a limit below the current ~$1,346/mo total (or bump a resource's size up), then save the `.tf` file — the existing popup should appear, and your Slack/Teams channel should get a matching message within a second or two.
4. Run **Terraform Cost: Clear Budget Alert Webhook** to turn it back off.

### Trying terraform plan-based costing

Static parsing can't resolve everything real Terraform can (`count`/`for_each` expressions, module outputs, provider defaults) — a real `terraform plan` already has all of that evaluated. This feature costs the *actual* plan instead of guessing.

1. If you have the `terraform` CLI installed, cost any real project's plan directly:
   ```bash
   cd path/to/some/terraform/project
   terraform init
   terraform plan -out=plan.tfplan
   terraform show -json plan.tfplan > plan.json
   ```
2. Back in the Dev Host window, run **Terraform Cost: Calculate Costs from Terraform Plan** and pick that `plan.json` (or the binary `plan.tfplan` — Matali will try to run `terraform show -json` on it for you if the `terraform` CLI is on your `PATH`).
3. The dashboard opens straight into "plan" scope: same hero total/donut/provider charts as file or workspace scope, but the subtitle reads **📋 Terraform plan: plan.json** and every resource is tagged with its module address instead of a file path.
4. No real project handy? [test-fixtures/sample-plan](test-fixtures/sample-plan) ships a genuine plan (`plan.json`, produced from its own `main.tf` via the real steps above, no cloud credentials needed) — pick that and you should land on **$95.86/mo** across 4 resources.
5. Don't have the `terraform` CLI at all? You can still pick `plan.json` files directly (skip steps 1–2) — only the binary-`.tfplan`-to-JSON conversion in step 2 needs the CLI.

### Trying cost history tracking

1. Open the dashboard in any scope (file, workspace, or a loaded plan) and look for the **Cost History** card near the bottom.
2. Click **Record snapshot** (or run **Terraform Cost: Record Cost Snapshot**) — it appends today's total for the current scope to `terraform-cost-history.json` next to your project. The first snapshot alone just shows "record another to see a trend."
3. Change something that affects cost (bump an instance size, add a resource) and save, then record a second snapshot. The card now renders a real line chart with actual dates on the X-axis — hover any point for an exact date/cost/label tooltip.
4. History is scoped the same way everything else is: recording from "Whole workspace" tracks the whole project's trend; recording from a single file or a loaded plan tracks just that. Switch scope in the dashboard to see each one's independent history.
5. `terraform-cost-history.json` is plain JSON, capped at the 200 most recent snapshots per scope — safe to delete if you want to start a trend over.

### Trying the budget feature

[test-fixtures/complex-project](test-fixtures/complex-project) already ships a `terraform.budget.json` tuned so its ~$1,346/mo total sits at "yellow, near limit" ($1,100 `limit_3`) by default — open it and its workspace dashboard should already show that state, no setup needed. Bump any instance size up to push it past the $1,500 `final_limit` and watch it turn red.

To try it from scratch on your own `.tf` file instead: add a `terraform.budget.json` next to it:
```json
{ "limit_1": 20, "final_limit": 50 }
```
Then edit your `.tf` file so the total crosses those numbers — the header should turn yellow, then red, and you'll get a popup + a diagnostic (red squiggle context) the first time each threshold is crossed.

### Editing the config files directly

`terraform.budget.json` and `terraform.capacity.json` are both just plain JSON — the **Set Capacity & Scaling Inputs** wizard and manually writing/editing the budget file are two paths to the exact same thing, not different features. If you already know the field names, editing the file directly and saving is faster than the wizard; the dashboard picks either up the same way (on save). This is exactly what tuning the fixture's `terraform.capacity.json` down to a smaller load (as it currently is) looks like — hand-edit, save, re-ask for suggestions.

### Resetting to a clean state

- **Remove a saved AI key**: `Terraform Cost: Clear AI Provider API Key`.
- **Stop using budget/capacity inputs for a project**: delete `terraform.budget.json` / `terraform.capacity.json` — the extension only looks for them, it doesn't require them.
- **Force a full recalculation** (e.g. after changing `terraformCost.region` or suspecting stale cached costs): `Terraform Cost: Refresh Cost Estimates`.
- **Reset the workspace dashboard back to file scope**: click **This file** in its scope toggle, or just close and reopen the panel.

## Making code changes and seeing them take effect

1. Edit any file under `src/` or `extension.js` in your **main** VS Code window (not the Dev Host window).
2. Switch to the **Extension Development Host** window.
3. Run **Developer: Reload Window** from the Command Palette (`Ctrl+Shift+P`).
4. The extension reloads with your changes — no rebuild/compile step needed, since it runs straight from source.

To stop the Dev Host, just close that window, or press `Shift+F5` in your main VS Code window while debugging.

## Troubleshooting

Real failure modes hit while building/testing this extension, in case they recur:

- **AI suggestions fail with a 404 / "model ... is no longer available" error.** Provider model ids drift — this happened twice in one session with Gemini and once with Groq. Fix: `Ctrl+,` → search `terraformCost.ai.model` → set it to whatever current model id the error message (or the provider's own docs/console) points you to. Leave it blank to fall back to the extension's built-in default, which may itself be stale by the time you read this.
- **AI suggestions fail with a 429 / "quota exhausted" / "prepayment credits" error.** Not a bug — the account behind that API key has no usable quota. Check the provider's own billing/usage console. Gemini specifically: a key created through Cloud/Vertex billing can require a prepay balance even for light use; a plain key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) usually has a real free tier instead.
- **"Running extension tests ... only supported if no other instance of Code is running."** Only relevant to `npm test` / the Extension Tests debug config, not F5. Means something is launching the test VS Code instance with the default (shared) profile instead of an isolated one — `test/runTest.js` and `.vscode/launch.json`'s Extension Tests config both pass `--user-data-dir`/`--extensions-dir` under `.vscode-test/` specifically to avoid this; if you've edited either, check that's still there.
- **No inline decorations, no dashboard data, nothing happening at all.** Check `terraformCost.enabled` is `true`. Check the Dev Host's Debug Console (in your **main** window, not the Dev Host) for `Matali extension activated successfully` — if that line's missing or an error follows it, activation itself failed.
- **A resource's cost looks like a flat $7.30/mo you didn't expect.** That's `getDefaultCost()` in `src/cost-calculator.js` — the generic "estimated, unknown resource type" fallback for any resource type not explicitly priced (not $0, even for things like `aws_vpc`/`aws_subnet`/`aws_eip` that don't actually cost anything on real AWS). Not a bug you're causing; existing behavior, worth knowing about when a total looks a little high.
- **A `var.x` reference isn't resolving / shows as the literal string.** The parser only resolves variables from a `variable` block in the *same file* as the resource using it — not across a module's own separate `variables.tf`, the way real Terraform does. Put the `variable` block in the same file as the resource, or give the attribute a literal value instead.
- **"No cost-relevant resources found to export."** The Excel export needs the same thing the dashboard does — a `.tf` file with actual `resource` blocks, active/open for **This file** scope, or a workspace folder with at least one for **Whole workspace**. If the AI Suggestions sheets are missing from an export even though you ran those commands, that's expected if either failed rather than succeeded — the export only includes a *successful* result cached from this session, and never triggers a fresh AI call itself.
- **Budget threshold crossed, popup appeared, but nothing showed up in Slack/Teams.** Check `Terraform Cost: Set Budget Alert Webhook` was actually run with a valid URL (re-run it to confirm/replace), and check `terraformCost.notifications.provider` isn't stuck on `none`. A failed webhook POST shows its own warning toast with the HTTP status — if you see that, the URL itself is likely wrong or the webhook was deleted on the Slack/Teams side.
- **"Calculate Costs from Terraform Plan" fails trying to read a `.tfplan` file.** Binary plan files need `terraform show -json` run on them first, which requires the `terraform` CLI on your `PATH` — if it's not found you'll get a friendly error telling you to run that command yourself and pick the resulting `.json` instead. Picking a `.json` file directly always works, no CLI needed.
- **Plan-based costs look different from what the static parser shows for the same file.** Expected, not a bug — the plan reflects Terraform's own evaluation of `count`/`for_each`/variables/module outputs, which the static parser can't fully resolve. Trust the plan numbers over the inline/dashboard file-scope numbers when they disagree.
- **Cost History card says "record another to see a trend" forever.** You need at least 2 snapshots *for that exact scope* — recording once from "This file" and once from "Whole workspace" doesn't count as 2 for either one. Record a second snapshot from the same scope you're currently viewing.

## Other ways to run it

- **From a terminal, without going through VS Code's UI first** (useful if VS Code's own F5 isn't convenient, e.g. scripting): after `npm test` has run once (which downloads a local VS Code test binary into `.vscode-test/`), you can launch the same Dev Host directly:
  ```bash
  .vscode-test/vscode-win32-x64-archive-*/Code.exe --extensionDevelopmentPath="$PWD"
  ```
- **Automated tests only** (no interactive window): `npm test` — runs the full Mocha suite (19 tests) inside a real extension host and exits.
- **Lint only**: `npm run lint`.
