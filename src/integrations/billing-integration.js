const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Deliberately no `require('vscode')` here — like module-resolver.js, this
// is plain Node so it can be tested standalone with a fake command runner.

/**
 * Pulls ACTUAL cloud spend (not an estimate) from each provider's own
 * billing API, through the provider's CLI so it reuses whatever credentials
 * the user is already signed in with — no keys are stored by the extension:
 *
 * - AWS:   Cost Explorer via `aws ce get-cost-and-usage`
 *          (note: AWS bills $0.01 per Cost Explorer API request)
 * - Azure: Cost Management Query API via `az rest` (uses `az login`)
 * - GCP:   the Cloud Billing BigQuery export via `bq query` — GCP has no
 *          direct "cost so far" API, so a billing export table is required
 *
 * Each fetch returns last full calendar month + month-to-date, grouped by
 * service, in one normalized shape:
 *   { provider, period, start, end, total, currency, services: [{ name, cost }] }
 */

const PROVIDER_LABELS = { aws: 'AWS', azure: 'Azure', gcp: 'Google Cloud' };
const BQ_TABLE_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_]+\.[A-Za-z0-9_$-]+$/;

function isoDate(date) {
    return date.toISOString().slice(0, 10);
}

/**
 * @param {Date} [now]
 * @returns {{ lastMonth: {start, end, label, invoiceMonth}, monthToDate: {start, end, label, invoiceMonth},
 *   daysElapsed: number, daysInMonth: number }}
 *   `end` is exclusive (first day after the period), matching Cost Explorer.
 */
function getBillingPeriods(now = new Date()) {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const startThis = new Date(Date.UTC(y, m, 1));
    const startPrev = new Date(Date.UTC(y, m - 1, 1));
    const tomorrow = new Date(Date.UTC(y, m, now.getUTCDate() + 1));
    const invoiceMonth = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const monthName = (d) => d.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

    return {
        lastMonth: { start: isoDate(startPrev), end: isoDate(startThis), label: monthName(startPrev), invoiceMonth: invoiceMonth(startPrev) },
        monthToDate: { start: isoDate(startThis), end: isoDate(tomorrow), label: `${monthName(startThis)} (to date)`, invoiceMonth: invoiceMonth(startThis) },
        daysElapsed: now.getUTCDate(),
        daysInMonth: new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
    };
}

/**
 * Default command runner: spawns a CLI without a shell on POSIX. On Windows
 * the `az`/`bq` launchers are .cmd files, which Node can only start through a
 * shell, so arguments are quoted for cmd.exe there — callers never pass
 * user-controlled text as arguments (JSON bodies go via a temp file, SQL via
 * stdin, and the BigQuery table name is validated against BQ_TABLE_PATTERN).
 *
 * @returns {Promise<string>} stdout
 */
function runCommand(command, args, { input, timeoutMs = 60000 } = {}) {
    return new Promise((resolve, reject) => {
        const isWindows = process.platform === 'win32';
        // cmd.exe also splits batch-file arguments on = , ; so quote those too.
        const child = isWindows
            ? spawn([command, ...args.map((a) => (/[\s"=,;&|<>^()]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))].join(' '),
                { shell: true, windowsHide: true })
            : spawn(command, args, { windowsHide: true });

        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error(`${command} timed out after ${timeoutMs / 1000}s`));
        }, timeoutMs);

        child.stdout.on('data', (d) => { stdout += d; });
        child.stderr.on('data', (d) => { stderr += d; });
        child.on('error', (err) => {
            clearTimeout(timer);
            reject(err.code === 'ENOENT' ? new Error(`\`${command}\` CLI not found on PATH`) : err);
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0) {
                resolve(stdout);
            } else if (isWindows && /is not recognized as an internal or external command/.test(stderr)) {
                reject(new Error(`\`${command}\` CLI not found on PATH`));
            } else {
                reject(new Error(`${command} exited with code ${code}: ${(stderr || stdout).trim().slice(0, 400)}`));
            }
        });

        if (input !== undefined) child.stdin.end(input);
    });
}

// Rounds to cents and normalizes -0 (credits netting usage to zero would
// otherwise print as "-0.00").
function roundCents(n) {
    return Math.round(n * 100) / 100 + 0;
}

function summarize(provider, period, services, currency) {
    const sorted = services.filter((s) => s.cost !== 0).sort((a, b) => b.cost - a.cost);
    return {
        provider,
        period: period.label,
        start: period.start,
        end: period.end,
        total: roundCents(sorted.reduce((sum, s) => sum + s.cost, 0)),
        currency: currency || 'USD',
        services: sorted
    };
}

// ---- AWS ----------------------------------------------------------------

function parseAwsCostExplorer(json, provider = 'aws', period = {}) {
    const totals = new Map();
    let currency = 'USD';
    for (const result of json?.ResultsByTime || []) {
        for (const group of result.Groups || []) {
            const name = group.Keys?.[0] || 'Unknown';
            const metric = group.Metrics?.UnblendedCost;
            if (!metric) continue;
            currency = metric.Unit || currency;
            totals.set(name, (totals.get(name) || 0) + Number(metric.Amount || 0));
        }
    }
    return summarize(provider, period, [...totals].map(([name, cost]) => ({ name, cost })), currency);
}

