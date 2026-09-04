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

        this._panel.webview.html = this._getHtml(this._panel.webview);

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            (message) => {
                if ((message?.type === 'ready' || message?.type === 'refresh') && this._onRefreshRequest) {
                    this._onRefreshRequest();
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

    /** Push a new data snapshot into the webview. */
    update(data) {
        this._panel.webview.postMessage({ type: 'data', payload: data });
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
#forecast-tooltip {
    position: absolute; pointer-events: none; opacity: 0; transition: opacity .12s;
    background: var(--surface-1); border: 1px solid var(--border); border-radius: 8px;
    padding: 7px 10px; font-size: 11px; box-shadow: var(--card-shadow); white-space: nowrap; z-index: 5;
}
#forecast-tooltip .t-month { color: var(--text-muted); margin-bottom: 3px; }
#forecast-tooltip .t-row { display: flex; align-items: center; gap: 6px; }
#forecast-tooltip .t-dot { width: 8px; height: 8px; border-radius: 50%; }
.forecast-note { font-size: 11px; color: var(--text-muted); margin-top: 10px; }

.footer-note { text-align: center; font-size: 11px; color: var(--text-muted); margin-top: 28px; }

#dashboard-content { display: none; }
#dashboard-content.show { display: block; }
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
            <span class="updated-at" id="updated-at"></span>
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
                    <div id="forecast-tooltip"></div>
                </div>
                <div class="forecast-note">Illustrative projection from the current monthly total — not a guarantee of future spend.</div>
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

    // ---- table toggles -----------------------------------------------------
    document.querySelectorAll('.toggle-table').forEach((btn) => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.target;
            const isTable = target === 'type'
                ? document.getElementById('type-table').classList.contains('show')
                : document.getElementById('provider-table').classList.contains('show');
            if (target === 'type') {
                document.getElementById('type-table').classList.toggle('show', !isTable);
                document.getElementById('donut-visual').classList.toggle('hidden-by-table', !isTable);
                document.getElementById('donut-legend').classList.toggle('hidden-by-table', !isTable);
            } else {
                document.getElementById('provider-table').classList.toggle('show', !isTable);
                document.getElementById('provider-bars').classList.toggle('hidden-by-table', !isTable);
            }
            btn.textContent = isTable ? 'View as table' : 'View as chart';
        });
    });

    function render(data) {
        if (!data || data.empty) {
            showEmpty(true);
            current = null;
            return;
        }
        showEmpty(false);
        renderHero(data, current);
        renderBudget(data);
        renderDonut(data);
        renderProviders(data);
        renderForecast(data);
        document.getElementById('file-name').textContent = data.fileName || '';
        document.getElementById('updated-at').textContent = 'Updated ' + new Date(data.generatedAt).toLocaleTimeString();
        current = data;
    }

    window.addEventListener('message', (event) => {
        const msg = event.data;
        if (msg && msg.type === 'data') render(msg.payload);
    });

    document.getElementById('refresh-btn').addEventListener('click', () => {
        vscode.postMessage({ type: 'refresh' });
    });

    vscode.postMessage({ type: 'ready' });
})();
`;

module.exports = CostDashboardPanel;
