const vscode = require('vscode');

class StatusBarManager {
    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right, 
            100
        );
        this.statusBarItem.command = 'terraformCost.calculateCosts';
        this.statusBarItem.tooltip = 'Click to refresh Terraform cost estimates';
        this.isVisible = false;
    }

    updateTotalCost(totalCost, currency = 'USD') {
        if (totalCost === 0) {
            this.hide();
            return;
        }

        const monthlyStr = this.formatCurrency(totalCost, currency);
        
        // Icon based on cost level
        let icon = '💰';
        let backgroundColor = undefined;
        
        if (totalCost > 1000) {
            icon = '🚨';
            backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        } else if (totalCost > 500) {
            icon = '⚠️';
            backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else if (totalCost > 100) {
            icon = '⚡';
        }

        this.statusBarItem.text = `${icon} ${monthlyStr}/mo`;
        this.statusBarItem.tooltip = this.createTooltip(totalCost, currency);
        this.statusBarItem.backgroundColor = backgroundColor;
        
        this.show();
    }

    updateProgress(message = 'Calculating costs...') {
        this.statusBarItem.text = `$(sync~spin) ${message}`;
        this.statusBarItem.tooltip = 'Terraform cost calculation in progress';
        this.statusBarItem.backgroundColor = undefined;
        this.show();
    }

    updateError(errorMessage) {
        this.statusBarItem.text = '$(error) Cost calc failed';
        this.statusBarItem.tooltip = `Error calculating Terraform costs: ${errorMessage}`;
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.show();
    }

    formatCurrency(amount, currency = 'USD') {
        const symbol = this.getCurrencySymbol(currency);
        
        if (amount >= 1000) {
            return `${symbol}${(amount / 1000).toFixed(1)}k`;
        } else if (amount >= 100) {
            return `${symbol}${amount.toFixed(0)}`;
        } else {
            return `${symbol}${amount.toFixed(2)}`;
        }
    }

    getCurrencySymbol(currency) {
        const symbols = {
            'USD': '$',
            'EUR': '€',
            'GBP': '£',
            'JPY': '¥'
        };
        return symbols[currency] || '$';
    }

    createTooltip(totalCost, currency) {
        const monthlyStr = this.formatCurrency(totalCost, currency);
        const yearlyStr = this.formatCurrency(totalCost * 12, currency);
        const dailyStr = this.formatCurrency(totalCost / 30, currency);
        
        const lines = [
            '**Terraform Infrastructure Costs**',
            '',
            `💰 **Total Estimated Cost:**`,
            `• Daily: ${dailyStr}`,
            `• Monthly: ${monthlyStr}`,
            `• Yearly: ${yearlyStr}`,
            '',
            this.getCostAnalysis(totalCost),
            '',
            '💡 **Actions:**',
            '• Click to refresh calculations',
            '• Use Ctrl+Shift+P → "Terraform Cost" for more options'
        ];

        return new vscode.MarkdownString(lines.join('\n'));
    }

    getCostAnalysis(totalCost) {
        if (totalCost > 1000) {
            return '🚨 **High cost infrastructure** - Review for optimization opportunities';
        } else if (totalCost > 500) {
            return '⚠️ **Moderate cost infrastructure** - Monitor usage and consider optimization';
        } else if (totalCost > 100) {
            return '⚡ **Standard cost infrastructure** - Well within reasonable range';
        } else if (totalCost > 0) {
            return '✅ **Low cost infrastructure** - Cost-effective setup';
        } else {
            return '🆓 **Free tier resources** - No estimated costs';
        }
    }

    show() {
        if (!this.isVisible) {
            this.statusBarItem.show();
            this.isVisible = true;
        }
    }

    hide() {
        if (this.isVisible) {
            this.statusBarItem.hide();
            this.isVisible = false;
        }
    }

    dispose() {
        this.statusBarItem.dispose();
    }
}

module.exports = StatusBarManager;