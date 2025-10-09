const vscode = require('vscode');
const TerraformCostCalculator = require('./src/cost-calculator');
const TerraformParser = require('./src/terraform-parser');
const CostDecorator = require('./src/cost-decorator');
const StatusBarManager = require('./src/status-bar-manager');
const ErrorHandler = require('./src/error-handler');
const debounce = require('debounce');

let costCalculator;
let terraformParser;
let costDecorator;
let statusBarManager;
let errorHandler;
let budgetManager;
let budgetDiagnostics; // vscode.DiagnosticCollection

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
    console.log('Matali - Ride the cloud, not the cost....');

    try {
        // Initialize components
        errorHandler = new ErrorHandler();
        costCalculator = new TerraformCostCalculator();
        terraformParser = new TerraformParser();
        costDecorator = new CostDecorator();
        statusBarManager = new StatusBarManager();
    budgetManager = new (require('./src/budget-manager'))();
    budgetDiagnostics = vscode.languages.createDiagnosticCollection('terraformBudget');

        // Initialize cost calculator (async)
        await costCalculator.initialize(context);

        // Register commands
        registerCommands(context);

        // Set up file watchers and events
        setupFileWatchers(context);

        // Watch for budget file changes so we reload budgets and re-evaluate
        const budgetWatcher = vscode.workspace.createFileSystemWatcher('**/terraform.budget.json');
        const onBudgetChange = async (uri) => {
            // reload budget for folder and re-run analysis on open terraform files
            await budgetManager.loadBudgetForFolder(vscode.Uri.file(uri.fsPath.replace(/\/terraform.budget.json$/,'')));
            await processOpenTerraformFiles();
        };

        budgetWatcher.onDidCreate(onBudgetChange, null, context.subscriptions);
        budgetWatcher.onDidChange(onBudgetChange, null, context.subscriptions);
        budgetWatcher.onDidDelete(async (uri) => {
            // clear cache and diagnostics when deleted
            budgetManager.clearCache();
            budgetDiagnostics.clear();
            await processOpenTerraformFiles();
        }, null, context.subscriptions);
        context.subscriptions.push(budgetWatcher, budgetDiagnostics);

        // Process already open Terraform files
        await processOpenTerraformFiles();

        console.log('Matali extension activated successfully');
    } catch (error) {
        console.error('Failed to activate extension:', error);
        vscode.window.showErrorMessage(`Matali extension failed to activate: ${error.message}`);
    }
}

function registerCommands(context) {
    // Calculate costs command
    const calculateCostsCommand = vscode.commands.registerCommand('terraformCost.calculateCosts', async () => {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && isTerraformFile(activeEditor.document)) {
            statusBarManager.updateProgress('Calculating costs...');
            await calculateAndDisplayCosts(activeEditor);
            vscode.window.showInformationMessage('Terraform costs calculated!');
        } else {
            vscode.window.showWarningMessage('Please open a Terraform file to calculate costs.');
        }
    });

    // Toggle cost display command
    const toggleCostDisplayCommand = vscode.commands.registerCommand('terraformCost.toggleCostDisplay', () => {
        const config = vscode.workspace.getConfiguration('terraformCost');
        const currentlyEnabled = config.get('showInlineDecorations');
        config.update('showInlineDecorations', !currentlyEnabled, true);
        
        if (!currentlyEnabled) {
            processOpenTerraformFiles();
            vscode.window.showInformationMessage('Cost display enabled');
        } else {
            clearAllDecorations();
            vscode.window.showInformationMessage('Cost display disabled');
        }
    });

    // Refresh costs command
    const refreshCostsCommand = vscode.commands.registerCommand('terraformCost.refreshCosts', async () => {
        // Clear cache
        if (costCalculator) {
            costCalculator.clearCache();
        }
        
        clearAllDecorations();
        statusBarManager.updateProgress('Refreshing costs...');
        await processOpenTerraformFiles();
        vscode.window.showInformationMessage('Cost estimates refreshed!');
    });

    // Toggle total cost header command
    const toggleTotalCostHeaderCommand = vscode.commands.registerCommand('terraformCost.toggleTotalCostHeader', () => {
        const config = vscode.workspace.getConfiguration('terraformCost');
        const currentlyEnabled = config.get('showTotalCostHeader');
        config.update('showTotalCostHeader', !currentlyEnabled, true);
        
        // Refresh all open files to apply the change
        processOpenTerraformFiles();
        
        if (!currentlyEnabled) {
            vscode.window.showInformationMessage('Total cost header enabled');
        } else {
            vscode.window.showInformationMessage('Total cost header disabled');
        }
    });

    // Clear error log command
    const clearErrorLogCommand = vscode.commands.registerCommand('terraformCost.clearErrorLog', () => {
        if (errorHandler) {
            errorHandler.clearErrorLog();
            vscode.window.showInformationMessage('Error log cleared');
        }
    });

    // Export error log command
    const exportErrorLogCommand = vscode.commands.registerCommand('terraformCost.exportErrorLog', async () => {
        if (errorHandler) {
            await errorHandler.exportErrorLog();
        }
    });

    context.subscriptions.push(
        calculateCostsCommand,
        toggleCostDisplayCommand,
        refreshCostsCommand,
        toggleTotalCostHeaderCommand,
        clearErrorLogCommand,
        exportErrorLogCommand
    );
}

