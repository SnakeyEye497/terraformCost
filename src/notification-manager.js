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

const LEVEL_COLORS = {
    1: '#eda100', // yellow
    2: '#eda100',
    3: '#eb6834', // orange
    4: '#d03b3b' // red — final limit
};

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

function buildTeamsPayload({ level, current, limit, currency, projectName, fileName }) {
    const emoji = level >= 4 ? '🔴' : '🟡';
    const fmt = (n) => `${currency} ${n.toFixed(2)}`;
    return {
        '@type': 'MessageCard',
        '@context': 'http://schema.org/extensions',
        summary: 'Terraform Budget Alert',
        themeColor: (LEVEL_COLORS[level] || LEVEL_COLORS[1]).replace('#', ''),
        title: `${emoji} Terraform Budget Alert`,
        sections: [
            {
                facts: [
                    { name: 'Project', value: projectName },
                    { name: 'File', value: fileName },
                    { name: 'Current spend', value: `${fmt(current)}/mo` },
                    { name: 'Threshold', value: levelLabel(level, currency, limit) }
                ],
                text: 'via Matali — Terraform Cost Calculator'
            }
        ]
    };
}

module.exports = NotificationManager;
