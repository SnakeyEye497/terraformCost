const ExcelJS = require('exceljs');

/**
 * Builds a multi-sheet .xlsx cost report from already-computed data — this
 * module has no knowledge of vscode, the parser, or the calculator, it just
 * lays out whatever it's handed. Sheets included depend on what's present:
 * Summary and Resources always; By Provider/By Type always (computed fresh
 * here from the full resource list, not the dashboard's top-5-truncated
 * versions); By File only for workspace-scope reports; Forecast always;
 * Budget/Capacity/AI Suggestions/Scaling Suggestions only when that data
 * was actually available at export time.
 *
 * @param {object} data
 * @param {string} data.projectName
 * @param {'file'|'workspace'} data.scope
 * @param {string} data.scopeLabel - e.g. a filename, or "7 files"
 * @param {Date} data.generatedAt
 * @param {string} data.currency
 * @param {{hourly:number, monthly:number, yearly:number}} data.totals
 * @param {Array<{type:string, name:string, provider:string, sourceFile?:string, monthly:number, yearly:number, breakdown?:string[]}>} data.resources
 * @param {{months:number[], flat:number[], growth:number[], growthRatePct:number}} [data.forecast]
 * @param {object} [data.budget] - {limit_1, limit_2, limit_3, final_limit, level, current}
 * @param {object} [data.capacityConfig] - {expected_users, requests_per_day, peak_requests_per_second, growth_rate_percent}
 * @param {{provider:string, model:string, suggestions:Array}} [data.aiSuggestions]
 * @param {{provider:string, model:string, suggestions:Array}} [data.scalingSuggestions]
 * @returns {ExcelJS.Workbook}
 */
function buildWorkbook(data) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Matali — Terraform Cost Calculator';
    workbook.created = data.generatedAt;

    const cur = data.currency || 'USD';
    const money = moneyFormat(cur);

    addSummarySheet(workbook, data, money);
    addResourcesSheet(workbook, data, money);
    addByProviderSheet(workbook, data, money);
    addByTypeSheet(workbook, data, money);
    if (data.scope === 'workspace' && data.byFile) {
        addByFileSheet(workbook, data, money);
    }
    if (data.forecast) {
        addForecastSheet(workbook, data, money);
    }
    if (data.budget) {
        addBudgetSheet(workbook, data, money);
    }
    if (data.capacityConfig && Object.keys(data.capacityConfig).length > 0) {
        addCapacitySheet(workbook, data);
    }
    if (data.costHistory && data.costHistory.length > 0) {
        addCostHistorySheet(workbook, data, money);
    }
    if (data.aiSuggestions) {
        addAiSuggestionsSheet(workbook, data, money);
    }
    if (data.scalingSuggestions) {
        addScalingSuggestionsSheet(workbook, data);
    }

    return workbook;
}

// ---------------------------------------------------------------------------
// Sheet builders
// ---------------------------------------------------------------------------

function addSummarySheet(workbook, data, money) {
    const sheet = workbook.addWorksheet('Summary');
    sheet.columns = [{ width: 26 }, { width: 34 }];

    titleRow(sheet, `Terraform Cost Report — ${data.projectName}`);
    sheet.addRow([]);
    const scopeText = data.scope === 'workspace' ? `Whole workspace (${data.scopeLabel})`
        : data.scope === 'plan' ? `Terraform plan (${data.scopeLabel})`
        : `Single file (${data.scopeLabel})`;
    kvRow(sheet, 'Scope', scopeText);
    kvRow(sheet, 'Generated', formatDate(data.generatedAt));
    kvRow(sheet, 'Currency', data.currency);
    sheet.addRow([]);

    sectionHeader(sheet, 'Cost totals');
    kvMoneyRow(sheet, 'Monthly', data.totals.monthly, money);
    kvMoneyRow(sheet, 'Yearly', data.totals.yearly, money);
    kvMoneyRow(sheet, 'Hourly', data.totals.hourly, money);
    kvRow(sheet, 'Resources counted', data.resources.length);
    if (data.scope === 'workspace') {
        kvRow(sheet, 'Files scanned', data.fileCount);
    }

    if (data.budget) {
        sheet.addRow([]);
        sectionHeader(sheet, 'Budget status');
        const b = data.budget;
        const statusText = b.level >= 4 ? 'OVER FINAL LIMIT' : b.level >= 1 ? `Threshold ${b.level} reached` : 'On track';
        kvRow(sheet, 'Status', statusText);
        if (b.limit_1) kvMoneyRow(sheet, 'Limit 1', b.limit_1, money);
        if (b.limit_2) kvMoneyRow(sheet, 'Limit 2', b.limit_2, money);
        if (b.limit_3) kvMoneyRow(sheet, 'Limit 3', b.limit_3, money);
        if (b.final_limit) kvMoneyRow(sheet, 'Final limit', b.final_limit, money);
    }

    if (data.capacityConfig && Object.keys(data.capacityConfig).length > 0) {
        sheet.addRow([]);
        sectionHeader(sheet, 'Expected load (terraform.capacity.json)');
        const c = data.capacityConfig;
        if (c.expected_users != null) kvRow(sheet, 'Expected users', c.expected_users);
        if (c.requests_per_day != null) kvRow(sheet, 'Requests / day', c.requests_per_day);
        if (c.peak_requests_per_second != null) kvRow(sheet, 'Peak requests / second', c.peak_requests_per_second);
        if (c.growth_rate_percent != null) kvRow(sheet, 'Expected growth', `${c.growth_rate_percent}%/month`);
    }

    sheet.addRow([]);
    sheet.addRow(['Generated by Matali — Terraform Cost Calculator']).font = { italic: true, color: { argb: 'FF888888' } };
}

