const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const TerraformCostCalculator = require('./src/cost-calculator');
const TerraformParser = require('./src/terraform-parser');
const CostDecorator = require('./src/cost-decorator');
const StatusBarManager = require('./src/status-bar-manager');
const ErrorHandler = require('./src/error-handler');
const CostDashboardPanel = require('./src/cost-dashboard');
const AIAdvisor = require('./src/ai-advisor');
const WorkspaceScanner = require('./src/workspace-scanner');
const CapacityManager = require('./src/capacity-manager');
const excelExporter = require('./src/excel-exporter');
const NotificationManager = require('./src/notification-manager');
const CostHistoryManager = require('./src/cost-history-manager');
const { extractResourcesFromPlan, getPlanMetadata } = require('./src/plan-parser');
const debounce = require('debounce');

const execFileAsync = promisify(execFile);

let costCalculator;
let terraformParser;
let costDecorator;
let statusBarManager;
let errorHandler;
let budgetManager;
let budgetDiagnostics; // vscode.DiagnosticCollection
let aiAdvisor;
let workspaceScanner;
let capacityManager;
let notificationManager;
let costHistoryManager;
let dashboardScope = 'file'; // 'file' | 'workspace' — which view the dashboard panel is currently showing
let lastFileDashboardData = null; // most recent FILE-scope snapshot; also what the AI advisor reasons over
let lastWorkspaceDashboardData = null; // most recent WORKSPACE-scope snapshot
let lastPlanDashboardData = null; // most recent snapshot loaded from a `terraform show -json` plan
let lastResourceCosts = null; // most recent { resource, cost, line }[] for the active file, feeds the AI advisor
let lastAiSuggestionsResult = null; // last successful cost-suggestions result, included in exported reports if present
let lastScalingSuggestionsResult = null; // last successful scaling-suggestions result, same deal

// Friendly labels for the resource dashboard's "cost by type" breakdown.
const RESOURCE_TYPE_LABELS = {
    aws_instance: 'EC2 Instance',
    aws_db_instance: 'RDS Database',
    aws_s3_bucket: 'S3 Bucket',
    aws_ebs_volume: 'EBS Volume',
    aws_nat_gateway: 'NAT Gateway',
    aws_lb: 'Load Balancer',
    aws_alb: 'App Load Balancer',
    aws_nlb: 'Network Load Balancer',
    aws_eks_cluster: 'EKS Cluster',
    aws_rds_cluster: 'RDS Cluster',
    aws_elasticache_cluster: 'ElastiCache',
    google_compute_instance: 'Compute Engine VM',
    google_sql_database_instance: 'Cloud SQL',
    google_storage_bucket: 'Cloud Storage',
    google_compute_disk: 'Compute Disk',
    google_container_cluster: 'GKE Cluster',
    azurerm_virtual_machine: 'Virtual Machine',
    azurerm_linux_virtual_machine: 'Linux VM',
    azurerm_windows_virtual_machine: 'Windows VM',
    azurerm_sql_database: 'SQL Database',
    azurerm_storage_account: 'Storage Account',
    azurerm_managed_disk: 'Managed Disk',
    azurerm_kubernetes_cluster: 'AKS Cluster'
};

