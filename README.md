# Terraform Cost Calculator

A powerful VS Code extension that provides real-time cost estimation for your Terraform infrastructure across AWS, Google Cloud Platform (GCP), and Microsoft Azure.

## Features

### 🚀 Real-time Cost Calculation
- **Live cost updates** as you type in Terraform files
- **Multi-cloud support** for AWS, GCP, and Azure
- **Intelligent parsing** of Terraform configuration files
- **Debounced updates** to avoid excessive API calls

### 💰 Cost Display Options
- **Inline decorations** showing costs directly in your code
- **Status bar integration** displaying total infrastructure costs
- **Hover tooltips** with detailed cost breakdowns
- **Color-coded warnings** for expensive resources

### 📊 Comprehensive Cost Analysis
- **Hourly, monthly, and yearly** cost estimates
- **Detailed breakdowns** by resource type
- **Cost optimization suggestions** for expensive resources
- **Currency support** (USD, EUR, GBP, JPY)

### ⚙️ Configurable Settings
- Enable/disable cost calculations
- Choose supported cloud providers
- Set default regions per provider
- Customize update intervals
- Toggle inline decorations and status bar

## Supported Resources

### AWS Resources
- EC2 Instances (`aws_instance`)
- RDS Databases (`aws_db_instance`)
- S3 Buckets (`aws_s3_bucket`)
- EBS Volumes (`aws_ebs_volume`)
- NAT Gateways (`aws_nat_gateway`)
- Load Balancers (`aws_lb`, `aws_alb`, `aws_nlb`)
- Lambda Functions (`aws_lambda_function`)
- ECS Services (`aws_ecs_service`)

### Google Cloud Resources
- Compute Engine (`google_compute_instance`)
- Cloud SQL (`google_sql_database_instance`)
- Cloud Storage (`google_storage_bucket`)
- Persistent Disks (`google_compute_disk`)
- Cloud Functions (`google_cloudfunctions_function`)
- GKE Clusters (`google_container_cluster`)

### Azure Resources
- Virtual Machines (`azurerm_virtual_machine`)
- SQL Databases (`azurerm_sql_database`)
- Storage Accounts (`azurerm_storage_account`)
- Managed Disks (`azurerm_managed_disk`)
- Function Apps (`azurerm_function_app`)
- AKS Clusters (`azurerm_kubernetes_cluster`)

## Installation

1. Install the extension from the VS Code marketplace
2. Open a Terraform file (`.tf` or `.tfvars`)
3. Start seeing real-time cost estimates!

## Commands

The extension provides the following commands accessible via Command Palette (`Ctrl+Shift+P`):

- **Terraform Cost: Calculate Costs** - Manually trigger cost calculation
- **Terraform Cost: Toggle Cost Display** - Enable/disable inline cost decorations
- **Terraform Cost: Refresh Cost Estimates** - Refresh all cost calculations

## Configuration

Access settings via `File > Preferences > Settings` and search for "Terraform Cost":

```json
{
  "terraformCost.enabled": true,
  "terraformCost.providers": ["aws", "gcp", "azure"],
  "terraformCost.currency": "USD",
  "terraformCost.region": {
    "aws": "us-east-1",
    "gcp": "us-central1",
    "azure": "East US"
  },
  "terraformCost.updateInterval": 2000,
  "terraformCost.showInlineDecorations": true,
  "terraformCost.showStatusBar": true
}
```

### Settings Description

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable the extension |
| `providers` | array | `["aws", "gcp", "azure"]` | Supported cloud providers |
| `currency` | string | `"USD"` | Display currency (USD, EUR, GBP, JPY) |
| `region` | object | See above | Default regions for each provider |
| `updateInterval` | number | `2000` | Update interval in milliseconds |
| `showInlineDecorations` | boolean | `true` | Show costs inline with code |
| `showStatusBar` | boolean | `true` | Show total cost in status bar |

## Usage Examples

