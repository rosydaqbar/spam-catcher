require('dotenv').config();

const configStore = require('../src/config-store');
const { requireRuntimeEnv } = require('../src/bot/env');

const USAGE = `Usage:
  node scripts/upsert-guild-config.js \\
    --guild-id 123 \\
    --log-channel-id 456 \\
    --review-channel-id 789 \\
    --trap-channel-ids 111,222 \\
    --timeout-minutes 60 \\
    --auto-ban false \\
    --ban-mode delayed \\
    --ban-delay-minutes 10

Options:
  --guild-id <id>             Required Discord guild/server ID.
  --trap-channel-ids <ids>    Required comma-separated trap text channel IDs.
  --review-channel-id <id>    Required admin review channel ID.
  --log-channel-id <id>       Optional admin log channel ID.
  --enabled <true|false>      Defaults to true.
  --timeout-minutes <number>  Defaults to 60.
  --auto-ban <true|false>     Defaults to false.
  --ban-mode <mode>           delayed, immediate, or after_timeout. Defaults to delayed.
  --ban-delay-minutes <num>   Defaults to 10.
  --language <en|id>          Defaults to en.
  --webhook-enabled <bool>    Defaults to false.
  --webhook-urls <json>       JSON array: [{"channelId":"...","webhookUrl":"..."}].
  --help                      Show this help.
`;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) {
      throw new Error(`Unexpected argument: ${item}`);
    }
    const [rawKey, inlineValue] = item.slice(2).split(/=(.*)/s, 2);
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    if (inlineValue !== undefined) {
      args[key] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true) return true;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

function parseNumber(value, fallback) {
  if (value === undefined || value === null || value === true || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number: ${value}`);
  return parsed;
}

function parseId(value, name, { required = true } = {}) {
  if (value === undefined || value === null || value === true || String(value).trim() === '') {
    if (required) throw new Error(`${name} is required.`);
    return null;
  }
  const id = String(value).trim();
  if (!/^\d+$/.test(id)) throw new Error(`${name} must be a Discord numeric ID.`);
  return id;
}

function parseIdList(value, name) {
  if (value === undefined || value === null || value === true || String(value).trim() === '') {
    throw new Error(`${name} is required.`);
  }
  const ids = [...new Set(String(value).split(',').map((item) => item.trim()).filter(Boolean))];
  if (!ids.length) throw new Error(`${name} must include at least one ID.`);
  for (const id of ids) {
    if (!/^\d+$/.test(id)) throw new Error(`${name} contains a non-numeric Discord ID: ${id}`);
  }
  return ids;
}

function parseWebhookUrls(value) {
  if (value === undefined || value === null || value === true || String(value).trim() === '') return [];
  let parsed;
  try {
    parsed = JSON.parse(String(value));
  } catch (error) {
    throw new Error(`Invalid --webhook-urls JSON: ${error.message}`);
  }
  if (!Array.isArray(parsed)) throw new Error('--webhook-urls must be a JSON array.');
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  requireRuntimeEnv();

  const guildId = parseId(args.guildId, '--guild-id');
  const config = configStore.normalizeSpamCatcherConfig({
    enabled: parseBoolean(args.enabled, true),
    channelIds: parseIdList(args.trapChannelIds, '--trap-channel-ids'),
    logChannelId: parseId(args.logChannelId, '--log-channel-id', { required: false }),
    reviewChannelId: parseId(args.reviewChannelId, '--review-channel-id'),
    timeoutMinutes: parseNumber(args.timeoutMinutes, 60),
    autoBanEnabled: parseBoolean(args.autoBan, false),
    banMode: args.banMode || 'delayed',
    banDelayMinutes: parseNumber(args.banDelayMinutes, 10),
    language: args.language,
    webhookEnabled: parseBoolean(args.webhookEnabled, false),
    webhookUrls: parseWebhookUrls(args.webhookUrls),
  });

  const saved = await configStore.saveSpamCatcherConfig(guildId, config);
  console.log(JSON.stringify({
    ok: true,
    guildId,
    enabled: saved.enabled,
    trapChannelCount: saved.channelIds.length,
    logChannelId: saved.logChannelId,
    reviewChannelId: saved.reviewChannelId,
    timeoutMinutes: saved.timeoutMinutes,
    autoBanEnabled: saved.autoBanEnabled,
    banMode: saved.banMode,
    banDelayMinutes: saved.banDelayMinutes,
    language: saved.language,
    webhookEnabled: saved.webhookEnabled,
    webhookCount: saved.webhookUrls.length,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(() => {
    configStore.close?.().catch(() => null);
  });
