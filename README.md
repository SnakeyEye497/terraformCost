<p align="center">
  <img src="images/icon.png" width="96" alt="Matali icon">
</p>

# Matali - Terraform Cost Calculator

> **Ride the cloud, not the cost**

A VS Code extension that estimates the monthly and yearly cost of your Terraform infrastructure **as you write it**. Costs appear inline next to each resource, in a total-cost header at the top of the file, and as a running total in the status bar. It supports AWS, GCP and Azure, and uses [Infracost](https://www.infracost.io) for live pricing when it's installed, falling back to built-in prices otherwise.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-Apache--2.0-green)

## Features

- **Live inline costs** for 60+ AWS, GCP and Azure resource types, with free plumbing (VPCs, IAM, …) priced at $0 and `count`/`for_each` taken into account. See [pricing](docs/pricing.md).
- **Cost dashboard** for the active file, the whole workspace, or a loaded `terraform plan`, with breakdowns, a forecast and a budget meter. See [dashboard](docs/features/dashboard.md).
- **Module resolution** that follows local and remote (registry/git) modules the way Terraform does. See [modules](docs/features/module-resolution.md).
- **Plan-based costing** from real `terraform show -json` output. See [plan costing](docs/features/plan-costing.md).
- **Budgets** via `terraform.budget.json`, with popups and Slack/Teams alerts. See [budget alerts](docs/features/budget-alerts.md).
- **AI cost and scaling suggestions** (Gemini, Claude, OpenAI, DeepSeek, Groq). See [AI suggestions](docs/features/ai-suggestions.md).
- **Estimated vs. actual spend** from AWS Cost Explorer, Azure Cost Management and GCP billing exports. See [actual spend](docs/features/actual-spend.md).
- **Cost history**, **Excel reports**, and a **GitHub Action** that comments each PR's cost change. See [history](docs/features/cost-history.md), [export](docs/features/excel-export.md) and [CI](docs/features/ci-pr-comments.md).

## Quick start

```bash
git clone https://github.com/SnakeyEye497/terraformCost.git
cd terraformCost
npm install
npm run vsix
code --install-extension terraform-cost-calculator-1.0.0.vsix
```

Open any folder with `.tf` files and costs appear inline. Try [`examples/example.tf`](examples/example.tf), or press `Ctrl+Shift+P` and run **Terraform Cost: Show Cost Dashboard**.

To run from source instead, open the folder in VS Code and press **F5**. See [Getting started](docs/getting-started.md).

## Documentation

All documentation is in [`docs/`](docs/README.md):

| | |
|---|---|
| [Getting started](docs/getting-started.md) | Install, run, 5-minute tour |
| [Feature walkthrough](docs/walkthrough.md) | Try each feature step by step |
| [Commands](docs/commands.md) · [Configuration](docs/configuration.md) | Reference |
| [Pricing](docs/pricing.md) · [Known limitations](docs/known-limitations.md) | Where numbers come from and their limits |
| [Architecture](docs/architecture.md) · [Development](docs/development.md) | Source layout, building, testing, publishing |
| [Troubleshooting](docs/troubleshooting.md) | Common problems |

## Project layout

```
src/            extension source (core, integrations, config, ui, export, utils)
test/           Mocha suite + fixtures (sample projects, a real plan JSON)
docs/           documentation
examples/       example.tf, plus aws-demo/ for real `terraform plan` costing
scripts/        headless cost report used by the GitHub Action
images/         extension icon
```

## Status

All 76 tests pass, `npm audit` reports no vulnerabilities, and the extension packages to a ~355 KB `.vsix`. It is not yet published to the Marketplace. See [Known limitations](docs/known-limitations.md).

## License

Apache-2.0. See [LICENSE](LICENSE).

## Acknowledgments

- [Infracost](https://www.infracost.io), for accurate cloud cost data
- The VS Code extension API team
