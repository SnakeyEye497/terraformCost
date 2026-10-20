/**
 * Sends a budget-breach alert to a Slack or Microsoft Teams incoming
 * webhook when a threshold in terraform.budget.json is crossed. Piggybacks
 * on the exact same "only notify when crossing into a higher level" logic
 * checkBudgetAndWarn() already uses for its VS Code popups — this fires at
 * the identical point, not on a separate schedule, so there's exactly one
 * source of truth for "did we already tell someone about this."
 *
 * The webhook URL is stored via VS Code's SecretStorage (context.secrets),
 * same reasoning as the AI provider API keys: it's a credential (anyone
 * with it can post to your channel), not display config, so it doesn't
 * belong in settings.json.
 */

const SECRET_KEY = 'terraformCost.notifications.webhookUrl';

class NotificationManager {
    /**
     * @param {import('vscode').ExtensionContext} context
     */
    constructor(context) {
        this.context = context;
    }

    async getWebhookUrl() {
        return this.context.secrets.get(SECRET_KEY);
    }

    async setWebhookUrl(url) {
        await this.context.secrets.store(SECRET_KEY, url);
    }

    async clearWebhookUrl() {
        await this.context.secrets.delete(SECRET_KEY);
    }

    /**
     * @param {object} opts
     * @param {'slack'|'teams'} opts.provider
     * @param {string} opts.webhookUrl
     * @param {number} opts.level - 1-3 (threshold) or 4 (final limit)
     * @param {number} opts.current - current monthly spend
     * @param {number} opts.limit - the limit that was crossed
     * @param {string} opts.currency
     * @param {string} opts.projectName
     * @param {string} opts.fileName
     */
    async sendBudgetAlert({ provider, webhookUrl, level, current, limit, currency, projectName, fileName }) {
        if (typeof fetch !== 'function') {
            throw new Error('This VS Code build has no global fetch available (requires Node 18+).');
        }
        if (!webhookUrl) {
            throw new Error('No webhook URL configured.');
        }

        const payload = provider === 'teams'
            ? buildTeamsPayload({ level, current, limit, currency, projectName, fileName })
            : buildSlackPayload({ level, current, limit, currency, projectName, fileName });

        const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Webhook returned ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
        }
    }
}

function levelLabel(level, currency, limit) {
    const fmt = (n) => `${currency} ${n.toFixed(2)}`;
    return level >= 4
        ? `Final limit exceeded (${fmt(limit)}/mo)`
        : `Budget threshold ${level} reached (${fmt(limit)}/mo)`;
}

function buildSlackPayload({ level, current, limit, currency, projectName, fileName }) {
    const emoji = level >= 4 ? '🔴' : '🟡';
    const fmt = (n) => `${currency} ${n.toFixed(2)}`;
    return {
        text: `${emoji} *Terraform Budget Alert*\n` +
            `Project: *${projectName}*\n` +
            `File: \`${fileName}\`\n` +
            `Current spend: *${fmt(current)}/mo*\n` +
            `Threshold: ${levelLabel(level, currency, limit)}\n\n` +
            `_via Matali — Terraform Cost Calculator_`
    };
}

/**
 * Adaptive Card wrapped in a `message` envelope. This is the format Teams
 * Workflows ("When a Teams webhook request is received") requires, and the
 * remaining classic Incoming Webhook connectors accept it too — unlike the
 * legacy `MessageCard` format, which Workflows rejects.
 */
function buildTeamsPayload({ level, current, limit, currency, projectName, fileName }) {
    const emoji = level >= 4 ? '🔴' : '🟡';
    const fmt = (n) => `${currency} ${n.toFixed(2)}`;
    return {
        type: 'message',
        attachments: [
            {
                contentType: 'application/vnd.microsoft.card.adaptive',
                contentUrl: null,
                content: {
                    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
                    type: 'AdaptiveCard',
                    version: '1.4',
                    msteams: { width: 'Full' },
                    body: [
                        {
                            type: 'TextBlock',
                            text: `${emoji} Terraform Budget Alert`,
                            weight: 'Bolder',
                            size: 'Medium',
                            color: level >= 4 ? 'Attention' : 'Warning',
                            wrap: true
                        },
                        {
                            type: 'FactSet',
                            facts: [
                                { title: 'Project', value: projectName },
                                { title: 'File', value: fileName },
                                { title: 'Current spend', value: `${fmt(current)}/mo` },
                                { title: 'Threshold', value: levelLabel(level, currency, limit) }
                            ]
                        },
                        {
                            type: 'TextBlock',
                            text: 'via Matali — Terraform Cost Calculator',
                            isSubtle: true,
                            size: 'Small',
                            wrap: true
                        }
                    ]
                }
            }
        ]
    };
}

module.exports = NotificationManager;
module.exports.buildSlackPayload = buildSlackPayload;
module.exports.buildTeamsPayload = buildTeamsPayload;
