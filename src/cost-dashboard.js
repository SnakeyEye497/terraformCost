const vscode = require('vscode');

/**
 * Webview panel that renders a visual cost dashboard for the active Terraform file:
 * a cost-breakdown donut, a per-provider bar chart, and a 12-month forecast chart.
 *
 * The panel is a passive renderer — extension.js computes the data (via
 * buildDashboardAggregate) and pushes it in with update(). The webview itself
 * only asks for data (on load, and via the Refresh button) through onRefreshRequest.
 */
class CostDashboardPanel {
    static currentPanel = undefined;
    static viewType = 'terraformCostDashboard';

    static createOrShow() {
        const activeColumn = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (CostDashboardPanel.currentPanel) {
            CostDashboardPanel.currentPanel._panel.reveal(activeColumn);
            return CostDashboardPanel.currentPanel;
        }

        const panel = vscode.window.createWebviewPanel(
            CostDashboardPanel.viewType,
            '📊 Terraform Cost Dashboard',
            activeColumn ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: []
            }
        );

        CostDashboardPanel.currentPanel = new CostDashboardPanel(panel);
        return CostDashboardPanel.currentPanel;
    }

    constructor(panel) {
        this._panel = panel;
        this._disposables = [];
        this._onRefreshRequest = null;
        this._onAskAiRequest = null;
        this._onScopeChangeRequest = null;
        this._onAskScalingRequest = null;
        this._onEditCapacityRequest = null;
        this._onExportRequest = null;
        this._onRecordSnapshotRequest = null;

        this._panel.webview.html = this._getHtml(this._panel.webview);

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            (message) => {
                if ((message?.type === 'ready' || message?.type === 'refresh') && this._onRefreshRequest) {
                    this._onRefreshRequest();
                } else if (message?.type === 'askAi' && this._onAskAiRequest) {
                    this._onAskAiRequest();
                } else if (message?.type === 'setScope' && this._onScopeChangeRequest) {
                    this._onScopeChangeRequest(message.scope);
                } else if (message?.type === 'askScaling' && this._onAskScalingRequest) {
                    this._onAskScalingRequest();
                } else if (message?.type === 'editCapacity' && this._onEditCapacityRequest) {
                    this._onEditCapacityRequest();
                } else if (message?.type === 'exportReport' && this._onExportRequest) {
                    this._onExportRequest();
                } else if (message?.type === 'recordSnapshot' && this._onRecordSnapshotRequest) {
                    this._onRecordSnapshotRequest();
                }
            },
            null,
            this._disposables
        );
    }

    /**
     * Register the callback invoked whenever the webview asks for fresh data
     * (initial load + manual Refresh click).
     * @param {() => void} callback
     */
    onRefreshRequest(callback) {
        this._onRefreshRequest = callback;
    }

    /**
     * Register the callback invoked when the user clicks "Ask AI for
     * suggestions" in the AI Cost Optimization card.
     * @param {() => void} callback
     */
    onAskAiRequest(callback) {
        this._onAskAiRequest = callback;
    }

    /** Push a new data snapshot into the webview. */
    update(data) {
        this._panel.webview.postMessage({ type: 'data', payload: data });
    }

    /** Tell the webview an AI request is in flight (shows a spinner). */
    setAiLoading(loading, provider) {
        this._panel.webview.postMessage({ type: 'aiLoading', payload: { loading, provider } });
    }

    /** Push an AI suggestions result (or { error, provider } on failure). */
    updateAiSuggestions(result) {
        this._panel.webview.postMessage({ type: 'aiSuggestions', payload: result });
    }

    /**
     * Register the callback invoked when the user clicks the "This file" /
     * "Whole workspace" scope toggle. Called with 'file' or 'workspace'.
     * @param {(scope: string) => void} callback
     */
    onScopeChangeRequest(callback) {
        this._onScopeChangeRequest = callback;
    }

    /** Tell the webview a workspace scan is in flight (shows a scanning indicator). */
    setScanning(loading) {
        this._panel.webview.postMessage({ type: 'scanning', payload: { loading } });
    }

    /**
     * Register the callback invoked when the user clicks "Get scaling
     * suggestions" in the Capacity & Scaling card.
     * @param {() => void} callback
     */
    onAskScalingRequest(callback) {
        this._onAskScalingRequest = callback;
    }

    /**
     * Register the callback invoked when the user clicks "Edit inputs" in
     * the Capacity & Scaling card.
     * @param {() => void} callback
     */
    onEditCapacityRequest(callback) {
        this._onEditCapacityRequest = callback;
    }

    /**
     * Register the callback invoked when the user clicks "Export report"
     * in the topbar.
     * @param {() => void} callback
     */
    onExportRequest(callback) {
        this._onExportRequest = callback;
    }

    /**
     * Register the callback invoked when the user clicks "Record snapshot"
     * in the Cost History card.
     * @param {() => void} callback
     */
    onRecordSnapshotRequest(callback) {
        this._onRecordSnapshotRequest = callback;
    }

    /** Tell the webview a scaling-suggestions request is in flight. */
    setScalingLoading(loading, provider) {
        this._panel.webview.postMessage({ type: 'scalingLoading', payload: { loading, provider } });
    }

    /** Push a scaling suggestions result (or { error, provider } on failure). */
    updateScalingSuggestions(result) {
        this._panel.webview.postMessage({ type: 'scalingSuggestions', payload: result });
    }

    reveal() {
        this._panel.reveal();
    }

    dispose() {
        CostDashboardPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d) d.dispose();
        }
    }

    _getHtml(webview) {
        const nonce = getNonce();
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Terraform Cost Dashboard</title>
<style>${CSS}</style>
</head>
<body>
${BODY}
<script nonce="${nonce}">${JS}</script>
</body>
</html>`;
    }
}

function getNonce() {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}

// ---------------------------------------------------------------------------
// Styles — categorical hues, chart chrome and status colors are a validated
// CVD-safe palette (see the project's dataviz notes); only chrome/gradients
// around the data marks are decorative.
// ---------------------------------------------------------------------------
const CSS = `
:root {
    --surface-1: #fcfcfb;
    --page: #f9f9f7;
    --text-primary: #0b0b0b;
    --text-secondary: #52514e;
    --text-muted: #898781;
    --gridline: #e1e0d9;
    --baseline: #c3c2b7;
    --border: rgba(11,11,11,0.10);
    --card-shadow: 0 1px 3px rgba(11,11,11,0.06), 0 8px 24px rgba(11,11,11,0.05);

    --slot-1: #2a78d6; /* blue */
    --slot-2: #eb6834; /* orange */
    --slot-3: #1baf7a; /* aqua */
    --slot-4: #eda100; /* yellow */
    --slot-5: #e87ba4; /* magenta */
    --slot-other: #898781;

    --good: #0ca30c;
    --warning: #fab219;
    --serious: #ec835a;
    --critical: #d03b3b;
}

body.vscode-dark, body.vscode-high-contrast {
    --surface-1: #1a1a19;
    --page: #0d0d0d;
    --text-primary: #ffffff;
    --text-secondary: #c3c2b7;
    --text-muted: #9b9a94;
    --gridline: #2c2c2a;
    --baseline: #383835;
    --border: rgba(255,255,255,0.10);
    --card-shadow: 0 1px 3px rgba(0,0,0,0.3), 0 12px 32px rgba(0,0,0,0.35);

    --slot-1: #3987e5;
    --slot-2: #d95926;
    --slot-3: #199e70;
    --slot-4: #c98500;
    --slot-5: #d55181;
}

* { box-sizing: border-box; }

body {
    margin: 0;
    padding: 0;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    color: var(--text-primary);
    background:
        radial-gradient(1200px 600px at 15% -10%, color-mix(in srgb, var(--slot-1) 10%, transparent), transparent),
        radial-gradient(1000px 500px at 100% 0%, color-mix(in srgb, var(--slot-2) 8%, transparent), transparent),
        var(--page);
    min-height: 100vh;
}

.wrap { max-width: 1180px; margin: 0 auto; padding: 28px 28px 60px; }

/* ---------- Header ---------- */
.topbar { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 22px; flex-wrap: wrap; }
.topbar h1 { font-size: 20px; margin: 0; font-weight: 700; letter-spacing: -0.01em; }
.topbar .subtitle { color: var(--text-muted); font-size: 12px; margin-top: 4px; }
.topbar-actions { display: flex; align-items: center; gap: 10px; }
.scope-toggle { display: inline-flex; background: var(--gridline); border-radius: 8px; padding: 2px; gap: 2px; }
.scope-btn { appearance: none; border: none; background: transparent; color: var(--text-secondary); font-size: 11.5px; font-weight: 600; padding: 5px 10px; border-radius: 6px; cursor: pointer; transition: background-color .15s ease, color .15s ease; }
.scope-btn.active { background: var(--surface-1); color: var(--text-primary); box-shadow: var(--card-shadow); }
.scope-btn:hover:not(.active) { color: var(--text-primary); }
.scope-btn:disabled { opacity: 0.5; cursor: default; }
.updated-at { font-size: 11px; color: var(--text-muted); }
.btn-refresh {
    appearance: none; border: 1px solid var(--border); background: var(--surface-1);
    color: var(--text-primary); padding: 6px 12px; border-radius: 7px; font-size: 12px;
    cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: transform .15s ease, box-shadow .15s ease;
}
.btn-refresh:hover { box-shadow: var(--card-shadow); transform: translateY(-1px); }
.btn-refresh:active { transform: translateY(0); }
.btn-refresh svg { width: 13px; height: 13px; }

/* ---------- Empty state ---------- */
#empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 120px 20px; color: var(--text-secondary); }
#empty-state .icon { font-size: 44px; margin-bottom: 14px; animation: floaty 3s ease-in-out infinite; }
#empty-state h2 { margin: 0 0 6px; font-size: 16px; color: var(--text-primary); }
#empty-state p { margin: 0; font-size: 13px; max-width: 380px; color: var(--text-muted); }
@keyframes floaty { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }

/* ---------- Hero ---------- */
.hero { display: flex; align-items: flex-end; gap: 36px; flex-wrap: wrap; margin-bottom: 22px; }
.hero-figure .label { font-size: 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .06em; margin-bottom: 2px; }
.hero-figure .value { font-size: 52px; font-weight: 700; letter-spacing: -0.02em; line-height: 1; }
.hero-figure .value .cur { font-size: 28px; font-weight: 600; color: var(--text-secondary); margin-right: 2px; }
.stat-row { display: flex; gap: 22px; flex-wrap: wrap; }
.stat-tile .label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .05em; }
.stat-tile .value { font-size: 20px; font-weight: 600; margin-top: 2px; }

