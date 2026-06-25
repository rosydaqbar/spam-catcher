# Spam Catcher

Standalone Discord bot for trap channels. If a non-admin user posts in a configured trap channel, the bot records the event and applies the configured action: timeout only, immediate ban, ban after timeout, or ban after an appeal window.

Guild config lives in PostgreSQL, not `.env`. Unknown guilds are disabled by default.

## Requirements

- Node.js `18+`
- PostgreSQL `12+` recommended
- Discord application with bot user
- Bot invited with `bot` and `applications.commands` scopes
- Bot permissions: `View Channels`, `Send Messages`, `Read Message History`, `Moderate Members`, `Ban Members`

`Moderate Members` is needed for timeout and timeout removal. `Ban Members` is needed only when Auto Ban is enabled.

## Install

```bash
npm install
cp .env.example .env
npm run check
```

## Discord Bot Setup

1. Create app in Discord Developer Portal.
2. Create bot user and copy bot token into `.env` as `DISCORD_TOKEN`.
3. Enable the bot in the app installation settings.
4. Invite the bot with scopes `bot` and `applications.commands`.
5. Grant these permissions: `View Channels`, `Send Messages`, `Read Message History`, `Moderate Members`, `Ban Members`.
6. Start the bot once so it registers `/spam-catcher setup`.

The bot uses `Guilds` and `GuildMessages` gateway intents. It does not need Message Content intent because it only checks channel, author, member, and guild metadata.

## Database

Use PostgreSQL. Tables auto-create at runtime, or you can apply `scripts/schema-postgres.sql` manually.

Required tables:

- `spam_catcher_config`
- `spam_catcher_events`
- `spam_catcher_notice_messages`

For VPS/local PostgreSQL setup, read `setup.md`.

Recommended local VPS connection:

```env
DATABASE_URL=postgresql://spamcatcher:password@127.0.0.1:5432/spam_catcher
PG_SSL_MODE=disable
```

Do not expose PostgreSQL publicly. Keep it on `127.0.0.1` or private network.

## Environment

`.env` is runtime-only:

```env
DISCORD_TOKEN=your_discord_bot_token
DATABASE_URL=postgresql://spamcatcher:password@127.0.0.1:5432/spam_catcher
PG_SSL_MODE=disable
BOT_POSTGRES_POOL_MAX=2
ALLOWED_GUILD_IDS=
DEBUG=false
```

Do not put guild IDs, channel IDs, timeout settings, or ban settings in `.env`. Those are saved per guild in `spam_catcher_config.config_json`.

`ALLOWED_GUILD_IDS` is optional. Empty means any guild can work if it has enabled database config.

## Launch

```bash
npm start
```

On startup the bot:

- logs in to Discord
- registers `/spam-catcher setup`
- starts the delayed-ban loop
- creates missing PostgreSQL tables when needed

For production, run it under a process manager such as `systemd`, `pm2`, or Docker.

## Configure A Server

Run inside the Discord server as an Administrator:

```text
/spam-catcher setup
```

The setup panel uses Discord Component V2 and has four containers:

- `Spam Catcher Setup`: status, current result, enable/disable button, refresh button
- `Channels`: trap channels, review channel, log channel, timeout duration
- `Auto Ban`: Auto Ban on/off, ban timing, appeal window when needed
- `Trap Notices`: post or update warning notices in trap channels

Saved trap/review/log channels are preselected when reopening the setup panel.

Settings save immediately. `Enable Spam Catcher` only controls whether trap-channel messages are handled. Enable is blocked until trap, review, and log channels are set.

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
  --ban-delay-minutes 10
```

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