function setupFileWatchers(context) {
    // Watch for text document changes (debounced)
    const debouncedUpdateCosts = debounce(async (document) => {
        if (isTerraformFile(document)) {
            const editor = vscode.window.visibleTextEditors.find(e => e.document === document);
            if (editor) {
                await calculateAndDisplayCosts(editor);
            }
        }
    }, getUpdateInterval());

    const onDidChangeTextDocument = vscode.workspace.onDidChangeTextDocument(async (event) => {
        if (isExtensionEnabled() && isTerraformFile(event.document)) {
            debouncedUpdateCosts(event.document);
        }
    });

    // Watch for active editor changes
    const onDidChangeActiveTextEditor = vscode.window.onDidChangeActiveTextEditor(async (editor) => {
        if (editor && isExtensionEnabled() && isTerraformFile(editor.document)) {
            await calculateAndDisplayCosts(editor);
        }
    });

    // Watch for file saves
    const onDidSaveDocument = vscode.workspace.onDidSaveTextDocument(async (document) => {
        if (isExtensionEnabled() && isTerraformFile(document)) {
            // Clear cache for this file on save
            if (costCalculator) {
                costCalculator.clearCache();
            }
            
            const editor = vscode.window.visibleTextEditors.find(e => e.document === document);
            if (editor) {
                await calculateAndDisplayCosts(editor);
            }
        }
    });

    // Watch for configuration changes
    const onDidChangeConfiguration = vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('terraformCost')) {
            console.log('Configuration changed, refreshing...');
            
            // Reinitialize if Infracost settings changed
            if (event.affectsConfiguration('terraformCost.useInfracost') ||
                event.affectsConfiguration('terraformCost.infracostApiKey')) {
                if (costCalculator) {
                    costCalculator.clearCache();
                }
            }
            
            processOpenTerraformFiles();
        }
    });

    context.subscriptions.push(
        onDidChangeTextDocument,
        onDidChangeActiveTextEditor,
        onDidSaveDocument,
        onDidChangeConfiguration
    );
}

async function processOpenTerraformFiles() {
    if (!isExtensionEnabled()) return;

    const editors = vscode.window.visibleTextEditors.filter(editor => 
        isTerraformFile(editor.document)
    );

    for (const editor of editors) {
        await calculateAndDisplayCosts(editor);
    }
}

async function calculateAndDisplayCosts(editor) {
    if (!editor || !editor.document) return;

    try {
        const document = editor.document;
        const text = document.getText();
        const filePath = document.uri.fsPath;

        // Parse Terraform configuration
        const parsedConfig = await terraformParser.parse(text);
        
        if (!parsedConfig || !parsedConfig.resources || parsedConfig.resources.length === 0) {
            // No resources found, clear decorations
            costDecorator.clearDecorations(editor);
            statusBarManager.hide();
            return;
        }

        // Resolve variable references
        const resolvedResources = terraformParser.resolveVariableReferences(
            parsedConfig.resources,
            parsedConfig.variables
        );

        // Calculate costs for each resource
        const resourceCosts = await Promise.all(
            resolvedResources.map(async (resource) => {
                try {
                    const cost = await costCalculator.calculateResourceCost(resource, filePath);
                    return {
                        resource,
                        cost,
                        line: resource.line || 0
                    };
                } catch (error) {
                    console.error(`Error calculating cost for ${resource.type}.${resource.name}:`, error);
                    return {
                        resource,
                        cost: costCalculator.getErrorCost(error.message),
                        line: resource.line || 0
                    };
                }
            })
        );

        // Filter out invalid results
        const validResourceCosts = resourceCosts.filter(rc => 
            rc && rc.line > 0 && rc.line <= editor.document.lineCount
        );

        // Display inline decorations
        if (shouldShowInlineDecorations() && validResourceCosts.length > 0) {
            // prepare budgetInfo for decorator
            let budgetInfo = null;
            try {
                const b = await budgetManager.loadBudgetForFile(document.uri.fsPath);
                if (b) {
                    const totalCost = validResourceCosts.reduce((s, i) => s + (i.cost.monthly || 0), 0);
                    let level = 0;
                    if (b.limit_1 && totalCost >= b.limit_1) level = Math.max(level, 1);
                    if (b.limit_2 && totalCost >= b.limit_2) level = Math.max(level, 2);
                    if (b.limit_3 && totalCost >= b.limit_3) level = Math.max(level, 3);
                    if (b.final_limit && totalCost >= b.final_limit) level = Math.max(level, 4);

                    let msg = '';
                    if (level >= 1) {
                        if (level === 4) {
                            msg = `Final budget reached: ${totalCost.toFixed(2)}`;
                        } else {
                            msg = `Budget level ${level} reached: ${totalCost.toFixed(2)}`;
                        }
                    }
                    budgetInfo = { level, message: msg };
                }
            } catch (err) {
                console.warn('Failed to load budget for decorator', err.message);
            }

            costDecorator.decorateEditor(editor, validResourceCosts, budgetInfo);
        } else {
            costDecorator.clearDecorations(editor);
        }

        // Update status bar
        if (shouldShowStatusBar()) {
            const totalCost = validResourceCosts.reduce((sum, item) => 
                sum + (item.cost.monthly || 0), 0
            );
            
            if (totalCost > 0) {
                statusBarManager.updateTotalCost(totalCost, getCurrency());
            } else {
                statusBarManager.hide();
            }
        } else {
            statusBarManager.hide();
        }

        // Budget check: load budget for this file and emit diagnostics / warnings
        try {
            await checkBudgetAndWarn(document.uri.fsPath, validResourceCosts.reduce((s, i) => s + (i.cost.monthly || 0), 0));
        } catch (err) {
            console.warn('Budget check failed:', err.message);
        }

    } catch (error) {
        console.error('Error calculating Terraform costs:', error);
        
        if (errorHandler) {
            await errorHandler.handleError(
                error,
                'calculateAndDisplayCosts',
                `Failed to calculate costs: ${error.message}`
            );
        }
        
        statusBarManager.updateError(error.message);
    }
}

