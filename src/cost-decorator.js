const vscode = require('vscode');

class CostDecorator {
    constructor() {
        this.decorationType = vscode.window.createTextEditorDecorationType({
            after: {
                margin: '0 0 0 3em',
                color: '#888888',
                fontStyle: 'italic'
            },
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
        });
        
        this.errorDecorationType = vscode.window.createTextEditorDecorationType({
            after: {
                margin: '0 0 0 3em',
                color: '#ff6b6b',
                fontStyle: 'italic'
            },
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
        });
        
        this.expensiveDecorationType = vscode.window.createTextEditorDecorationType({
            after: {
                margin: '0 0 0 3em',
                color: '#ff9800',
                fontStyle: 'italic',
                fontWeight: 'bold'
            },
            backgroundColor: 'rgba(255, 152, 0, 0.1)',
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
        });

        this.totalCostDecorationType = vscode.window.createTextEditorDecorationType({
            after: {
                margin: '0 0 0 2em',
                color: '#4CAF50',
                fontWeight: 'bold'
            },
            backgroundColor: 'rgba(76, 175, 80, 0.1)',
            border: '1px solid rgba(76, 175, 80, 0.3)',
            borderRadius: '3px',
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
        });

        this.totalCostExpensiveDecorationType = vscode.window.createTextEditorDecorationType({
            after: {
                margin: '0 0 0 2em',
                color: '#ff6b6b',
                fontWeight: 'bold'
            },
            backgroundColor: 'rgba(255, 107, 107, 0.1)',
            border: '1px solid rgba(255, 107, 107, 0.3)',
            borderRadius: '3px',
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
        });

        this.budgetDecorationType = vscode.window.createTextEditorDecorationType({
            isWholeLine: false,
            after: {
                margin: '0 0 0 2em',
                color: '#FFB300',
                fontWeight: '600'
            },
            backgroundColor: 'rgba(255, 187, 51, 0.06)',
            border: '1px solid rgba(255, 187, 51, 0.12)',
            borderRadius: '3px',
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
        });
    }

    decorateEditor(editor, resourceCosts, budgetInfo = null) {
        if (!editor || !resourceCosts || resourceCosts.length === 0) {
            this.clearDecorations(editor);
            return;
        }

        const normalDecorations = [];
        const errorDecorations = [];
        const expensiveDecorations = [];
        const totalCostDecorations = [];

        // Calculate total cost
        const totalCost = resourceCosts.reduce((sum, item) => sum + (item.cost.monthly || 0), 0);
        
        // Add total cost decoration at the top of the file (if enabled)
        const showTotalCostHeader = vscode.workspace.getConfiguration('terraformCost').get('showTotalCostHeader', true);
        if (totalCost > 0 && showTotalCostHeader) {
            const decs = this.createTotalCostDecoration(editor, totalCost, resourceCosts[0]?.cost?.currency || 'USD', budgetInfo);
            if (decs) {
                if (decs.mainDecoration) totalCostDecorations.push(decs.mainDecoration);
                // store budgetDecoration separately by attaching to a temp field on editor (we'll apply later)
                if (decs.budgetDecoration) {
                    // reuse a local temporary store
                    this._pendingBudgetDecoration = decs.budgetDecoration;
                } else {
                    this._pendingBudgetDecoration = null;
                }
            }
        }

        resourceCosts.forEach(({ resource, cost, line }) => {
            if (line <= 0 || line > editor.document.lineCount) {
                return;
            }

            const lineIndex = line - 1;
            const lineText = editor.document.lineAt(lineIndex);
            const decoration = this.createDecoration(lineText, cost, resource);

            if (cost.monthly === 0 && cost.breakdown && cost.breakdown[0] && cost.breakdown[0].includes('Error')) {
                errorDecorations.push(decoration);
            } else if (cost.monthly > 100) { // Expensive resources
                expensiveDecorations.push(decoration);
            } else {
                normalDecorations.push(decoration);
            }
        });

        // Apply decorations
        editor.setDecorations(this.decorationType, normalDecorations);
        editor.setDecorations(this.errorDecorationType, errorDecorations);
        editor.setDecorations(this.expensiveDecorationType, expensiveDecorations);
        
        // Apply total cost decorations
        if (totalCost > 100) {
            editor.setDecorations(this.totalCostExpensiveDecorationType, totalCostDecorations);
            editor.setDecorations(this.totalCostDecorationType, []);
        } else {
            editor.setDecorations(this.totalCostDecorationType, totalCostDecorations);
            editor.setDecorations(this.totalCostExpensiveDecorationType, []);
        }

        // Apply separate budget decoration (if any)
        if (this._pendingBudgetDecoration) {
            editor.setDecorations(this.budgetDecorationType, [this._pendingBudgetDecoration]);
        } else {
            editor.setDecorations(this.budgetDecorationType, []);
        }
    }

