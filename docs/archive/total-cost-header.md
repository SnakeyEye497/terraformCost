> **Archived document.** Kept for history; it describes the project as it was at the time and may mention files, numbers or behavior that have since changed. See the [docs index](../README.md) for current documentation.

# Total Cost Header Feature

## Overview

The Terraform Cost Calculator extension now includes a **Total Cost Header** feature that displays a summary of the total infrastructure cost at the top of your Terraform files.

## Features

### Visual Header Display
- Shows at the top of each Terraform file (line 0)
- Displays total monthly cost for all resources in the file
- Uses visual styling to make it prominent but non-intrusive

### Smart Styling
- **Normal costs** (under $100/month): Blue background with 💰 emoji
- **Expensive costs** ($100/month and above): Red background with ⚠️💰 emoji to draw attention

### Example Display
```
💰 TOTAL INFRASTRUCTURE COST: $45.20/mo (3 resources)
```

### Hover Information
Hover over the total cost header to see:
- Breakdown of all resource costs
- Number of resources analyzed
- Yearly cost projection
- Individual resource costs

## Configuration

### Enable/Disable
The total cost header can be controlled via VS Code settings:

1. Open VS Code Settings (Cmd/Ctrl + ,)
2. Search for "terraform cost"
3. Toggle "Show Total Cost Header" setting

Or in `settings.json`:
```json
{
  "terraformCost.showTotalCostHeader": true
}
```

### Command Palette
Use the command palette (Cmd/Ctrl + Shift + P) and search for:
- "Terraform Cost: Toggle Total Cost Header"

## How It Works

1. **Real-time Analysis**: Automatically calculates costs as you edit Terraform files
2. **Multi-Cloud Support**: Works with AWS, GCP, and Azure resources
3. **Debounced Updates**: Updates after 2 seconds of inactivity to avoid constant recalculation
4. **Non-Intrusive**: Displays as a decoration that doesn't affect your code

## Integration with Other Features

- Works alongside individual resource cost decorations
- Integrates with the status bar total cost display
- Respects the same configuration for expensive cost thresholds
- Uses the same cost calculation engine

## Example Output

For a Terraform file with:
- 1x AWS EC2 t3.medium instance ($30.37/month)
- 1x AWS EBS gp3 volume 20GB ($1.60/month)  
- 1x AWS NAT Gateway ($32.40/month)

The header would show:
```
💰 TOTAL INFRASTRUCTURE COST: $64.37/mo (3 resources)
```

And when hovered:
```
Total Infrastructure Cost: $64.37/month
Yearly Cost: $772.44
Resources: 3

Breakdown:
• EC2 Instance t3.medium: $30.37/month
• EBS Volume gp3 20GB: $1.60/month  
• NAT Gateway: $32.40/month
```

## Benefits

- **Quick Overview**: See total costs at a glance without scrolling
- **Cost Awareness**: Helps developers understand the financial impact of their infrastructure
- **Early Warning**: Red highlighting for expensive configurations
- **Detailed Breakdown**: Hover for detailed cost analysis
- **Non-Intrusive**: Doesn't interfere with code editing workflow
