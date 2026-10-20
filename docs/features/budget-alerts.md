# Budget alert webhooks

[← Docs index](../README.md)

A budget threshold crossing (`terraform.budget.json`, see [Configuration](../configuration.md#optional-budgeting-terraformbudgetjson)) can post to a Slack or Microsoft Teams webhook, not just show the in-editor popup. This is useful when the team watching costs isn't all sitting in VS Code.

## Setting up a webhook

A webhook URL is a credential: anyone who has it can post to your channel. Paste it only into the VS Code prompt, never into chats, issues or commits. If one leaks, delete it and create a new one.

### Slack

1. Create the channel the alerts should go to (for example `#cost-alerts`). The webhook can only target a channel that already exists.
2. At [api.slack.com/apps](https://api.slack.com/apps), click **Create New App → From scratch**, name it, and pick your workspace.
3. In the app's left sidebar, under **Features**, open **Incoming Webhooks** and switch **Activate Incoming Webhooks** on. Socket Mode is not needed.
4. Click **Add New Webhook**, pick the channel from step 1, and click **Allow**.
   - Pick a real channel, not the app's own name or a person. A webhook aimed at the app's direct messages fails with `messages_tab_disabled`.
5. Copy the `https://hooks.slack.com/services/…` URL from the table at the bottom of the page.

### Microsoft Teams

1. In the target channel, open **⋯ → Workflows**.
2. Choose the template **Post to a channel when a webhook request is received**, and confirm the team and channel.
3. Copy the URL it gives you. Classic channel Incoming Webhooks also work.

### Save and test it

1. In VS Code, run `Terraform Cost: Set Budget Alert Webhook (Slack/Teams)`, pick the platform, and paste the URL. It's stored in VS Code's `SecretStorage` (like the AI provider keys), never in `settings.json`. This also sets `terraformCost.notifications.provider` to match.
2. Click **Send Test Alert** on the confirmation, or run `Terraform Cost: Send Test Budget Alert` any time, to confirm a clearly-labelled sample message arrives.
3. From then on, whenever a threshold in `terraform.budget.json` is crossed, the popup *and* the webhook fire together.

Run `Terraform Cost: Clear Budget Alert Webhook` to remove the URL and turn alerts off.

| Error from Send Test Alert | Meaning |
|---|---|
| `messages_tab_disabled` (Slack) | The webhook targets the app's DM. Create a new webhook aimed at a channel. |
| `no_service` or `invalid_token` (Slack) | The webhook was removed or the URL is wrong. Create a new one. |
| `action_prohibited` or `channel_is_archived` (Slack) | A workspace admin restricts posting there, or the channel was archived. |
| Any 4xx error (Teams) | The URL isn't a Workflows/Incoming Webhook URL, or the flow is turned off. |

## Design notes

- **Same trigger point as the existing popup, not a parallel schedule.** `checkBudgetAndWarn()` already tracks "have we notified for this level yet" per file to avoid spamming a popup on every keystroke; the webhook fires from that exact same `level > prev` check, so there's one source of truth for "did we already alert on this," not two mechanisms that could drift out of sync.
- **Teams messages are Adaptive Cards** (a `message` with an `application/vnd.microsoft.card.adaptive` attachment). Teams Workflows webhooks require this format, and classic Incoming Webhooks accept it too. The legacy `MessageCard` format is no longer used.
- **Whole-workspace alerts too**: refreshing the dashboard's workspace scope evaluates the workspace total against the root `terraform.budget.json` and alerts on a crossing into a higher level, with the same anti-spam gate tracked separately from per-file alerts.
- **Tested against a stubbed `fetch`, not a real channel** (`test/suite/managers.test.js`). The tests cover both payload shapes, an HTTP error, and a missing URL.