function humanizeResourceType(type) {
    if (RESOURCE_TYPE_LABELS[type]) return RESOURCE_TYPE_LABELS[type];
    return type
        .replace(/^(aws|google|azurerm)_/, '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

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
    aiAdvisor = new AIAdvisor(context);
    workspaceScanner = new WorkspaceScanner(terraformParser, costCalculator);
    capacityManager = new CapacityManager();
    notificationManager = new NotificationManager(context);
    costHistoryManager = new CostHistoryManager();

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

    // Show cost dashboard command (charts: breakdown donut, provider bars, 12-month forecast)
    const showCostDashboardCommand = vscode.commands.registerCommand('terraformCost.showCostDashboard', () => {
        openDashboard();
    });

    // Same dashboard, opened straight into the "whole workspace" scope
    const showWorkspaceCostDashboardCommand = vscode.commands.registerCommand('terraformCost.showWorkspaceCostDashboard', () => {
        openDashboard();
        setDashboardScope('workspace');
    });

    // Ask the configured AI provider for cost optimization suggestions
    const getAiSuggestionsCommand = vscode.commands.registerCommand('terraformCost.getAiSuggestions', async () => {
        await runAiSuggestions();
    });

    // Save an API key for an AI provider (stored via SecretStorage, never in settings.json)
    const setAiApiKeyCommand = vscode.commands.registerCommand('terraformCost.setAiApiKey', async () => {
        const picked = await vscode.window.showQuickPick(
            [
                { label: 'Gemini', description: 'Google', value: 'gemini' },
                { label: 'Claude', description: 'Anthropic', value: 'claude' },
                { label: 'GPT', description: 'OpenAI', value: 'openai' },
                { label: 'DeepSeek', description: 'low-cost, no minimum spend', value: 'deepseek' },
                { label: 'Groq', description: 'free tier, no card required', value: 'groq' }
            ],
            { placeHolder: 'Which AI provider is this API key for?' }
        );
        if (!picked) return;

        const key = await vscode.window.showInputBox({
            prompt: `Enter your ${picked.label} API key`,
            password: true,
            ignoreFocusOut: true
        });
        if (!key || !key.trim()) return;

        await aiAdvisor.setApiKey(picked.value, key.trim());

        const config = vscode.workspace.getConfiguration('terraformCost');
        if (config.get('ai.provider') !== picked.value) {
            await config.update('ai.provider', picked.value, true);
        }

        vscode.window.showInformationMessage(`${picked.label} API key saved securely. AI provider set to ${picked.label}.`);
    });

    // Remove a saved AI provider API key
    const clearAiApiKeyCommand = vscode.commands.registerCommand('terraformCost.clearAiApiKey', async () => {
        const picked = await vscode.window.showQuickPick(
            [
                { label: 'Gemini', value: 'gemini' },
                { label: 'Claude', value: 'claude' },
                { label: 'GPT', value: 'openai' },
                { label: 'DeepSeek', value: 'deepseek' },
                { label: 'Groq', value: 'groq' }
            ],
            { placeHolder: 'Clear the saved API key for which provider?' }
        );
        if (!picked) return;
        await aiAdvisor.clearApiKey(picked.value);
        vscode.window.showInformationMessage(`${picked.label} API key removed.`);
    });

    // Ask the configured AI provider for scale up/down suggestions, reasoned
    // against expected real-world load (terraform.capacity.json)
    const getScalingSuggestionsCommand = vscode.commands.registerCommand('terraformCost.getScalingSuggestions', async () => {
        await runScalingSuggestions();
    });

    // Interactive wizard for expected load (users/day, requests/day, etc.),
    // saved to terraform.capacity.json at the workspace root
    const setCapacityConfigCommand = vscode.commands.registerCommand('terraformCost.setCapacityConfig', async () => {
        await runSetCapacityConfig();
    });

    // Export a multi-sheet .xlsx cost report (summary, per-resource, by
    // provider/type/file, forecast, budget/capacity, cached AI suggestions)
    const exportCostReportCommand = vscode.commands.registerCommand('terraformCost.exportCostReport', async () => {
        await runExportCostReport();
    });

    // Save a Slack/Teams incoming webhook URL for budget-breach alerts
    // (stored via SecretStorage, same reasoning as the AI provider keys)
    const setBudgetWebhookCommand = vscode.commands.registerCommand('terraformCost.setBudgetWebhook', async () => {
        const picked = await vscode.window.showQuickPick(
            [
                { label: 'Slack', description: 'Incoming Webhook URL', value: 'slack' },
                { label: 'Microsoft Teams', description: 'Incoming Webhook (Connector) URL', value: 'teams' }
            ],
            { placeHolder: 'Which chat platform is this webhook for?' }
        );
        if (!picked) return;

        const url = await vscode.window.showInputBox({
            prompt: `Enter your ${picked.label} incoming webhook URL`,
            placeHolder: picked.value === 'slack' ? 'https://hooks.slack.com/services/...' : 'https://....webhook.office.com/webhookb2/...',
            password: true,
            ignoreFocusOut: true,
            validateInput: (value) => (value && value.startsWith('https://') ? null : 'Enter a valid https:// webhook URL')
        });
        if (!url) return;

        await notificationManager.setWebhookUrl(url.trim());

        const config = vscode.workspace.getConfiguration('terraformCost');
        if (config.get('notifications.provider') !== picked.value) {
            await config.update('notifications.provider', picked.value, true);
        }

        vscode.window.showInformationMessage(`${picked.label} webhook saved securely. Budget alerts will post there when a threshold is crossed.`);
    });

    // Remove the saved webhook URL and disable alerts
    const clearBudgetWebhookCommand = vscode.commands.registerCommand('terraformCost.clearBudgetWebhook', async () => {
        await notificationManager.clearWebhookUrl();
        const config = vscode.workspace.getConfiguration('terraformCost');
        await config.update('notifications.provider', 'none', true);
        vscode.window.showInformationMessage('Budget alert webhook removed.');
    });

    // Load a `terraform show -json` plan (or a binary .tfplan, converted via
    // the terraform CLI if it's on PATH) and cost every resource that will
    // exist after it applies — accurate for anything static parsing can't
    // evaluate (count/for_each, computed values, module outputs), since
    // Terraform's own plan engine already resolved all of that.
    const calculateFromPlanCommand = vscode.commands.registerCommand('terraformCost.calculateFromPlan', async () => {
        await runCalculateFromPlan();
    });

    // Append the current scope's total to terraform-cost-history.json —
    // explicitly user-triggered, never automatic, so there's no silent
    // per-save write; the dashboard's Cost History chart reads this back.
    const recordCostSnapshotCommand = vscode.commands.registerCommand('terraformCost.recordCostSnapshot', async () => {
        await runRecordCostSnapshot();
    });

    context.subscriptions.push(
        calculateCostsCommand,
        toggleCostDisplayCommand,
        refreshCostsCommand,
        toggleTotalCostHeaderCommand,
        clearErrorLogCommand,
        exportErrorLogCommand,
        showCostDashboardCommand,
        showWorkspaceCostDashboardCommand,
        getAiSuggestionsCommand,
        setAiApiKeyCommand,
        clearAiApiKeyCommand,
        getScalingSuggestionsCommand,
        setCapacityConfigCommand,
        exportCostReportCommand,
        setBudgetWebhookCommand,
        clearBudgetWebhookCommand,
        calculateFromPlanCommand,
        recordCostSnapshotCommand
    );
}

/**
 * Show (or reveal) the dashboard panel and wire up its request callbacks.
 * Shared by the "Show Cost Dashboard" command and anything else (like the AI
 * suggestions flow) that needs to make sure the panel exists and is current.
 */
function openDashboard() {
    const panel = CostDashboardPanel.createOrShow();
    panel.onRefreshRequest(() => {
        if (dashboardScope === 'workspace') return refreshWorkspaceDashboard();
        if (dashboardScope === 'plan') return panel.update(lastPlanDashboardData || { empty: true, scope: 'plan', generatedAt: Date.now() });
        return refreshDashboard();
    });
    panel.onAskAiRequest(() => runAiSuggestions());
    panel.onScopeChangeRequest((scope) => setDashboardScope(scope));
    panel.onAskScalingRequest(() => runScalingSuggestions());
    panel.onEditCapacityRequest(() => vscode.commands.executeCommand('terraformCost.setCapacityConfig'));
    panel.onExportRequest(() => runExportCostReport());
    panel.onRecordSnapshotRequest(() => runRecordCostSnapshot());

    const cached = dashboardScope === 'workspace' ? lastWorkspaceDashboardData
        : dashboardScope === 'plan' ? lastPlanDashboardData
        : lastFileDashboardData;
    if (cached) {
        panel.update(cached);
    }
    return panel;
}

/**
 * Switch the dashboard between "this file" and "whole workspace" and push
 * the relevant data (recomputing the workspace scan if we don't have a
 * snapshot yet, or if we're switching into that scope).
 */
async function setDashboardScope(scope) {
    dashboardScope = scope;
    const panel = CostDashboardPanel.currentPanel;
    if (!panel) return;

    if (scope === 'workspace') {
        await refreshWorkspaceDashboard();
    } else if (lastFileDashboardData) {
        panel.update(lastFileDashboardData);
    } else {
        await refreshDashboard();
    }
}

/**
 * Scan every .tf file in the workspace, aggregate costs across all of them,
 * and push the result into the dashboard panel (only actually renders it if
 * the panel is still on the "workspace" scope by the time the scan finishes,
 * so a quick scope flip-flop doesn't show stale data in the wrong view).
 */
async function refreshWorkspaceDashboard() {
    const panel = CostDashboardPanel.currentPanel;
    if (!panel) return;

    panel.setScanning(true);
    try {
        lastWorkspaceDashboardData = await buildWorkspaceDashboardAggregate();
        if (dashboardScope === 'workspace') {
            panel.update(lastWorkspaceDashboardData);
        }
    } catch (err) {
        console.error('Failed to scan workspace for costs:', err);
        vscode.window.showErrorMessage(`Failed to scan workspace for costs: ${err.message}`);
    } finally {
        panel.setScanning(false);
    }
}

/**
 * Recalculate the active file, then ask the configured AI provider for
 * cost-optimization suggestions and push the result into the dashboard.
 * Explicitly user-triggered only (command palette or the dashboard button) —
 * never runs automatically, so it never silently spends API quota.
 */
/**
 * Resolve the configured AI provider + its saved API key, prompting the user
 * to configure one if either is missing. Shared by cost suggestions and
 * scaling suggestions, which both need exactly this. Returns null if the
 * caller should bail (a configure-it prompt was already shown).
 */
async function resolveAiProviderAndKey() {
    const config = vscode.workspace.getConfiguration('terraformCost');
    const provider = config.get('ai.provider', 'none');

    if (provider === 'none') {
        const choice = await vscode.window.showInformationMessage(
            'No AI provider configured yet. Set one up first.',
            'Configure AI Provider'
        );
        if (choice) await vscode.commands.executeCommand('terraformCost.setAiApiKey');
        return null;
    }

    const apiKey = await aiAdvisor.getApiKey(provider);
    if (!apiKey) {
        const label = AIAdvisor.PROVIDER_LABELS[provider] || provider;
        const choice = await vscode.window.showWarningMessage(`No API key saved for ${label}.`, 'Set API Key');
        if (choice) await vscode.commands.executeCommand('terraformCost.setAiApiKey');
        return null;
    }

    return { provider, apiKey, model: config.get('ai.model') || undefined };
}

/**
 * Resolve which resource list (+ totals/budget/capacity) an AI/scaling call
 * should reason over, based on the dashboard's CURRENT scope — so "Ask AI"
 * analyzes whatever you're actually looking at, including workspace-wide
 * charts, rather than always silently falling back to just the active file
 * regardless of what the dashboard shows. Shows its own "nothing to
 * analyze" messaging and returns null if the caller should bail.
 */
async function resolveAiAnalysisTarget() {
    if (dashboardScope === 'workspace') {
        if (!lastWorkspaceDashboardData || lastWorkspaceDashboardData.empty) {
            await refreshWorkspaceDashboard();
        }
        if (!lastWorkspaceDashboardData || lastWorkspaceDashboardData.empty || !lastWorkspaceDashboardData.resourceItems?.length) {
            vscode.window.showInformationMessage('No cost-relevant resources found in the workspace.');
            return null;
        }
        return {
            resources: lastWorkspaceDashboardData.resourceItems,
            totals: lastWorkspaceDashboardData.totals,
            budget: lastWorkspaceDashboardData.budget,
            capacity: lastWorkspaceDashboardData.capacityConfig
        };
    }

    if (dashboardScope === 'plan') {
        if (!lastPlanDashboardData || lastPlanDashboardData.empty || !lastPlanDashboardData.resourceItems?.length) {
            vscode.window.showInformationMessage('No cost-relevant resources found in the loaded plan.');
            return null;
        }
        return {
            resources: lastPlanDashboardData.resourceItems,
            totals: lastPlanDashboardData.totals,
            budget: lastPlanDashboardData.budget,
            capacity: lastPlanDashboardData.capacityConfig
        };
    }

    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor || !isTerraformFile(activeEditor.document)) {
        vscode.window.showWarningMessage('Open a Terraform file, or switch the dashboard to "Whole workspace" scope.');
        return null;
    }

    await calculateAndDisplayCosts(activeEditor);
    if (!lastResourceCosts || lastResourceCosts.length === 0) {
        vscode.window.showInformationMessage('No cost-relevant resources found in this file.');
        return null;
    }

    let capacity = null;
    try {
        capacity = await capacityManager.loadCapacityForFile(activeEditor.document.uri.fsPath);
    } catch (err) {
        console.warn('Capacity lookup failed:', err.message);
    }

    return {
        resources: lastResourceCosts,
        totals: lastFileDashboardData?.totals,
        budget: lastFileDashboardData?.budget,
        capacity
    };
}

