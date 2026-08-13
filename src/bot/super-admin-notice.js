const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const {
  ContainerBuilder,
  SeparatorBuilder,
  SectionBuilder,
  TextDisplayBuilder,
} = require('@discordjs/builders');
const { parseSuperAdminUserIds } = require('./env');
const { createTranslator } = require('./i18n');
const { BUTTON_PREFIX } = require('./super-admin-command');

const notifiedLimitUsedGuildDays = new Set();

function resetLimitCustomId(guildId, adminId) {
  return adminId
    ? `${BUTTON_PREFIX}:resetlimit:${guildId}:${adminId}`
    : `${BUTTON_PREFIX}:resetlimit:${guildId}`;
}

function buildGuildAddedDmPayload(t, { guild, guildId, user, userId }) {
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [
      new ContainerBuilder()
        .setAccentColor(0x3b82f6)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent([
            `## ${t('superNotice.guildAddedTitle')}`,
            t('superNotice.guildAddedBody', { guild, guildId, user, userId }),
          ].join('\n'))
        ),
    ],
    allowedMentions: { parse: [] },
  };
}

function buildLimitUsedDmPayload(t, { guild, guildId, limit, adminId }) {
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [
      new ContainerBuilder()
        .setAccentColor(0xef4444)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent([
            `## ${t('superNotice.limitUsedTitle')}`,
            t('superNotice.limitUsedBody', { guild, guildId, limit }),
          ].join('\n'))
        )
        .addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setLabel(t('superNotice.resetLimitButton'))
              .setStyle(ButtonStyle.Primary)
              .setCustomId(resetLimitCustomId(guildId, adminId))
          )
        ),
    ],
    allowedMentions: { parse: [] },
  };
}

function buildLimitResetAnnouncementPayload(t) {
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [
      new ContainerBuilder()
        .setAccentColor(0x22c55e)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent([
            `## ${t('superNotice.limitResetAnnounceTitle')}`,
            t('superNotice.limitResetAnnounceBody'),
          ].join('\n'))
        ),
    ],
    allowedMentions: { parse: [] },
  };
}

async function sendSuperAdminDm(client, userId, payload) {
  const user = await client.users.fetch(userId);
  if (!user) return false;
  await user.send(payload);
  return true;
}

async function sendGuildAddedNotice(client, { guildId, guildName, userId, userName, config }) {
  const t = createTranslator(config.language);
  let sent = 0;
  const failed = [];
  const payload = buildGuildAddedDmPayload(t, {
    guild: guildName,
    guildId,
    user: userName,
    userId,
  });

  for (const superAdminUserId of parseSuperAdminUserIds()) {
    if (superAdminUserId === userId) continue;
    try {
      if (await sendSuperAdminDm(client, superAdminUserId, payload)) sent += 1;
      else failed.push(superAdminUserId);
    } catch (error) {
      failed.push(superAdminUserId);
    }
  }
  return { sent, failed };
}

async function sendLimitUsedNotice(client, { guildId, guildName, limit, adminId, usageDate, config }) {
  const dedupeKey = `${guildId}:${usageDate}`;
  if (notifiedLimitUsedGuildDays.has(dedupeKey)) return { sent: 0, failed: [], skipped: true };
  notifiedLimitUsedGuildDays.add(dedupeKey);

  const t = createTranslator(config.language);
  let sent = 0;
  const failed = [];
  const payload = buildLimitUsedDmPayload(t, {
    guild: guildName,
    guildId,
    limit,
    adminId,
  });

  for (const superAdminUserId of parseSuperAdminUserIds()) {
    try {
      if (await sendSuperAdminDm(client, superAdminUserId, payload)) sent += 1;
      else failed.push(superAdminUserId);
    } catch (error) {
      failed.push(superAdminUserId);
    }
  }
  return { sent, failed, skipped: false };
}

module.exports = {
  resetLimitCustomId,
  buildGuildAddedDmPayload,
  buildLimitUsedDmPayload,
  buildLimitResetAnnouncementPayload,
  sendSuperAdminDm,
  sendGuildAddedNotice,
  sendLimitUsedNotice,
};