function addResourcesSheet(workbook, data) {
    const sheet = workbook.addWorksheet('Resources');
    // Whether to show a Source File column at all — driven by whether any
    // resource actually has one, not a hardcoded scope name, so it adapts
    // automatically to workspace scope (file paths) and plan scope (module
    // addresses) alike, and stays correct if a new scope is added later.
    const hasSourceFiles = data.resources.some((r) => r.sourceFile);
    const cols = [
        { header: '#', key: 'idx', width: 5 },
        { header: 'Resource Type', key: 'type', width: 30 },
        { header: 'Name', key: 'name', width: 26 },
        { header: 'Provider', key: 'provider', width: 12 }
    ];
    if (hasSourceFiles) {
        cols.push({ header: 'Source File', key: 'sourceFile', width: 34 });
    }
    cols.push(
        { header: 'Monthly Cost', key: 'monthly', width: 16 },
        { header: 'Yearly Cost', key: 'yearly', width: 16 },
        { header: 'Notes', key: 'notes', width: 50 }
    );
    sheet.columns = cols;
    styleHeaderRow(sheet);

    const sorted = [...data.resources].sort((a, b) => (b.monthly || 0) - (a.monthly || 0));
    sorted.forEach((r, i) => {
        const row = {
            idx: i + 1,
            type: r.type,
            name: r.name,
            provider: providerLabel(r.provider),
            monthly: r.monthly || 0,
            yearly: r.yearly != null ? r.yearly : (r.monthly || 0) * 12,
            notes: (r.breakdown || []).join('; ')
        };
        if (hasSourceFiles) row.sourceFile = r.sourceFile || '';
        sheet.addRow(row);
    });

    applyMoneyColumn(sheet, 'monthly', data.currency);
    applyMoneyColumn(sheet, 'yearly', data.currency);
    finishTable(sheet, sorted.length);
}

function addByProviderSheet(workbook, data) {
    const sheet = workbook.addWorksheet('By Provider');
    sheet.columns = [
        { header: 'Provider', key: 'provider', width: 18 },
        { header: 'Resources', key: 'count', width: 12 },
        { header: 'Monthly Cost', key: 'monthly', width: 16 },
        { header: '% of Total', key: 'pct', width: 12 }
    ];
    styleHeaderRow(sheet);

    const grouped = groupBy(data.resources, (r) => r.provider || 'unknown');
    const total = data.totals.monthly || 1;
    const rows = Object.entries(grouped)
        .map(([provider, items]) => ({
            provider: providerLabel(provider),
            count: items.length,
            monthly: sumMonthly(items),
            pct: sumMonthly(items) / total
        }))
        .sort((a, b) => b.monthly - a.monthly);
    rows.forEach((r) => sheet.addRow(r));

    applyMoneyColumn(sheet, 'monthly', data.currency);
    applyPercentColumn(sheet, 'pct');
    finishTable(sheet, rows.length);
}

function addByTypeSheet(workbook, data) {
    const sheet = workbook.addWorksheet('By Resource Type');
    sheet.columns = [
        { header: 'Resource Type', key: 'type', width: 34 },
        { header: 'Count', key: 'count', width: 10 },
        { header: 'Monthly Cost', key: 'monthly', width: 16 },
        { header: '% of Total', key: 'pct', width: 12 }
    ];
    styleHeaderRow(sheet);

    const grouped = groupBy(data.resources, (r) => r.type || 'unknown');
    const total = data.totals.monthly || 1;
    const rows = Object.entries(grouped)
        .map(([type, items]) => ({
            type,
            count: items.length,
            monthly: sumMonthly(items),
            pct: sumMonthly(items) / total
        }))
        .sort((a, b) => b.monthly - a.monthly);
    rows.forEach((r) => sheet.addRow(r));

    applyMoneyColumn(sheet, 'monthly', data.currency);
    applyPercentColumn(sheet, 'pct');
    finishTable(sheet, rows.length);
}

