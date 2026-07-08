# AGENTS.md

## Commands
- Install deps with `npm install`.
- Run the only repo verification with `npm run check`; it is syntax-only via `node --check`, not tests.
- Start the bot with `npm start`; runtime requires `.env` with `DISCORD_TOKEN` and `DATABASE_URL`.
- CLI helpers require runtime env because they call `requireRuntimeEnv()`: `npm run config:list`, `npm run config:upsert`, `npm run post:notices`, `npm run deploy:commands`.
- `/spam-catcher check <user>` subcommand shows user spam status (auto-detection + trap events); accepts `@mention` or raw ID.

## Runtime Shape
- Entry point is `src/index.js`; it wires one Discord client to setup commands, Automatic Spam Detection, and trap-channel Spam Catcher.
- Message handling order is Automatic Spam Detection first, then trap-channel Spam Catcher.
- Interaction handling order is setup UI first, then Automatic Spam Detection, then Spam Catcher.
- Startup refreshes global application commands with `client.application.commands.set(...)`; Discord propagation may lag.

## Config And Database
- Guild settings live in PostgreSQL `spam_catcher_config.config_json`, not `.env`; unknown guilds are disabled by default.
- `.env` is only runtime connection/allowlist/API-key config: token, database URL, SSL mode, pool size, `ALLOWED_GUILD_IDS`, optional `OPENROUTER_API_KEY`, optional `OPENROUTER_MODEL`, optional `GEMINI_API_KEY`, optional `GEMINI_MODEL`, optional `AI_VISION_DAILY_LIMIT_BYPASS_GUILD_IDS`.
- Tables auto-create at runtime in `src/config-store.js`; update `scripts/schema-postgres.sql` too when changing schema.
- AI Verdict daily usage is tracked in `automatic_spam_detection_ai_usage` by `(guild_id, usage_date)` using the guild config `timezone`; default daily limit is `3`.
- AI Verdict reset notices are sent to the configured log channel on the first quota-counted AI Verdict trigger for a new guild-local date.
- `AI_VISION_DAILY_LIMIT_BYPASS_GUILD_IDS` is a comma-separated env allowlist that bypasses only the AI Verdict daily quota.
- Local/VPS PostgreSQL should use `PG_SSL_MODE=disable` and bind to `127.0.0.1`; see `setup.md` for safe setup.

## Feature Boundaries
- Keep setup enables separate: `enabled` controls trap channels, `automaticSpamDetectionEnabled` controls attachment detection.
- Shared moderation behavior belongs in `src/bot/moderation-workflow.js`: appeal button/modal, timeout DM, ban DM, timeout-removed DM.
- Trap notices are generated from `src/bot/trap-notice-payload.js`; do not duplicate notice text in scripts or managers.
- Language strings live in `src/bot/locales/en.json` and `src/bot/locales/id.json`; use `createTranslator` instead of hardcoded user-facing setup/notice/card text.

## Discord/Moderation Gotchas
- Bot needs `Guilds`, `GuildMessages`, and privileged `MessageContent`; attachment detection depends on Message Content Intent.
- Timeout removal should call `member.timeout(null, ...)` whenever the member exists; do not gate it on `communicationDisabledUntilTimestamp`, which can be stale/missing.
- Missing users are expected for leave/kick/ban cases; handle failed member fetches without crashing and update the review/Danger card.
- Automatic Detection and trap flow should share moderation workflow behavior, not maintain separate appeal/DM implementations.
- AI Verdict Checker applies only to Automatic Detection, analyzes only the first supported image attachment, uses OpenRouter by default (`xiaomi/mimo-v2.5`) with Gemini fallback, queues at most `2` concurrent AI analyses per guild, and must not timeout when AI analysis fails or daily quota is reached.
