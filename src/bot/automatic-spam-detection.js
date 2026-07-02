const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorSpacingSize,
} = require('discord.js');
const {
  ContainerBuilder,
  SeparatorBuilder,
  SectionBuilder,
  TextDisplayBuilder,
} = require('@discordjs/builders');
const { parseAllowedGuildIds } = require('./env');
const { createTranslator } = require('./i18n');
const { createModerationWorkflow } = require('./moderation-workflow');
const { createLogger } = require('../lib/logger');

const BAN_PREFIX = 'autospam_ban';
const REMOVE_TIMEOUT_PREFIX = 'autospam_remove_timeout';
const CONFIG_CACHE_TTL_MS = 5000;
const DISCORD_TIMEOUT_MAX_MS = 28 * 24 * 60 * 60 * 1000;

function createAutomaticSpamDetectionManager({ client, configStore }) {
  const allowedGuildIds = parseAllowedGuildIds();
  const configCache = new Map();
  const attachmentSessionByAuthor = new Map();
  const messageQueueByAuthor = new Map();
  const logger = createLogger('automatic-spam-detection');

  function isGuildAllowed(guildId) {
    if (!guildId) return false;
    return allowedGuildIds.size === 0 || allowedGuildIds.has(guildId);
  }

  async function getConfig(guildId) {
    const cached = configCache.get(guildId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const value = await configStore.getSpamCatcherConfig(guildId);
    configCache.set(guildId, { value, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
    return value;
  }

  function authorKey(guildId, userId) {
    return `${guildId}:${userId}`;
  }

  function safeError(error) {
    return String(error?.message || error || 'Unknown error').slice(0, 500);
  }

  function isUnknownMemberError(error) {
    return error?.code === 10007 || safeError(error).toLowerCase().includes('unknown member');
  }

  function existingTimeoutUntil(member) {
    const until = member?.communicationDisabledUntilTimestamp;
    return Number.isFinite(until) && until > Date.now() ? new Date(until) : null;
  }

  function timestamp(date, style = 'R') {
    if (!date) return null;
    return `<t:${Math.floor(new Date(date).getTime() / 1000)}:${style}>`;
  }

  function reasonText(reason, t) {
    if (reason === 'same_author_2plus_attachments_in_2plus_channels') {
      return t('automatic.reasonCrossChannel');
    }
    return t('automatic.reasonRepeated');
  }

  function statusText(event, t) {
    if (event.status === 'banned') return t('automatic.statusBanned', { userId: event.decidedBy });
    if (event.status === 'timeout_removed') return t('automatic.statusTimeoutRemoved', { userId: event.decidedBy });
    if (event.status === 'user_unavailable') return t('automatic.statusUserUnavailable', { userId: event.decidedBy });
    if (event.status === 'ban_failed') return t('automatic.statusBanFailed', { error: event.decisionError || 'unknown error' });
    if (event.status === 'timeout_remove_failed') return t('automatic.statusTimeoutRemoveFailed', { error: event.decisionError || 'unknown error' });
    return t('automatic.statusWaiting');
  }

  function spammerStateText(userState, t) {
    return userState?.spammer ? t('automatic.spammerStateActive') : t('automatic.spammerStateCleared');
  }

  function eventAccentColor(event) {
    if (event.status === 'danger') return 0xef4444;
    if (event.status === 'banned' || event.status === 'ban_failed') return 0x7f1d1d;
    if (event.status === 'timeout_remove_failed') return 0xf59e0b;
    return 0x22c55e;
  }

  function divider() {
    return new SeparatorBuilder()
      .setDivider(true)
      .setSpacing(SeparatorSpacingSize.Small);
  }

  function sectionWithLink(content, label, url) {
    return new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
      .setButtonAccessory(
        new ButtonBuilder()
          .setLabel(label)
          .setStyle(ButtonStyle.Link)
          .setURL(url)
      );
  }

  function buildDangerPayload(event, userState, config = {}) {
    const t = createTranslator(config.language);
    const messageUrl = `https://discord.com/channels/${event.guildId}/${event.sourceChannelId}/${event.sourceMessageId}`;
    const channelUrl = `https://discord.com/channels/${event.guildId}/${event.sourceChannelId}`;
    const channelList = event.channels.length > 0
      ? event.channels.map((channelId) => `<#${channelId}>`).join(', ')
      : `<#${event.sourceChannelId}>`;
    const timeoutLine = event.timeoutStatus === 'applied'
      ? `${t('automatic.timeout')}: **${t('automatic.timeoutApplied')}** ${t('automatic.until')} ${timestamp(event.timeoutUntil)}`
      : event.timeoutStatus === 'already_active'
        ? `${t('automatic.timeout')}: **${t('automatic.timeoutAlreadyActive')}** ${t('automatic.until')} ${timestamp(event.timeoutUntil)}`
      : event.timeoutStatus === 'failed'
        ? `${t('automatic.timeout')}: **${t('automatic.timeoutFailed')}** (${event.timeoutError || 'unknown error'})`
        : `${t('automatic.timeout')}: **${t('automatic.timeoutPending')}**`;

    const container = new ContainerBuilder()
      .setAccentColor(eventAccentColor(event))
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
          `# ${t('automatic.dangerTitle')}`,
          `-# ${t('automatic.eventId')}: \`${event.id}\``,
        ].join('\n'))
      )
      .addSeparatorComponents(divider())
      .addSectionComponents(sectionWithLink([
        `### ${t('automatic.incident')}`,
        `${t('automatic.user')}: <@${event.userId}> (\`${event.userId}\`)`,
        `${t('automatic.reason')}: **${reasonText(event.reason, t)}**`,
      ].join('\n'), t('automatic.openMessage'), messageUrl))
      .addSeparatorComponents(divider())
      .addSectionComponents(sectionWithLink([
        `### ${t('automatic.evidence')}`,
        `${t('automatic.sourceChannel')}: <#${event.sourceChannelId}>`,
        `${t('automatic.attachmentsOnTrigger')}: \`${event.attachmentCount}\``,
        `${t('automatic.channelsInWindow')}: ${channelList}`,
      ].join('\n'), t('automatic.openChannel'), channelUrl))
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
          `### ${t('automatic.window')}`,
          `${timestamp(event.windowStartedAt, 'T')} - ${timestamp(event.windowExpiresAt, 'T')}`,
        ].join('\n'))
      )
      .addSeparatorComponents(divider())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
          `### ${t('automatic.moderationState')}`,
          `${t('automatic.spammerState')}: **${spammerStateText(userState, t)}**`,
          `${t('automatic.spammerCount')}: \`${userState?.spammerCount || 0}\``,
          timeoutLine,
          `${t('automatic.status')}: **${statusText(event, t)}**`,
        ].filter(Boolean).join('\n'))
      );

    if (event.appealMessage) {
      container
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent([
            `### ${t('automatic.appeal')}`,
            event.appealMessage,
          ].join('\n'))
        );
    }

    if (event.status === 'danger') {
      container
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`-# ${t('automatic.adminHint')}`)
        )
        .addSeparatorComponents(divider())
        .addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`${REMOVE_TIMEOUT_PREFIX}:${event.id}`)
              .setLabel(t('automatic.removeTimeout'))
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(`${BAN_PREFIX}:${event.id}`)
              .setLabel(t('automatic.banUser'))
              .setStyle(ButtonStyle.Danger)
          )
        );
    }

    return {
      flags: MessageFlags.IsComponentsV2,
      components: [container],
      allowedMentions: { parse: [] },
    };
  }

  async function getModeratableMember(message) {
    const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member?.moderatable) return null;
    return member;
  }

  async function getLogChannel(guild, config) {
    if (!config.logChannelId) return null;
    const channel = await guild.channels.fetch(config.logChannelId).catch(() => null);
    return channel?.isTextBased() ? channel : null;
  }

  async function loadSessionFromDb(guildId, userId, config, messageAtMs) {
    const row = await configStore.getAutomaticSpamDetectionUser(guildId, userId).catch(() => null);
    if (!row?.lastAlertAt) return null;

    const startedAtMs = row.lastAlertAt.getTime();
    const windowMs = config.attachmentSpamWindowSeconds * 1000;
    if (!Number.isFinite(startedAtMs) || messageAtMs - startedAtMs > windowMs) return null;

    return {
      startedAtMs,
      events: [
        {
          messageId: row.lastMessageId,
          channelId: row.lastChannelId,
          attachmentCount: config.attachmentSpamThreshold,
          timestampMs: startedAtMs,
        },
      ].filter((event) => event.channelId),
    };
  }

  async function timeoutUser(guild, member, event, config) {
    const timeoutMs = Math.min(config.attachmentSpamTimeoutMinutes * 60 * 1000, DISCORD_TIMEOUT_MAX_MS);
    const timeoutUntil = new Date(Date.now() + timeoutMs);
    const alreadyTimedOutUntil = existingTimeoutUntil(member);
    if (alreadyTimedOutUntil) {
      logger.info('Automatic Spam Detection user already timed out', {
        guildId: guild.id,
        userId: member.id,
        eventId: event.id,
        timeoutUntil: alreadyTimedOutUntil.toISOString(),
      });
      return { timeoutStatus: 'already_active', timeoutUntil: alreadyTimedOutUntil, timeoutError: null };
    }

    try {
      await member.timeout(timeoutMs, `Automatic Spam Detection event ${event.id}`);
      return { timeoutStatus: 'applied', timeoutUntil, timeoutError: null };
    } catch (error) {
      logger.warn(isUnknownMemberError(error)
        ? 'Automatic Spam Detection user is no longer in guild'
        : 'Failed to timeout automatic spam detection user', {
        guildId: guild.id,
        userId: member.id,
        eventId: event.id,
        error: safeError(error),
      });
      return { timeoutStatus: 'failed', timeoutUntil: null, timeoutError: safeError(error) };
    }
  }

  async function sendDangerMessage(guild, config, event, userState) {
    const logChannel = await getLogChannel(guild, config);
    if (!logChannel) {
      logger.warn('Automatic Spam Detection danger has no log channel', {
        guildId: guild.id,
        eventId: event.id,
      });
      return null;
    }

    const message = await logChannel.send(buildDangerPayload(event, userState, config)).catch((error) => {
      logger.error('Failed to send Automatic Spam Detection danger card', {
        guildId: guild.id,
        eventId: event.id,
        error: safeError(error),
      });
      return null;
    });
    if (!message) return null;
    return configStore.updateAutomaticSpamDetectionReviewMessage(event.id, logChannel.id, message.id).catch(() => event);
  }

  async function sendOrUpdateDangerMessage(event) {
    if (!event?.reviewChannelId || !event.reviewMessageId) return null;
    const guild = client.guilds.cache.get(event.guildId) || await client.guilds.fetch(event.guildId).catch(() => null);
    if (!guild) return null;
    const channel = await guild.channels.fetch(event.reviewChannelId).catch(() => null);
    if (!channel?.isTextBased()) return null;
    const message = await channel.messages.fetch(event.reviewMessageId).catch(() => null);
    if (!message) return null;
    const userState = await configStore.getAutomaticSpamDetectionUser(event.guildId, event.userId).catch(() => null);
    const config = await getConfig(event.guildId).catch(() => ({}));
    return message.edit(buildDangerPayload(event, userState, config)).catch((error) => {
      logger.error('Failed to update Automatic Spam Detection danger card', {
        guildId: event.guildId,
        eventId: event.id,
        error: safeError(error),
      });
      return null;
    });
  }

  const moderationWorkflow = createModerationWorkflow({
    client,
    source: 'autospam',
    getConfig,
    isGuildAllowed,
    loadEvent: (eventId) => configStore.getAutomaticSpamDetectionEventById(eventId),
    saveAppeal: (eventId, message) => configStore.markAutomaticSpamDetectionAppealed(eventId, message),
    updateReviewMessage: sendOrUpdateDangerMessage,
  });

  async function recordAlert(message, config, messageAt) {
    await configStore.recordAutomaticSpamDetectionAlert({
      guildId: message.guild.id,
      userId: message.author.id,
      channelId: message.channelId,
      messageId: message.id,
      alertAt: messageAt,
    });
    logger.info('Attachment spam alert recorded', {
      guildId: message.guild.id,
      channelId: message.channelId,
      userId: message.author.id,
      threshold: config.attachmentSpamThreshold,
      windowSeconds: config.attachmentSpamWindowSeconds,
    });
  }

  async function handleDanger({ message, member, config, danger }) {
    let userState = await configStore.markAutomaticSpamDetectionDangerUser({
      guildId: message.guild.id,
      userId: message.author.id,
      channelId: message.channelId,
      messageId: message.id,
      dangerAt: message.createdAt || new Date(),
    });

    let event = await configStore.createAutomaticSpamDetectionEvent({
      guildId: message.guild.id,
      userId: message.author.id,
      sourceChannelId: message.channelId,
      sourceMessageId: message.id,
      attachmentCount: message.attachments.size,
      reason: danger.reason,
      channels: danger.channels,
      windowStartedAt: danger.windowStartedAt,
      windowExpiresAt: danger.windowExpiresAt,
    });

    const timeoutResult = await timeoutUser(message.guild, member, event, config);
    event = await configStore.updateAutomaticSpamDetectionTimeout(event.id, timeoutResult).catch(() => ({
      ...event,
      ...timeoutResult,
    }));
    userState = await configStore.getAutomaticSpamDetectionUser(event.guildId, event.userId).catch(() => userState);

    await moderationWorkflow.sendTimeoutDm({ userId: message.author.id, guildName: message.guild.name, eventId: event.id, config });

    await sendDangerMessage(message.guild, config, event, userState);
    logger.warn('Attachment spam danger recorded', {
      guildId: message.guild.id,
      channelId: message.channelId,
      userId: message.author.id,
      eventId: event.id,
      timeoutStatus: event.timeoutStatus,
    });
  }

  async function handleQueuedMessage(message) {
    if (!message.guild || message.author?.bot || message.webhookId) return;
    if (!isGuildAllowed(message.guild.id)) return;

    const config = await getConfig(message.guild.id).catch((error) => {
      logger.error('Failed to load Automatic Spam Detection config', {
        guildId: message.guild.id,
        error: safeError(error),
      });
      return null;
    });
    if (!config?.automaticSpamDetectionEnabled) return;

    const attachmentCount = message.attachments?.size || 0;
    if (attachmentCount < config.attachmentSpamThreshold) return;

    const member = await getModeratableMember(message);
    if (!member) return;

    const messageAt = message.createdAt || new Date();
    const messageAtMs = messageAt.getTime();
    const windowMs = config.attachmentSpamWindowSeconds * 1000;
    const key = authorKey(message.guild.id, message.author.id);
    let session = attachmentSessionByAuthor.get(key);
    if (!session) {
      session = await loadSessionFromDb(message.guild.id, message.author.id, config, messageAtMs);
    }

    const currentEvent = {
      messageId: message.id,
      channelId: message.channelId,
      attachmentCount,
      timestampMs: messageAtMs,
    };

    if (session && messageAtMs - session.startedAtMs <= windowMs) {
      const channels = [...new Set([...session.events.map((item) => item.channelId), message.channelId].filter(Boolean))];
      session.events.push(currentEvent);
      attachmentSessionByAuthor.set(key, session);
      await handleDanger({
        message,
        member,
        config,
        danger: {
          reason: channels.length >= 2
            ? 'same_author_2plus_attachments_in_2plus_channels'
            : 'same_author_repeated_2plus_attachments_in_window',
          channels,
          windowStartedAt: new Date(session.startedAtMs),
          windowExpiresAt: new Date(session.startedAtMs + windowMs),
        },
      });
      return;
    }

    attachmentSessionByAuthor.set(key, {
      startedAtMs: messageAtMs,
      events: [currentEvent],
    });
    await recordAlert(message, config, messageAt);
  }

  async function handleMessage(message) {
    if (!message.guild || message.author?.bot || message.webhookId) return;
    const key = authorKey(message.guild.id, message.author.id);
    const previous = messageQueueByAuthor.get(key) || Promise.resolve();
    const current = previous
      .catch(() => null)
      .then(() => handleQueuedMessage(message));
    messageQueueByAuthor.set(key, current);
    try {
      await current;
    } finally {
      if (messageQueueByAuthor.get(key) === current) {
        messageQueueByAuthor.delete(key);
      }
    }
  }

  async function requireAdmin(interaction, action) {
    if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
    await interaction.reply({
      content: `Only users with Administrator permission can ${action}.`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => null);
    return false;
  }

  async function getInteractionEvent(interaction) {
    const [, eventIdRaw] = interaction.customId.split(':');
    const eventId = Number(eventIdRaw);
    if (!Number.isFinite(eventId)) return null;
    const event = await configStore.getAutomaticSpamDetectionEventById(eventId).catch(() => null);
    if (!event || !isGuildAllowed(event.guildId)) return null;
    return event;
  }

  async function editDangerMessage(interaction, event) {
    const userState = await configStore.getAutomaticSpamDetectionUser(event.guildId, event.userId).catch(() => null);
    const config = await getConfig(event.guildId).catch(() => ({}));
    await interaction.editReply(buildDangerPayload(event, userState, config)).catch((error) => {
      logger.error('Failed to edit Automatic Spam Detection danger card', {
        guildId: event.guildId,
        eventId: event.id,
        error: safeError(error),
      });
    });
  }

  async function handleRemoveTimeout(interaction) {
    if (!await requireAdmin(interaction, 'remove Automatic Spam Detection timeouts')) return;
    const event = await getInteractionEvent(interaction);
    if (!event) {
      await interaction.reply({ content: 'Automatic Spam Detection event not found.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }
    if (event.status !== 'danger') {
      await interaction.reply({ content: 'This Automatic Spam Detection event is already resolved.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }

    await interaction.deferUpdate().catch(() => null);
    let updated = event;
    try {
      const guild = await client.guilds.fetch(event.guildId);
      const member = await guild.members.fetch(event.userId).catch((error) => {
        if (isUnknownMemberError(error)) return null;
        throw error;
      });
      if (!member) {
        await configStore.resetAutomaticSpamDetectionSpammer(event.guildId, event.userId);
        updated = await configStore.updateAutomaticSpamDetectionDecision(
          event.id,
          'user_unavailable',
          interaction.user.id,
          'User is no longer in this guild.'
        );
        await editDangerMessage(interaction, updated || event);
        return;
      }
      await member.timeout(null, `Automatic Spam Detection timeout removed by ${interaction.user.id}`);
      await configStore.resetAutomaticSpamDetectionSpammer(event.guildId, event.userId);
      updated = await configStore.updateAutomaticSpamDetectionDecision(event.id, 'timeout_removed', interaction.user.id);
    } catch (error) {
      updated = await configStore.updateAutomaticSpamDetectionDecision(
        event.id,
        'timeout_remove_failed',
        interaction.user.id,
        safeError(error)
      ).catch(() => ({ ...event, status: 'timeout_remove_failed', decidedBy: interaction.user.id, decisionError: safeError(error) }));
    }
    await editDangerMessage(interaction, updated || event);
  }

  async function handleBanUser(interaction) {
    if (!await requireAdmin(interaction, 'ban Automatic Spam Detection users')) return;
    const event = await getInteractionEvent(interaction);
    if (!event) {
      await interaction.reply({ content: 'Automatic Spam Detection event not found.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }
    if (event.status !== 'danger') {
      await interaction.reply({ content: 'This Automatic Spam Detection event is already resolved.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }

    await interaction.deferUpdate().catch(() => null);
    let updated = event;
    try {
      const guild = await client.guilds.fetch(event.guildId);
      await guild.members.ban(event.userId, {
        reason: `Automatic Spam Detection event ${event.id}`,
        deleteMessageSeconds: 0,
      });
      await configStore.resetAutomaticSpamDetectionSpammer(event.guildId, event.userId);
      updated = await configStore.updateAutomaticSpamDetectionDecision(event.id, 'banned', interaction.user.id);
    } catch (error) {
      updated = await configStore.updateAutomaticSpamDetectionDecision(
        event.id,
        'ban_failed',
        interaction.user.id,
        safeError(error)
      ).catch(() => ({ ...event, status: 'ban_failed', decidedBy: interaction.user.id, decisionError: safeError(error) }));
    }
    await editDangerMessage(interaction, updated || event);
  }

  async function handleInteraction(interaction) {
    if (await moderationWorkflow.handleInteraction(interaction)) {
      return true;
    }
    if (interaction.isButton() && interaction.customId.startsWith(`${REMOVE_TIMEOUT_PREFIX}:`)) {
      await handleRemoveTimeout(interaction);
      return true;
    }
    if (interaction.isButton() && interaction.customId.startsWith(`${BAN_PREFIX}:`)) {
      await handleBanUser(interaction);
      return true;
    }
    return false;
  }

  return {
    handleMessage,
    handleInteraction,
  };
}

module.exports = { createAutomaticSpamDetectionManager };