/* ---------- Budget meter ---------- */
.budget-card { background: var(--surface-1); border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; margin-bottom: 22px; box-shadow: var(--card-shadow); display: none; }
.budget-card.show { display: block; }
.budget-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 12px; }
.budget-head .title { font-weight: 600; color: var(--text-primary); }
.budget-head .status { font-weight: 600; }
.meter-track { height: 10px; border-radius: 6px; background: var(--gridline); overflow: hidden; position: relative; }
.meter-fill { height: 100%; border-radius: 6px; width: 0%; transition: width .8s cubic-bezier(.22,.68,0,1.01), background-color .4s; }
.budget-foot { display: flex; justify-content: space-between; margin-top: 6px; font-size: 11px; color: var(--text-muted); }

/* ---------- Cards grid ---------- */
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.grid .full { grid-column: 1 / -1; }
@media (max-width: 860px) { .grid { grid-template-columns: 1fr; } }

.card { background: var(--surface-1); border: 1px solid var(--border); border-radius: 14px; padding: 18px 20px 20px; box-shadow: var(--card-shadow); opacity: 0; transform: translateY(10px); animation: cardIn .5s ease forwards; }
.card:nth-of-type(1) { animation-delay: .02s; }
.card:nth-of-type(2) { animation-delay: .10s; }
.card:nth-of-type(3) { animation-delay: .18s; }
@keyframes cardIn { to { opacity: 1; transform: translateY(0); } }

.card-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14px; }
.card-head h3 { margin: 0; font-size: 13px; font-weight: 700; }
.card-head .toggle-table { font-size: 11px; color: var(--text-muted); background: none; border: none; cursor: pointer; text-decoration: underline; padding: 0; }
.card-head .toggle-table:hover { color: var(--text-primary); }

