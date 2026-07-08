# Spam Catcher

Standalone Discord bot for trap channels and attachment-spam detection. Trap channels apply the configured action. Automatic Spam Detection can also watch all guild messages for repeated attachment bursts and timeout suspected spammers.

Trap-channel Spam Catcher and Automatic Spam Detection have separate setup toggles, but share the same user moderation workflow for timeout DMs, appeal buttons/modals, timeout removal DMs, and ban DMs.

Guild config lives in PostgreSQL, not `.env`. Unknown guilds are disabled by default.

## Required To Run

- Node.js `18+`
- PostgreSQL reachable through `DATABASE_URL`
- Discord application with bot user
- Bot invited with `bot` and `applications.commands` scopes
- Required bot permissions: `View Channels`, `Send Messages`, `Read Message History`, `Moderate Members`
- Discord Developer Portal `Message Content Intent` enabled

`Moderate Members` is required for timeout and timeout removal. `Message Content Intent` is required so Discord includes message attachment data.

> [!IMPORTANT]
> **Privacy: Spam Catcher does not read or analyze message text.**
>
> `Message Content Intent` is used so Discord includes attachment metadata. Automatic Spam Detection only uses moderation metadata: author, channel, attachment count, timestamps, and the attachment image URL when optional AI Verdict is enabled.

## Quick Start

Install and create `.env`:

```bash
npm install
cp .env.example .env
npm run check
```

Set only the required `.env` values first:

```env
DISCORD_TOKEN=your_discord_bot_token
DATABASE_URL=postgresql://spamcatcher:password@127.0.0.1:5432/spam_catcher
```

For local/VPS PostgreSQL on `127.0.0.1`, also set:

```env
PG_SSL_MODE=disable
```

Start the bot:

```bash
npm start
```

Then run inside Discord as an Administrator:

```text
/spam-catcher setup
```

Unknown guilds are disabled by default. Use `/spam-catcher setup` to save guild config in PostgreSQL.
<img width="521" height="829" alt="image" src="https://github.com/user-attachments/assets/75e2c2e2-5310-4ac4-a16b-e8430d028fb4" />

## Discord Bot Setup Checklist

1. Create app in Discord Developer Portal.
2. Create bot user and copy bot token into `.env` as `DISCORD_TOKEN`.
3. Enable the bot in the app installation settings.
4. Invite the bot with scopes `bot` and `applications.commands`.
5. Enable `Message Content Intent` under Bot privileged gateway intents.
6. Grant required permissions: `View Channels`, `Send Messages`, `Read Message History`, `Moderate Members`.
7. Optional: grant `Ban Members` if using Auto Ban or admin Ban buttons.
8. Start the bot once so it registers `/spam-catcher setup` and `/spam-catcher lang`.

The bot uses `Guilds`, `GuildMessages`, and `MessageContent` gateway intents.

## Database

Tables auto-create at runtime, or you can apply `scripts/schema-postgres.sql` manually.

Required tables:

- `spam_catcher_config`
- `spam_catcher_events`
- `spam_catcher_notice_messages`
- `automatic_spam_detection_users`
- `automatic_spam_detection_events`
- `automatic_spam_detection_ai_usage`

For VPS/local PostgreSQL setup, read `setup.md`.

Recommended local VPS connection:

```env
DATABASE_URL=postgresql://spamcatcher:password@127.0.0.1:5432/spam_catcher
PG_SSL_MODE=disable
```

Do not expose PostgreSQL publicly. Keep it on `127.0.0.1` or private network.

## Optional Environment

`.env` is runtime-only. Do not put guild IDs, channel IDs, timeout settings, or ban settings in `.env`; those live in `spam_catcher_config.config_json`.

```env
PG_SSL_MODE=disable
BOT_POSTGRES_POOL_MAX=2
ALLOWED_GUILD_IDS=
OPENROUTER_API_KEY=
OPENROUTER_MODEL=xiaomi/mimo-v2.5
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
AI_VISION_DAILY_LIMIT_BYPASS_GUILD_IDS=
DEBUG=false
```

- `PG_SSL_MODE`: use `disable` for local/VPS PostgreSQL on `127.0.0.1`; defaults to SSL-required behavior otherwise.
- `BOT_POSTGRES_POOL_MAX`: defaults to `2`.
- `ALLOWED_GUILD_IDS`: comma-separated allowlist; empty means any guild can work if it has enabled database config.
- `OPENROUTER_API_KEY`: optional; preferred provider when a guild enables AI Verdict Checker.
- `OPENROUTER_MODEL`: optional; defaults to `xiaomi/mimo-v2.5`.
- `GEMINI_API_KEY`: optional fallback for AI Verdict Checker when OpenRouter is not configured.
- `GEMINI_MODEL`: optional fallback model; defaults to `gemini-2.5-flash`.
- `AI_VISION_DAILY_LIMIT_BYPASS_GUILD_IDS`: optional comma-separated guild IDs that bypass only the AI Verdict daily limit.
- `DEBUG`: currently optional runtime flag.

On startup, the bot:

- logs in to Discord
- refreshes the global `/spam-catcher` application command with all current subcommands
- starts the delayed-ban loop
- creates missing PostgreSQL tables when needed
- watches messages for Automatic Spam Detection when enabled per guild

For production, run it under a process manager such as `systemd`, `pm2`, or Docker.

## Configure A Server

Run inside the Discord server as an Administrator:

```text
/spam-catcher setup
```

Optional: set the server UI language with:

```text
/spam-catcher lang language: English
/spam-catcher lang language: Indonesia
```

The setup dashboard uses Discord Component V2 and has summary containers. Buttons open focused ephemeral setup panels.