### Example 1: AWS EC2 Instance
```hcl
resource "aws_instance" "web_server" {
  ami           = "ami-0c55b159cbfafe1d0"
  instance_type = "t3.medium"    # 💰 $30.37/mo ($364.40/yr)
  
  tags = {
    Name = "Web Server"
  }
}
```

### Example 2: GCP Compute Instance
```hcl
resource "google_compute_instance" "app_server" {
  name         = "app-server"
  machine_type = "e2-medium"     # 💰 $18.40/mo ($220.75/yr)
  zone         = "us-central1-a"
  
  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-11"
    }
  }
}
```

### Example 3: Azure Virtual Machine
```hcl
resource "azurerm_virtual_machine" "main" {
  name                = "main-vm"
  location            = "East US"
  vm_size             = "Standard_B2s"  # 💰 $30.37/mo ($364.40/yr)
  
  # ... other configuration
}
```

## Cost Estimation Methodology

### Pricing Data Sources
- **AWS**: Based on official AWS pricing (simplified estimates)
- **GCP**: Based on Google Cloud pricing calculator data
- **Azure**: Based on Azure pricing calculator estimates

### Important Notes
- 🔔 **Estimates Only**: Costs are estimates and may not reflect actual billing
- 📊 **Simplified Calculations**: Complex pricing models are simplified
- 🔄 **Regular Updates**: Pricing data should be updated regularly
- 💡 **Optimization**: Use suggestions to optimize your infrastructure costs

### Cost Categories
- 🟢 **Low Cost**: < $10/month
- 🟡 **Medium Cost**: $10-50/month  
- 🟠 **High Cost**: $50-100/month
- 🔴 **Very High Cost**: > $100/month

## Optimization Suggestions

The extension provides intelligent suggestions for cost optimization:

### Instance Optimization
- Use smaller instance types for development
- Consider spot instances for non-critical workloads
- Implement auto-scaling for variable workloads

### Storage Optimization
- Use appropriate storage tiers (Standard vs Premium)
- Consider lifecycle policies for S3/Blob storage
- Right-size storage volumes

### Database Optimization
- Use reserved instances for long-term workloads
- Consider read replicas instead of larger instances
- Optimize database configurations

## Troubleshooting

### Common Issues

**Extension not showing costs**
- Ensure the file has `.tf` extension
- Check that `terraformCost.enabled` is true
- Verify the Terraform syntax is valid

**Incorrect cost estimates**
- Check region settings in configuration
- Verify resource attributes are correctly specified
- Update pricing data if available

**Performance issues**
- Increase `updateInterval` for large files
- Disable inline decorations for very large files
- Use file exclusion patterns if needed

### Debug Information

Enable debug logging by setting the log level to "Debug" in VS Code settings.

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup
1. Clone the repository
2. Run `npm install`
3. Open in VS Code
4. Press `F5` to launch extension development host

### Adding New Resource Types
1. Update the appropriate cost calculator in `src/cost-calculator.js`
2. Add resource type to `terraform-parser.js`
3. Update documentation and tests

## Roadmap

### Upcoming Features
- 🔄 **Live pricing API integration**
- 📈 **Cost trend analysis**
- 💾 **Cost budget alerts**
- 🔗 **Integration with cloud billing APIs**
- 📊 **Cost comparison between regions**
- 🎯 **Resource tagging cost analysis**

### Version History

#### v1.0.0
- Initial release
- Support for AWS, GCP, and Azure
- Real-time cost calculations
- Inline decorations and status bar
- Configuration options

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

- 📧 **Email**: support@terraform-cost-calculator.com
- 🐛 **Issues**: [GitHub Issues](https://github.com/yourusername/terraform-cost-calculator/issues)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/yourusername/terraform-cost-calculator/discussions)

---

**Disclaimer**: This extension provides cost estimates based on public pricing information. Actual costs may vary based on usage patterns, discounts, reserved instances, and other factors. Always refer to your cloud provider's billing dashboard for accurate cost information.

## Working with Markdown

You can author your README using Visual Studio Code.  Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux)
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux)
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