/**
 * Tag each AI suggestion with the source file (or, for a plan-scope call,
 * the module address) its resource actually lives in, looked up from the
 * resource list we sent the model — rather than trust the model to echo
 * that back reliably in its response. A no-op (undefined tag) for
 * file-scope calls, where every resource is already in the one open file.
 */
function attachSourceFiles(suggestions, resources) {
    const fileMap = new Map();
    for (const { resource, sourceFile, moduleAddress } of resources) {
        const tag = sourceFile || moduleAddress;
        if (tag) fileMap.set(`${resource.type}.${resource.name}`, tag);
    }
    return (suggestions || []).map((s) => ({
        ...s,
        sourceFile: s.resource ? fileMap.get(s.resource) : undefined
    }));
}

async function runAiSuggestions() {
    const target = await resolveAiAnalysisTarget();
    if (!target) return;

    const resolved = await resolveAiProviderAndKey();
    if (!resolved) return;
    const { provider, apiKey, model } = resolved;

    const panel = openDashboard();
    panel.setAiLoading(true, provider);

    try {
        const result = await aiAdvisor.getSuggestions({
            provider,
            model,
            apiKey,
            resources: target.resources,
            totals: target.totals,
            budget: target.budget,
            currency: getCurrency()
        });
        result.suggestions = attachSourceFiles(result.suggestions, target.resources);
        lastAiSuggestionsResult = result;
        panel.updateAiSuggestions(result);
    } catch (error) {
        console.error('AI suggestions failed:', error);
        panel.updateAiSuggestions({ error: error.message, provider });
        vscode.window.showErrorMessage(`AI suggestions failed: ${error.message}`);
    }
}

