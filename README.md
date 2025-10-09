# Matali - Terraform Cost Calculator

> **Ride the cloud, not the cost**

Real-time cost estimation for your Terraform infrastructure. See cloud costs as you write Infrastructure as Code - before you deploy!

![VS Code Extension Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Real-time cost estimates** - See costs as you type
- **Inline decorations** - Cost displayed right next to your resources
- **Status bar totals** - Quick overview of total infrastructure costs
- **Multi-cloud support** - AWS, GCP, and Azure
- **Infracost integration** - Accurate pricing via Infracost API
- **Smart highlighting** - Expensive resources highlighted automatically
- **Cost optimization tips** - Suggestions to reduce costs

## Quick Start

### Installation

1. Install from VS Code Marketplace (coming soon)
2. Or install from `.vsix` file:
   ```bash
   code --install-extension terraform-cost-calculator-1.0.0.vsix
   ```

### Setup

1. **Optional but Recommended**: Get a free [Infracost API key](https://www.infracost.io)
2. Open VS Code Settings (`Ctrl+,` or `Cmd+,`)
3. Search for "Terraform Cost"
4. Enter your Infracost API key

Without API key, the extension will use built-in fallback pricing (less accurate).

##  Usage

1. Open any `.tf` or `.tfvars` file
2. Cost estimates appear automatically next to resources
3. Total cost shows in the status bar (bottom right)

### Commands

- `Terraform Cost: Calculate Costs` - Manually trigger cost calculation
- `Terraform Cost: Refresh Cost Estimates` - Refresh all estimates
- `Terraform Cost: Toggle Cost Display` - Show/hide inline costs
- `Terraform Cost: Toggle Total Cost Header` - Show/hide header summary

Access commands via Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`)


### Inline Cost Estimates
```hcl
resource "aws_instance" "web" {
  ami           = "ami-12345678"
  instance_type = "t3.medium"      # 💰 $30.37/mo ($364.42/yr)
}

resource "aws_db_instance" "postgres" {
  instance_class = "db.t3.small"   # 💰 $24.82/mo ($297.84/yr)
  engine         = "postgres"
}
```

### Total Cost Header
```
 TOTAL INFRASTRUCTURE COST: $847.50/mo ($10,170.00/yr)
```

## ⚙️ Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `terraformCost.enabled` | `true` | Enable/disable extension |
| `terraformCost.useInfracost` | `true` | Use Infracost for accurate pricing |
| `terraformCost.infracostApiKey` | `""` | Your Infracost API key |
| `terraformCost.currency` | `USD` | Display currency (USD, EUR, GBP, JPY) |
| `terraformCost.updateInterval` | `2000` | Delay before recalculating (ms) |
| `terraformCost.showInlineDecorations` | `true` | Show costs inline |
| `terraformCost.showStatusBar` | `true` | Show total in status bar |
| `terraformCost.showTotalCostHeader` | `true` | Show cost summary at top |
| `terraformCost.expensiveThreshold` | `100` | Threshold for expensive resource warning |
| `terraformCost.useSeparateBudgetDecoration` | `true` | Show budget messages as a separate block under the total cost header |

### Region Configuration

```json
{
  "terraformCost.region": {
    "aws": "us-east-1",
    "gcp": "us-central1",
    "azure": "eastus"
  }
}
```

## 🎨 Cost Indicators

- **Green** - Low cost (< $10/month)
- **Yellow** - Medium cost ($10-50/month)
- **Orange** - High cost ($50-100/month)
- **Red** - Very high cost (> $100/month)

##  Supported Resources

### AWS
- EC2 Instances (`aws_instance`)
- RDS Databases (`aws_db_instance`)
- S3 Buckets (`aws_s3_bucket`)
- EBS Volumes (`aws_ebs_volume`)
- NAT Gateways (`aws_nat_gateway`)
- Load Balancers (`aws_lb`, `aws_alb`, `aws_nlb`)

### GCP
- Compute Instances (`google_compute_instance`)
- Cloud SQL (`google_sql_database_instance`)
- Cloud Storage (`google_storage_bucket`)
- Persistent Disks (`google_compute_disk`)

### Azure
- Virtual Machines (`azurerm_virtual_machine`)
- SQL Databases (`azurerm_sql_database`)
- Storage Accounts (`azurerm_storage_account`)
- Managed Disks (`azurerm_managed_disk`)

##  Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see LICENSE file for details

## Acknowledgments

- [Infracost](https://www.infracost.io) - Accurate cloud cost data
- VS Code team for excellent extension API

<!-- ##  Support

-  [Report bugs](https://github.com/yourusername/terraform-cost-calculator/issues)
-  [Request features](https://github.com/yourusername/terraform-cost-calculator/issues)
- Email: swarajpawar465@gmail.com

--- -->

**Made with ❤️ for DevOps Engineers who care about cloud costs**

## 💸 Optional Budgeting Feature (new)

You can optionally add a `terraform.budget.json` file to your workspace (placed in your repository root or any parent folder of the Terraform files). When present the extension will monitor total estimated monthly costs and surface in-editor feedback when configured thresholds are reached.

Supported fields (all numeric):
- `final_limit` — Final budget. When reached the header turns red and an error diagnostic/popup is shown.
- `limit_1`, `limit_2`, `limit_3` — Progressive thresholds. When reached the header turns yellow and a visible budget block appears below the total header.

Example `terraform.budget.json`:

```json
{
  "final_limit": 2000.00,
  "limit_1": 100.00,
  "limit_2": 500.00,
  "limit_3": 1000.00
}
```

Behavior:
- The total infra cost header is green by default.
- When `limit_1/2/3` is reached the header becomes yellow and a separate budget block message is shown under the header (visible inline, controlled by `terraformCost.useSeparateBudgetDecoration`).
- When `final_limit` is reached the header becomes red, a diagnostic (error) is emitted at the top of the file and an error popup is shown.
- The extension avoids spamming notifications — it only notifies when you cross into a higher threshold level.

Settings:
- `terraformCost.useSeparateBudgetDecoration` (default: `true`) — If enabled, the budget message is shown as a separate styled block under the total header (recommended). If disabled, the message is appended inline with the header.

This feature is optional and can be removed by deleting `terraform.budget.json` from your workspace.