/* ---------- Donut ---------- */
.donut-row { display: flex; align-items: center; gap: 22px; flex-wrap: wrap; }
.donut-visual { position: relative; width: 190px; height: 190px; flex: 0 0 auto; }
.donut-visual svg circle.slice { transition: stroke-dasharray .8s cubic-bezier(.22,.68,0,1.01), stroke-dashoffset .8s cubic-bezier(.22,.68,0,1.01); }
.donut-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; pointer-events: none; }
.donut-center .amt { font-size: 20px; font-weight: 700; }
.donut-center .lbl { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .05em; margin-top: 2px; }
.legend { flex: 1 1 200px; display: flex; flex-direction: column; gap: 9px; min-width: 180px; }
.legend-row { display: flex; align-items: center; gap: 9px; font-size: 12px; }
.legend-row .dot { width: 10px; height: 10px; border-radius: 50%; flex: 0 0 auto; }
.legend-row .name { flex: 1; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.legend-row .amt { font-weight: 600; color: var(--text-primary); }
.legend-row .pct { color: var(--text-muted); width: 38px; text-align: right; }

table.data-table { display: none; width: 100%; border-collapse: collapse; font-size: 12px; }
table.data-table.show { display: table; }
table.data-table th { text-align: left; color: var(--text-muted); font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; padding: 6px 8px; border-bottom: 1px solid var(--gridline); }
table.data-table td { padding: 7px 8px; border-bottom: 1px solid var(--gridline); color: var(--text-secondary); }
table.data-table td.num { text-align: right; font-variant-numeric: tabular-nums; color: var(--text-primary); }
.donut-visual.hidden-by-table, .provider-bars.hidden-by-table { display: none; }

/* ---------- Provider bars ---------- */
.provider-bars { display: flex; flex-direction: column; gap: 14px; }
.provider-row .row-top { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 5px; }
.provider-row .row-top .pname { display: flex; align-items: center; gap: 7px; font-weight: 600; }
.provider-row .row-top .pname .dot { width: 9px; height: 9px; border-radius: 50%; }
.provider-row .row-top .pval { font-weight: 700; font-variant-numeric: tabular-nums; }
.bar-track { height: 22px; border-radius: 6px; background: var(--gridline); overflow: hidden; }
.bar-fill { height: 100%; border-radius: 6px; width: 0%; transition: width 1s cubic-bezier(.22,.68,0,1.01); }
.provider-row .row-sub { font-size: 11px; color: var(--text-muted); margin-top: 4px; }

/* ---------- Forecast ---------- */
.forecast-legend { display: flex; gap: 18px; margin-bottom: 10px; font-size: 11px; color: var(--text-secondary); }
.forecast-legend .item { display: flex; align-items: center; gap: 6px; }
.forecast-legend .swatch { width: 16px; height: 3px; border-radius: 2px; }
.forecast-wrap { position: relative; }
.chart-tooltip {
    position: absolute; pointer-events: none; opacity: 0; transition: opacity .12s;
    background: var(--surface-1); border: 1px solid var(--border); border-radius: 8px;
    padding: 7px 10px; font-size: 11px; box-shadow: var(--card-shadow); white-space: nowrap; z-index: 5;
}
.chart-tooltip .t-month { color: var(--text-muted); margin-bottom: 3px; }
.chart-tooltip .t-row { display: flex; align-items: center; gap: 6px; }
.chart-tooltip .t-dot { width: 8px; height: 8px; border-radius: 50%; }
.forecast-note { font-size: 11px; color: var(--text-muted); margin-top: 10px; }

.footer-note { text-align: center; font-size: 11px; color: var(--text-muted); margin-top: 28px; }

#dashboard-content { display: none; }
#dashboard-content.show { display: block; }

/* ---------- AI suggestions ---------- */
.card:nth-of-type(4) { animation-delay: .24s; }
.card:nth-of-type(5) { animation-delay: .30s; }
.card:nth-of-type(6) { animation-delay: .36s; }
.ai-provider-badge { font-size: 11px; font-weight: 600; color: var(--text-muted); background: var(--gridline); padding: 3px 9px; border-radius: 999px; }
.ai-empty { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; padding: 6px 0 2px; }
.ai-empty p { margin: 0; font-size: 12px; color: var(--text-secondary); max-width: 520px; }
.btn-ask-ai {
    appearance: none; border: none; border-radius: 8px; padding: 9px 16px; font-size: 12px; font-weight: 600;
    color: #fff; cursor: pointer; background: linear-gradient(135deg, var(--slot-1), var(--slot-5));
    box-shadow: var(--card-shadow); transition: transform .15s ease;
}
.btn-ask-ai:hover { transform: translateY(-1px); }
.btn-ask-ai:active { transform: translateY(0); }
.ai-loading { display: flex; align-items: center; gap: 10px; padding: 18px 0; font-size: 12px; color: var(--text-secondary); }
.ai-spinner { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--gridline); border-top-color: var(--slot-1); animation: spin .8s linear infinite; flex: 0 0 auto; }
@keyframes spin { to { transform: rotate(360deg); } }
.ai-error { font-size: 12px; color: var(--critical); padding: 10px 0; }
.ai-results { display: grid; gap: 10px; }
.ai-none { font-size: 12px; color: var(--text-muted); margin: 0; }
.ai-suggestion { border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; background: color-mix(in srgb, var(--slot-1) 4%, var(--surface-1)); }
.ai-suggestion-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
.ai-resource { font-size: 12px; font-weight: 700; color: var(--text-primary); }
.ai-category { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: var(--text-muted); background: var(--gridline); padding: 2px 7px; border-radius: 999px; }
.ai-savings { font-size: 11px; font-weight: 700; color: var(--good); margin-left: auto; }
.ai-text { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); }
.ai-file-tag { font-size: 10.5px; color: var(--text-muted); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; margin-bottom: 6px; }