    createTotalCostDecoration(editor, totalCost, currency, budgetInfo = null) {
        if (!editor || totalCost <= 0) {
            return null;
        }

        // Find the best line to place the total cost (first non-empty line or line 1)
        let targetLine = 0;
        for (let i = 0; i < Math.min(10, editor.document.lineCount); i++) {
            const line = editor.document.lineAt(i);
            if (line.text.trim().length > 0) {
                // Place it on the first non-empty line
                targetLine = i;
                break;
            }
        }

        const line = editor.document.lineAt(targetLine);
    const costText = this.formatTotalCostText(totalCost, currency);
        const range = new vscode.Range(targetLine, line.text.length, targetLine, line.text.length);

        // Decide color based on budgetInfo.level: 0=green, 1-3=yellow, 4=red
        let color = '#4CAF50';
        let level = 0;
        if (budgetInfo && typeof budgetInfo === 'object') {
            level = budgetInfo.level || 0;
            if (level >= 4) {
                color = '#ff6b6b';
            } else if (level >= 1) {
                color = '#FFB300';
            }
        }

        const mainDecoration = {
            range,
            renderOptions: {
                after: {
                    contentText: costText,
                    color: color,
                    fontWeight: 'bold'
                }
            },
            hoverMessage: this.createTotalCostHoverMessage(totalCost, currency)
        };

        // If separate budget block is requested, return main and also a second decoration target
        if (budgetInfo && budgetInfo.message && vscode.workspace.getConfiguration('terraformCost').get('useSeparateBudgetDecoration', true)) {
            // Create a second decoration anchored to the same line with budget message
            const budgetDecoration = {
                range,
                renderOptions: {
                    after: {
                        contentText: ` ${budgetInfo.message}`,
                        color: level >= 4 ? '#ff6b6b' : '#FFB300',
                        fontWeight: '600'
                    }
                }
            };

            // Return both decorations to be applied to separate decoration types by caller
            return { mainDecoration, budgetDecoration };
        }

        return { mainDecoration };
    }

    formatTotalCostText(totalCost, currency) {
        const monthlyStr = this.formatCurrency(totalCost, currency);
        const yearlyStr = this.formatCurrency(totalCost * 12, currency);
        
        let icon = '💰';
        let warningText = '';
        
        if (totalCost > 1000) {
            icon = '🚨';
            warningText = ' (HIGH COST!)';
        } else if (totalCost > 500) {
            icon = '⚠️';
            warningText = ' (Monitor costs)';
        } else if (totalCost > 100) {
            icon = '⚡';
        }
        
        return ` ${icon} TOTAL INFRASTRUCTURE COST: ${monthlyStr}/mo (${yearlyStr}/yr)${warningText}`;
    }