/**
 * Ask the configured AI provider whether the current scope's resources are
 * right-sized for the expected load in terraform.capacity.json.
 */
async function runScalingSuggestions() {
    const target = await resolveAiAnalysisTarget();
    if (!target) return;

    if (!target.capacity) {
        const choice = await vscode.window.showInformationMessage(
            'No capacity/usage inputs set for this project yet.',
            'Set Capacity Inputs'
        );
        if (choice) await vscode.commands.executeCommand('terraformCost.setCapacityConfig');
        return;
    }

    const resolved = await resolveAiProviderAndKey();
    if (!resolved) return;
    const { provider, apiKey, model } = resolved;

    const panel = openDashboard();
    panel.setScalingLoading(true, provider);

    try {
        const result = await aiAdvisor.getScalingSuggestions({
            provider,
            model,
            apiKey,
            resources: target.resources,
            capacity: target.capacity,
            currency: getCurrency()
        });
        result.suggestions = attachSourceFiles(result.suggestions, target.resources);
        lastScalingSuggestionsResult = result;
        panel.updateScalingSuggestions(result);
    } catch (error) {
        console.error('Scaling suggestions failed:', error);
        panel.updateScalingSuggestions({ error: error.message, provider });
        vscode.window.showErrorMessage(`Scaling suggestions failed: ${error.message}`);
    }
}

/**
 * Interactive multi-step wizard for expected load (users/day, requests/day,
 * peak req/s, growth %/month), saved to terraform.capacity.json at the
 * workspace root. Escape at any step cancels the whole wizard unsaved;
 * leaving a field blank just skips that figure.
 */
async function runSetCapacityConfig() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        vscode.window.showWarningMessage('Open a workspace folder first — capacity inputs are saved to terraform.capacity.json at the workspace root.');
        return;
    }
    const folderUri = folders[0].uri;
    const existing = (await capacityManager.loadCapacityForFolder(folderUri)) || {};

    const numericOrEmpty = (value) => {
        if (value === '') return null;
        return /^\d+(\.\d+)?$/.test(value) ? null : 'Enter a number, or leave blank to skip';
    };

    const usersRaw = await vscode.window.showInputBox({
        prompt: 'Expected / current daily active users',
        placeHolder: 'e.g. 5000 — leave blank to skip',
        value: existing.expected_users != null ? String(existing.expected_users) : '',
        ignoreFocusOut: true,
        validateInput: numericOrEmpty
    });
    if (usersRaw === undefined) return;

    const reqsPerDayRaw = await vscode.window.showInputBox({
        prompt: 'Requests per day',
        placeHolder: 'e.g. 200000 — leave blank to skip',
        value: existing.requests_per_day != null ? String(existing.requests_per_day) : '',
        ignoreFocusOut: true,
        validateInput: numericOrEmpty
    });
    if (reqsPerDayRaw === undefined) return;

    const peakRpsRaw = await vscode.window.showInputBox({
        prompt: 'Peak requests per second (bursts)',
        placeHolder: 'e.g. 50 — leave blank to skip',
        value: existing.peak_requests_per_second != null ? String(existing.peak_requests_per_second) : '',
        ignoreFocusOut: true,
        validateInput: numericOrEmpty
    });
    if (peakRpsRaw === undefined) return;

    const growthRaw = await vscode.window.showInputBox({
        prompt: 'Expected growth (%/month)',
        placeHolder: 'e.g. 10 — leave blank to skip',
        value: existing.growth_rate_percent != null ? String(existing.growth_rate_percent) : '',
        ignoreFocusOut: true,
        validateInput: numericOrEmpty
    });
    if (growthRaw === undefined) return;

    const newConfig = {};
    if (usersRaw.trim()) newConfig.expected_users = Number(usersRaw);
    if (reqsPerDayRaw.trim()) newConfig.requests_per_day = Number(reqsPerDayRaw);
    if (peakRpsRaw.trim()) newConfig.peak_requests_per_second = Number(peakRpsRaw);
    if (growthRaw.trim()) newConfig.growth_rate_percent = Number(growthRaw);

    if (Object.keys(newConfig).length === 0) {
        vscode.window.showInformationMessage('No values entered — capacity inputs not saved.');
        return;
    }

    await capacityManager.saveCapacityForFolder(folderUri, newConfig);
    vscode.window.showInformationMessage('Capacity inputs saved to terraform.capacity.json.');

    // Refresh whichever dashboard scope is showing so the new inputs' summary appears
    if (CostDashboardPanel.currentPanel) {
        if (dashboardScope === 'workspace') {
            await refreshWorkspaceDashboard();
        } else {
            await refreshDashboard();
        }
    }
}

/**
 * Export a multi-sheet .xlsx cost report — prompts for scope (if a workspace
 * folder is open), recomputes fresh data for it, then a save-file dialog.
 * Includes whatever's actually available: budget/capacity data if those
 * files exist, and the last successful AI cost/scaling suggestions from this
 * session if you've run either — it never triggers a fresh AI call itself.
 */