/* ---------- Capacity & scaling ---------- */
.capacity-summary { font-size: 12px; color: var(--text-secondary); background: var(--gridline); border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; }
.scaling-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.btn-secondary { background: var(--surface-1); color: var(--text-primary); border: 1px solid var(--border); box-shadow: none; }
.action-badge { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; padding: 2px 7px; border-radius: 999px; font-weight: 700; }
.action-scale_up { background: color-mix(in srgb, var(--warning) 20%, transparent); color: var(--warning); }
.action-scale_down { background: color-mix(in srgb, var(--good) 20%, transparent); color: var(--good); }
.action-keep { background: var(--gridline); color: var(--text-muted); }
.scaling-change { font-size: 11.5px; font-weight: 600; color: var(--text-primary); margin-left: auto; }
`;

// ---------------------------------------------------------------------------
// Body markup — mostly empty containers; render() (below) fills them in.
// ---------------------------------------------------------------------------
const BODY = `
<div class="wrap">
    <div class="topbar">
        <div>
            <h1>📊 Terraform Cost Dashboard</h1>
            <div class="subtitle" id="file-name">—</div>
        </div>
        <div class="topbar-actions">
            <div class="scope-toggle" id="scope-toggle" role="tablist">
                <button class="scope-btn active" data-scope="file" title="Costs for the active file only">This file</button>
                <button class="scope-btn" data-scope="workspace" title="Costs across every .tf file in the workspace">Whole workspace</button>
            </div>
            <span class="updated-at" id="updated-at"></span>
            <button class="btn-refresh" id="export-btn" title="Export a multi-sheet .xlsx cost report">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>
                Export
            </button>
            <button class="btn-refresh" id="refresh-btn" title="Recalculate now">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>
                Refresh
            </button>
        </div>
    </div>

    <div id="empty-state">
        <div class="icon">📄</div>
        <h2>No cost data yet</h2>
        <p>Open a <code>.tf</code> file that defines resources — the dashboard fills in automatically and keeps itself in sync as you edit.</p>
    </div>

    <div id="dashboard-content">
        <div class="hero">
            <div class="hero-figure">
                <div class="label">Total monthly cost</div>
                <div class="value"><span class="cur" id="hero-currency">$</span><span id="hero-amount">0.00</span></div>
            </div>
            <div class="stat-row">
                <div class="stat-tile"><div class="label">Yearly</div><div class="value" id="stat-yearly">$0</div></div>
                <div class="stat-tile"><div class="label">Hourly</div><div class="value" id="stat-hourly">$0</div></div>
                <div class="stat-tile"><div class="label">Resources</div><div class="value" id="stat-resources">0</div></div>
                <div class="stat-tile"><div class="label">Providers</div><div class="value" id="stat-providers">0</div></div>
                <div class="stat-tile" id="stat-files-tile" style="display:none;"><div class="label">Files scanned</div><div class="value" id="stat-files">0</div></div>
            </div>
        </div>

        <div class="budget-card" id="budget-card">
            <div class="budget-head">
                <span class="title">Budget usage</span>
                <span class="status" id="budget-status">On track</span>
            </div>
            <div class="meter-track"><div class="meter-fill" id="budget-fill"></div></div>
            <div class="budget-foot">
                <span id="budget-current">$0/mo</span>
                <span id="budget-limit">of $0/mo</span>
            </div>
        </div>

        <div class="grid">
            <div class="card">
                <div class="card-head">
                    <h3>Cost breakdown by resource type</h3>
                    <button class="toggle-table" data-target="type">View as table</button>
                </div>
                <div class="donut-row">
                    <div class="donut-visual" id="donut-visual">
                        <svg viewBox="0 0 200 200" width="190" height="190"></svg>
                        <div class="donut-center">
                            <div class="amt" id="donut-total">$0</div>
                            <div class="lbl">per month</div>
                        </div>
                    </div>
                    <div class="legend" id="donut-legend"></div>
                </div>
                <table class="data-table" id="type-table">
                    <thead><tr><th>Resource type</th><th>Count</th><th>Monthly</th><th>Share</th></tr></thead>
                    <tbody></tbody>
                </table>
            </div>

            <div class="card">
                <div class="card-head">
                    <h3>Cost by cloud provider</h3>
                    <button class="toggle-table" data-target="provider">View as table</button>
                </div>
                <div class="provider-bars" id="provider-bars"></div>
                <table class="data-table" id="provider-table">
                    <thead><tr><th>Provider</th><th>Resources</th><th>Monthly</th></tr></thead>
                    <tbody></tbody>
                </table>
            </div>

            <div class="card full" id="by-file-card" style="display:none;">
                <div class="card-head">
                    <h3>Cost by file / module</h3>
                    <button class="toggle-table" data-target="file">View as table</button>
                </div>
                <div class="provider-bars" id="file-bars"></div>
                <table class="data-table" id="file-table">
                    <thead><tr><th>File</th><th>Resources</th><th>Monthly</th></tr></thead>
                    <tbody></tbody>
                </table>
            </div>

            <div class="card full">
                <div class="card-head">
                    <h3>12-month cost forecast</h3>
                </div>
                <div class="forecast-legend">
                    <span class="item"><span class="swatch" style="background:var(--slot-1)"></span>If usage stays flat</span>
                    <span class="item"><span class="swatch" style="background:var(--slot-2)"></span><span id="forecast-growth-label">If usage grows</span></span>
                </div>
                <div class="forecast-wrap">
                    <svg id="forecast-svg" viewBox="0 0 640 260" width="100%" height="260"></svg>
                    <div id="forecast-tooltip" class="chart-tooltip"></div>
                </div>
                <div class="forecast-note">Illustrative projection from the current monthly total — not a guarantee of future spend.</div>
            </div>

            <div class="card full" id="history-card" style="display:none;">
                <div class="card-head">
                    <h3>📊 Cost history</h3>
                    <button class="btn-ask-ai btn-secondary" id="record-snapshot-btn" style="padding:5px 12px;font-size:11px;">Record snapshot</button>
                </div>
                <div id="history-empty" class="ai-empty" style="display:none;">
                    <p>Real recorded totals over time, not a projection — run <strong>Terraform Cost: Record Cost Snapshot</strong> (or the button above) periodically to build a trend.</p>
                </div>
                <div id="history-chart-wrap" class="forecast-wrap" style="display:none;">
                    <svg id="history-svg" viewBox="0 0 640 220" width="100%" height="220"></svg>
                    <div id="history-tooltip" class="chart-tooltip"></div>
                </div>
            </div>

            <div class="card full" id="ai-card">
                <div class="card-head">
                    <h3>✨ AI cost optimization suggestions</h3>
                    <span class="ai-provider-badge" id="ai-provider-badge"></span>
                </div>
                <div id="ai-empty" class="ai-empty">
                    <p id="ai-empty-text">Get concrete, resource-specific suggestions for cutting this file's cost — rightsizing, reserved capacity, storage tiers, architecture swaps.</p>
                    <button class="btn-ask-ai" id="ask-ai-btn">✨ Ask AI for suggestions</button>
                </div>
                <div id="ai-loading" class="ai-loading" style="display:none;">
                    <div class="ai-spinner"></div>
                    <span id="ai-loading-text">Asking AI…</span>
                </div>
                <div id="ai-results" class="ai-results" style="display:none;"></div>
                <div id="ai-error" class="ai-error" style="display:none;"></div>
            </div>

            <div class="card full" id="scaling-card">
                <div class="card-head">
                    <h3>📈 Capacity &amp; scaling suggestions</h3>
                    <span class="ai-provider-badge" id="scaling-provider-badge"></span>
                </div>
                <div class="capacity-summary" id="capacity-summary" style="display:none;"></div>
                <div id="scaling-empty" class="ai-empty">
                    <p id="scaling-empty-text">Tell it your expected load — users/day, requests/day — and get AI-reasoned scale up/down suggestions for these resources, not just cost ones.</p>
                    <div class="scaling-actions">
                        <button class="btn-ask-ai btn-secondary" id="edit-capacity-btn">Set capacity inputs</button>
                        <button class="btn-ask-ai" id="ask-scaling-btn">📈 Get scaling suggestions</button>
                    </div>
                </div>
                <div id="scaling-loading" class="ai-loading" style="display:none;">
                    <div class="ai-spinner"></div>
                    <span id="scaling-loading-text">Asking AI…</span>
                </div>
                <div id="scaling-results" class="ai-results" style="display:none;"></div>
                <div id="scaling-error" class="ai-error" style="display:none;"></div>
            </div>
        </div>

        <div class="footer-note">Estimates from Infracost (when configured) or built-in fallback pricing · Matali — Terraform Cost Calculator</div>
    </div>
