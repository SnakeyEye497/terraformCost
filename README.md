# Matali - Terraform Cost Calculator

> **Ride the cloud, not the cost**

A VS Code extension that estimates the monthly/yearly cost of your Terraform infrastructure **as you write it** — inline next to each resource, as a total-cost header at the top of the file, and as a running total in the status bar. Supports AWS, GCP, and Azure, with optional [Infracost](https://www.infracost.io) integration for accurate live pricing (falls back to built-in estimated pricing if no API key is configured).

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## What this project is

It's a plain-JavaScript VS Code extension (no TypeScript, no bundler required to run it) built around a small pipeline:

```
.tf file text
   -> src/terraform-parser.js       parses HCL into resources/variables
   -> src/cost-calculator.js        looks up/estimates monthly cost per resource
        (optionally via src/infracost-integration.js, the Infracost CLI)
   -> src/cost-decorator.js         renders inline decorations + total-cost header
   -> src/status-bar-manager.js     shows the running total in the status bar
   -> src/budget-manager.js         compares total cost against terraform.budget.json
   -> src/error-handler.js          centralizes error logging/reporting
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
- **Commands** wired up in the Command Palette: `Calculate Costs`, `Toggle Cost Display`, `Refresh Cost Estimates`, `Toggle Total Cost Header`.
- **Error handling/logging** via `src/error-handler.js`, including `clearErrorLog` / `exportErrorLog` commands — these two are registered in code but not yet declared in `package.json`'s `contributes.commands`, so they run from the Command Palette under their raw id rather than a friendly title.
- **20+ configuration settings** (see table below).

⚠️ **Known gaps / not yet done:**

- **No `webpack.config.js`** — `npm run package` / `compile` / `watch` reference webpack but there's no config for it in the repo, so those scripts currently fail. The extension doesn't need bundling to run or test (it `require()`s `src/*.js` directly), so this only matters for producing a packaged `.vsix` for the Marketplace.
- **Not published anywhere** — `package.json` still has placeholder `publisher: "UnknownPublisher"` and a `yourusername` GitHub URL.
- **`npm audit`** currently reports some vulnerabilities in dev-only tooling (eslint 8.x line, etc.) — not exploit-relevant for local development, but worth updating before a real release.
- **18 `no-unused-vars` ESLint warnings** (0 errors) — cosmetic cleanup, not blocking.

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

Access via Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).

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