async function runExportCostReport() {
    let scope;
    let aggregate;

    if (dashboardScope === 'plan' && lastPlanDashboardData && !lastPlanDashboardData.empty) {
        // Already looking at a loaded plan's data — export exactly that,
        // rather than asking again which scope to export.
        scope = 'plan';
        aggregate = lastPlanDashboardData;
    } else {
        const hasWorkspace = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0;
        scope = 'file';

        if (hasWorkspace) {
            const picked = await vscode.window.showQuickPick(
                [
                    { label: 'This file', description: 'Export costs for the active Terraform file only', value: 'file' },
                    { label: 'Whole workspace', description: 'Scan every .tf file and export the full project', value: 'workspace' }
                ],
                { placeHolder: 'Export cost report for…' }
            );
            if (!picked) return;
            scope = picked.value;
        }

        if (scope === 'workspace') {
            aggregate = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'Scanning workspace for cost report…' },
                () => buildWorkspaceDashboardAggregate()
            );
        } else {
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor || !isTerraformFile(activeEditor.document)) {
                vscode.window.showWarningMessage('Open a Terraform file to export a cost report, or choose "Whole workspace" instead.');
                return;
            }
            await calculateAndDisplayCosts(activeEditor);
            aggregate = lastFileDashboardData;
        }
    }

    if (!aggregate || aggregate.empty || !aggregate.resourceItems || aggregate.resourceItems.length === 0) {
        vscode.window.showInformationMessage('No cost-relevant resources found to export.');
        return;
    }

    const activeEditor = vscode.window.activeTextEditor;
    const projectName = scope === 'plan'
        ? getProjectName(aggregate.planFilePath)
        : getProjectName(activeEditor?.document.uri.fsPath);

    const resources = aggregate.resourceItems.map(({ resource, cost, sourceFile, moduleAddress }) => ({
        type: resource.type,
        name: resource.name,
        provider: resource.provider,
        sourceFile: sourceFile || moduleAddress,
        monthly: cost.monthly || 0,
        yearly: cost.yearly != null ? cost.yearly : (cost.monthly || 0) * 12,
        breakdown: cost.breakdown
    }));

    const reportData = {
        projectName,
        scope,
        scopeLabel: scope === 'workspace' ? `${aggregate.fileCount} files` : scope === 'plan' ? aggregate.planFileName : aggregate.fileName,
        fileCount: aggregate.fileCount,
        generatedAt: new Date(),
        currency: aggregate.currency,
        totals: aggregate.totals,
        resources,
        byFile: aggregate.byFile,
        forecast: aggregate.forecast,
        budget: aggregate.budget,
        capacityConfig: aggregate.capacityConfig,
        costHistory: aggregate.costHistory,
        aiSuggestions: lastAiSuggestionsResult,
        scalingSuggestions: lastScalingSuggestionsResult
    };

    const defaultFileName = `${sanitizeFileName(projectName)}-cost-report-${new Date().toISOString().slice(0, 10)}.xlsx`;
    const defaultDir = vscode.workspace.workspaceFolders?.[0]?.uri
        || (activeEditor ? vscode.Uri.file(path.dirname(activeEditor.document.uri.fsPath)) : undefined)
        || (scope === 'plan' && aggregate.planFilePath ? vscode.Uri.file(path.dirname(aggregate.planFilePath)) : undefined);
    const defaultUri = defaultDir ? vscode.Uri.joinPath(defaultDir, defaultFileName) : vscode.Uri.file(defaultFileName);

    const saveUri = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { 'Excel Workbook': ['xlsx'] },
        title: 'Export Terraform Cost Report'
    });
    if (!saveUri) return;

    try {
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Generating cost report…' },
            async () => {
                const workbook = excelExporter.buildWorkbook(reportData);
                await workbook.xlsx.writeFile(saveUri.fsPath);
            }
        );
        const choice = await vscode.window.showInformationMessage(
            `Cost report exported to ${path.basename(saveUri.fsPath)}`,
            'Reveal in Folder'
        );
        if (choice) {
            vscode.commands.executeCommand('revealFileInOS', saveUri);
        }
    } catch (error) {
        console.error('Failed to export cost report:', error);
        vscode.window.showErrorMessage(`Failed to export cost report: ${error.message}`);
    }
}

function sanitizeFileName(name) {
    return (name || 'terraform-project').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
}

/**
 * Best-effort project name for reports/alerts: the workspace folder name if
 * one's open, else the parent folder of the given file, else a fallback.
 */
function getProjectName(referenceFilePath) {
    return vscode.workspace.workspaceFolders?.[0]?.name
        || (referenceFilePath ? path.basename(path.dirname(referenceFilePath)) : 'terraform-project');
}

/**
 * Recompute dashboard data for whichever Terraform file is currently relevant
 * (the active editor if there is one, otherwise the last file we had data for)
 * and push it into the dashboard panel, if it's open.
 */
async function refreshDashboard() {
    const panel = CostDashboardPanel.currentPanel;
    if (!panel) return;

    const editor = vscode.window.activeTextEditor;
    if (editor && isTerraformFile(editor.document)) {
        // This recalculates costs and, as a side effect, refreshes lastFileDashboardData/panel.
        await calculateAndDisplayCosts(editor);
        return;
    }

    panel.update(lastFileDashboardData || { empty: true, scope: 'file', generatedAt: Date.now() });
}

/**
 * Aggregate a flat list of { resource, cost } items into totals, cost-by-provider,
 * cost-by-type, top resources, and a 12-month forecast — the core of the dashboard
 * shape, shared by both the single-file and whole-workspace scopes (the only
 * difference between them is what list of items feeds this).
 */
