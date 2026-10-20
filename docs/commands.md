# Commands

[← Docs index](README.md)

| Command | What it does |
|---|---|
| `Terraform Cost: Calculate Costs` | Manually (re-)calculate costs for the active file |
| `Terraform Cost: Refresh Cost Estimates` | Clears the cost cache and recalculates all open Terraform files |
| `Terraform Cost: Toggle Cost Display` | Show/hide inline cost decorations |
| `Terraform Cost: Toggle Total Cost Header` | Show/hide the total-cost header at the top of the file |
| `Terraform Cost: Show Cost Dashboard` | Opens the [cost dashboard](features/dashboard.md), defaulting to the active Terraform file |
| `Terraform Cost: Show Workspace Cost Dashboard` | Same dashboard, opened straight into "whole workspace" scope |
| `Terraform Cost: Get AI Cost Optimization Suggestions` | Asks the configured AI provider for suggestions on whichever scope the dashboard currently shows (file or whole workspace) |
| `Terraform Cost: Set AI Provider API Key` | Pick a provider (Gemini/Claude/GPT/DeepSeek/Groq) and securely save its API key |
| `Terraform Cost: Clear AI Provider API Key` | Remove a saved AI provider API key |
| `Terraform Cost: Get Scaling Suggestions` | Asks the configured AI provider whether the current scope's resources are right-sized for your expected load |
| `Terraform Cost: Set Capacity & Scaling Inputs` | Interactive wizard for expected users/requests/growth, saved to `terraform.capacity.json` |
| `Terraform Cost: Export Cost Report (Excel)` | Prompts for scope, then saves a multi-sheet `.xlsx` cost report via a native save dialog |
| `Terraform Cost: Set Budget Alert Webhook (Slack/Teams)` | Pick Slack or Teams and securely save an incoming webhook URL for budget-threshold alerts |
| `Terraform Cost: Send Test Budget Alert` | Post a clearly-labelled sample alert to the saved webhook to confirm delivery |
| `Terraform Cost: Clear Budget Alert Webhook` | Remove the saved webhook and disable alerts |
| `Terraform Cost: Calculate Costs from Terraform Plan` | Pick a `terraform show -json` plan (or binary `.tfplan`) and cost every resource that will exist after it applies |
| `Terraform Cost: Record Cost Snapshot` | Append the current scope's total to `terraform-cost-history.json` for the dashboard's Cost History chart |
| `Terraform Cost: Compare Estimate with Actual Cloud Spend` | Pull real spend from AWS/Azure/GCP billing and open an estimate-vs-actual report |
| `Terraform Cost: Export Error Log` | Save the extension's internal error log to a file |
| `Terraform Cost: Clear Error Log` | Clear the internal error log |

Access via Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