    createTotalCostHoverMessage(totalCost, currency) {
        const monthlyStr = this.formatCurrency(totalCost, currency);
        const yearlyStr = this.formatCurrency(totalCost * 12, currency);
        const dailyStr = this.formatCurrency(totalCost / 30, currency);
        
        const messages = [
            '## 💰 Total Infrastructure Cost Summary',
            '',
            '**Estimated Costs:**',
            `• **Daily:** ${dailyStr}`,
            `• **Monthly:** ${monthlyStr}`,
            `• **Yearly:** ${yearlyStr}`,
            '',
            this.getTotalCostAnalysis(totalCost),
            '',
            '**💡 Cost Optimization Tips:**',
            '• Review expensive resources (>$100/month)',
            '• Consider spot instances for non-critical workloads',
            '• Use reserved instances for predictable workloads',
            '• Implement auto-scaling to optimize usage',
            '• Review storage tiers and lifecycle policies',
            '',
            '**📊 Actions:**',
            '• Use Ctrl+Shift+P → "Terraform Cost" for more options',
            '• Hover over individual resources for optimization suggestions'
        ];

        return new vscode.MarkdownString(messages.join('\n'));
    }

    getTotalCostAnalysis(totalCost) {
        if (totalCost > 1000) {
            return '🚨 **HIGH COST INFRASTRUCTURE** - Immediate review recommended for cost optimization';
        } else if (totalCost > 500) {
            return '⚠️ **MODERATE COST INFRASTRUCTURE** - Monitor usage and consider optimization opportunities';
        } else if (totalCost > 100) {
            return '⚡ **STANDARD COST INFRASTRUCTURE** - Well within reasonable range, monitor growth';
        } else if (totalCost > 0) {
            return '✅ **LOW COST INFRASTRUCTURE** - Cost-effective setup, great for development/testing';
        } else {
            return '🆓 **FREE TIER RESOURCES** - No estimated costs, perfect for learning and experimentation';
        }
    }

    createDecoration(line, cost, resource) {
        const costText = this.formatCostText(cost);
        const range = new vscode.Range(line.lineNumber, line.text.length, line.lineNumber, line.text.length);
        
        return {
            range,
            renderOptions: {
                after: {
                    contentText: costText,
                    color: this.getCostColor(cost)
                }
            },
            hoverMessage: this.createHoverMessage(cost, resource)
        };
    }

    formatCostText(cost) {
        if (cost.monthly === 0) {
            if (cost.breakdown && cost.breakdown[0] && cost.breakdown[0].includes('Error')) {
                return ' ❌ Error calculating cost';
            }
            return ' 💰 Free';
        }

        const monthlyStr = this.formatCurrency(cost.monthly, cost.currency);
        const yearlyStr = this.formatCurrency(cost.yearly, cost.currency);
        
        if (cost.monthly > 100) {
            return ` 💰 ${monthlyStr}/mo (${yearlyStr}/yr) ⚠️`;
        } else if (cost.monthly > 50) {
            return ` 💰 ${monthlyStr}/mo (${yearlyStr}/yr) ⚡`;
        } else {
            return ` 💰 ${monthlyStr}/mo (${yearlyStr}/yr)`;
        }
    }