</div>
`;

// ---------------------------------------------------------------------------
// Client-side script — pure vanilla JS, no dependencies.
// ---------------------------------------------------------------------------
const JS = `
(function () {
    const vscode = acquireVsCodeApi();
    const SLOTS = ['var(--slot-1)', 'var(--slot-2)', 'var(--slot-3)', 'var(--slot-4)', 'var(--slot-5)'];
    const CUR_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', JPY: '¥' };
    let current = null;

    function fmtMoney(n, currency) {
        const sym = CUR_SYMBOLS[currency] || '$';
        return sym + (n || 0).toFixed(2);
    }

    function fmtCompact(n, currency) {
        const sym = CUR_SYMBOLS[currency] || '$';
        const abs = Math.abs(n || 0);
        if (abs >= 1000) return sym + (n / 1000).toFixed(1) + 'k';
        return sym + (n || 0).toFixed(0);
    }

    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

    function animateNumber(el, from, to, ms, render) {
        const start = performance.now();
        function frame(now) {
            const t = Math.min(1, (now - start) / ms);
            const val = from + (to - from) * easeOutCubic(t);
            el.textContent = render(val);
            if (t < 1) requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    }

    function providerLabel(p) {
        return ({ aws: 'AWS', gcp: 'Google Cloud', azure: 'Microsoft Azure' })[p] || p;
    }

    // ---- empty state -------------------------------------------------
    function showEmpty(show) {
        document.getElementById('empty-state').style.display = show ? 'flex' : 'none';
        document.getElementById('dashboard-content').classList.toggle('show', !show);
    }

    // ---- hero + stat tiles --------------------------------------------
    function renderHero(data, prev) {
        document.getElementById('hero-currency').textContent = CUR_SYMBOLS[data.currency] || '$';
        const heroEl = document.getElementById('hero-amount');
        animateNumber(heroEl, prev ? prev.totals.monthly : 0, data.totals.monthly, 700, v => v.toFixed(2));
        document.getElementById('stat-yearly').textContent = fmtCompact(data.totals.yearly, data.currency);
        document.getElementById('stat-hourly').textContent = fmtMoney(data.totals.hourly, data.currency);
        document.getElementById('stat-resources').textContent = data.resourceCount;
        document.getElementById('stat-providers').textContent = data.byProvider.length;

        const filesTile = document.getElementById('stat-files-tile');
        if (data.scope === 'workspace') {
            filesTile.style.display = '';
            document.getElementById('stat-files').textContent = data.fileCount;
        } else {
            filesTile.style.display = 'none';
        }
    }

    // ---- budget meter ---------------------------------------------------
    function renderBudget(data) {
        const card = document.getElementById('budget-card');
        if (!data.budget) { card.classList.remove('show'); return; }
        card.classList.add('show');
        const b = data.budget;
        const limit = b.final_limit || b.limit_3 || b.limit_2 || b.limit_1 || (b.current * 1.5) || 1;
        const pct = Math.min(100, (b.current / limit) * 100);
        const fill = document.getElementById('budget-fill');
        fill.style.width = pct + '%';
        let color = 'var(--good)', statusText = 'On track', statusColor = 'var(--good)';
        if (b.level >= 4) { color = 'var(--critical)'; statusText = 'Over budget'; statusColor = 'var(--critical)'; }
        else if (b.level === 3) { color = 'var(--serious)'; statusText = 'Near limit'; statusColor = 'var(--serious)'; }
        else if (b.level >= 1) { color = 'var(--warning)'; statusText = 'Watch spend'; statusColor = 'var(--warning)'; }
        fill.style.backgroundColor = color;
        const statusEl = document.getElementById('budget-status');
        statusEl.textContent = statusText;
        statusEl.style.color = statusColor;
        document.getElementById('budget-current').textContent = fmtMoney(b.current, data.currency) + '/mo';
        document.getElementById('budget-limit').textContent = 'of ' + fmtMoney(limit, data.currency) + '/mo budget';
    }

    // ---- donut -----------------------------------------------------------
    function renderDonut(data) {
        const svg = document.querySelector('#donut-visual svg');
        const R = 70, CX = 100, CY = 100, STROKE = 26;
        const C = 2 * Math.PI * R;
        const total = data.byType.reduce((s, t) => s + t.monthly, 0) || 1;

        svg.innerHTML = '';
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('transform', 'rotate(-90 ' + CX + ' ' + CY + ')');
        svg.appendChild(g);

        // track
        const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        track.setAttribute('cx', CX); track.setAttribute('cy', CY); track.setAttribute('r', R);
        track.setAttribute('fill', 'none'); track.setAttribute('stroke', 'var(--gridline)'); track.setAttribute('stroke-width', STROKE);
        g.appendChild(track);

        let offset = 0;
        const gap = 3; // px of surface-color gap between slices
        data.byType.forEach((t, i) => {
            const frac = t.monthly / total;
            const len = Math.max(0, frac * C - gap);
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('class', 'slice');
            circle.setAttribute('cx', CX); circle.setAttribute('cy', CY); circle.setAttribute('r', R);
            circle.setAttribute('fill', 'none');
            circle.setAttribute('stroke', t.isOther ? 'var(--slot-other)' : SLOTS[i % SLOTS.length]);
            circle.setAttribute('stroke-width', STROKE);
            circle.setAttribute('stroke-dasharray', len + ' ' + (C - len));
            circle.setAttribute('stroke-dashoffset', -offset);
            circle.innerHTML = '<title>' + t.label + ': ' + fmtMoney(t.monthly, data.currency) + '/mo</title>';
            g.appendChild(circle);
            offset += frac * C;
        });

        document.getElementById('donut-total').textContent = fmtCompact(total, data.currency);

        const legend = document.getElementById('donut-legend');
        legend.innerHTML = '';
        const tbody = document.querySelector('#type-table tbody');
        tbody.innerHTML = '';
        data.byType.forEach((t, i) => {
            const pct = total ? (t.monthly / total * 100) : 0;
            const color = t.isOther ? 'var(--slot-other)' : SLOTS[i % SLOTS.length];
            const row = document.createElement('div');
            row.className = 'legend-row';
            row.innerHTML = '<span class="dot" style="background:' + color + '"></span>' +
                '<span class="name">' + t.label + '</span>' +
                '<span class="amt">' + fmtMoney(t.monthly, data.currency) + '</span>' +
                '<span class="pct">' + pct.toFixed(0) + '%</span>';
            legend.appendChild(row);

            const tr = document.createElement('tr');
            tr.innerHTML = '<td>' + t.label + '</td><td class="num">' + t.count + '</td>' +
                '<td class="num">' + fmtMoney(t.monthly, data.currency) + '</td><td class="num">' + pct.toFixed(0) + '%</td>';
            tbody.appendChild(tr);
        });
    }

    // ---- provider bars -----------------------------------------------------
    function renderProviders(data) {
        const wrap = document.getElementById('provider-bars');
        wrap.innerHTML = '';
        const tbody = document.querySelector('#provider-table tbody');
        tbody.innerHTML = '';
        const max = Math.max(1, ...data.byProvider.map(p => p.monthly));
        data.byProvider.forEach((p, i) => {
            const color = SLOTS[i % SLOTS.length];
            const row = document.createElement('div');
            row.className = 'provider-row';
            row.innerHTML =
                '<div class="row-top"><span class="pname"><span class="dot" style="background:' + color + '"></span>' + providerLabel(p.provider) + '</span>' +
                '<span class="pval">' + fmtMoney(p.monthly, data.currency) + '/mo</span></div>' +
                '<div class="bar-track"><div class="bar-fill" style="background:' + color + '"></div></div>' +
                '<div class="row-sub">' + p.count + ' resource' + (p.count === 1 ? '' : 's') + '</div>';
            wrap.appendChild(row);
            requestAnimationFrame(() => {
                row.querySelector('.bar-fill').style.width = Math.max(4, (p.monthly / max) * 100) + '%';
            });

            const tr = document.createElement('tr');
            tr.innerHTML = '<td>' + providerLabel(p.provider) + '</td><td class="num">' + p.count + '</td><td class="num">' + fmtMoney(p.monthly, data.currency) + '</td>';
            tbody.appendChild(tr);
        });
    }

    // ---- cost by file/module (workspace scope only) -------------------------
    function renderByFile(data) {
        const wrap = document.getElementById('file-bars');
        wrap.innerHTML = '';
        const tbody = document.querySelector('#file-table tbody');
        tbody.innerHTML = '';
        const files = data.byFile || [];
        const max = Math.max(1, ...files.map((f) => f.monthly));
        files.forEach((f, i) => {
            const color = SLOTS[i % SLOTS.length];
            const row = document.createElement('div');
            row.className = 'provider-row';
            row.innerHTML =
                '<div class="row-top"><span class="pname"><span class="dot" style="background:' + color + '"></span>' + escapeHtml(f.file) + '</span>' +
                '<span class="pval">' + fmtMoney(f.monthly, data.currency) + '/mo</span></div>' +
                '<div class="bar-track"><div class="bar-fill" style="background:' + color + '"></div></div>' +
                '<div class="row-sub">' + f.count + ' resource' + (f.count === 1 ? '' : 's') + '</div>';
            wrap.appendChild(row);
            requestAnimationFrame(() => {
                row.querySelector('.bar-fill').style.width = Math.max(4, (f.monthly / max) * 100) + '%';
            });

            const tr = document.createElement('tr');
            tr.innerHTML = '<td>' + escapeHtml(f.file) + '</td><td class="num">' + f.count + '</td><td class="num">' + fmtMoney(f.monthly, data.currency) + '</td>';
            tbody.appendChild(tr);
        });
    }

    // ---- forecast chart -----------------------------------------------------
    function renderForecast(data) {
        const svg = document.getElementById('forecast-svg');
        const tooltip = document.getElementById('forecast-tooltip');
        const f = data.forecast;
        document.getElementById('forecast-growth-label').textContent = 'If usage grows ~' + f.growthRatePct + '%/mo';

        const W = 640, H = 260, PAD_L = 46, PAD_R = 16, PAD_T = 14, PAD_B = 26;
        const innerW = W - PAD_L - PAD_R, innerH = H - PAD_T - PAD_B;
        const maxVal = Math.max(...f.flat, ...f.growth, 1);
        const niceMax = Math.ceil(maxVal / 4) * 4 || 1;

        const xAt = (i) => PAD_L + (i / (f.months.length - 1)) * innerW;
        const yAt = (v) => PAD_T + innerH - (v / niceMax) * innerH;

        function pathFor(values) {
            return values.map((v, i) => (i === 0 ? 'M' : 'L') + xAt(i).toFixed(1) + ' ' + yAt(v).toFixed(1)).join(' ');
        }
        function areaFor(values) {
            const line = pathFor(values);
            return line + ' L' + xAt(values.length - 1).toFixed(1) + ' ' + yAt(0).toFixed(1) +
                ' L' + xAt(0).toFixed(1) + ' ' + yAt(0).toFixed(1) + ' Z';
        }

        let svgHtml = '';
        // gridlines + y labels
        for (let s = 0; s <= 4; s++) {
            const v = (niceMax / 4) * s;
            const y = yAt(v);
            svgHtml += '<line x1="' + PAD_L + '" x2="' + (W - PAD_R) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="var(--gridline)" stroke-width="1"/>';
            svgHtml += '<text x="' + (PAD_L - 8) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end" font-size="9" fill="var(--text-muted)">' + fmtCompact(v, data.currency) + '</text>';
        }
        // x labels (months 1,3,6,9,12)
        [0, 2, 5, 8, 11].forEach((idx) => {
            if (idx >= f.months.length) return;
            svgHtml += '<text x="' + xAt(idx).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="9" fill="var(--text-muted)">M' + f.months[idx] + '</text>';
        });

        svgHtml += '<path d="' + areaFor(f.growth) + '" fill="var(--slot-2)" opacity="0.12" stroke="none"/>';
        svgHtml += '<path d="' + pathFor(f.growth) + '" fill="none" stroke="var(--slot-2)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
        svgHtml += '<path d="' + pathFor(f.flat) + '" fill="none" stroke="var(--slot-1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';

        // end markers + end labels (avoid collision by nudging apart)
        const lastI = f.months.length - 1;
        const yFlat = yAt(f.flat[lastI]);
        const yGrowth = yAt(f.growth[lastI]);
        let labelFlatY = yFlat, labelGrowthY = yGrowth;
        if (Math.abs(yFlat - yGrowth) < 14) {
            const mid = (yFlat + yGrowth) / 2;
            if (yFlat <= yGrowth) { labelFlatY = mid - 8; labelGrowthY = mid + 8; }
            else { labelFlatY = mid + 8; labelGrowthY = mid - 8; }
        }
        svgHtml += '<circle cx="' + xAt(lastI).toFixed(1) + '" cy="' + yFlat.toFixed(1) + '" r="4" fill="var(--slot-1)" stroke="var(--surface-1)" stroke-width="2"/>';
        svgHtml += '<circle cx="' + xAt(lastI).toFixed(1) + '" cy="' + yGrowth.toFixed(1) + '" r="4" fill="var(--slot-2)" stroke="var(--surface-1)" stroke-width="2"/>';
        svgHtml += '<text x="' + (xAt(lastI) + 8).toFixed(1) + '" y="' + (labelFlatY + 3).toFixed(1) + '" font-size="10" font-weight="600" fill="var(--slot-1)">' + fmtCompact(f.flat[lastI], data.currency) + '</text>';
        svgHtml += '<text x="' + (xAt(lastI) + 8).toFixed(1) + '" y="' + (labelGrowthY + 3).toFixed(1) + '" font-size="10" font-weight="600" fill="var(--slot-2)">' + fmtCompact(f.growth[lastI], data.currency) + '</text>';

        // hover crosshair layer
        svgHtml += '<line id="fc-crosshair" x1="0" x2="0" y1="' + PAD_T + '" y2="' + (H - PAD_B) + '" stroke="var(--baseline)" stroke-width="1" opacity="0"/>';
        svgHtml += '<rect id="fc-hitrect" x="' + PAD_L + '" y="' + PAD_T + '" width="' + innerW + '" height="' + innerH + '" fill="transparent"/>';

        svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
        svg.innerHTML = svgHtml;

        const hitrect = svg.querySelector('#fc-hitrect');
        const crosshair = svg.querySelector('#fc-crosshair');
        hitrect.addEventListener('mousemove', (e) => {
            const rect = svg.getBoundingClientRect();
            const scale = W / rect.width;
            const mx = (e.clientX - rect.left) * scale;
            let idx = Math.round(((mx - PAD_L) / innerW) * (f.months.length - 1));
            idx = Math.max(0, Math.min(f.months.length - 1, idx));
            const x = xAt(idx);
            crosshair.setAttribute('x1', x); crosshair.setAttribute('x2', x); crosshair.setAttribute('opacity', '1');

            tooltip.innerHTML =
                '<div class="t-month">Month ' + f.months[idx] + '</div>' +
                '<div class="t-row"><span class="t-dot" style="background:var(--slot-1)"></span>Flat: ' + fmtMoney(f.flat[idx], data.currency) + '</div>' +
                '<div class="t-row"><span class="t-dot" style="background:var(--slot-2)"></span>Growth: ' + fmtMoney(f.growth[idx], data.currency) + '</div>';
            tooltip.style.opacity = '1';
            const wrapRect = svg.parentElement.getBoundingClientRect();
            let left = (e.clientX - wrapRect.left) + 14;
            if (left + 150 > wrapRect.width) left = (e.clientX - wrapRect.left) - 160;
            tooltip.style.left = left + 'px';
            tooltip.style.top = Math.max(0, (e.clientY - wrapRect.top) - 50) + 'px';
        });
        hitrect.addEventListener('mouseleave', () => {
            crosshair.setAttribute('opacity', '0');
            tooltip.style.opacity = '0';
        });
    }

    // ---- cost history (real recorded snapshots, not a projection) --------
    function renderCostHistory(data) {
        const history = data.costHistory || [];
        const card = document.getElementById('history-card');
        const empty = document.getElementById('history-empty');
        const chartWrap = document.getElementById('history-chart-wrap');

        if (history.length === 0) {
            card.style.display = 'none';
            return;
        }
        card.style.display = '';

        if (history.length === 1) {
            empty.style.display = 'flex';
            chartWrap.style.display = 'none';
            return;
        }
        empty.style.display = 'none';
        chartWrap.style.display = '';

        const svg = document.getElementById('history-svg');
        const tooltip = document.getElementById('history-tooltip');
        const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp);
        const values = sorted.map((h) => h.totalMonthly);

        const W = 640, H = 220, PAD_L = 46, PAD_R = 16, PAD_T = 14, PAD_B = 26;
        const innerW = W - PAD_L - PAD_R, innerH = H - PAD_T - PAD_B;
        const maxVal = Math.max(...values, 1);
        const niceMax = Math.ceil(maxVal / 4) * 4 || 1;

        const xAt = (i) => PAD_L + (sorted.length === 1 ? 0 : (i / (sorted.length - 1)) * innerW);
        const yAt = (v) => PAD_T + innerH - (v / niceMax) * innerH;
        const pathFor = (vals) => vals.map((v, i) => (i === 0 ? 'M' : 'L') + xAt(i).toFixed(1) + ' ' + yAt(v).toFixed(1)).join(' ');

        let svgHtml = '';
        for (let s = 0; s <= 4; s++) {
            const v = (niceMax / 4) * s;
            const y = yAt(v);
            svgHtml += '<line x1="' + PAD_L + '" x2="' + (W - PAD_R) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="var(--gridline)" stroke-width="1"/>';
            svgHtml += '<text x="' + (PAD_L - 8) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end" font-size="9" fill="var(--text-muted)">' + fmtCompact(v, data.currency) + '</text>';
        }
        // A handful of evenly-spaced date labels, not one per point (could be many)
        const labelCount = Math.min(sorted.length, 6);
        for (let i = 0; i < labelCount; i++) {
            const idx = Math.round((i / (labelCount - 1 || 1)) * (sorted.length - 1));
            svgHtml += '<text x="' + xAt(idx).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="9" fill="var(--text-muted)">' + formatShortDate(sorted[idx].timestamp) + '</text>';
        }

        svgHtml += '<path d="' + pathFor(values) + '" fill="none" stroke="var(--slot-1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
        sorted.forEach((h, i) => {
            svgHtml += '<circle cx="' + xAt(i).toFixed(1) + '" cy="' + yAt(h.totalMonthly).toFixed(1) + '" r="3.5" fill="var(--slot-1)" stroke="var(--surface-1)" stroke-width="1.5"/>';
        });

        svgHtml += '<line id="hist-crosshair" x1="0" x2="0" y1="' + PAD_T + '" y2="' + (H - PAD_B) + '" stroke="var(--baseline)" stroke-width="1" opacity="0"/>';
        svgHtml += '<rect id="hist-hitrect" x="' + PAD_L + '" y="' + PAD_T + '" width="' + innerW + '" height="' + innerH + '" fill="transparent"/>';

        svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
        svg.innerHTML = svgHtml;

        const hitrect = svg.querySelector('#hist-hitrect');
        const crosshair = svg.querySelector('#hist-crosshair');
        hitrect.addEventListener('mousemove', (e) => {
            const rect = svg.getBoundingClientRect();
            const scale = W / rect.width;
            const mx = (e.clientX - rect.left) * scale;
            let idx = Math.round(((mx - PAD_L) / innerW) * (sorted.length - 1));
            idx = Math.max(0, Math.min(sorted.length - 1, idx));
            const x = xAt(idx);
            crosshair.setAttribute('x1', x); crosshair.setAttribute('x2', x); crosshair.setAttribute('opacity', '1');

            const point = sorted[idx];
            tooltip.innerHTML =
                '<div class="t-month">' + formatFullDate(point.timestamp) + '</div>' +
                '<div class="t-row"><span class="t-dot" style="background:var(--slot-1)"></span>' + fmtMoney(point.totalMonthly, data.currency) + '/mo</div>' +
                '<div class="t-row">' + escapeHtml(point.label || '') + ' · ' + point.resourceCount + ' resources</div>';
            tooltip.style.opacity = '1';
            const wrapRect = svg.parentElement.getBoundingClientRect();
            let left = (e.clientX - wrapRect.left) + 14;
            if (left + 160 > wrapRect.width) left = (e.clientX - wrapRect.left) - 170;
            tooltip.style.left = left + 'px';
            tooltip.style.top = Math.max(0, (e.clientY - wrapRect.top) - 50) + 'px';
        });
        hitrect.addEventListener('mouseleave', () => {
            crosshair.setAttribute('opacity', '0');
            tooltip.style.opacity = '0';
        });
    }

    function formatShortDate(ts) {
        const d = new Date(ts);
        return (d.getMonth() + 1) + '/' + d.getDate();
    }

    function formatFullDate(ts) {
        return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    }

    document.getElementById('record-snapshot-btn').addEventListener('click', () => {
        vscode.postMessage({ type: 'recordSnapshot' });
    });

    // ---- table toggles -----------------------------------------------------
    const TABLE_TOGGLE_TARGETS = {
        type: { table: 'type-table', chartEls: ['donut-visual', 'donut-legend'] },
        provider: { table: 'provider-table', chartEls: ['provider-bars'] },
        file: { table: 'file-table', chartEls: ['file-bars'] }
    };

    document.querySelectorAll('.toggle-table').forEach((btn) => {
        btn.addEventListener('click', () => {
            const cfg = TABLE_TOGGLE_TARGETS[btn.dataset.target];
            if (!cfg) return;
            const tableEl = document.getElementById(cfg.table);
            const isTable = tableEl.classList.contains('show');
            tableEl.classList.toggle('show', !isTable);
            cfg.chartEls.forEach((id) => document.getElementById(id).classList.toggle('hidden-by-table', !isTable));
            btn.textContent = isTable ? 'View as table' : 'View as chart';
        });
    });

    function render(data) {
        setScopeButtons(data && data.scope);
        renderAiScopeText(data && data.scope);

        if (!data || data.empty) {
            showEmpty(true);
            current = null;
            document.getElementById('file-name').textContent = data && data.scope === 'workspace'
                ? 'No .tf files with resources found in this workspace'
                : data && data.scope === 'plan'
                ? 'This plan has no resources that will exist after applying it'
                : '—';
            return;
        }
        showEmpty(false);
        renderHero(data, current);
        renderBudget(data);
        renderDonut(data);
        renderProviders(data);
        renderForecast(data);
        renderCostHistory(data);

        const byFileCard = document.getElementById('by-file-card');
        if (data.scope === 'workspace' && data.byFile) {
            byFileCard.style.display = '';
            renderByFile(data);
        } else {
            byFileCard.style.display = 'none';
        }

        renderCapacitySummary(data);

        document.getElementById('file-name').textContent = data.scope === 'workspace'
            ? data.fileCount + ' file' + (data.fileCount === 1 ? '' : 's') + ' scanned'
            : data.scope === 'plan'
            ? '📋 Terraform plan: ' + (data.planFileName || '')
            : (data.fileName || '');
        document.getElementById('updated-at').textContent = 'Updated ' + new Date(data.generatedAt).toLocaleTimeString();
        current = data;
    }

    // ---- AI/scaling card text reflects the active scope ------------------
    function renderAiScopeText(scope) {
        const scopeWord = scope === 'workspace' ? 'the whole workspace' : scope === 'plan' ? 'this plan' : 'this file';
        document.getElementById('ai-empty-text').textContent =
            'Get concrete, resource-specific suggestions for cutting ' + scopeWord + "'s cost — rightsizing, reserved capacity, storage tiers, architecture swaps.";
        document.getElementById('scaling-empty-text').textContent =
            'Tell it your expected load — users/day, requests/day — and get AI-reasoned scale up/down suggestions for ' + scopeWord + "'s resources, not just cost ones.";
    }

    // ---- scope toggle ---------------------------------------------------
    function setScopeButtons(scope) {
        document.querySelectorAll('.scope-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.scope === (scope || 'file'));
        });
    }

    document.querySelectorAll('.scope-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            if (btn.classList.contains('active')) return;
            setScopeButtons(btn.dataset.scope);
            vscode.postMessage({ type: 'setScope', scope: btn.dataset.scope });
        });
    });

    // ---- AI cost suggestions + capacity/scaling suggestions ---------------
    // Both cards are the same empty/loading/results/error state machine over
    // a differently-shaped result list, so they share setCardState() and
    // only their per-item render function differs.
    const AI_PROVIDER_LABELS = { gemini: 'Gemini', claude: 'Claude', openai: 'GPT', deepseek: 'DeepSeek', groq: 'Groq' };
    const CARD_DISPLAY_FOR_STATE = { empty: 'flex', loading: 'flex', results: 'grid', error: 'block' };

    function setCardState(prefix, state, payload, renderResults) {
        const els = {
            empty: document.getElementById(prefix + '-empty'),
            loading: document.getElementById(prefix + '-loading'),
            results: document.getElementById(prefix + '-results'),
            error: document.getElementById(prefix + '-error')
        };
        Object.keys(els).forEach((k) => {
            els[k].style.display = (k === state) ? CARD_DISPLAY_FOR_STATE[k] : 'none';
        });

        if (state === 'loading') {
            document.getElementById(prefix + '-loading-text').textContent =
                'Asking ' + (AI_PROVIDER_LABELS[payload && payload.provider] || 'AI') + ' for suggestions…';
        } else if (state === 'error') {
            els.error.textContent = '⚠️ ' + ((payload && payload.error) || 'Something went wrong.');
        } else if (state === 'results') {
            renderResults(payload);
        }
    }

    function renderAiResults(payload) {
        document.getElementById('ai-provider-badge').textContent = AI_PROVIDER_LABELS[payload.provider] || '';
        const wrap = document.getElementById('ai-results');
        wrap.innerHTML = '';
        const list = payload.suggestions || [];
        if (list.length === 0) {
            wrap.innerHTML = '<p class="ai-none">No specific suggestions — this configuration already looks reasonably optimized.</p>';
            return;
        }
        const currency = current ? current.currency : 'USD';
        list.forEach((s) => {
            const card = document.createElement('div');
            card.className = 'ai-suggestion';
            const savings = (typeof s.estimatedMonthlySavings === 'number' && s.estimatedMonthlySavings > 0)
                ? '<span class="ai-savings">save ~' + fmtMoney(s.estimatedMonthlySavings, currency) + '/mo</span>'
                : '';
            const fileTag = s.sourceFile
                ? '<div class="ai-file-tag">📄 ' + escapeHtml(s.sourceFile) + '</div>'
                : '';
            card.innerHTML =
                '<div class="ai-suggestion-head">' +
                    '<span class="ai-resource">' + escapeHtml(s.resource || 'General') + '</span>' +
                    '<span class="ai-category">' + escapeHtml(s.category || 'other') + '</span>' +
                    savings +
                '</div>' +
                fileTag +
                '<p class="ai-text">' + escapeHtml(s.suggestion || '') + '</p>';
            wrap.appendChild(card);
        });
    }

    const ACTION_LABELS = { scale_up: 'Scale up', scale_down: 'Scale down', keep: 'Keep as-is' };

    function renderScalingResults(payload) {
        document.getElementById('scaling-provider-badge').textContent = AI_PROVIDER_LABELS[payload.provider] || '';
        const wrap = document.getElementById('scaling-results');
        wrap.innerHTML = '';
        const list = (payload.suggestions || []).filter((s) => s.action !== 'keep' || s.reasoning);
        if (list.length === 0) {
            wrap.innerHTML = '<p class="ai-none">No sizing mismatches found for the load you described.</p>';
            return;
        }
        list.forEach((s) => {
            const card = document.createElement('div');
            card.className = 'ai-suggestion';
            const change = s.suggestedChange
                ? '<span class="scaling-change">' + escapeHtml(s.suggestedChange) + '</span>'
                : '';
            const fileTag = s.sourceFile
                ? '<div class="ai-file-tag">📄 ' + escapeHtml(s.sourceFile) + '</div>'
                : '';
            card.innerHTML =
                '<div class="ai-suggestion-head">' +
                    '<span class="ai-resource">' + escapeHtml(s.resource || 'General') + '</span>' +
                    '<span class="action-badge action-' + (s.action || 'keep') + '">' + (ACTION_LABELS[s.action] || 'Keep as-is') + '</span>' +
                    change +
                '</div>' +
                fileTag +
                '<p class="ai-text">' + escapeHtml(s.reasoning || '') + '</p>';
            wrap.appendChild(card);
        });
    }

    function renderCapacitySummary(data) {
        const el = document.getElementById('capacity-summary');
        const c = data.capacityConfig;
        if (!c || Object.keys(c).length === 0) {
            el.style.display = 'none';
            return;
        }
        const parts = [];
        if (c.expected_users != null) parts.push(c.expected_users.toLocaleString() + ' users');
        if (c.requests_per_day != null) parts.push(c.requests_per_day.toLocaleString() + ' req/day');
        if (c.peak_requests_per_second != null) parts.push(c.peak_requests_per_second + ' req/s peak');
        if (c.growth_rate_percent != null) parts.push('+' + c.growth_rate_percent + '%/mo growth');
        el.textContent = parts.length ? parts.join(' · ') : '';
        el.style.display = parts.length ? 'block' : 'none';
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    document.getElementById('ask-ai-btn').addEventListener('click', () => {
        vscode.postMessage({ type: 'askAi' });
    });

    document.getElementById('ask-scaling-btn').addEventListener('click', () => {
        vscode.postMessage({ type: 'askScaling' });
    });

    document.getElementById('edit-capacity-btn').addEventListener('click', () => {
        vscode.postMessage({ type: 'editCapacity' });
    });

    window.addEventListener('message', (event) => {
        const msg = event.data;
        if (msg && msg.type === 'data') render(msg.payload);
        else if (msg && msg.type === 'aiLoading') setCardState('ai', 'loading', msg.payload, renderAiResults);
        else if (msg && msg.type === 'aiSuggestions') {
            setCardState('ai', msg.payload && msg.payload.error ? 'error' : 'results', msg.payload, renderAiResults);
        } else if (msg && msg.type === 'scalingLoading') setCardState('scaling', 'loading', msg.payload, renderScalingResults);
        else if (msg && msg.type === 'scalingSuggestions') {
            setCardState('scaling', msg.payload && msg.payload.error ? 'error' : 'results', msg.payload, renderScalingResults);
        } else if (msg && msg.type === 'scanning') {
            const scanning = msg.payload && msg.payload.loading;
            document.getElementById('updated-at').textContent = scanning ? 'Scanning workspace…' : document.getElementById('updated-at').textContent;
            document.querySelectorAll('.scope-btn').forEach((btn) => { btn.disabled = !!scanning; });
        }
    });

    document.getElementById('refresh-btn').addEventListener('click', () => {
        vscode.postMessage({ type: 'refresh' });
    });

    document.getElementById('export-btn').addEventListener('click', () => {
        vscode.postMessage({ type: 'exportReport' });
    });

    vscode.postMessage({ type: 'ready' });
})();
`;

module.exports = CostDashboardPanel;