async function fetchAws(period, { profile, run = runCommand } = {}) {
    const args = [
        'ce', 'get-cost-and-usage',
        '--time-period', `Start=${period.start},End=${period.end}`,
        '--granularity', 'MONTHLY',
        '--metrics', 'UnblendedCost',
        '--group-by', 'Type=DIMENSION,Key=SERVICE',
        '--output', 'json'
    ];
    if (profile) args.push('--profile', profile);
    const stdout = await run('aws', args);
    return parseAwsCostExplorer(JSON.parse(stdout), 'aws', period);
}

// ---- Azure --------------------------------------------------------------

function parseAzureCostQuery(json, period = {}) {
    const columns = (json?.properties?.columns || []).map((c) => c.name);
    const costIdx = columns.findIndex((c) => c === 'Cost' || c === 'PreTaxCost' || c === 'totalCost');
    const serviceIdx = columns.indexOf('ServiceName');
    const currencyIdx = columns.indexOf('Currency');
    if (costIdx === -1) {
        throw new Error('Unexpected Azure Cost Management response: no cost column.');
    }

    const totals = new Map();
    let currency = 'USD';
    for (const row of json.properties.rows || []) {
        const name = serviceIdx === -1 ? 'All services' : (row[serviceIdx] || 'Unknown');
        totals.set(name, (totals.get(name) || 0) + Number(row[costIdx] || 0));
        if (currencyIdx !== -1 && row[currencyIdx]) currency = row[currencyIdx];
    }
    return summarize('azure', period, [...totals].map(([name, cost]) => ({ name, cost })), currency);
}

function buildAzureQueryBody(period) {
    // timePeriod.to is inclusive, so stop one second before the exclusive end.
    const to = new Date(`${period.end}T00:00:00Z`);
    to.setUTCSeconds(-1);
    return {
        type: 'ActualCost',
        timeframe: 'Custom',
        timePeriod: { from: `${period.start}T00:00:00Z`, to: to.toISOString().replace('.000Z', 'Z') },
        dataset: {
            granularity: 'None',
            aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
            grouping: [{ type: 'Dimension', name: 'ServiceName' }]
        }
    };
}

async function fetchAzure(period, { subscriptionId, run = runCommand } = {}) {
    let subId = subscriptionId;
    if (!subId) {
        subId = (await run('az', ['account', 'show', '--query', 'id', '--output', 'tsv'])).trim();
    }
    if (!/^[0-9a-fA-F-]{36}$/.test(subId)) {
        throw new Error(`Invalid Azure subscription id: ${subId || '(empty)'}`);
    }

    const bodyFile = path.join(os.tmpdir(), `terraform-cost-azure-query-${process.pid}-${Date.now()}.json`);
    await fs.promises.writeFile(bodyFile, JSON.stringify(buildAzureQueryBody(period)), 'utf8');
    try {
        const stdout = await run('az', [
            'rest', '--method', 'post',
            '--url', `https://management.azure.com/subscriptions/${subId}/providers/Microsoft.CostManagement/query?api-version=2023-03-01`,
            '--body', `@${bodyFile}`,
            '--headers', 'Content-Type=application/json',
            '--output', 'json'
        ]);
        return parseAzureCostQuery(JSON.parse(stdout), period);
    } finally {
        fs.promises.unlink(bodyFile).catch(() => {});
    }
}

// ---- GCP ----------------------------------------------------------------

function buildGcpBillingQuery(table, invoiceMonth) {
    if (!BQ_TABLE_PATTERN.test(table)) {
        throw new Error(`Invalid BigQuery table "${table}" — expected project.dataset.table`);
    }
    if (!/^\d{6}$/.test(invoiceMonth)) {
        throw new Error(`Invalid invoice month "${invoiceMonth}"`);
    }
    return [
        'SELECT service.description AS service,',
        '  SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS cost,',
        '  ANY_VALUE(currency) AS currency',
        `FROM \`${table}\``,
        `WHERE invoice.month = '${invoiceMonth}'`,
        'GROUP BY service',
        'ORDER BY cost DESC'
    ].join('\n');
}

function parseGcpBillingRows(rows, period = {}) {
    let currency = 'USD';
    const services = (rows || []).map((r) => {
        if (r.currency) currency = r.currency;
        return { name: r.service || 'Unknown', cost: Number(r.cost || 0) };
    });
    return summarize('gcp', period, services, currency);
}