function aggregateCostItems(items) {
    let totalMonthly = 0;
    let totalHourly = 0;
    let totalYearly = 0;
    const providerMap = new Map();
    const typeMap = new Map();
    const resourceList = [];

    for (const { resource, cost } of items) {
        const monthly = cost.monthly || 0;
        totalMonthly += monthly;
        totalHourly += cost.hourly || 0;
        totalYearly += cost.yearly || monthly * 12;

        const provider = resource.provider || 'unknown';
        const providerEntry = providerMap.get(provider) || { provider, monthly: 0, count: 0 };
        providerEntry.monthly += monthly;
        providerEntry.count += 1;
        providerMap.set(provider, providerEntry);

        const type = resource.type || 'unknown';
        const typeEntry = typeMap.get(type) || { type, label: humanizeResourceType(type), monthly: 0, count: 0 };
        typeEntry.monthly += monthly;
        typeEntry.count += 1;
        typeMap.set(type, typeEntry);

        resourceList.push({ name: resource.name, type, provider, monthly });
    }

    const providerOrder = ['aws', 'gcp', 'azure'];
    const byProvider = Array.from(providerMap.values()).sort((a, b) => {
        const ai = providerOrder.indexOf(a.provider);
        const bi = providerOrder.indexOf(b.provider);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    let byType = Array.from(typeMap.values()).sort((a, b) => b.monthly - a.monthly);
    const TOP_TYPES = 5;
    if (byType.length > TOP_TYPES) {
        const top = byType.slice(0, TOP_TYPES);
        const rest = byType.slice(TOP_TYPES);
        byType = [
            ...top,
            {
                type: 'other',
                label: `Other (${rest.length} types)`,
                monthly: rest.reduce((s, r) => s + r.monthly, 0),
                count: rest.reduce((s, r) => s + r.count, 0),
                isOther: true
            }
        ];
    }

    const topResources = [...resourceList].sort((a, b) => b.monthly - a.monthly).slice(0, 5);

    // 12-month forecast: a flat scenario (no change) vs an illustrative growth
    // scenario, so the chart tells a "what if this keeps scaling" story.
    const GROWTH_RATE = 0.05; // ~5%/month, e.g. modest traffic-driven scaling
    const months = [];
    const flat = [];
    const growth = [];
    let flatCumulative = 0;
    let growthCumulative = 0;
    let growthMonthly = totalMonthly;
    for (let m = 1; m <= 12; m++) {
        flatCumulative += totalMonthly;
        growthCumulative += growthMonthly;
        months.push(m);
        flat.push(Number(flatCumulative.toFixed(2)));
        growth.push(Number(growthCumulative.toFixed(2)));
        growthMonthly *= 1 + GROWTH_RATE;
    }

    return {
        totals: { hourly: totalHourly, monthly: totalMonthly, yearly: totalYearly },
        byProvider,
        byType,
        topResources,
        forecast: { months, flat, growth, growthRatePct: GROWTH_RATE * 100 }
    };
}

/**
 * Resolve a budget (if any applies) and its threshold level for a given
 * total monthly cost. Shared by the file-scope and workspace-scope builders.
 */
function evaluateBudget(budgetConfig, totalMonthly) {
    if (!budgetConfig || !(budgetConfig.final_limit || budgetConfig.limit_1 || budgetConfig.limit_2 || budgetConfig.limit_3)) {
        return null;
    }
    let level = 0;
    if (budgetConfig.limit_1 && totalMonthly >= budgetConfig.limit_1) level = Math.max(level, 1);
    if (budgetConfig.limit_2 && totalMonthly >= budgetConfig.limit_2) level = Math.max(level, 2);
    if (budgetConfig.limit_3 && totalMonthly >= budgetConfig.limit_3) level = Math.max(level, 3);
    if (budgetConfig.final_limit && totalMonthly >= budgetConfig.final_limit) level = Math.max(level, 4);
    return {
        limit_1: budgetConfig.limit_1,
        limit_2: budgetConfig.limit_2,
        limit_3: budgetConfig.limit_3,
        final_limit: budgetConfig.final_limit,
        level,
        current: totalMonthly
    };
}

/**
 * Build the FILE-scope dashboard snapshot from already-computed resource costs.
 * Cheap and synchronous except for the budget file lookup, and reuses costs
 * calculateAndDisplayCosts already computed rather than recalculating them.
 */
async function buildDashboardAggregate(document, validResourceCosts) {
    const fileName = path.basename(document.uri.fsPath);
    const currency = getCurrency();

    if (!validResourceCosts || validResourceCosts.length === 0) {
        return { empty: true, scope: 'file', fileName, currency, generatedAt: Date.now() };
    }

    const agg = aggregateCostItems(validResourceCosts);

    let budget = null;
    try {
        const b = await budgetManager.loadBudgetForFile(document.uri.fsPath);
        budget = evaluateBudget(b, agg.totals.monthly);
    } catch (err) {
        console.warn('Dashboard budget lookup failed:', err.message);
    }

    let capacityConfig = null;
    try {
        capacityConfig = await capacityManager.loadCapacityForFile(document.uri.fsPath);
    } catch (err) {
        console.warn('Dashboard capacity lookup failed:', err.message);
    }

    let costHistory = [];
    try {
        costHistory = await costHistoryManager.loadHistoryForFile(document.uri.fsPath);
    } catch (err) {
        console.warn('Dashboard cost history lookup failed:', err.message);
    }

    return {
        empty: false,
        scope: 'file',
        fileName,
        currency,
        resourceCount: validResourceCosts.length,
        resourceItems: validResourceCosts, // full { resource, cost, line }[] — feeds the Excel export's Resources sheet
        ...agg,
        budget,
        capacityConfig,
        costHistory,
        generatedAt: Date.now()
    };
}

/**
 * Build the WORKSPACE-scope dashboard snapshot: scans every .tf file (via
 * WorkspaceScanner), aggregates costs across all of them, and adds a
 * cost-by-file breakdown on top of the usual by-provider/by-type/forecast.
 */
async function buildWorkspaceDashboardAggregate() {
    const currency = getCurrency();
    const items = await workspaceScanner.scan();

    if (!items || items.length === 0) {
        return { empty: true, scope: 'workspace', currency, fileCount: 0, generatedAt: Date.now() };
    }

    const agg = aggregateCostItems(items);

    const fileMap = new Map();
    for (const { cost, sourceFile } of items) {
        const entry = fileMap.get(sourceFile) || { file: sourceFile, monthly: 0, count: 0 };
        entry.monthly += cost.monthly || 0;
        entry.count += 1;
        fileMap.set(sourceFile, entry);
    }
    const byFile = Array.from(fileMap.values()).sort((a, b) => b.monthly - a.monthly);

    let budget = null;
    let capacityConfig = null;
    let costHistory = [];
    try {
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            // loadBudgetForFile/loadCapacityForFile/loadHistoryForFile all walk
            // up from a file's directory, so a non-existent probe path inside
            // the root resolves the same terraform.budget.json /
            // terraform.capacity.json / terraform-cost-history.json a real
            // file there would.
            const probePath = path.join(folders[0].uri.fsPath, '__terraformCost_probe__.tf');
            const b = await budgetManager.loadBudgetForFile(probePath);
            budget = evaluateBudget(b, agg.totals.monthly);
            capacityConfig = await capacityManager.loadCapacityForFile(probePath);
            costHistory = await costHistoryManager.loadHistoryForFile(probePath);
        }
    } catch (err) {
        console.warn('Workspace dashboard budget/capacity/history lookup failed:', err.message);
    }

    return {
        empty: false,
        scope: 'workspace',
        currency,
        fileCount: fileMap.size,
        resourceCount: items.length,
        resourceItems: items, // full { resource, cost, sourceFile, line }[] — feeds the Excel export's Resources sheet
        byFile,
        ...agg,
        budget,
        capacityConfig,
        costHistory,
        generatedAt: Date.now()
    };
}

/**
 * Build the PLAN-scope dashboard snapshot from resources already extracted
 * + costed from a `terraform show -json` plan (see runCalculateFromPlan).
 * Budget/capacity are looked up relative to the plan file's own directory —
 * there's no "workspace" concept tying a loaded plan to a specific folder.
 */
async function buildPlanDashboardAggregate(planFilePath, resourceItems) {
    const currency = getCurrency();
    const planFileName = path.basename(planFilePath);

    if (!resourceItems || resourceItems.length === 0) {
        return { empty: true, scope: 'plan', currency, planFilePath, planFileName, generatedAt: Date.now() };
    }

    const agg = aggregateCostItems(resourceItems);

    let budget = null;
    let capacityConfig = null;
    let costHistory = [];
    try {
        const b = await budgetManager.loadBudgetForFile(planFilePath);
        budget = evaluateBudget(b, agg.totals.monthly);
        capacityConfig = await capacityManager.loadCapacityForFile(planFilePath);
        costHistory = await costHistoryManager.loadHistoryForFile(planFilePath);
    } catch (err) {
        console.warn('Plan dashboard budget/capacity/history lookup failed:', err.message);
    }

    return {
        empty: false,
        scope: 'plan',
        currency,
        planFilePath,
        planFileName,
        resourceCount: resourceItems.length,
        resourceItems,
        ...agg,
        budget,
        capacityConfig,
        costHistory,
        generatedAt: Date.now()
    };
}

/**
 * Prompt for a plan file (a `terraform show -json` output, or a binary
 * .tfplan converted via the terraform CLI if one's on PATH), extract and
 * cost its resources, and push the result into the dashboard as a new
 * 'plan' scope — verified end-to-end against a real `terraform init && plan
 * && show -json` run (test-fixtures/sample-plan), not just a hand-authored
 * synthetic JSON.
 */
async function runCalculateFromPlan() {
    const picked = await vscode.window.showOpenDialog({
        title: 'Select a Terraform plan file',
        openLabel: 'Calculate Costs',
        canSelectMany: false,
        filters: {
            'Terraform plan (JSON or binary)': ['json', 'tfplan', 'plan'],
            'All files': ['*']
        }
    });
    if (!picked || picked.length === 0) return;
    const filePath = picked[0].fsPath;

    let planJson;
    try {
        planJson = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Reading Terraform plan…' },
            async () => {
                if (filePath.toLowerCase().endsWith('.json')) {
                    const raw = await fs.promises.readFile(filePath, 'utf8');
                    return JSON.parse(raw);
                }
                // Not JSON — assume a binary plan file and try converting it
                // via the terraform CLI, if one's on PATH.
                try {
                    const { stdout } = await execFileAsync('terraform', ['show', '-json', filePath], {
                        cwd: path.dirname(filePath),
                        maxBuffer: 50 * 1024 * 1024
                    });
                    return JSON.parse(stdout);
                } catch (err) {
                    if (err.code === 'ENOENT') {
                        throw new Error(
                            'The "terraform" CLI isn\'t on your PATH, so this binary plan file can\'t be converted automatically. ' +
                            'Run `terraform show -json <planfile> > plan.json` yourself, then pick the resulting .json file instead.'
                        );
                    }
                    throw new Error(`terraform show -json failed: ${err.message}`);
                }
            }
        );
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to read plan: ${error.message}`);
        return;
    }

    let resources;
    try {
        resources = extractResourcesFromPlan(planJson);
    } catch (error) {
        vscode.window.showErrorMessage(error.message);
        return;
    }

    if (resources.length === 0) {
        vscode.window.showInformationMessage('This plan has no resources that will exist after applying it — nothing to cost.');
        return;
    }

    const resourceItems = [];
    for (const resource of resources) {
        try {
            const cost = await costCalculator.calculateResourceCost(resource, filePath);
            resourceItems.push({ resource, cost, moduleAddress: resource.moduleAddress, line: 0 });
        } catch (error) {
            console.error(`Error calculating cost for ${resource.type}.${resource.name}:`, error);
        }
    }

    dashboardScope = 'plan';
    lastPlanDashboardData = await buildPlanDashboardAggregate(filePath, resourceItems);

    const panel = openDashboard();
    panel.update(lastPlanDashboardData);

    const meta = getPlanMetadata(planJson);
    vscode.window.showInformationMessage(
        `Loaded ${resources.length} resource(s) from plan (Terraform ${meta.terraformVersion || 'unknown version'}).`
    );
}

/**
 * Append a snapshot of the dashboard's CURRENT scope (file, workspace, or a
 * loaded plan) to terraform-cost-history.json, and refresh whichever
 * dashboard view is open so its new Cost History chart picks it up.
 * Explicitly user-triggered — there's no automatic recording on save, the
 * same "not automatic" boundary the AI/export features already keep.
 */
async function runRecordCostSnapshot() {
    const target = await resolveAiAnalysisTarget();
    if (!target) return;

    const activeEditor = vscode.window.activeTextEditor;
    const folderUri = vscode.workspace.workspaceFolders?.[0]?.uri
        || (activeEditor ? vscode.Uri.file(path.dirname(activeEditor.document.uri.fsPath)) : null)
        || (dashboardScope === 'plan' && lastPlanDashboardData?.planFilePath
            ? vscode.Uri.file(path.dirname(lastPlanDashboardData.planFilePath))
            : null);

    if (!folderUri) {
        vscode.window.showWarningMessage('Open a folder or a Terraform file first — there\'s nowhere to save the snapshot to.');
        return;
    }

    const label = dashboardScope === 'workspace'
        ? `Workspace (${lastWorkspaceDashboardData?.fileCount || 0} files)`
        : dashboardScope === 'plan'
        ? `Plan: ${lastPlanDashboardData?.planFileName || ''}`
        : lastFileDashboardData?.fileName || 'file';

    const currency = getCurrency();
    const snapshot = {
        timestamp: Date.now(),
        scope: dashboardScope,
        label,
        totalMonthly: Number((target.totals?.monthly || 0).toFixed(2)),
        currency,
        resourceCount: target.resources.length
    };

    try {
        await costHistoryManager.appendSnapshot(folderUri, snapshot);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to record cost snapshot: ${error.message}`);
        return;
    }

    vscode.window.showInformationMessage(
        `Cost snapshot recorded: ${currency} ${snapshot.totalMonthly.toFixed(2)}/mo (${snapshot.resourceCount} resources).`
    );

    if (CostDashboardPanel.currentPanel) {
        if (dashboardScope === 'workspace') {
            await refreshWorkspaceDashboard();
        } else if (dashboardScope === 'plan') {
            lastPlanDashboardData = await buildPlanDashboardAggregate(lastPlanDashboardData.planFilePath, lastPlanDashboardData.resourceItems);
            CostDashboardPanel.currentPanel.update(lastPlanDashboardData);
        } else {
            await refreshDashboard();
        }
    }
}

