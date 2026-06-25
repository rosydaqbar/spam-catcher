require('dotenv').config();

const configStore = require('../src/config-store');
const { DISCORD_TOKEN, DISCORD_GUILD_ID, requireRuntimeEnv } = require('../src/bot/env');

requireRuntimeEnv();

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

async function main() {
  const guildId = DISCORD_GUILD_ID || process.env.SELECTED_GUILD_ID;
  if (!guildId) {
    throw new Error('DISCORD_GUILD_ID is required to post notices.');
  }

  const config = await configStore.getSpamCatcherConfig(guildId);
  if (!config.channelIds.length) {
    throw new Error('No Spam Catcher channels configured. Set SPAM_CATCHER_CHANNEL_IDS or spam_catcher_config.');
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
  console.log(`Saved ${notices.length} Spam Catcher notice message${notices.length === 1 ? '' : 's'}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    configStore.close?.().catch(() => null);
  });