async function fetchGcp(period, { billingExportTable, run = runCommand } = {}) {
    if (!billingExportTable) {
        throw new Error('No BigQuery billing export table configured (terraformCost.billing.gcpBillingExportTable).');
    }
    const query = buildGcpBillingQuery(billingExportTable, period.invoiceMonth);
    // `bq query` reads the SQL from stdin when no query argument is given.
    const stdout = await run('bq', ['query', '--format=json', '--nouse_legacy_sql', '--max_rows=1000'], { input: query });
    const trimmed = stdout.trim();
    return parseGcpBillingRows(trimmed ? JSON.parse(trimmed) : [], period);
}

// ---- Orchestration --------------------------------------------------------

/**
 * Fetches last month + month-to-date for each requested provider. A failure
 * for one provider never hides the others' results.
 *
 * @param {Array<'aws'|'azure'|'gcp'>} providers
 * @param {object} [options] - { awsProfile, azureSubscriptionId, gcpBillingExportTable, now, run }
 * @returns {Promise<Array<{ provider, lastMonth?, monthToDate?, error? }>>}
 */
async function fetchActualSpend(providers, options = {}) {
    const periods = getBillingPeriods(options.now);
    const run = options.run || runCommand;

    const fetchers = {
        aws: (p) => fetchAws(p, { profile: options.awsProfile, run }),
        azure: (p) => fetchAzure(p, { subscriptionId: options.azureSubscriptionId, run }),
        gcp: (p) => fetchGcp(p, { billingExportTable: options.gcpBillingExportTable, run })
    };

    const results = [];
    for (const provider of providers) {
        const fetcher = fetchers[provider];
        if (!fetcher) continue;
        try {
            const lastMonth = await fetcher(periods.lastMonth);
            const monthToDate = await fetcher(periods.monthToDate);
            results.push({ provider, lastMonth, monthToDate });
        } catch (err) {
            results.push({ provider, error: err.message });
        }
    }
    return { periods, results };
}

/**
 * Renders a Markdown comparison of estimated vs. actual spend.
 *
 * @param {{ periods, results }} actual - fetchActualSpend output
 * @param {{ byProvider: Array<{provider, monthly}>, totals: {monthly} }|null} estimate
 * @param {{ currency: string, projectName: string, generatedAt?: Date }} meta
 */
function buildComparisonMarkdown(actual, estimate, meta) {
    const { periods, results } = actual;
    const money = (n, cur) => `${cur || meta.currency} ${roundCents(Number(n)).toFixed(2)}`;
    const estimateFor = (provider) => estimate?.byProvider?.find((p) => p.provider === provider)?.monthly;
    const pct = (a, b) => (b ? `${a >= b ? '+' : ''}${(((a - b) / b) * 100).toFixed(0)}%` : '—');

    const lines = [
        `# Estimated vs. actual cloud spend — ${meta.projectName}`,
        '',
        `_Generated ${(meta.generatedAt || new Date()).toISOString().replace('T', ' ').slice(0, 16)} UTC. ` +
        'Estimates come from this workspace\'s Terraform files; actual spend comes from each provider\'s billing API ' +
        'and covers **everything billed to that account/subscription/billing export**, including resources not managed by this Terraform._',
        '',
        `| Provider | Terraform estimate (/mo) | ${periods.lastMonth.label} actual | ${periods.monthToDate.label} | Month projection | Projection vs. estimate |`,
        '|---|---:|---:|---:|---:|---:|'
    ];

    for (const r of results) {
        const label = PROVIDER_LABELS[r.provider] || r.provider;
        const est = estimateFor(r.provider);
        const estText = est !== undefined ? money(est) : '—';
        if (r.error) {
            lines.push(`| ${label} | ${estText} | ⚠️ ${r.error.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')} | | | |`);
            continue;
        }
        const projection = periods.daysElapsed > 0
            ? r.monthToDate.total / periods.daysElapsed * periods.daysInMonth
            : r.monthToDate.total;
        lines.push(`| ${label} | ${estText} | ${money(r.lastMonth.total, r.lastMonth.currency)} | ` +
            `${money(r.monthToDate.total, r.monthToDate.currency)} | ${money(projection, r.monthToDate.currency)} | ` +
            `${est !== undefined ? pct(projection, est) : '—'} |`);
    }

    for (const r of results) {
        if (r.error || r.lastMonth.services.length === 0) continue;
        lines.push('', `## ${PROVIDER_LABELS[r.provider] || r.provider} — top services, ${r.lastMonth.period}`, '',
            '| Service | Cost |', '|---|---:|');
        for (const s of r.lastMonth.services.slice(0, 10)) {
            lines.push(`| ${s.name.replace(/\|/g, '\\|')} | ${money(s.cost, r.lastMonth.currency)} |`);
        }
    }

    lines.push('', '> Month projection = month-to-date spend ÷ days elapsed × days in month — a straight-line extrapolation.');
    return lines.join('\n') + '\n';
}

module.exports = {
    fetchActualSpend,
    buildComparisonMarkdown,
    getBillingPeriods,
    parseAwsCostExplorer,
    parseAzureCostQuery,
    buildAzureQueryBody,
    buildGcpBillingQuery,
    parseGcpBillingRows,
    runCommand
};