/**
 * Recompute the FILE-scope dashboard snapshot and, if the panel is currently
 * showing that scope, push it. Always updates lastFileDashboardData
 * regardless of the panel's current scope, since the AI advisor always
 * reasons over the active file.
 */
async function updateDashboard(document, validResourceCosts) {
    try {
        lastFileDashboardData = await buildDashboardAggregate(document, validResourceCosts);
        if (dashboardScope === 'file' && CostDashboardPanel.currentPanel) {
            CostDashboardPanel.currentPanel.update(lastFileDashboardData);
        }
    } catch (err) {
        console.warn('Failed to update cost dashboard:', err.message);
    }
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

            // A save could change the workspace-wide picture too (new/changed
            // resource in this file) — refresh it if that's the active scope.
            // Not hooked to onDidChangeTextDocument's live-typing path: a
            // full workspace re-scan on every keystroke across every file
            // would be wasteful, so workspace scope only refreshes on save,
            // scope switch, or the panel's manual Refresh button.
            if (dashboardScope === 'workspace' && CostDashboardPanel.currentPanel) {
                await refreshWorkspaceDashboard();
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
            if (dashboardScope === 'workspace' && CostDashboardPanel.currentPanel) {
                refreshWorkspaceDashboard();
            }
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
            lastResourceCosts = [];
            updateDashboard(document, []);
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

        // Keep the cost dashboard (if open) and the AI advisor's data in sync
        // with what we just calculated
        lastResourceCosts = validResourceCosts;
        await updateDashboard(document, validResourceCosts);

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
            await sendBudgetWebhookAlert(filePath, level, totalMonthly, budget);
        }
    } else {
        // Clear diagnostics and reset notification level
        budgetDiagnostics.delete(vscode.Uri.file(filePath));
        budgetManager.setNotificationLevelForFile(filePath, 0);
    }
}

