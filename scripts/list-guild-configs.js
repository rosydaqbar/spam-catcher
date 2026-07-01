require('dotenv').config();

const configStore = require('../src/config-store');
const { requireRuntimeEnv } = require('../src/bot/env');

const USAGE = `Usage:
  node scripts/list-guild-configs.js [--json]

Lists configured Spam Catcher guilds. No secrets are printed.
`;

function parseArgs(argv) {
  const args = new Set(argv);
  if (args.has('--help') || args.has('-h')) return { help: true };
  return { json: args.has('--json') };
}

function summarize(row) {
  return {
    guildId: row.guildId,
    enabled: row.config.enabled,
    trapChannelCount: row.config.channelIds.length,
    logChannelId: row.config.logChannelId,
    reviewChannelId: row.config.reviewChannelId,
    banMode: row.config.banMode,
    automaticSpamDetectionEnabled: row.config.automaticSpamDetectionEnabled,
    webhookEnabled: row.config.webhookEnabled,
    webhookCount: row.config.webhookUrls.length,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  requireRuntimeEnv();

  const rows = (await configStore.listSpamCatcherConfigs()).map(summarize);
  if (args.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  if (!rows.length) {
    console.log('No Spam Catcher guild configs found.');
    return;
  }

  console.table(rows);
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(() => {
    configStore.close?.().catch(() => null);
  });