function addByFileSheet(workbook, data) {
    const sheet = workbook.addWorksheet('By File-Module');
    sheet.columns = [
        { header: 'File', key: 'file', width: 44 },
        { header: 'Resources', key: 'count', width: 12 },
        { header: 'Monthly Cost', key: 'monthly', width: 16 },
        { header: '% of Total', key: 'pct', width: 12 }
    ];
    styleHeaderRow(sheet);

    const total = data.totals.monthly || 1;
    const rows = [...data.byFile]
        .sort((a, b) => b.monthly - a.monthly)
        .map((f) => ({ file: f.file, count: f.count, monthly: f.monthly, pct: f.monthly / total }));
    rows.forEach((r) => sheet.addRow(r));

    applyMoneyColumn(sheet, 'monthly', data.currency);
    applyPercentColumn(sheet, 'pct');
    finishTable(sheet, rows.length);
}

function addForecastSheet(workbook, data) {
    const sheet = workbook.addWorksheet('12-Month Forecast');
    sheet.columns = [
        { header: 'Month', key: 'month', width: 10 },
        { header: 'Flat Scenario (Cumulative)', key: 'flat', width: 26 },
        { header: `Growth Scenario ~${data.forecast.growthRatePct}%/mo (Cumulative)`, key: 'growth', width: 32 }
    ];
    styleHeaderRow(sheet);

    data.forecast.months.forEach((m, i) => {
        sheet.addRow({ month: m, flat: data.forecast.flat[i], growth: data.forecast.growth[i] });
    });

    applyMoneyColumn(sheet, 'flat', data.currency);
    applyMoneyColumn(sheet, 'growth', data.currency);
    finishTable(sheet, data.forecast.months.length);
}

function addBudgetSheet(workbook, data, money) {
    const sheet = workbook.addWorksheet('Budget');
    sheet.columns = [{ width: 24 }, { width: 20 }];
    const b = data.budget;

    titleRow(sheet, 'Budget status');
    sheet.addRow([]);
    kvMoneyRow(sheet, 'Current spend', b.current, money);
    if (b.limit_1) kvMoneyRow(sheet, 'Limit 1', b.limit_1, money);
    if (b.limit_2) kvMoneyRow(sheet, 'Limit 2', b.limit_2, money);
    if (b.limit_3) kvMoneyRow(sheet, 'Limit 3', b.limit_3, money);
    if (b.final_limit) kvMoneyRow(sheet, 'Final limit', b.final_limit, money);
    kvRow(sheet, 'Threshold level reached', b.level >= 4 ? 'Final limit exceeded' : b.level > 0 ? `Level ${b.level}` : 'None — on track');
}

function addCapacitySheet(workbook, data) {
    const sheet = workbook.addWorksheet('Capacity Inputs');
    sheet.columns = [{ width: 26 }, { width: 20 }];
    const c = data.capacityConfig;

    titleRow(sheet, 'Expected load (terraform.capacity.json)');
    sheet.addRow([]);
    if (c.expected_users != null) kvRow(sheet, 'Expected users', c.expected_users);
    if (c.requests_per_day != null) kvRow(sheet, 'Requests / day', c.requests_per_day);
    if (c.peak_requests_per_second != null) kvRow(sheet, 'Peak requests / second', c.peak_requests_per_second);
    if (c.growth_rate_percent != null) kvRow(sheet, 'Expected growth', `${c.growth_rate_percent}%/month`);
}

function addCostHistorySheet(workbook, data) {
    const sheet = workbook.addWorksheet('Cost History');
    sheet.columns = [
        { header: 'Date', key: 'date', width: 20 },
        { header: 'Scope', key: 'scope', width: 12 },
        { header: 'Label', key: 'label', width: 30 },
        { header: 'Monthly Cost', key: 'monthly', width: 16 },
        { header: 'Resources', key: 'resourceCount', width: 12 }
    ];
    styleHeaderRow(sheet);

    const sorted = [...data.costHistory].sort((a, b) => a.timestamp - b.timestamp);
    sorted.forEach((h) => {
        sheet.addRow({
            date: new Date(h.timestamp).toLocaleString(),
            scope: h.scope,
            label: h.label || '',
            monthly: h.totalMonthly || 0,
            resourceCount: h.resourceCount || 0
        });
    });

    applyMoneyColumn(sheet, 'monthly', data.currency);
    finishTable(sheet, sorted.length);
}

