const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const {
  ContainerBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
} = require('@discordjs/builders');
const { parseAllowedGuildIds } = require('./env');
const { createTranslator } = require('./i18n');
const { buildTrapNoticePayload } = require('./trap-notice-payload');

const APPEAL_PREFIX = 'spamcatcher_appeal';
const APPEAL_MODAL_PREFIX = 'spamcatcher_appeal_modal';
const BAN_USER_PREFIX = 'spamcatcher_ban_user';
const REMOVE_TIMEOUT_PREFIX = 'spamcatcher_remove_timeout';
const REMOVE_TIMEOUT_CONFIRM_PREFIX = 'spamcatcher_remove_timeout_confirm';
const REMOVE_TIMEOUT_CANCEL_PREFIX = 'spamcatcher_remove_timeout_cancel';
const DELAYED_BAN_INTERVAL_MS = 30 * 1000;
const CONFIG_CACHE_TTL_MS = 5000;
const DISCORD_TIMEOUT_MAX_MS = 28 * 24 * 60 * 60 * 1000;

function createSpamCatcherManager({ client, configStore }) {
  const allowedGuildIds = parseAllowedGuildIds();
  const configCache = new Map();
  let banInterval = null;
  let delayedBanRunning = false;

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

  function appealButton(eventId, config = {}) {
    const t = createTranslator(config.language);
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${APPEAL_PREFIX}:${eventId}`)
        .setLabel(t('moderation.appealButton'))
        .setStyle(ButtonStyle.Secondary)
    );
  }

  async function dmUser(userId, payload) {
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) return false;
    return user.send(payload).then(() => true).catch(() => false);
  }

  async function createDmChannel(userId) {
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) return null;
    return user.createDM().catch(() => null);
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

  async function getLogChannel(guildId) {
    const config = await configStore.getGuildConfig(guildId).catch(() => null);
    if (!config?.logChannelId) return null;
    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return null;
    const channel = await guild.channels.fetch(config.logChannelId).catch(() => null);
    return channel?.isTextBased() ? channel : null;
  }

  function webhookEditUrl(webhookUrl, messageId) {
    const url = new URL(webhookUrl);
    url.pathname = `${url.pathname.replace(/\/$/, '')}/messages/${messageId}`;
    url.searchParams.set('with_components', 'true');
    return url.toString();
  }

  async function refreshTrapNoticeCount(guild, config, event) {
    const notice = await configStore
      .getSpamCatcherNoticeMessage(event.guildId, event.channelId)
      .catch(() => null);
    if (!notice?.messageId) return;

    const caughtCount = await configStore.getSpamCatcherCaughtCount(event.guildId, event.channelId).catch(() => 0);
    const payload = buildTrapNoticePayload(caughtCount, config);

    if (notice.deliveryMethod === 'webhook' && notice.webhookUrl) {
      await fetch(webhookEditUrl(notice.webhookUrl, notice.messageId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch((error) => {
        console.error('Failed to edit Spam Catcher webhook notice:', error);
      });
      return;
    }

    const channel = await guild.channels.fetch(notice.channelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    const message = await channel.messages.fetch(notice.messageId).catch(() => null);
    if (!message) return;
    await message.edit(payload).catch((error) => {
      console.error('Failed to edit Spam Catcher trap notice:', error);
    });
  }

  async function logAction(event, title, details = []) {
    const logChannel = await getLogChannel(event.guildId);
    if (!logChannel) return;
    await logChannel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [
        new ContainerBuilder()
          .setAccentColor(title.includes('Banned') ? 0xef4444 : 0xf59e0b)
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              [
                `### ${title}`,
                `- User: <@${event.userId}> (\`${event.userId}\`)`,
                `- Channel: <#${event.channelId}> (\`${event.channelId}\`)`,
                event.messageId ? `- Message ID: \`${event.messageId}\`` : null,
                `- Event ID: \`${event.id}\``,
                ...details,
              ].filter(Boolean).join('\n')
            )
          )
          .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# Logged <t:${Math.floor(Date.now() / 1000)}:F>`)
          ),
      ],
      allowedMentions: { parse: [] },
    }).catch((error) => {
      console.error('Failed to send Spam Catcher log:', error);
    });
  }

  function timestamp(date, style = 'R') {
    if (!date) return null;
    return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
  }

  function reviewActionLabel(event) {
    if (event.action === 'ban_immediate') return 'Ban immediately';
    if (event.action === 'ban_after_timeout') return 'Ban after timeout ends';
    if (event.action === 'ban_delayed') return 'Ban after appeal window';
    return 'Timeout only';
  }

  function reviewStatusLabel(event) {
    const labels = {
      caught: 'Caught',
      timed_out: 'Timed out',
      ban_pending: 'Ban pending',
      banned: 'Banned',
      ban_failed: 'Ban failed',
      timeout_failed: 'Timeout failed',
      timeout_removed: 'Timeout removed',
    };
    return labels[event.status] || event.status || 'Unknown';
  }

  function reviewTitle(event) {
    if (event.status === 'banned') return 'Spam Catcher Banned User';
    if (event.status === 'ban_failed') return 'Spam Catcher Ban Failed';
    if (event.status === 'timeout_failed') return 'Spam Catcher Timeout Failed';
    if (event.status === 'timeout_removed') return 'Spam Catcher Timeout Removed';
    return 'Spam Catcher Review';
  }

  function reviewAccentColor(event) {
    if (event.status === 'banned' || event.status === 'ban_failed' || event.status === 'timeout_failed') return 0xef4444;
    if (event.status === 'timeout_removed') return 0x22c55e;
    return 0xf59e0b;
  }

  function scheduledBanLine(event) {
    if (event.status === 'banned' || event.status === 'timeout_removed') return null;
    if (!event.banAfter) return null;
    const scheduledAt = timestamp(event.banAfter);
    if (event.action === 'ban_after_timeout') return `- Ban after timeout ends: ${scheduledAt}`;
    if (event.action === 'ban_delayed') return `- Ban after appeal window: ${scheduledAt}`;
    return `- Scheduled ban: ${scheduledAt}`;
  }

  function catcherMessageLine(event) {
    if (!event.messageId) return `- Catcher message: unavailable in <#${event.channelId}> (\`${event.channelId}\`)`;
    return `- Catcher message: https://discord.com/channels/${event.guildId}/${event.channelId}/${event.messageId}`;
  }

  function canReviewTimeout(event) {
    return event.action !== 'ban_immediate' && (event.status === 'timed_out' || event.status === 'ban_pending');
  }

  function buildReviewComponents(event) {
    const container = new ContainerBuilder()
      .setAccentColor(reviewAccentColor(event))
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          [
            `### ${reviewTitle(event)}`,
            '-# A user was caught by a Spam Catcher trap channel.',
            '',
            `- User: <@${event.userId}> (\`${event.userId}\`)`,
            catcherMessageLine(event),
            `- Action: \`${reviewActionLabel(event)}\``,
            `- Status: **${reviewStatusLabel(event)}**`,
            event.timeoutUntil && event.status !== 'banned' && event.status !== 'timeout_removed'
              ? `- Timeout until: ${timestamp(event.timeoutUntil)}`
              : null,
            scheduledBanLine(event),
            event.bannedAt ? `- Banned: ${timestamp(event.bannedAt, 'F')}` : null,
            event.decidedBy ? `- Decided by: <@${event.decidedBy}>` : null,
            `- Event ID: \`${event.id}\``,
            event.appealMessage ? '' : null,
            event.appealMessage ? `**Appeal:** ${event.appealMessage}` : null,
          ].filter(Boolean).join('\n')
        )
      );

    if (canReviewTimeout(event)) {
      container
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`${BAN_USER_PREFIX}:${event.id}`)
              .setLabel('Ban User')
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId(`${REMOVE_TIMEOUT_PREFIX}:${event.id}`)
              .setLabel('Remove Timeout')
              .setStyle(ButtonStyle.Success)
          )
        );
    }

    return {
      flags: MessageFlags.IsComponentsV2,
      components: [container],
      allowedMentions: { parse: [], users: [event.userId] },
    };
  }

  function buildRemoveTimeoutConfirmationComponents(event, adminId) {
    return {
      flags: MessageFlags.IsComponentsV2,
      components: [
        new ContainerBuilder()
          .setAccentColor(0xf97316)
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              [
                '### Confirm Remove Timeout',
                `- User: <@${event.userId}> (\`${event.userId}\`)`,
                `- Requested by: <@${adminId}>`,
                `- Event ID: \`${event.id}\``,
                '',
                '⚠️ Removing this timeout will let the user send messages again. If they were testing or spamming, they may send spam messages again.',
                event.banAfter ? '🛑 This also cancels the scheduled Spam Catcher ban for this event.' : null,
              ].filter(Boolean).join('\n')
            )
          )
          .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
          .addActionRowComponents(
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`${REMOVE_TIMEOUT_CONFIRM_PREFIX}:${event.id}`)
                .setLabel('Confirm Remove Timeout')
                .setStyle(ButtonStyle.Success),
              new ButtonBuilder()
                .setCustomId(`${REMOVE_TIMEOUT_CANCEL_PREFIX}:${event.id}`)
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
            )
          ),
      ],
      allowedMentions: { parse: [], users: [event.userId] },
    };
  }

  function buildResolvedReviewComponents(event) {
    return buildReviewComponents(event);
  }

  async function sendOrUpdateReviewMessage(guild, event, buildPayload = buildReviewComponents) {
    if (!guild || !event?.reviewChannelId) return null;
    const channel = await guild.channels.fetch(event.reviewChannelId).catch(() => null);
    if (!channel?.isTextBased()) return null;

    const payload = buildPayload(event);
    if (event.reviewMessageId) {
      const existing = await channel.messages.fetch(event.reviewMessageId).catch(() => null);
      if (existing) {
        const edited = await existing.edit(payload).catch((error) => {
          console.error('Failed to edit Spam Catcher review message:', error);
          return null;
        });
        if (edited) return event;
      }
    }

    const sent = await channel.send(payload).catch((error) => {
      console.error('Failed to send Spam Catcher review message:', error);
      return null;
    });
    if (!sent) return null;
    return configStore.updateSpamCatcherReviewMessage(event.id, channel.id, sent.id).catch(() => event);
  }

  async function handleImmediateBan(guild, event, options = {}) {
    const config = await getConfig(event.guildId).catch(() => ({}));
    const t = createTranslator(config.language);
    const mode = event.action === 'ban_after_timeout'
      ? 'after_timeout'
      : event.action === 'ban_delayed'
        ? 'delayed'
        : 'immediate';
    const dmChannel = await createDmChannel(event.userId);
    const dmPayload = {
      content: t('moderation.banDm'),
    };
    const dmSent = dmChannel
      ? await dmChannel.send(dmPayload).then(() => true).catch(() => false)
      : await dmUser(event.userId, dmPayload);

    let banError = null;
    await guild.members.ban(event.userId, {
      reason: `Spam Catcher ${mode} ban, event ${event.id}`,
      deleteMessageSeconds: 0,
    }).catch((error) => {
      banError = error;
    });

    if (banError) {
      console.error('Failed Spam Catcher ban:', banError);
      const updated = await configStore
        .updateSpamCatcherEventStatus(event.id, 'ban_failed', options.decidedBy)
        .catch(() => ({ ...event, status: 'ban_failed', decidedBy: options.decidedBy || event.decidedBy }));
      await logAction(updated || event, 'Spam Catcher Ban Failed', [
        `- Reason: \`${banError.message || banError}\``,
        `- DM before ban: \`${dmSent ? 'sent' : 'failed'}\``,
      ]);
      await sendOrUpdateReviewMessage(guild, updated || event).catch(() => null);
      return updated || event;
    }

    const updated = await configStore.updateSpamCatcherEventStatus(event.id, 'banned', options.decidedBy).catch(() => ({
      ...event,
      status: 'banned',
      decidedBy: options.decidedBy || event.decidedBy,
      bannedAt: new Date(),
    }));
    await logAction(updated || event, 'Spam Catcher Banned User', [
      `- Mode: \`${mode}\``,
      `- DM before ban: \`${dmSent ? 'sent' : 'failed'}\``,
    ]);
    await sendOrUpdateReviewMessage(guild, updated || event).catch(() => null);
    return updated || event;
  }

  async function handleTimeout(guild, member, config, event) {
    const t = createTranslator(config.language);
    const alreadyTimedOutUntil = existingTimeoutUntil(member);
    if (alreadyTimedOutUntil) {
      await dmUser(member.id, {
        content: t('moderation.alreadyTimedOutDm', { guild: guild.name }),
        components: [appealButton(event.id, config)],
      });

      await logAction(event, 'Spam Catcher User Already Timed Out', [
        `- Existing timeout until: <t:${Math.floor(alreadyTimedOutUntil.getTime() / 1000)}:R>`,
        event.banAfter
          ? event.action === 'ban_after_timeout'
            ? `- Ban after timeout ends: <t:${Math.floor(event.banAfter.getTime() / 1000)}:R>`
            : `- Ban after appeal window: <t:${Math.floor(event.banAfter.getTime() / 1000)}:R>`
          : '- Scheduled ban: `off`',
      ]);
      await sendOrUpdateReviewMessage(guild, event).catch(() => null);
      return;
    }

    const timeoutMs = Math.min(config.timeoutMinutes * 60 * 1000, DISCORD_TIMEOUT_MAX_MS);
    let timeoutError = null;
    await member.timeout(timeoutMs, `Spam Catcher event ${event.id}`).catch((error) => {
      timeoutError = error;
    });

    if (timeoutError) {
      const userUnavailable = isUnknownMemberError(timeoutError);
      console.error(userUnavailable ? 'Spam Catcher user is no longer in guild:' : 'Failed Spam Catcher timeout:', timeoutError);
      const updated = await configStore.updateSpamCatcherEventStatus(event.id, 'timeout_failed').catch(() => ({
        ...event,
        status: 'timeout_failed',
      }));
      await logAction(updated || event, userUnavailable ? 'Spam Catcher User Unavailable' : 'Spam Catcher Timeout Failed', [
        `- Reason: \`${safeError(timeoutError)}\``,
      ]);
      await sendOrUpdateReviewMessage(guild, updated || event).catch(() => null);
      return;
    }

    await dmUser(member.id, {
      content: t('moderation.timeoutDm', { guild: guild.name }),
      components: [appealButton(event.id, config)],
    });

    await logAction(event, 'Spam Catcher Timed Out User', [
      `- Timeout: \`${config.timeoutMinutes} minutes\``,
      event.banAfter
        ? event.action === 'ban_after_timeout'
          ? `- Ban after timeout ends: <t:${Math.floor(event.banAfter.getTime() / 1000)}:R>`
          : `- Ban after appeal window: <t:${Math.floor(event.banAfter.getTime() / 1000)}:R>`
        : '- Scheduled ban: `off`',
    ]);
    await sendOrUpdateReviewMessage(guild, event).catch(() => null);
  }

  async function notifyTimeoutRemoved(guild, event) {
    const config = await getConfig(event.guildId).catch(() => ({}));
    const t = createTranslator(config.language);
    return dmUser(event.userId, {
      content: t('moderation.timeoutRemovedDm', { guild: guild.name }),
    });
  }

  async function handleMessage(message) {
    if (!message.guild || !message.member || message.author?.bot || message.webhookId) return;
    if (!isGuildAllowed(message.guild.id)) return;
    const config = await getConfig(message.guild.id).catch((error) => {
      console.error('Failed to load Spam Catcher config:', error);
      return null;
    });
    if (!config?.enabled || !config.channelIds.includes(message.channelId)) return;
    if (message.member.permissions.has(PermissionFlagsBits.Administrator)) return;

    const action = config.autoBanEnabled && config.banMode === 'immediate'
      ? 'ban_immediate'
      : config.autoBanEnabled && config.banMode === 'after_timeout'
        ? 'ban_after_timeout'
        : config.autoBanEnabled
          ? 'ban_delayed'
          : 'timeout';
    const now = Date.now();
    const timeoutUntil = action === 'ban_immediate'
      ? null
      : new Date(now + config.timeoutMinutes * 60 * 1000);
    const banAfter = action === 'ban_delayed'
      ? new Date(now + config.banDelayMinutes * 60 * 1000)
      : action === 'ban_after_timeout'
        ? timeoutUntil
      : null;
    const event = await configStore.createSpamCatcherEvent({
      guildId: message.guild.id,
      userId: message.author.id,
      channelId: message.channelId,
      messageId: message.id,
      action,
      status: action === 'ban_delayed' || action === 'ban_after_timeout' ? 'ban_pending' : action === 'timeout' ? 'timed_out' : 'caught',
      timeoutUntil,
      banAfter,
      reviewChannelId: config.reviewChannelId,
    });

    if (!event) return;
    await refreshTrapNoticeCount(message.guild, config, event);
    if (action === 'ban_immediate') {
      await handleImmediateBan(message.guild, event);
      return;
    }

    await handleTimeout(message.guild, message.member, config, event);
  }

  async function handleAppealButton(interaction) {
    const [, eventId] = interaction.customId.split(':');
    const event = await configStore.getSpamCatcherEventById(Number(eventId)).catch(() => null);
    const config = event ? await getConfig(event.guildId).catch(() => ({})) : {};
    const t = createTranslator(config.language);
    if (!event || event.userId !== interaction.user.id || !isGuildAllowed(event.guildId)) {
      await interaction.reply({ content: t('moderation.appealNotFound'), flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }
    const modal = new ModalBuilder()
      .setCustomId(`${APPEAL_MODAL_PREFIX}:${eventId}`)
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
  }

  async function handleAppealModal(interaction) {
    const [, eventIdRaw] = interaction.customId.split(':');
    const eventId = Number(eventIdRaw);
    const message = interaction.fields.getTextInputValue('appeal_message').trim();
    const existingEvent = await configStore.getSpamCatcherEventById(eventId).catch(() => null);
    const config = existingEvent ? await getConfig(existingEvent.guildId).catch(() => ({})) : {};
    const t = createTranslator(config.language);
    if (!existingEvent || existingEvent.userId !== interaction.user.id || !isGuildAllowed(existingEvent.guildId)) {
      await interaction.reply({ content: t('moderation.appealNotFound'), flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }

    const event = await configStore.markSpamCatcherAppealed(eventId, message).catch(() => null);
    if (!event) {
      await interaction.reply({ content: t('moderation.appealNotFound'), flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }

    const guild = await client.guilds.fetch(event.guildId).catch(() => null);
    const reviewChannel = guild && event.reviewChannelId
      ? await guild.channels.fetch(event.reviewChannelId).catch(() => null)
      : null;
    if (!reviewChannel?.isTextBased()) {
      await interaction.reply({
        content: t('moderation.appealSavedNoReview'),
        flags: MessageFlags.Ephemeral,
      }).catch(() => null);
      return;
    }

    const sent = await sendOrUpdateReviewMessage(guild, event).catch(() => null);
    if (!sent) {
      await interaction.reply({
        content: t('moderation.appealSavedNoMessage'),
        flags: MessageFlags.Ephemeral,
      }).catch(() => null);
      return;
    }
    await interaction.reply({ content: t('moderation.appealSent'), flags: MessageFlags.Ephemeral }).catch(() => null);
  }

  async function requireAdmin(interaction, action) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({
        content: `Only users with Administrator permission can ${action}.`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => null);
      return false;
    }
    return true;
  }

  async function getInteractionEvent(interaction) {
    const [, eventIdRaw] = interaction.customId.split(':');
    const eventId = Number(eventIdRaw);
    if (!Number.isFinite(eventId)) return null;
    return configStore.getSpamCatcherEventById(eventId).catch(() => null);
  }

  async function handleRemoveTimeout(interaction) {
    if (!await requireAdmin(interaction, 'remove Spam Catcher timeouts')) return;

    const event = await getInteractionEvent(interaction);
    if (!event) {
      await interaction.reply({ content: 'Spam Catcher event not found.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }
    if (!isGuildAllowed(event.guildId)) {
      await interaction.reply({ content: 'Spam Catcher is not enabled for this guild.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }

    if (!canReviewTimeout(event)) {
      await interaction.reply({ content: 'This Spam Catcher event is no longer waiting for timeout action.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }

    await interaction.update(buildRemoveTimeoutConfirmationComponents(event, interaction.user.id)).catch(async () => {
      await interaction.reply({ content: 'Failed to show timeout-removal confirmation.', flags: MessageFlags.Ephemeral }).catch(() => null);
    });
  }

  async function handleCancelRemoveTimeout(interaction) {
    if (!await requireAdmin(interaction, 'cancel Spam Catcher timeout actions')) return;

    const event = await getInteractionEvent(interaction);
    if (!event) {
      await interaction.reply({ content: 'Spam Catcher event not found.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }
    if (!isGuildAllowed(event.guildId)) {
      await interaction.reply({ content: 'Spam Catcher is not enabled for this guild.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }

    await interaction.update(buildReviewComponents(event)).catch(async () => {
      await interaction.reply({ content: 'Failed to restore the review message.', flags: MessageFlags.Ephemeral }).catch(() => null);
    });
  }

  async function handleConfirmRemoveTimeout(interaction) {
    if (!await requireAdmin(interaction, 'remove Spam Catcher timeouts')) return;

    const event = await getInteractionEvent(interaction);
    if (!event) {
      await interaction.reply({ content: 'Spam Catcher event not found.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }
    if (!isGuildAllowed(event.guildId)) {
      await interaction.reply({ content: 'Spam Catcher is not enabled for this guild.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }

    if (!canReviewTimeout(event)) {
      await interaction.update(buildReviewComponents(event)).catch(async () => {
        await interaction.reply({ content: 'This Spam Catcher event is no longer waiting for timeout action.', flags: MessageFlags.Ephemeral }).catch(() => null);
      });
      return;
    }

    const member = interaction.guild
      ? await interaction.guild.members.fetch(event.userId).catch(() => null)
      : null;
    if (!member) {
      const updated = await configStore.resolveSpamCatcherAppeal(event.id, interaction.user.id).catch(() => event);
      await interaction.update(buildResolvedReviewComponents(updated || event)).catch(async () => {
        await interaction.reply({ content: 'User is no longer in this guild; the scheduled ban was cancelled.', flags: MessageFlags.Ephemeral }).catch(() => null);
      });
      await logAction(updated || event, 'Spam Catcher Timeout Removal Skipped', [
        `- Removed by: <@${interaction.user.id}>`,
        '- Reason: `user is no longer in this guild`',
      ]);
      return;
    }

    if (!existingTimeoutUntil(member)) {
      const updated = await configStore.resolveSpamCatcherAppeal(event.id, interaction.user.id).catch(() => event);
      const dmSent = await notifyTimeoutRemoved(interaction.guild, updated || event).catch(() => false);
      await interaction.update(buildResolvedReviewComponents(updated || event)).catch(async () => {
        await interaction.reply({ content: 'No active timeout was found, but the Spam Catcher event was resolved.', flags: MessageFlags.Ephemeral }).catch(() => null);
      });
      await logAction(updated || event, 'Spam Catcher Timeout Already Cleared', [
        `- Removed by: <@${interaction.user.id}>`,
        `- DM sent: \`${dmSent ? 'yes' : 'no'}\``,
      ]);
      return;
    }

    let timeoutError = null;
    if (member) {
      await member.timeout(null, `Spam Catcher appeal accepted by ${interaction.user.id}`).catch((error) => {
        console.error('Failed to remove Spam Catcher timeout:', error);
        timeoutError = error;
      });
    }

    if (timeoutError) {
      await interaction.reply({
        content: `Failed to remove timeout: ${timeoutError.message || timeoutError}`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => null);
      return;
    }

    const updated = await configStore.resolveSpamCatcherAppeal(event.id, interaction.user.id).catch(() => event);
    const dmSent = interaction.guild
      ? await notifyTimeoutRemoved(interaction.guild, updated || event).catch(() => false)
      : false;
    await interaction.update(buildResolvedReviewComponents(updated || event)).catch(async () => {
      await interaction.reply({ content: 'Timeout removed, but failed to update review message.', flags: MessageFlags.Ephemeral }).catch(() => null);
    });
    await logAction(updated || event, 'Spam Catcher Timeout Removed', [
      `- Removed by: <@${interaction.user.id}>`,
      `- DM sent: \`${dmSent ? 'yes' : 'no'}\``,
    ]);
  }

  async function handleBanUser(interaction) {
    if (!await requireAdmin(interaction, 'ban Spam Catcher users')) return;

    const event = await getInteractionEvent(interaction);
    if (!event) {
      await interaction.reply({ content: 'Spam Catcher event not found.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }
    if (!isGuildAllowed(event.guildId)) {
      await interaction.reply({ content: 'Spam Catcher is not enabled for this guild.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }
    if (!canReviewTimeout(event)) {
      await interaction.reply({ content: 'This Spam Catcher event is no longer waiting for admin action.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }
    if (!interaction.guild) {
      await interaction.reply({ content: 'Guild is not available for this action.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }

    await interaction.deferUpdate().catch(() => null);
    const updated = await handleImmediateBan(interaction.guild, event, { decidedBy: interaction.user.id });
    await interaction.editReply(buildReviewComponents(updated || event)).catch(() => null);
  }

  async function handleInteraction(interaction) {
    if (interaction.isButton() && interaction.customId.startsWith(`${APPEAL_PREFIX}:`)) {
      await handleAppealButton(interaction);
      return true;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith(`${APPEAL_MODAL_PREFIX}:`)) {
      await handleAppealModal(interaction);
      return true;
    }
    if (interaction.isButton() && interaction.customId.startsWith(`${BAN_USER_PREFIX}:`)) {
      await handleBanUser(interaction);
      return true;
    }
    if (interaction.isButton() && interaction.customId.startsWith(`${REMOVE_TIMEOUT_CONFIRM_PREFIX}:`)) {
      await handleConfirmRemoveTimeout(interaction);
      return true;
    }
    if (interaction.isButton() && interaction.customId.startsWith(`${REMOVE_TIMEOUT_CANCEL_PREFIX}:`)) {
      await handleCancelRemoveTimeout(interaction);
      return true;
    }
    if (interaction.isButton() && interaction.customId.startsWith(`${REMOVE_TIMEOUT_PREFIX}:`)) {
      await handleRemoveTimeout(interaction);
      return true;
    }
    return false;
  }

  async function runDelayedBansOnce() {
    if (delayedBanRunning) return;
    delayedBanRunning = true;
    try {
      const events = await configStore.getDueSpamCatcherBanEvents(25).catch(() => []);
      for (const event of events) {
        if (!isGuildAllowed(event.guildId)) continue;
        const config = await getConfig(event.guildId).catch(() => null);
        if (!config?.enabled) continue;
        const guild = client.guilds.cache.get(event.guildId) || await client.guilds.fetch(event.guildId).catch(() => null);
        if (!guild) continue;
        await handleImmediateBan(guild, event);
      }
    } finally {
      delayedBanRunning = false;
    }
  }

  function startLoop() {
    if (banInterval) return;
    runDelayedBansOnce().catch((error) => console.error('Failed initial Spam Catcher delayed-ban pass:', error));
    banInterval = setInterval(() => {
      runDelayedBansOnce().catch((error) => console.error('Failed Spam Catcher delayed-ban pass:', error));
    }, DELAYED_BAN_INTERVAL_MS);
  }

  function stopLoop() {
    if (!banInterval) return;
    clearInterval(banInterval);
    banInterval = null;
  }

  return {
    handleMessage,
    handleInteraction,
    startLoop,
    stopLoop,
  };
}

module.exports = { createSpamCatcherManager };
