# Spam Catcher

Spam Catcher is a Discord moderation bot with two independent protection modes:

- Trap Channels apply a configured timeout or ban action when a user posts in a designated channel.
- Automatic Attachment Detection watches non-trap channels for repeated attachment bursts from the same user.

Both modes use the same timeout DMs, appeal flow, timeout-removal DMs, and ban DMs. Guild settings are stored in PostgreSQL. New guilds remain disabled until an Administrator completes setup.

### Try Ready to use bot. (✨ AI Enabled)

[![Invite to Server](https://img.shields.io/badge/Invite%20to%20Server-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.com/oauth2/authorize?client_id=1519685310068424856&permissions=1099511696518&integration_type=0&scope=bot)

### Host your own

[![How to Setup](https://img.shields.io/badge/How%20to%20Setup-2F363D?style=for-the-badge&logo=github&logoColor=white)](#setup)

> [!IMPORTANT]
> **Spam Catcher does not read or analyze message text.**
>
> Discord's `Message Content Intent` is used only to receive attachment metadata. Automatic Attachment Detection uses the author, channel, attachment count, timestamps, and, when AI Verdict is enabled, the first supported image attachment.

## Features

- **Trap Channels** - Apply a timeout or ban when a user posts in a designated channel.
- **Automatic Attachment Detection** - Detect repeated attachment bursts and create one tracked Danger incident.
- **AI Verdict** - Analyze the trigger image once and add OCR-based evidence to the existing incident.
- **Moderation And Appeals** - Share timeout, ban, DM, appeal, and administrator review workflows.
- **Trap Channel Notices** - Post and maintain warning messages in configured trap channels.

<details>
<summary><strong>Trap Channels</strong></summary>

Administrators choose one or more text channels as traps and configure the moderation action. When a non-administrator posts in an enabled trap channel, Spam Catcher records the event and applies the selected timeout or ban flow.

Trap Channels and Automatic Attachment Detection have separate enable switches. Messages in active trap channels are excluded from Automatic Attachment Detection, preventing both systems from acting on the same message.

Caught messages remain in the trap channel. Event totals count incidents, not distinct users.

</details>

<details>
<summary><strong>Automatic Attachment Detection</strong></summary>

Automatic Attachment Detection is disabled by default. When enabled, it processes messages from users the bot can moderate and ignores:

- bots and webhooks
- Discord Administrators
- users above the bot in the role hierarchy
- users the bot cannot moderate because of missing permissions
- messages in active trap channels

Detection follows one fixed window:

1. A message with `2+` attachments starts a `10 minute` Alert window.
2. The next message from the same user with `2+` attachments inside that window creates one Danger incident.
3. The bot immediately marks the user as a spammer, increments their incident count once, applies the timeout, sends the timeout DM, and posts a Danger card.
4. Later qualifying messages inside the same window update the original incident with affected channels, message and attachment totals, and latest activity. They do not repeat moderation or AI analysis.
5. After the window expires, the next qualifying message starts a new Alert window.

Same-channel and cross-channel repeats both create Danger incidents. Removing the timeout, successfully banning the user, or finding that the member is no longer in the guild closes the active window. If the user can send messages in the guild again, their next qualifying message starts a new Alert window.

The Danger action:

- sets the active spammer flag
- increments the user's stored incident count once
- applies the configured Automatic Detection timeout, which defaults to `28 days`
- posts one Danger card in the configured log channel
- sends the shared timeout and appeal DM if Discord accepts the DM

Danger cards display moderation and AI statuses separately. When an incident is resolved, the card becomes an Attachment Spam Summary Log instead of being deleted.

</details>

<details>
<summary><strong>AI Verdict</strong></summary>

AI Verdict is an optional Automatic Attachment Detection add-on. It never runs for Trap Channel events.

When enabled, AI Verdict runs once in the background after the Danger action. Moderation does not wait for AI. The result updates the existing Danger card without applying, repeating, or reversing moderation.

AI Verdict behavior:

- Requires `OPENROUTER_API_KEY` or `GEMINI_API_KEY`.
- Uses OpenRouter when configured; Gemini is used only when OpenRouter is not configured.
- Defaults to OpenRouter model `xiaomi/mimo-v2.5` or Gemini model `gemini-2.5-flash`.
- Analyzes only the first supported image from the message that created the Danger incident.
- Returns a caption, OCR matches, and confidence score.
- Matches OCR text against the guild's configured trigger words.
- Defaults to a confidence threshold of `0.7`.
- Runs through a per-guild queue with at most `2` concurrent analyses.

The default quota is `3` verdicts per guild per day. The quota resets using the guild's configured timezone, which defaults to `UTC`. The setup panel displays the current usage, and the first quota-counted verdict on a new guild-local date sends a reset notice to the log channel.

OpenRouter image URL, base64 fallback, and JSON retry attempts count as one bot verdict. If every failed attempt is explicitly unbilled, the bot refunds that event's quota slot. Explicitly unbilled means OpenRouter reports `usage.cost = 0`, reports zero completion tokens with an error or no finish reason, or rejects the request before generation. Billed or unknown malformed responses remain counted.

If the quota is exhausted, no provider request is made. The existing Danger card is updated with the quota result. Guild IDs in `AI_VISION_DAILY_LIMIT_BYPASS_GUILD_IDS` bypass only this daily quota.

</details>

<details>
<summary><strong>Moderation And Appeals</strong></summary>

Trap Channel incidents support these timeout durations:

- `10 Minutes`
- `30 Minutes`
- `1 Hour`
- `6 Hours`
- `12 Hours`
- `1 Day`
- `3 Days`
- `7 Days`
- `14 Days`
- `28 Days`

Trap Channel Auto Ban modes:

- `Auto Ban Off`: apply the timeout without scheduling a ban
- `Ban After Appeal Window`: apply the timeout, then ban after the selected appeal period
- `Ban Immediately`: ban without applying a timeout
- `Ban After Timeout Ends`: apply the timeout, then ban when it expires

Appeal window options:

- `10 Minutes`
- `30 Minutes`
- `1 Hour`
- `2 Hours`
- `6 Hours`
- `12 Hours`
- `24 Hours`

Timed-out users receive a DM with an Appeal button. The button opens the shared appeal modal, where the user submits an explanation. The explanation is stored with the incident and displayed on its moderation card.

Administrator card actions:

- `Remove Timeout`: removes the timeout, resets the active spammer flag, closes the detection window, and marks the incident resolved
- `Ban User`: bans the user and, after a successful ban, resets the active spammer flag, closes the detection window, and marks the incident resolved

When an Administrator removes a timeout, the bot DMs the user that the timeout was lifted and records whether Discord accepted the DM. Timeout removal always calls Discord's `member.timeout(null, ...)` when the member exists instead of relying on cached timeout fields.

If a user has left, been kicked, or been banned before an Administrator acts, the bot records that the member is unavailable and updates the existing card without crashing.

</details>

<details>
<summary><strong>Trap Channel Notices</strong></summary>

Trap notices warn users not to post in configured trap channels. Administrators can post or update them from `/spam-catcher setup`.

Notice message IDs are stored in `spam_catcher_notice_messages`. The bot edits a stored notice when the message still exists and is editable. Otherwise, it posts a replacement and stores the new message ID.

</details>

## Setup

### Install

Requirements:

- Node.js `18+`
- npm
- PostgreSQL reachable through `DATABASE_URL`
- a Discord application with a bot user

Install dependencies and verify JavaScript syntax:

```bash
npm install
npm run check
```

### Create And Invite The Discord Bot

1. Create an application in the Discord Developer Portal.
2. Create its bot user and copy the token.
3. Enable `Message Content Intent` under privileged gateway intents.
4. Enable the bot in the application's installation settings.
5. Invite it with the `bot` and `applications.commands` scopes.
6. Grant `View Channels`, `Send Messages`, `Read Message History`, and `Moderate Members`.
7. Grant `Ban Members` if you plan to use Auto Ban or the `Ban User` card action.

### Environment Variables

Create `.env` from the example file:

```bash
cp .env.example .env
```

Required values:

```env
DISCORD_TOKEN=your_discord_bot_token
DATABASE_URL=postgresql://spamcatcher:password@127.0.0.1:5432/spam_catcher
```

Optional runtime values:

```env
PG_SSL_MODE=disable
BOT_POSTGRES_POOL_MAX=2
ALLOWED_GUILD_IDS=
OPENROUTER_API_KEY=
OPENROUTER_MODEL=xiaomi/mimo-v2.5
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
AI_VISION_DAILY_LIMIT_BYPASS_GUILD_IDS=
```

- `PG_SSL_MODE`: set to `disable` for PostgreSQL on local/VPS `127.0.0.1`; remote connections require SSL by default.
- `BOT_POSTGRES_POOL_MAX`: maximum PostgreSQL pool size; defaults to `2`.
- `ALLOWED_GUILD_IDS`: comma-separated guild allowlist. When empty, any guild may configure the bot, but both moderation features remain disabled until enabled through setup.
- `OPENROUTER_API_KEY`: enables OpenRouter for AI Verdict.
- `OPENROUTER_MODEL`: defaults to `xiaomi/mimo-v2.5`.
- `GEMINI_API_KEY`: enables Gemini when OpenRouter is not configured.
- `GEMINI_MODEL`: defaults to `gemini-2.5-flash`.
- `AI_VISION_DAILY_LIMIT_BYPASS_GUILD_IDS`: comma-separated guild IDs that bypass only the AI Verdict daily quota.

Guild IDs, channel IDs, timeout settings, ban settings, language, timezone, trigger words, and daily limits belong in PostgreSQL guild config, not `.env`.

### PostgreSQL

Tables are created automatically at runtime. You can also apply `scripts/schema-postgres.sql` manually.

Required tables:

- `spam_catcher_config`
- `spam_catcher_events`
- `spam_catcher_notice_messages`
- `automatic_spam_detection_users`
- `automatic_spam_detection_events`
- `automatic_spam_detection_event_messages`
- `automatic_spam_detection_ai_usage`
- `automatic_spam_detection_ai_usage_reservations`

Recommended local/VPS connection:

```env
DATABASE_URL=postgresql://spamcatcher:password@127.0.0.1:5432/spam_catcher
PG_SSL_MODE=disable
```

Do not expose PostgreSQL publicly. Bind it to `127.0.0.1` or use a private network. See `setup.md` for VPS installation instructions.

### Run The Bot

Start the bot:

```bash
npm start
```

On startup, the bot:

- logs in to Discord
- creates missing PostgreSQL tables
- refreshes the global `/spam-catcher` application command
- starts the delayed-ban loop
- starts Automatic Attachment Detection for guilds where it is enabled

Global Discord command updates may take time to propagate.

### Complete Setup In Discord

Run this command as a Discord Administrator:

```text
/spam-catcher setup
```

New guilds are disabled by default. Select the required channels and enable the features you want to use.

- Trap Channels require at least one trap channel, a review channel, and a log channel before they can be enabled.
- Automatic Attachment Detection is independent and requires only a log channel.
- AI Verdict requires Automatic Attachment Detection plus an OpenRouter or Gemini API key.

Saved channels are preselected when the setup panel is reopened, and changes are stored immediately.

<img width="521" height="829" alt="Spam Catcher Discord setup dashboard" src="https://github.com/user-attachments/assets/75e2c2e2-5310-4ac4-a16b-e8430d028fb4" />

## Commands

### `/spam-catcher setup`

Opens the Discord Components V2 setup dashboard for Administrators. Each summary displays saved settings and opens an ephemeral editing panel.

- `Spam Catcher Summary`: Trap Channel enable state and configured timeout/ban outcome
- `Channels / Timeout Summary`: trap channels, review channel, log channel, and timeout duration
- `Auto Ban Summary`: Auto Ban enable state, mode, and appeal timing
- `Automatic Spam Detection Summary`: enable state, attachment threshold/window, timeout duration, AI state and quota, timezone, and log channel
- `AI Verdict Checker`: trigger words, confidence threshold, daily quota, and provider readiness
- `Trap Notices Summary`: configured trap-channel count and whether notices are ready to post

### `/spam-catcher lang`

Sets the guild's interface language:

```text
/spam-catcher lang language: English
/spam-catcher lang language: Indonesia
```

The selected language applies to setup panels, trap notices, Danger cards, timeout DMs, appeal modals, and shared moderation messages. Supported stored values are `en` and `id`.

### `/spam-catcher check`

Shows a user's Automatic Attachment Detection status and Trap Channel event history. The user argument accepts either an `@mention` or a raw Discord user ID.

```text
/spam-catcher check user:@User
```

### CLI Commands

The Discord setup dashboard is preferred. CLI commands require the runtime environment variables because they connect to PostgreSQL and, where applicable, Discord.

Create or update guild config:

```bash
npm run config:upsert -- \
  --guild-id YOUR_GUILD_ID \
  --log-channel-id ADMIN_LOG_CHANNEL_ID \
  --review-channel-id ADMIN_REVIEW_CHANNEL_ID \
  --trap-channel-ids TRAP_CHANNEL_ID_1,TRAP_CHANNEL_ID_2 \
  --timeout-minutes 60 \
  --auto-ban false \
  --ban-mode delayed \
  --ban-delay-minutes 10 \
  --language en \
  --timezone UTC \
  --ai-vision-daily-limit 3
```

Timezone values must be valid IANA names such as `UTC`, `Asia/Jakarta`, or `America/New_York`.

List guild configs:

```bash
npm run config:list
```

Post or update notices for one guild:

```bash
npm run post:notices -- --guild-id YOUR_GUILD_ID
```

Post or update notices for every enabled guild:

```bash
npm run post:notices -- --all
```

Notice failures are logged with the `[spam-catcher-setup]` prefix. Logs include the channel ID, delivery method, stored message ID, failure stage, Discord response body when available, and final success/failure totals.

## Reference

### Permissions And Intents

Required Discord permissions:

- `View Channels`
- `Send Messages`
- `Read Message History`
- `Moderate Members`

Optional permission:

- `Ban Members` for Auto Ban and the `Ban User` card action

Required gateway intents:

- `Guilds`
- `GuildMessages`
- privileged `MessageContent`

`Moderate Members` is required for timeout and timeout removal. `MessageContent` is required for Discord to include attachment metadata; the bot does not inspect message text.

### Production Deployment

Run the bot under a process manager such as `systemd`, `pm2`, or Docker. Keep PostgreSQL on `127.0.0.1` or a private network and use `PG_SSL_MODE=disable` only for a trusted local/VPS connection.

The delayed-ban loop checks due events every `30 seconds`. Restarting the process does not remove stored guild config, incidents, scheduled ban state, notice message IDs, or AI quota usage because they are persisted in PostgreSQL.

### Behavior Notes

- Discord Administrators are ignored by both moderation features.
- Caught Trap Channel messages are not deleted.
- Caught totals are incident counts, not distinct-user counts.
- Review cards allow Administrators to remove a timeout or ban the user.
- Removing a timeout cancels the scheduled Spam Catcher ban for that incident.
- Missing members are treated as expected leave, kick, or ban cases instead of runtime errors.
- Automatic Attachment Detection never processes messages in active trap channels.
- AI Verdict failure or quota exhaustion never delays or cancels the immediate Danger action.

## Changelog

### 2026-07-17

- Automatic Attachment Detection now ignores active trap channels; the first qualifying attachment message opens an Alert window and the second creates one Danger incident.
- Later qualifying attachment messages update the original Danger incident and card instead of repeating moderation.
- Clearing a user closes the current window while preserving prior incident history, allowing future spam to start a new detection cycle.
- AI Verdict now runs after immediate moderation, checks the first supported image from the trigger message once, and updates the existing Danger card.
- Explicitly unbilled OpenRouter failures no longer consume a guild's daily AI Verdict quota.
- Danger cards now separate moderation and AI statuses, the appeal prompt and button appear at the bottom of timeout DMs, and setup/card text was updated in English and Indonesian.
