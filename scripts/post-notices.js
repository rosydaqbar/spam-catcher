require('dotenv').config();

const configStore = require('../src/config-store');
const { DISCORD_TOKEN, requireRuntimeEnv } = require('../src/bot/env');

const USAGE = `Usage:
  node scripts/post-notices.js --guild-id 123
  node scripts/post-notices.js --all

Options:
  --guild-id <id>  Post notices for one configured guild.
  --all           Post notices for every enabled configured guild.
  --help          Show this help.
`;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--help' || item === '-h') return { help: true };
    if (item === '--all') {
      args.all = true;
      continue;
    }
    if (item === '--guild-id') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--guild-id requires a value.');
      args.guildId = value.trim();
      index += 1;
      continue;
    }
    if (item.startsWith('--guild-id=')) {
      args.guildId = item.slice('--guild-id='.length).trim();
      continue;
    }
    throw new Error(`Unexpected argument: ${item}`);
  }
  return args;
}

function formatNoticeMinutes(minutes) {
  const safeMinutes = Math.max(1, Math.floor(Number(minutes) || 1));
  if (safeMinutes % 1440 === 0) {
    const days = safeMinutes / 1440;
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  if (safeMinutes % 60 === 0) {
    const hours = safeMinutes / 60;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${safeMinutes} minute${safeMinutes === 1 ? '' : 's'}`;
}

function buildSpamCatcherNoticePayload(caughtCount, config) {
  const safeCount = Math.max(0, Math.floor(Number(caughtCount) || 0));
  const timeoutText = formatNoticeMinutes(config.timeoutMinutes);
  const banDelayText = formatNoticeMinutes(config.banDelayMinutes);
  const actionId = config.autoBanEnabled
    ? config.banMode === 'immediate'
      ? 'kamu akan langsung terkena `ban`.'
      : config.banMode === 'after_timeout'
        ? `kamu akan terkena \`timeout\` selama ${timeoutText}, lalu terkena \`ban\` saat timeout berakhir.`
        : `kamu akan terkena \`timeout\` selama ${timeoutText}, lalu terkena \`ban\` setelah periode appeal selama ${banDelayText}.`
    : `kamu akan terkena \`timeout\` selama ${timeoutText}.`;
  const appealId = config.autoBanEnabled && config.banMode === 'immediate'
    ? 'Jika ini adalah kesalahan, silakan hubungi admin server.'
    : 'Jika kamu terkena timeout, silakan kirim private message ke salah satu admin yang sedang online atau gunakan tombol appeal jika tersedia.';
  const actionEn = config.autoBanEnabled
    ? config.banMode === 'immediate'
      ? 'you will be `banned` immediately.'
      : config.banMode === 'after_timeout'
        ? `you will receive a \`timeout\` for ${timeoutText}, then be \`banned\` when the timeout ends.`
        : `you will receive a \`timeout\` for ${timeoutText}, then be \`banned\` after a ${banDelayText} appeal window.`
    : `you will receive a \`timeout\` for ${timeoutText}.`;
  const appealEn = config.autoBanEnabled && config.banMode === 'immediate'
    ? 'If this was a mistake, please contact a server admin.'
    : 'If you are timed out, please send a private message to one of the online admins or use the appeal button if available.';

  return {
    flags: 32768,
    components: [
      {
        type: 17,
        components: [
          {
            type: 10,
            content: [
              '# 🚫 Dilarang Mengirim Pesan di Channel Ini',
              `⚠️ Channel ini dibuat untuk menangkap spammer. Jika kamu mengirim pesan di channel ini, ${actionId} ${appealId}`,
              '',
              '## 😈 Jangan Berani-Berani Mencoba',
              'Kalau cuma mau tes, sistem tetap akan menangkap kamu.',
              '',
              `-# Jumlah user yang sudah tertangkap di channel ini: \`${safeCount}\``,
            ].join('\n'),
          },
          { type: 14, divider: true, spacing: 1 },
          {
            type: 10,
            content: [
              '# 🚫 Do Not Send Messages in This Channel',
              `⚠️ This channel is made to catch spammers. If you send a message in this channel, ${actionEn} ${appealEn}`,
              '',
              "## 😈 Don't Even Think About Trying",
              'Even if you are just testing, the system will still catch you.',
              '',
              `-# Caught users in this channel: \`${safeCount}\``,
            ].join('\n'),
          },
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

function withWebhookComponentsEnabled(webhookUrl, waitForMessage = false) {
  const url = new URL(webhookUrl);
  url.searchParams.set('with_components', 'true');
  if (waitForMessage) {
    url.searchParams.set('wait', 'true');
  }
  return url.toString();
}

async function postWebhookNotice(channelId, webhookUrl, payload) {
  const response = await fetch(withWebhookComponentsEnabled(webhookUrl, true), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Webhook rejected notice for ${channelId}: ${response.status} ${detail}`);
  }
  const message = await response.json().catch(() => null);
  return message?.id ? { channelId, messageId: message.id, deliveryMethod: 'webhook', webhookUrl } : null;
}

async function postBotNotice(channelId, payload) {
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${DISCORD_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Discord rejected notice for ${channelId}: ${response.status} ${detail}`);
  }
  const message = await response.json().catch(() => null);
  return message?.id ? { channelId, messageId: message.id, deliveryMethod: 'bot' } : null;
}

async function postGuildNotices(guildId, config) {
  if (!config.enabled) {
    throw new Error(`Spam Catcher is disabled for guild ${guildId}.`);
  }
  if (!config.channelIds.length) {
    throw new Error(`No Spam Catcher trap channels configured for guild ${guildId}.`);
  }

  const webhookByChannel = new Map(
    config.webhookEnabled ? config.webhookUrls.map((item) => [item.channelId, item.webhookUrl]) : []
  );
  const notices = [];

  for (const channelId of config.channelIds) {
    const count = await configStore.getSpamCatcherCaughtCount(guildId, channelId).catch(() => 0);
    const payload = buildSpamCatcherNoticePayload(count, config);
    const webhookUrl = webhookByChannel.get(channelId);
    const notice = webhookUrl
      ? await postWebhookNotice(channelId, webhookUrl, payload)
      : await postBotNotice(channelId, payload);
    if (notice) notices.push(notice);
  }

  await configStore.saveSpamCatcherNoticeMessages(guildId, notices);
  return notices;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }
  requireRuntimeEnv();
  if (args.all && args.guildId) {
    throw new Error('Use either --guild-id or --all, not both.');
  }
  if (!args.all && !args.guildId) {
    throw new Error(`Missing target.\n\n${USAGE}`);
  }

  const targets = args.all
    ? (await configStore.listSpamCatcherConfigs())
      .filter((row) => row.config.enabled)
      .map((row) => ({ guildId: row.guildId, config: row.config }))
    : [{ guildId: args.guildId, config: await configStore.getSpamCatcherConfig(args.guildId) }];

  if (!targets.length) {
    console.log('No enabled Spam Catcher guild configs found.');
    return;
  }

  for (const target of targets) {
    const notices = await postGuildNotices(target.guildId, target.config);
    console.log(
      `Guild ${target.guildId}: saved ${notices.length} Spam Catcher notice message${notices.length === 1 ? '' : 's'}.`
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    configStore.close?.().catch(() => null);
  });