    formatCurrency(amount, currency = 'USD') {
        const symbol = this.getCurrencySymbol(currency);
        return `${symbol}${amount.toFixed(2)}`;
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

    getCostColor(cost) {
        if (cost.monthly === 0) return '#666666';
        if (cost.monthly > 100) return '#ff6b6b';
        if (cost.monthly > 50) return '#ff9800';
        if (cost.monthly > 10) return '#ffc107';
        return '#4caf50';
    }

    createHoverMessage(cost, resource) {
        const messages = [];
        
        // Resource info
        messages.push(`**${resource.type}** \`${resource.name}\``);
        messages.push('');
        
        // Cost breakdown
        messages.push('**Cost Breakdown:**');
        if (cost.breakdown && cost.breakdown.length > 0) {
            cost.breakdown.forEach(item => {
                messages.push(`• ${item}`);
            });
        }
        
        messages.push('');
        
        // Detailed costs
        if (cost.monthly > 0) {
            messages.push('**Estimated Costs:**');
            messages.push(`• Hourly: ${this.formatCurrency(cost.hourly, cost.currency)}`);
            messages.push(`• Monthly: ${this.formatCurrency(cost.monthly, cost.currency)}`);
            messages.push(`• Yearly: ${this.formatCurrency(cost.yearly, cost.currency)}`);
        }
        
        // Warnings for expensive resources
        if (cost.monthly > 100) {
            messages.push('');
            messages.push('⚠️ **High Cost Resource** - Consider optimization');
        } else if (cost.monthly > 50) {
            messages.push('');
            messages.push('⚡ **Medium Cost Resource** - Monitor usage');
        }
        
        // Provider info
        messages.push('');
        messages.push(`**Provider:** ${resource.provider.toUpperCase()}`);
        
        // Attributes info
        if (resource.attributes && Object.keys(resource.attributes).length > 0) {
            messages.push('');
            messages.push('**Configuration:**');
            Object.entries(resource.attributes).slice(0, 5).forEach(([key, value]) => {
                if (typeof value === 'string' && value.length < 50) {
                    messages.push(`• ${key}: \`${value}\``);
                } else if (typeof value === 'number') {
                    messages.push(`• ${key}: \`${value}\``);
                }
            });
        }
        
        // Optimization suggestions
        if (this.hasOptimizationSuggestions(resource, cost)) {
            messages.push('');
            messages.push('**💡 Optimization Suggestions:**');
            const suggestions = this.getOptimizationSuggestions(resource, cost);
            suggestions.forEach(suggestion => {
                messages.push(`• ${suggestion}`);
            });
        }
        
        return new vscode.MarkdownString(messages.join('\n'));
    }

    hasOptimizationSuggestions(resource, cost) {
        return cost.monthly > 10 || this.isOptimizableResource(resource);
    }

    isOptimizableResource(resource) {
        const optimizableTypes = [
            'aws_instance', 'google_compute_instance', 'azurerm_virtual_machine',
            'aws_db_instance', 'google_sql_database_instance', 'azurerm_sql_database',
            'aws_ebs_volume', 'google_compute_disk', 'azurerm_managed_disk'
        ];
        return optimizableTypes.includes(resource.type);
    }

    getOptimizationSuggestions(resource, cost) {
        const suggestions = [];
        
        switch (resource.type) {
            case 'aws_instance':
            case 'google_compute_instance':
            case 'azurerm_virtual_machine':
                if (cost.monthly > 50) {
                    suggestions.push('Consider using smaller instance types or spot instances');
                    suggestions.push('Implement auto-scaling to optimize usage');
                }
                if (!resource.attributes.instance_type?.includes('spot')) {
                    suggestions.push('Consider spot instances for non-critical workloads');
                }
                break;
                
            case 'aws_db_instance':
            case 'google_sql_database_instance':
            case 'azurerm_sql_database':
                if (cost.monthly > 30) {
                    suggestions.push('Consider using reserved instances for long-term workloads');
                    suggestions.push('Optimize database size and storage type');
                }
                break;
                
            case 'aws_ebs_volume':
            case 'google_compute_disk':
            case 'azurerm_managed_disk':
                suggestions.push('Consider using lower-cost storage tiers for infrequent access');
                if (resource.attributes.size > 100) {
                    suggestions.push('Evaluate if full storage capacity is needed');
                }
                break;
                
            default:
                if (cost.monthly > 50) {
                    suggestions.push('Review resource configuration for optimization opportunities');
                }
        }
        
        return suggestions;
    }

    clearDecorations(editor) {
        if (editor) {
            editor.setDecorations(this.decorationType, []);
            editor.setDecorations(this.errorDecorationType, []);
            editor.setDecorations(this.expensiveDecorationType, []);
            editor.setDecorations(this.totalCostDecorationType, []);
            editor.setDecorations(this.totalCostExpensiveDecorationType, []);
            editor.setDecorations(this.budgetDecorationType, []);
        }
    }

    dispose() {
        this.decorationType.dispose();
        this.errorDecorationType.dispose();
        this.expensiveDecorationType.dispose();
        this.totalCostDecorationType.dispose();
        this.totalCostExpensiveDecorationType.dispose();
        this.budgetDecorationType.dispose();
    }
}

module.exports = CostDecorator;