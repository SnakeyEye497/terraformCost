# Known limitations

[← Docs index](README.md)

## Accuracy

- **Static parsing can't evaluate expressions.** `count = var.enabled ? 1 : 0`, `local.*` values, function calls and `each.value` aren't evaluated, so such resources are costed as a single instance. Registry modules use these heavily (for example the AWS VPC module's optional VPN gateway). For exact numbers on such projects, use [plan-based costing](features/plan-costing.md).
- **Built-in prices are approximate** us-east-1 / us-central1 / eastus on-demand list prices. The `terraformCost.region` setting doesn't change them. Use Infracost for region-accurate pricing. See [Pricing](pricing.md).
- **Usage-based services use stated assumptions** (Lambda invocations, GB stored, logs ingested). See [Pricing](pricing.md#usage-based-assumptions). Infracost has the same limitation without a usage file.
- **Remote modules need `terraform init` first.** Until `.terraform/modules/modules.json` exists, their resources can't be found. They're logged as unresolved rather than silently dropped. See [Module resolution](features/module-resolution.md).
- **Single-file scope resolves variables from the same file only.** Workspace scope merges the whole directory and applies module inputs.

## Not yet verified against real services

- **Actual-spend comparison** has only been tested against mocked CLI output, not a live AWS, Azure or GCP billing account. AWS charges $0.01 per Cost Explorer request, and each run makes 2.
- **Slack/Teams delivery** is tested against a stubbed `fetch`. Use `Terraform Cost: Send Test Budget Alert` to confirm your own webhook works.

## Release

- **Not yet on the Marketplace.** The package builds (`npm run vsix`), but publishing needs a publisher account and token. See [Development → Publishing](development.md#publishing).
