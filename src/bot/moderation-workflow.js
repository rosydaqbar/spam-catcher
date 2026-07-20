const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextInputBuilder,
  TextInputStyle,
  TextDisplayBuilder,
} = require('discord.js');
const { createTranslator } = require('./i18n');

const APPEAL_PREFIX = 'moderation_appeal';
const APPEAL_MODAL_PREFIX = 'moderation_appeal_modal';
const DISCORD_TIMEOUT_MAX_MS = (28 * 24 * 60 * 60 * 1000) - 60_000;

function moderationActionForConfig(config = {}) {
  if (!config.autoBanEnabled) return 'timeout';
  if (config.banMode === 'immediate') return 'ban_immediate';
  if (config.banMode === 'after_timeout') return 'ban_after_timeout';
  return 'ban_delayed';
}

function planModerationPolicy({ config = {}, timeoutMinutes, now = new Date() }) {
  const moderationAction = moderationActionForConfig(config);
  const plannedAt = new Date(now);
  const nowMs = Number.isFinite(plannedAt.getTime()) ? plannedAt.getTime() : Date.now();
  const configuredTimeoutMs = Number(timeoutMinutes) * 60 * 1000;
  const timeoutMs = moderationAction === 'ban_immediate'
    ? null
    : Math.min(
      Number.isFinite(configuredTimeoutMs) ? Math.max(60_000, Math.floor(configuredTimeoutMs)) : 60_000,
      DISCORD_TIMEOUT_MAX_MS
    );
  const timeoutUntil = timeoutMs === null ? null : new Date(nowMs + timeoutMs);
  const configuredDelayMs = Number(config.banDelayMinutes) * 60 * 1000;
  const delayMs = Number.isFinite(configuredDelayMs)
    ? Math.max(60_000, Math.floor(configuredDelayMs))
    : 60_000;
  const banAfter = moderationAction === 'ban_delayed'
    ? new Date(nowMs + delayMs)
    : moderationAction === 'ban_after_timeout'
      ? timeoutUntil
      : moderationAction === 'ban_immediate'
        ? new Date(nowMs + 60_000)
        : null;

  return {
    moderationAction,
    timeoutMs,
    timeoutUntil,
    banStatus: moderationAction === 'timeout' ? 'none' : 'pending',
    banAfter,
  };
}

