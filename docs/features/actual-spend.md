# Actual cloud spend

[← Docs index](../README.md)

`Terraform Cost: Compare Estimate with Actual Cloud Spend` asks which providers to query, then opens a Markdown report showing:

- the Terraform estimate per provider (a whole-workspace scan),
- **last full month's actual spend**,
- **month-to-date spend**, plus a straight-line projection for the full month and its difference from the estimate,
- the top 10 services by actual spend for each provider.

It runs each provider's own CLI under your existing login, and the extension stores no cloud credentials:

| Provider | How | Setup |
|---|---|---|
| AWS | `aws ce get-cost-and-usage` (Cost Explorer) | `aws configure` / SSO; optional `terraformCost.billing.awsProfile`. **AWS bills $0.01 per request; each run makes 2.** |
| Azure | Cost Management Query API via `az rest` | `az login`; optional `terraformCost.billing.azureSubscriptionId` |
| GCP | `bq query` against your [Cloud Billing BigQuery export](https://cloud.google.com/billing/docs/how-to/export-data-bigquery) | `gcloud auth login`; set `terraformCost.billing.gcpBillingExportTable` (you're prompted the first time) |

Actual spend covers **everything billed to that account, subscription or billing export**, including resources that this Terraform doesn't manage, so read big gaps with that in mind. If one provider fails (for example, not logged in), its error is shown in the report and the other providers' results still appear.

**Verification**: `src/integrations/billing-integration.js` has no `vscode` dependency and takes an injectable command runner. `test/suite/billing-integration.test.js` covers response parsing for all three providers, billing-period math (including year boundaries), BigQuery table-name validation, temp-file cleanup and the report output. It has **not** been run against a live billing account yet.