/**
 * Post a Slack/Teams alert for a budget threshold crossing, if a webhook is
 * configured. Called from the exact same "level > prev" gate the VS Code
 * popup uses, so there's one source of truth for "did we already alert on
 * this" — never a second, independent notification schedule to drift out of
 * sync with the popup/diagnostic behavior.
 */
async function sendBudgetWebhookAlert(filePath, level, totalMonthly, budget) {
    if (!notificationManager) return;

    const config = vscode.workspace.getConfiguration('terraformCost');
    const provider = config.get('notifications.provider', 'none');
    if (provider === 'none') return;

    const webhookUrl = await notificationManager.getWebhookUrl();
    if (!webhookUrl) return;

    const limitForLevel = { 1: budget.limit_1, 2: budget.limit_2, 3: budget.limit_3, 4: budget.final_limit };

    try {
        await notificationManager.sendBudgetAlert({
            provider,
            webhookUrl,
            level,
            current: totalMonthly,
            limit: limitForLevel[level] ?? totalMonthly,
            currency: getCurrency(),
            projectName: getProjectName(filePath),
            fileName: path.basename(filePath)
        });
    } catch (error) {
        console.error('Budget webhook alert failed:', error);
        vscode.window.showWarningMessage(`Budget alert webhook failed: ${error.message}`);
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