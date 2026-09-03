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

## Commands to try

Open the Command Palette in the Dev Host window (`Ctrl+Shift+P` / `Cmd+Shift+P`) and search **"Terraform Cost"**:

| Command | What you'll see |
|---|---|
| **Terraform Cost: Calculate Costs** | Forces an immediate recalculation of the active file; shows an info toast "Terraform costs calculated!" |
| **Terraform Cost: Refresh Cost Estimates** | Clears the cost cache first, then recalculates everything open — use this after changing settings like currency or region |
| **Terraform Cost: Toggle Cost Display** | Hides/shows the inline `💰 ...` decorations next to resources |
| **Terraform Cost: Toggle Total Cost Header** | Hides/shows the summary line at the top of the file |

You can also change settings live and watch it react: `Ctrl+,` → search "Terraform Cost" → try changing `terraformCost.currency` to `EUR` or `terraformCost.expensiveThreshold` to `10`, and switch back to your `.tf` file — it updates automatically.

### Trying the budget feature

In the Dev Host window's workspace, add a `terraform.budget.json` next to your `.tf` file:
```json
{ "limit_1": 20, "final_limit": 50 }
```
Then edit your `.tf` file so the total crosses those numbers — the header should turn yellow, then red, and you'll get a popup + a diagnostic (red squiggle context) the first time each threshold is crossed.

## Making code changes and seeing them take effect

1. Edit any file under `src/` or `extension.js` in your **main** VS Code window (not the Dev Host window).
2. Switch to the **Extension Development Host** window.
3. Run **Developer: Reload Window** from the Command Palette (`Ctrl+Shift+P`).
4. The extension reloads with your changes — no rebuild/compile step needed, since it runs straight from source.

To stop the Dev Host, just close that window, or press `Shift+F5` in your main VS Code window while debugging.

## Other ways to run it

- **From a terminal, without going through VS Code's UI first** (useful if VS Code's own F5 isn't convenient, e.g. scripting): after `npm test` has run once (which downloads a local VS Code test binary into `.vscode-test/`), you can launch the same Dev Host directly:
  ```bash
  .vscode-test/vscode-win32-x64-archive-*/Code.exe --extensionDevelopmentPath="$PWD"
  ```
- **Automated tests only** (no interactive window): `npm test` — runs the full Mocha suite (19 tests) inside a real extension host and exits.
- **Lint only**: `npm run lint`.
