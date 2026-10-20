# Getting started

[← Docs index](../README.md)

## Requirements

- [Node.js](https://nodejs.org) 20.19+ (tested on v22) and npm
- VS Code `^1.85.0`
- Internet access the *first* time you run `npm test`: it downloads a standalone copy of VS Code (~330MB) into `.vscode-test/`.
- Optional: the [Infracost](https://www.infracost.io) CLI with an API key for live pricing. Without it, built-in prices are used. See [Pricing](pricing.md).
- Optional: an API key for AI suggestions from [Groq](https://console.groq.com/) (free tier, no card; the easiest one to try first), [DeepSeek](https://platform.deepseek.com/), [Google AI Studio](https://aistudio.google.com/apikey) (Gemini), [Anthropic](https://console.anthropic.com/) (Claude), or [OpenAI](https://platform.openai.com/).

## Option 1: install the packaged extension

```bash
git clone https://github.com/SnakeyEye497/terraformCost.git
cd terraformCost
npm install
npm run vsix
code --install-extension terraform-cost-calculator-1.0.0.vsix
```

Reload VS Code, open any folder with `.tf` files, and costs appear inline.

## Option 2: run from source (Extension Development Host)

This opens a second, live VS Code window with Matali loaded. It's the best option while you're changing the code.

```bash
git clone https://github.com/SnakeyEye497/terraformCost.git
cd terraformCost
npm install
```

1. **Open the project folder in VS Code:**
   ```bash
   code "path/to/terraformCost"
   ```

2. **Open the Run and Debug panel** (`Ctrl+Shift+D` / `Cmd+Shift+D`), or just press **F5**.

   This repo ships a [.vscode/launch.json](../.vscode/launch.json) with two configs:
   - **Run Extension** ← the one you want (selected by default)
   - **Extension Tests** — runs the automated Mocha suite instead (same as `npm test`)

3. **Press F5.** VS Code will:
   - Run the `npm: compile` task ([.vscode/tasks.json](../.vscode/tasks.json)), which bundles `src/` into `dist/extension.js` with webpack (a few seconds)
   - Launch a new window titled **[Extension Development Host]**
   - Load Matali into it automatically

4. **In the new Extension Development Host window**, open a Terraform file to see it in action:
   - File → Open File → pick [example.tf](../examples/example.tf) from this repo (it already has AWS/GCP resources in it), **or**
   - Open/create any `.tf` file of your own.

   You should see:
   - 💰 inline cost estimates next to each resource (e.g. `# 💰 $30.37/mo ($364.42/yr)`)
   - A **total infrastructure cost header** at the top of the file
   - A running total in the **status bar** (bottom right)

## The 5-minute tour

If you just want to see everything at once (good for a demo, or to sanity-check a fresh clone actually works) rather than exploring feature-by-feature:

1. F5 → **Run Extension**.
2. In the Dev Host window: **File → Open Folder** → [test/fixtures/complex-project](../test/fixtures/complex-project).
3. Open `modules/compute/main.tf` — inline `💰 ...` costs appear next to each resource, plus a total header at the top of that one file.
4. `Ctrl+Shift+P` → **Terraform Cost: Show Workspace Cost Dashboard**. Watch it scan all 11 files, then land on: a ~$1,330/mo hero total, donut/provider/file-by-file charts, and a budget meter already sitting at "yellow, near limit" — no setup needed, that's what the fixture is tuned for.
5. `Ctrl+Shift+P` → **Terraform Cost: Set AI Provider API Key** → **Groq** (free, no card) → paste a key from [console.groq.com](https://console.groq.com/).
6. Open `modules/compute/main.tf` (where `batch_processor` — an `m5.xlarge` for what's tagged as a batch job — lives), then `Ctrl+Shift+P` → **Terraform Cost: Get AI Cost Optimization Suggestions**. It should flag it.
7. `Ctrl+Shift+P` → **Terraform Cost: Get Scaling Suggestions** — same idea, but reasoned against the fixture's `terraform.capacity.json` load figures instead of just cost.
8. Bump `batch_processor`'s `instance_type` to something even bigger and save — watch the budget meter go red, and the AI suggestion change on your next ask.
9. Click **Export** in the dashboard's topbar → **Whole workspace** → save. Open the resulting `.xlsx` — everything you just saw is now a 10-sheet spreadsheet, including the AI/scaling suggestions from steps 6–7.
10. Click **Record snapshot** in the dashboard's Cost History card, change an instance size, save, and record a second snapshot — a real line chart appears tracking that jump.
11. `Ctrl+Shift+P` → **Terraform Cost: Calculate Costs from Terraform Plan** → pick [test/fixtures/sample-plan/plan.json](../test/fixtures/sample-plan/plan.json) — a genuine `terraform show -json` output — and watch the dashboard switch to plan scope at **$95.86/mo** across 4 resources.

That's the whole extension, one file at a time, start to finish.

Next: the [feature walkthrough](walkthrough.md) tries each feature one at a time, and [Troubleshooting](troubleshooting.md) covers common problems.