function clearAllDecorations() {
    for (const editor of vscode.window.visibleTextEditors) {
        if (costDecorator) {
            costDecorator.clearDecorations(editor);
        }
    }
    if (statusBarManager) {
        statusBarManager.hide();
    }
}

async function checkBudgetAndWarn(filePath, totalMonthly) {
    if (!budgetManager) return;

    const budget = await budgetManager.loadBudgetForFile(filePath);
    if (!budget) {
        // clear any diagnostics for this file
        budgetDiagnostics?.delete(vscode.Uri.file(filePath));
        return;
    }

    // Determine level: 0 = ok, 1 = limit_1, 2 = limit_2, 3 = limit_3, 4 = final_limit
    let level = 0;
    if (budget.limit_1 && totalMonthly >= budget.limit_1) level = Math.max(level, 1);
    if (budget.limit_2 && totalMonthly >= budget.limit_2) level = Math.max(level, 2);
    if (budget.limit_3 && totalMonthly >= budget.limit_3) level = Math.max(level, 3);
    if (budget.final_limit && totalMonthly >= budget.final_limit) level = Math.max(level, 4);

    const prev = budgetManager.getNotificationLevelForFile(filePath) || 0;

    if (level > 0) {
        // Create diagnostic at top of file
        const uri = vscode.Uri.file(filePath);
        const doc = await vscode.workspace.openTextDocument(uri);
        const range = new vscode.Range(0, 0, 0, Math.min(200, doc.lineAt(0).text.length));
        const severity = level >= 4 ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
        const message = level >= 4 ?
            `Budget exceeded: total ${totalMonthly.toFixed(2)} >= final_limit ${budget.final_limit}` :
            `Budget threshold reached (level ${level}): total ${totalMonthly.toFixed(2)}`;

        const diag = new vscode.Diagnostic(range, message, severity);
        diag.source = 'terraform.budget.json';

        budgetDiagnostics.set(uri, [diag]);

        // Only show notification when crossing into a higher level
        if (level > prev) {
            if (level >= 4) {
                vscode.window.showErrorMessage(message);
            } else {
                vscode.window.showWarningMessage(message);
            }
            budgetManager.setNotificationLevelForFile(filePath, level);
        }
    } else {
        // Clear diagnostics and reset notification level
        budgetDiagnostics.delete(vscode.Uri.file(filePath));
        budgetManager.setNotificationLevelForFile(filePath, 0);
    }
}

function isTerraformFile(document) {
    if (!document) return false;
    
    return document.languageId === 'terraform' || 
           document.fileName.endsWith('.tf') || 
           document.fileName.endsWith('.tfvars') ||
           document.fileName.endsWith('.tf.json');
}

function isExtensionEnabled() {
    return vscode.workspace.getConfiguration('terraformCost').get('enabled', true);
}

function shouldShowInlineDecorations() {
    return vscode.workspace.getConfiguration('terraformCost').get('showInlineDecorations', true);
}

function shouldShowStatusBar() {
    return vscode.workspace.getConfiguration('terraformCost').get('showStatusBar', true);
}

function getCurrency() {
    return vscode.workspace.getConfiguration('terraformCost').get('currency', 'USD');
}

function getUpdateInterval() {
    return vscode.workspace.getConfiguration('terraformCost').get('updateInterval', 2000);
}

function deactivate() {
    console.log('Deactivating Matali extension...');
    
    clearAllDecorations();
    
    if (statusBarManager) {
        statusBarManager.dispose();
    }
    
    if (costDecorator) {
        costDecorator.dispose();
    }
    
    if (costCalculator) {
        costCalculator.dispose();
    }
    
    console.log('Matali extension deactivated');
}

module.exports = {
    activate,
    deactivate
};