function addAiSuggestionsSheet(workbook, data) {
    const sheet = workbook.addWorksheet('AI Cost Suggestions');
    const hasSourceFiles = (data.aiSuggestions.suggestions || []).some((s) => s.sourceFile);
    const cols = [{ header: 'Resource', key: 'resource', width: 26 }];
    if (hasSourceFiles) cols.push({ header: 'Source File', key: 'sourceFile', width: 34 });
    cols.push(
        { header: 'Category', key: 'category', width: 18 },
        { header: 'Suggestion', key: 'suggestion', width: 70 },
        { header: 'Est. Monthly Savings', key: 'savings', width: 20 },
        { header: 'Confidence', key: 'confidence', width: 12 }
    );
    sheet.columns = cols;
    styleHeaderRow(sheet);
    sheet.getRow(1).getCell(1).note = `Generated by ${data.aiSuggestions.provider} (${data.aiSuggestions.model})`;

    (data.aiSuggestions.suggestions || []).forEach((s) => {
        const row = {
            resource: s.resource || 'General',
            category: s.category || 'other',
            suggestion: s.suggestion || '',
            savings: s.estimatedMonthlySavings != null ? s.estimatedMonthlySavings : '',
            confidence: s.confidence || ''
        };
        if (hasSourceFiles) row.sourceFile = s.sourceFile || '';
        sheet.addRow(row);
    });

    applyMoneyColumn(sheet, 'savings', data.currency);
    finishTable(sheet, (data.aiSuggestions.suggestions || []).length);
}

function addScalingSuggestionsSheet(workbook, data) {
    const sheet = workbook.addWorksheet('AI Scaling Suggestions');
    const hasSourceFiles = (data.scalingSuggestions.suggestions || []).some((s) => s.sourceFile);
    const cols = [{ header: 'Resource', key: 'resource', width: 26 }];
    if (hasSourceFiles) cols.push({ header: 'Source File', key: 'sourceFile', width: 34 });
    cols.push(
        { header: 'Action', key: 'action', width: 14 },
        { header: 'Suggested Change', key: 'change', width: 30 },
        { header: 'Reasoning', key: 'reasoning', width: 70 },
        { header: 'Confidence', key: 'confidence', width: 12 }
    );
    sheet.columns = cols;
    styleHeaderRow(sheet);
    sheet.getRow(1).getCell(1).note = `Generated by ${data.scalingSuggestions.provider} (${data.scalingSuggestions.model})`;

    (data.scalingSuggestions.suggestions || []).forEach((s) => {
        const row = {
            resource: s.resource || 'General',
            action: (s.action || 'keep').replace('_', ' '),
            change: s.suggestedChange || '',
            reasoning: s.reasoning || '',
            confidence: s.confidence || ''
        };
        if (hasSourceFiles) row.sourceFile = s.sourceFile || '';
        sheet.addRow(row);
    });

    finishTable(sheet, (data.scalingSuggestions.suggestions || []).length);
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function titleRow(sheet, text) {
    const row = sheet.addRow([text]);
    row.font = { bold: true, size: 14 };
    sheet.mergeCells(row.number, 1, row.number, sheet.columns.length || 2);
}

function sectionHeader(sheet, text) {
    const row = sheet.addRow([text]);
    row.font = { bold: true, size: 11, color: { argb: 'FF2A78D6' } };
}

function kvRow(sheet, label, value) {
    const row = sheet.addRow([label, value]);
    row.getCell(1).font = { bold: true };
}

function kvMoneyRow(sheet, label, value, moneyFmt) {
    const row = sheet.addRow([label, value]);
    row.getCell(1).font = { bold: true };
    row.getCell(2).numFmt = moneyFmt;
}

function styleHeaderRow(sheet) {
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2A78D6' } };
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

function finishTable(sheet, rowCount) {
    if (rowCount > 0) {
        sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
    }
}

function applyMoneyColumn(sheet, key, currency) {
    const col = sheet.getColumn(key);
    col.numFmt = moneyFormat(currency);
}

function applyPercentColumn(sheet, key) {
    const col = sheet.getColumn(key);
    col.numFmt = '0.0%';
}

function moneyFormat(currency) {
    const symbols = { USD: '$', EUR: '€', GBP: '£', JPY: '¥' };
    const sym = symbols[currency] || '$';
    return `"${sym}"#,##0.00`;
}

function groupBy(items, keyFn) {
    const out = {};
    for (const item of items) {
        const k = keyFn(item);
        (out[k] = out[k] || []).push(item);
    }
    return out;
}

function sumMonthly(items) {
    return items.reduce((s, i) => s + (i.monthly || 0), 0);
}

function providerLabel(p) {
    return { aws: 'AWS', gcp: 'Google Cloud', azure: 'Microsoft Azure' }[p] || p || 'Unknown';
}

function formatDate(date) {
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleString();
}

module.exports = { buildWorkbook };
