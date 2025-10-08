const vscode = require('vscode');
const TerraformCostCalculator = require('./src/cost-calculator');
const TerraformParser = require('./src/terraform-parser');
const CostDecorator = require('./src/cost-decorator');
const StatusBarManager = require('./src/status-bar-manager');
const debounce = require('debounce');

let costCalculator;
let terraformParser;
let costDecorator;
let statusBarManager;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    console.log('Terraform Cost Calculator extension is activating...');

    // Initialize components
    costCalculator = new TerraformCostCalculator();
    terraformParser = new TerraformParser();
    costDecorator = new CostDecorator();
    statusBarManager = new StatusBarManager();

    // Register commands
    registerCommands(context);

    // Set up file watchers and events
    setupFileWatchers(context);

    // Process already open Terraform files
    processOpenTerraformFiles();

    console.log('Terraform Cost Calculator extension is now active!');
}

function registerCommands(context) {
    // Calculate costs command
    const calculateCostsCommand = vscode.commands.registerCommand('terraformCost.calculateCosts', async () => {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && isTerraformFile(activeEditor.document)) {
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
        clearAllDecorations();
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

    context.subscriptions.push(calculateCostsCommand, toggleCostDisplayCommand, refreshCostsCommand, toggleTotalCostHeaderCommand);
}

function setupFileWatchers(context) {
    // Watch for text document changes
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
            const editor = vscode.window.visibleTextEditors.find(e => e.document === document);
            if (editor) {
                await calculateAndDisplayCosts(editor);
            }
        }
    });

    // Watch for configuration changes
    const onDidChangeConfiguration = vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('terraformCost')) {
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

    for (const editor of vscode.window.visibleTextEditors) {
        if (isTerraformFile(editor.document)) {
            await calculateAndDisplayCosts(editor);
        }
    }
}

async function calculateAndDisplayCosts(editor) {
    try {
        const document = editor.document;
        const text = document.getText();

        // Parse Terraform configuration
        const parsedConfig = await terraformParser.parse(text);
        
        if (!parsedConfig || !parsedConfig.resources) {
            return;
        }

        // Calculate costs for each resource
        const resourceCosts = await Promise.all(
            parsedConfig.resources.map(async (resource) => {
                const cost = await costCalculator.calculateResourceCost(resource);
                return {
                    resource,
                    cost,
                    line: resource.line || 0
                };
            })
        );

        // Display inline decorations
        if (shouldShowInlineDecorations()) {
            costDecorator.decorateEditor(editor, resourceCosts);
        }

        // Update status bar
        if (shouldShowStatusBar()) {
            const totalCost = resourceCosts.reduce((sum, item) => sum + (item.cost.monthly || 0), 0);
            statusBarManager.updateTotalCost(totalCost, getCurrency());
        }

    } catch (error) {
        console.error('Error calculating Terraform costs:', error);
        vscode.window.showErrorMessage(`Error calculating costs: ${error.message}`);
    }
}

function clearAllDecorations() {
    for (const editor of vscode.window.visibleTextEditors) {
        costDecorator.clearDecorations(editor);
    }
    statusBarManager.hide();
}

function isTerraformFile(document) {
    return document.languageId === 'terraform' || 
           document.fileName.endsWith('.tf') || 
           document.fileName.endsWith('.tfvars');
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
    clearAllDecorations();
    if (statusBarManager) {
        statusBarManager.dispose();
    }
}

module.exports = {
    activate,
    deactivate
};
