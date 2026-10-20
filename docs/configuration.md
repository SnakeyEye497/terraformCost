# Configuration

[← Docs index](README.md)

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
| `terraformCost.notifications.provider` | `none` | Budget alert webhook target: `none`, `slack`, `teams` (set via the webhook command) |
| `terraformCost.billing.awsProfile` | `""` | AWS CLI profile for the actual-spend comparison (blank = default credentials) |
| `terraformCost.billing.azureSubscriptionId` | `""` | Azure subscription for the actual-spend comparison (blank = `az account show` default) |
| `terraformCost.billing.gcpBillingExportTable` | `""` | BigQuery billing export table (`project.dataset.table`) for the GCP actual-spend comparison |

API keys for the AI provider are **not** a setting — set them via the `Terraform Cost: Set AI Provider API Key` command, which stores them in VS Code's SecretStorage rather than plain-text `settings.json` (unlike `infracostApiKey`, which currently is a plain string setting).

## Cost indicators

- 🟢 Green — < $10/month
- 🟡 Yellow — $10–50/month
- 🟠 Orange — $50–100/month
- 🔴 Red — > $100/month

## Optional budgeting (`terraform.budget.json`)

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

## Project files

All three are optional plain-JSON files, looked up by walking up from the `.tf` file's folder to the workspace root.

| File | Purpose | Docs |
|---|---|---|
| `terraform.budget.json` | Budget thresholds (see above) | [Budget alerts](features/budget-alerts.md) |
| `terraform.capacity.json` | Expected load for scaling suggestions | [AI suggestions](features/ai-suggestions.md#capacity--scaling) |
| `terraform-cost-history.json` | Recorded cost snapshots | [Cost history](features/cost-history.md) |