function createModerationWorkflow({
  client,
  source,
  getConfig,
  isGuildAllowed,
  loadEvent,
  saveAppeal,
  updateReviewMessage,
}) {
  function appealCustomId(eventId) {
    return `${APPEAL_PREFIX}:${source}:${eventId}`;
  }

  function appealModalCustomId(eventId) {
    return `${APPEAL_MODAL_PREFIX}:${source}:${eventId}`;
  }

  function appealButton(eventId, config = {}) {
    const t = createTranslator(config.language);
    return new ActionRowBuilder().addComponents(
      appealButtonComponent(eventId, t)
    );
  }

  function appealButtonComponent(eventId, t) {
    return new ButtonBuilder()
      .setCustomId(appealCustomId(eventId))
      .setLabel(t('moderation.appealButton'))
      .setStyle(ButtonStyle.Secondary);
  }

  function divider() {
    return new SeparatorBuilder()
      .setDivider(true)
      .setSpacing(SeparatorSpacingSize.Small);
  }

  function timeoutReasonKey(alreadyTimedOut) {
    if (alreadyTimedOut) return 'moderation.timeoutDmReasonAlreadyActive';
    if (source === 'autospam') return 'moderation.timeoutDmReasonAutomatic';
    return 'moderation.timeoutDmReasonSpamCatcher';
  }

  function buildTimeoutDmPayload({ guildName, eventId, config, alreadyTimedOut }) {
    const t = createTranslator(config.language);
    const container = new ContainerBuilder()
      .setAccentColor(alreadyTimedOut ? 0xf59e0b : 0xef4444)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
          `# ${t(alreadyTimedOut ? 'moderation.timeoutDmTitleAlreadyActive' : 'moderation.timeoutDmTitle')}`,
          `-# ${t('moderation.timeoutDmServer', { guild: guildName })}`,
        ].join('\n'))
      )
      .addSeparatorComponents(divider())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
          `### ${t('moderation.timeoutDmReasonTitle')}`,
          t(timeoutReasonKey(alreadyTimedOut), { guild: guildName }),
        ].join('\n'))
      )
      .addSeparatorComponents(divider())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
          `### ${t('moderation.timeoutDmNextTitle')}`,
          t('moderation.timeoutDmNextBody'),
          '',
          `-# ${t('moderation.timeoutDmFooter')}`,
        ].join('\n'))
      )
      .addSeparatorComponents(divider())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`### ${t('moderation.timeoutDmMistakePrompt')}`)
      )
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(appealButtonComponent(eventId, t))
      );

    return {
      flags: MessageFlags.IsComponentsV2,
      components: [container],
      allowedMentions: { parse: [] },
    };
  }

  function buildSimpleDmPayload({ title, body, accentColor }) {
    return {
      flags: MessageFlags.IsComponentsV2,
      components: [
        new ContainerBuilder()
          .setAccentColor(accentColor)
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent([
              `# ${title}`,
              body,
            ].join('\n\n'))
          ),
      ],
      allowedMentions: { parse: [] },
    };
  }

  async function dmUser(userId, payload) {
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) return false;
    return user.send(payload).then(() => true).catch(() => false);
  }

  async function sendTimeoutDm({ userId, guildName, eventId, config, alreadyTimedOut = false }) {
    return dmUser(userId, buildTimeoutDmPayload({ guildName, eventId, config, alreadyTimedOut }));
  }

  async function sendBanDm(userId, config = {}) {
    const t = createTranslator(config.language);
    return dmUser(userId, buildSimpleDmPayload({
      title: t('moderation.banDmTitle'),
      body: t('moderation.banDm'),
      accentColor: 0xef4444,
    }));
  }

  async function sendTimeoutRemovedDm({ userId, guildName, config }) {
    const t = createTranslator(config.language);
    return dmUser(userId, buildSimpleDmPayload({
      title: t('moderation.timeoutRemovedDmTitle'),
      body: t('moderation.timeoutRemovedDm', { guild: guildName }),
      accentColor: 0x22c55e,
    }));
  }

  async function executeBan({ guild, userId, eventId, config = {}, reason }) {
    const dmSent = await sendBanDm(userId, config);
    try {
      await guild.members.ban(userId, {
        reason: reason || `Spam Catcher event ${eventId}`,
        deleteMessageSeconds: 0,
      });
      return {
        banned: true,
        bannedAt: new Date(),
        dmSent,
        error: null,
      };
    } catch (error) {
      return {
        banned: false,
        bannedAt: null,
        dmSent,
        error,
      };
    }
  }

  async function handleAppealButton(interaction) {
    const [, customSource, eventIdRaw] = interaction.customId.split(':');
    if (customSource !== source) return false;
    const eventId = Number(eventIdRaw);
    const event = await loadEvent(eventId).catch(() => null);
    const config = event ? await getConfig(event.guildId).catch(() => ({})) : {};
    const t = createTranslator(config.language);
    if (!event || event.userId !== interaction.user.id || !isGuildAllowed(event.guildId)) {
      await interaction.reply({ content: t('moderation.appealNotFound'), flags: MessageFlags.Ephemeral }).catch(() => null);
      return true;
    }

    const modal = new ModalBuilder()
      .setCustomId(appealModalCustomId(eventId))
      .setTitle(t('moderation.appealModalTitle'))
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('appeal_message')
            .setLabel(t('moderation.appealModalQuestion'))
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1000)
        )
      );
    await interaction.showModal(modal);
    return true;
  }

  async function handleAppealModal(interaction) {
    const [, customSource, eventIdRaw] = interaction.customId.split(':');
    if (customSource !== source) return false;
    const eventId = Number(eventIdRaw);
    const existingEvent = await loadEvent(eventId).catch(() => null);
    const config = existingEvent ? await getConfig(existingEvent.guildId).catch(() => ({})) : {};
    const t = createTranslator(config.language);
    if (!existingEvent || existingEvent.userId !== interaction.user.id || !isGuildAllowed(existingEvent.guildId)) {
      await interaction.reply({ content: t('moderation.appealNotFound'), flags: MessageFlags.Ephemeral }).catch(() => null);
      return true;
    }

    const message = interaction.fields.getTextInputValue('appeal_message').trim();
    const event = await saveAppeal(eventId, message).catch(() => null);
    if (!event) {
      await interaction.reply({ content: t('moderation.appealNotFound'), flags: MessageFlags.Ephemeral }).catch(() => null);
      return true;
    }

    const updated = await updateReviewMessage(event).catch(() => null);
    if (!updated) {
      await interaction.reply({ content: t('moderation.appealSavedNoMessage'), flags: MessageFlags.Ephemeral }).catch(() => null);
      return true;
    }
    await interaction.reply({ content: t('moderation.appealSent'), flags: MessageFlags.Ephemeral }).catch(() => null);
    return true;
  }

  function ownsAppealInteraction(interaction) {
    return (interaction.isButton() && interaction.customId.startsWith(`${APPEAL_PREFIX}:${source}:`))
      || (interaction.isModalSubmit() && interaction.customId.startsWith(`${APPEAL_MODAL_PREFIX}:${source}:`));
  }

  async function handleInteraction(interaction) {
    if (interaction.isButton() && interaction.customId.startsWith(`${APPEAL_PREFIX}:${source}:`)) {
      return handleAppealButton(interaction);
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith(`${APPEAL_MODAL_PREFIX}:${source}:`)) {
      return handleAppealModal(interaction);
    }
    return false;
  }

  return {
    appealButton,
    dmUser,
    executeBan,
    handleInteraction,
    ownsAppealInteraction,
    sendBanDm,
    sendTimeoutDm,
    sendTimeoutRemovedDm,
  };
}

module.exports = { createModerationWorkflow, planModerationPolicy };