- `Spam Catcher Summary`: main trap-channel enable state and current result
- `Channels / Timeout Summary`: trap channels, review channel, log channel, timeout duration
- `Auto Ban Summary`: optional Auto Ban state and ban timing
- `Automatic Spam Detection Summary`: attachment-spam detector state and action
- `AI Verdict Checker`: optional Automatic Detection add-on using OpenRouter/Gemini image analysis and configured trigger patterns
- `Trap Notices Summary`: optional notice posting status
- Optional language setting is stored per guild and used for setup UI, trap notices, Automatic Detection Danger cards, timeout DMs, appeal modals, and shared moderation messages.

Saved trap/review/log channels are preselected when reopening the setup panel.

Settings save immediately. `Enable Spam Catcher` only controls whether trap-channel messages are handled. Enable is blocked until trap, review, and log channels are set.

`Enable Automatic Detection` is independent from `Enable Spam Catcher`. It requires only the log channel because Danger cards use that channel. Servers can use Automatic Detection without trap channels.

## Timeout And Ban Options

Timeout options in `/spam-catcher setup`:

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

Auto Ban modes:

- `Auto Ban Off`: timeout only, no automatic ban
- `Ban After Appeal Window`: timeout first, then ban after selected appeal window
- `Ban Immediately`: ban right away, no timeout
- `Ban After Timeout Ends`: timeout first, ban when timeout expires

Appeal window options:

- `10 Minutes`
- `30 Minutes`
- `1 Hour`
- `2 Hours`
- `6 Hours`
- `12 Hours`
- `24 Hours`

When an admin removes a timeout from the review card, the bot DMs the user that the timeout has been lifted and logs whether the DM was sent.

## Automatic Spam Detection

Default: off per guild.

When enabled, the bot watches all guild messages from users it can moderate. It ignores only bots, webhooks, and users the bot cannot moderate because of role hierarchy or missing permission.

Detection flow:

- First message from a user with `2+` attachments starts a fixed `10 minute` window and records an Alert.
- A later message from the same user with `2+` attachments inside that window triggers Danger.
- Same-channel repeats and cross-channel repeats both trigger Danger.
- After the window expires, the next qualifying message starts a new Alert window.

Danger action:

- sets `spammer = 1`
- increments `spammer_count` by `1`
- times out the user for `28 days`
- sends a Component V2 Danger card to the configured log channel
- DMs the user with the shared timeout/appeal workflow when DMs are available

Optional AI Verdict Checker:

- Applies only to Automatic Spam Detection, never trap-channel Spam Catcher.
- Requires `OPENROUTER_API_KEY` or `GEMINI_API_KEY` and must be enabled in the Automatic Detection setup panel.
- OpenRouter is preferred by default with model `xiaomi/mimo-v2.5`.
- Analyzes only the first supported image attachment from the trigger message.
- AI provider returns caption, OCR text, and confidence; the bot decides scam by matching configured trigger words.
- Default confidence threshold is `0.7`.
- Default daily AI Verdict limit is `3` verdicts per guild per day.
- Daily AI Verdict usage resets by the guild config timezone, default `UTC`.
- `/spam-catcher setup` shows current AI Verdict quota information under Automatic Spam Detection.
- On the first quota-counted AI Verdict trigger after a guild-local daily reset, the bot sends a reset notice to the configured log channel.
- AI Verdict calls run through a per-guild queue with up to `2` concurrent image analyses.
- If confidence is below threshold, no timeout is applied and admins get a warning card.
- If AI analysis fails, no timeout is applied and admins get a warning card.
- If the daily AI Verdict limit is reached, no AI API call is made, no timeout is applied, and admins get a warning card.
- Guild IDs in `AI_VISION_DAILY_LIMIT_BYPASS_GUILD_IDS` skip only the daily quota check; AI queueing and all moderation rules still apply.
- If no trigger words match, no timeout is applied and the result is logged only.

Automatic Detection appeals:

- The DM appeal button opens the same style appeal modal as trap-channel Spam Catcher.
- Appeal text is saved on the Automatic Detection event and shown on the Danger card.
- If the user has left, been kicked, or been banned before admin action, the Danger card is updated without crashing.

Danger card buttons:

- `Remove Timeout`: admin only, removes timeout, sets `spammer = 0`, edits card resolved
- `Ban User`: admin only, bans user, sets `spammer = 0` only if ban succeeds, edits card resolved

Timeout removal always calls Discord's `member.timeout(null, ...)` when the member still exists. It does not rely on cached timeout fields, which can be stale or missing.

## Trap Notices

Use the setup panel button `Post/Update Notices`, or run:

```bash
npm run post:notices -- --guild-id YOUR_GUILD_ID
```

Post notices for every enabled guild:

```bash
npm run post:notices -- --all
```

Notice message IDs are stored in `spam_catcher_notice_messages`. The bot edits saved notices when possible and posts a replacement if the old message cannot be edited.

If posting fails from the setup panel, check logs prefixed with:

```text
[spam-catcher-setup]
```

Logs include channel ID, delivery method, existing message ID, failure stage, Discord response body when available, and final success/failure count.

## CLI Config

Discord setup panel is preferred. CLI exists for automation:

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

Supported language values are `en` and `id`.
Timezone should be an IANA timezone such as `UTC`, `Asia/Jakarta`, or `America/New_York`.

List configs:

```bash
npm run config:list
```

## Behavior Notes

- Discord Administrators are ignored.
- Caught messages are left in the trap channel.
- Caught counts are event counts, not distinct-user counts.
- Delayed bans are checked every 30 seconds while the bot is running.
- Review cards let admins ban user or remove timeout.
- Removing timeout cancels scheduled Spam Catcher ban for that event.
