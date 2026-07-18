const {
  ActionRowBuilder,
  ApplicationIntegrationType,
  ButtonBuilder,
  ButtonStyle,
  InteractionContextType,
  SlashCommandBuilder,
} = require('discord.js');
const { parseAiVisionDailyLimitBypassGuildIds, parseSuperAdminUserIds } = require('./env');
const { createLogger } = require('../lib/logger');

const COMMAND_NAME = 'spam-admin';
const BUTTON_PREFIX = 'sa';
const GUILD_PAGE_SIZE = 10;
const BYPASS_PAGE_SIZE = 10;
const SNOWFLAKE_PATTERN = /^\d{17,20}$/;

function createSuperAdminCommandManager({
  client,
  configStore,
  runAutomaticUserReset = async (_guildId, _userId, resetTask) => resetTask(),
  runSpamCatcherUserReset = async (_guildId, _userId, resetTask) => resetTask(),
  runGuildConfigOperation = async (_guildId, task) => task(),
  invalidateGuildConfig = () => {},
}) {
  const superAdminUserIds = parseSuperAdminUserIds();
  const envBypassGuildIds = parseAiVisionDailyLimitBypassGuildIds();
  const logger = createLogger('super-admin');

  function guildIdOption(option) {
    return option
      .setName('guild_id')
      .setDescription('Discord server ID')
      .setRequired(true)
      .setMinLength(17)
      .setMaxLength(20);
  }

  function commandData() {
    if (superAdminUserIds.size === 0) return null;
    return new SlashCommandBuilder()
      .setName(COMMAND_NAME)
      .setDescription('Manage hosted Spam Catcher guilds')
      .setContexts(InteractionContextType.BotDM)
      .setIntegrationTypes(ApplicationIntegrationType.UserInstall)
      .addSubcommand((subcommand) => subcommand
        .setName('guilds')
        .setDescription('List guilds currently connected to this bot'))
      .addSubcommand((subcommand) => subcommand
        .setName('bypass-add')
        .setDescription('Bypass the AI Verdict daily limit for a guild')
        .addStringOption(guildIdOption))
      .addSubcommand((subcommand) => subcommand
        .setName('bypass-remove')
        .setDescription('Remove a guild AI Verdict daily limit bypass')
        .addStringOption(guildIdOption))
      .addSubcommand((subcommand) => subcommand
        .setName('bypass-list')
        .setDescription('List active AI Verdict daily limit bypasses'))
      .addSubcommand((subcommand) => subcommand
        .setName('quota-reset')
        .setDescription('Reset today’s AI Verdict usage for a guild')
        .addStringOption(guildIdOption))
      .addSubcommand((subcommand) => subcommand
        .setName('quota-set')
        .setDescription('Set the daily AI Verdict limit for a guild')
        .addStringOption(guildIdOption)
        .addIntegerOption((option) => option
          .setName('limit')
          .setDescription('Daily checks from 0 to 10000')
          .setRequired(true)
          .setMinValue(0)
          .setMaxValue(10_000)))
      .addSubcommand((subcommand) => subcommand
        .setName('user-reset')
        .setDescription('Reset stored state for a user in one guild')
        .addStringOption(guildIdOption)
        .addStringOption((option) => option
          .setName('user_id')
          .setDescription('Discord user ID')
          .setRequired(true)
          .setMinLength(17)
          .setMaxLength(20))
        .addStringOption((option) => option
          .setName('scope')
          .setDescription('Choose what to reset')
          .setRequired(true)
          .addChoices(
            { name: 'Active state only', value: 'active' },
            { name: 'Full stored history', value: 'full' }
          )))
      .addSubcommand((subcommand) => subcommand
        .setName('guild-reset')
        .setDescription('Restore a guild’s settings to disabled defaults')
        .addStringOption(guildIdOption))
      .toJSON();
  }

  function isSuperAdmin(userId) {
    return superAdminUserIds.has(userId);
  }

  function safeName(value) {
    return String(value || 'Unknown guild')
      .replace(/[`@]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
  }

  function validateSnowflake(value, label) {
    const id = String(value || '').trim();
    if (!SNOWFLAKE_PATTERN.test(id)) {
      throw new Error(`${label} must be a 17-20 digit Discord ID.`);
    }
    return id;
  }

  function connectedGuild(guildId) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw new Error(`Guild ${guildId} is not currently connected to this bot.`);
    return guild;
  }

  function guildLocalDate(date, timezone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date || new Date());
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
  }

  function guildsPayload(requesterId, requestedPage = 0) {
    const guilds = [...client.guilds.cache.values()]
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const totalPages = Math.max(1, Math.ceil(guilds.length / GUILD_PAGE_SIZE));
    const page = Math.max(0, Math.min(totalPages - 1, Number(requestedPage) || 0));
    const visible = guilds.slice(page * GUILD_PAGE_SIZE, (page + 1) * GUILD_PAGE_SIZE);
    const lines = visible.length > 0
      ? visible.map((guild, index) => {
          const position = page * GUILD_PAGE_SIZE + index + 1;
          return `${position}. **${safeName(guild.name)}** · \`${guild.id}\` · ${guild.memberCount || 0} members`;
        })
      : ['No guilds are currently connected.'];
    const payload = {
      content: [
        `## Connected Guilds`,
        `Page ${page + 1}/${totalPages} · ${guilds.length} total`,
        '',
        ...lines,
      ].join('\n'),
      components: [],
      allowedMentions: { parse: [] },
    };
    if (totalPages > 1) {
      payload.components.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`${BUTTON_PREFIX}:guilds:${page - 1}:${requesterId}`)
            .setLabel('Previous')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
          new ButtonBuilder()
            .setCustomId(`${BUTTON_PREFIX}:guilds:${page + 1}:${requesterId}`)
            .setLabel('Next')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= totalPages - 1)
        )
      );
    }
    return payload;
  }

  async function bypassesPayload(requesterId, requestedPage = 0) {
    const rows = await configStore.listAiVisionDailyLimitBypassGuilds();
    const overrides = new Map(rows.map((row) => [row.guild_id, row]));
    const effectiveGuildIds = new Set(
      rows.filter((row) => row.bypassed === true).map((row) => row.guild_id)
    );
    for (const guildId of envBypassGuildIds) {
      if (overrides.get(guildId)?.bypassed !== false) effectiveGuildIds.add(guildId);
    }
    const guildIds = [...effectiveGuildIds].sort();
    const totalPages = Math.max(1, Math.ceil(guildIds.length / BYPASS_PAGE_SIZE));
    const page = Math.max(0, Math.min(totalPages - 1, Number(requestedPage) || 0));
    const visible = guildIds.slice(page * BYPASS_PAGE_SIZE, (page + 1) * BYPASS_PAGE_SIZE);
    const lines = visible.map((guildId) => {
      const guild = client.guilds.cache.get(guildId);
      const row = overrides.get(guildId);
      const source = envBypassGuildIds.has(guildId) && row?.bypassed === true
        ? 'ENV + DM'
        : envBypassGuildIds.has(guildId)
          ? 'ENV'
          : 'DM';
      return `- **${safeName(guild?.name || 'Disconnected guild')}** · \`${guildId}\` · ${source}`;
    });
    const payload = {
      content: [
        '## Active AI Verdict Daily Limit Bypasses',
        `Page ${page + 1}/${totalPages} · ${guildIds.length} total`,
        '',
        ...(lines.length > 0 ? lines : ['No active bypasses configured.']),
      ].join('\n'),
      components: [],
      allowedMentions: { parse: [] },
    };
    if (totalPages > 1) {
      payload.components.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`${BUTTON_PREFIX}:bypasses:${page - 1}:${requesterId}`)
            .setLabel('Previous')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
          new ButtonBuilder()
            .setCustomId(`${BUTTON_PREFIX}:bypasses:${page + 1}:${requesterId}`)
            .setLabel('Next')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= totalPages - 1)
        )
      );
    }
    return payload;
  }

  function confirmationButtons(confirmCustomId, requesterId) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(confirmCustomId)
        .setLabel('Confirm')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`${BUTTON_PREFIX}:cancel:${requesterId}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  async function replyError(interaction, error) {
    const content = `❌ ${String(error?.message || error || 'Unknown error').slice(0, 1500)}`;
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content, components: [], allowedMentions: { parse: [] } }).catch(() => null);
      return;
    }
    await interaction.reply({ content, allowedMentions: { parse: [] } }).catch(() => null);
  }

  async function requireSuperAdmin(interaction) {
    if (isSuperAdmin(interaction.user.id)) return true;
    logger.warn('Rejected unauthorized Super Admin interaction', {
      userId: interaction.user.id,
      commandName: interaction.commandName || null,
      customId: interaction.customId || null,
    });
    await interaction.reply({ content: 'Access denied.', allowedMentions: { parse: [] } }).catch(() => null);
    return false;
  }

  async function handleCommand(interaction) {
    if (!await requireSuperAdmin(interaction)) return true;
    if (interaction.guildId) {
      await interaction.reply({ content: 'Use `/spam-admin` in a DM with this bot.', allowedMentions: { parse: [] } });
      return true;
    }

    const subcommand = interaction.options.getSubcommand(true);
    if (['bypass-list', 'bypass-add', 'bypass-remove', 'quota-reset', 'quota-set'].includes(subcommand)) {
      await interaction.deferReply();
    }
    try {
      if (subcommand === 'guilds') {
        await interaction.reply(guildsPayload(interaction.user.id));
        return true;
      }

      if (subcommand === 'bypass-list') {
        await interaction.editReply(await bypassesPayload(interaction.user.id));
        return true;
      }

      const guildId = validateSnowflake(interaction.options.getString('guild_id', true), 'Guild ID');

      if (subcommand === 'bypass-add') {
        const guild = connectedGuild(guildId);
        await configStore.addAiVisionDailyLimitBypassGuild(guildId, interaction.user.id);
        logger.info('Added persistent AI Verdict daily limit bypass', { adminId: interaction.user.id, guildId });
        await interaction.editReply({
          content: `✅ AI Verdict daily limit bypass enabled for **${safeName(guild.name)}** (\`${guildId}\`).`,
          allowedMentions: { parse: [] },
        });
        return true;
      }

      if (subcommand === 'bypass-remove') {
        const removed = await configStore.removeAiVisionDailyLimitBypassGuild(guildId, interaction.user.id);
        logger.info('Removed AI Verdict daily limit bypass', { adminId: interaction.user.id, guildId, removed });
        await interaction.editReply({
          content: `✅ AI Verdict daily limit bypass disabled for \`${guildId}\`, including any ENV default.`,
          allowedMentions: { parse: [] },
        });
        return true;
      }

      const guild = connectedGuild(guildId);

      if (subcommand === 'quota-reset') {
        const { config, usageDate, result } = await runGuildConfigOperation(guildId, async () => {
          const currentConfig = await configStore.getSpamCatcherConfig(guildId);
          const currentUsageDate = guildLocalDate(new Date(), currentConfig.timezone);
          const resetResult = await configStore.resetAiVisionDailyUsage(guildId, currentUsageDate);
          return { config: currentConfig, usageDate: currentUsageDate, result: resetResult };
        });
        logger.info('Reset guild AI Verdict daily usage', {
          adminId: interaction.user.id,
          guildId,
          usageDate,
          previousUsedCount: result.previousUsedCount,
        });
        await interaction.editReply({
          content: `✅ Reset AI Verdict usage for **${safeName(guild.name)}** on \`${usageDate}\` (${config.timezone}) from \`${result.previousUsedCount}\` to \`0\`.`,
          allowedMentions: { parse: [] },
        });
        return true;
      }

      if (subcommand === 'quota-set') {
        const limit = interaction.options.getInteger('limit', true);
        const { config, saved } = await runGuildConfigOperation(guildId, async () => {
          const currentConfig = await configStore.getSpamCatcherConfig(guildId);
          const updatedConfig = await configStore.setGuildAiVisionDailyLimit(guildId, limit);
          invalidateGuildConfig(guildId);
          return { config: currentConfig, saved: updatedConfig };
        });
        logger.info('Changed guild AI Verdict daily limit', {
          adminId: interaction.user.id,
          guildId,
          previousLimit: config.aiVisionDailyLimit,
          limit: saved.aiVisionDailyLimit,
        });
        await interaction.editReply({
          content: `✅ AI Verdict daily limit for **${safeName(guild.name)}** changed from \`${config.aiVisionDailyLimit}\` to \`${saved.aiVisionDailyLimit}\`.`,
          allowedMentions: { parse: [] },
        });
        return true;
      }

      if (subcommand === 'user-reset') {
        const userId = validateSnowflake(interaction.options.getString('user_id', true), 'User ID');
        const scope = interaction.options.getString('scope', true);
        const fullReset = scope === 'full';
        const customId = `${BUTTON_PREFIX}:confirm:user:${scope}:${guildId}:${userId}:${interaction.user.id}`;
        await interaction.reply({
          content: [
            `## Confirm User Database Reset`,
            `**Guild:** ${safeName(guild.name)} (\`${guildId}\`)`,
            `**User ID:** \`${userId}\``,
            `**Scope:** ${fullReset ? 'Full stored history' : 'Active state only'}`,
            '',
            fullReset
              ? 'This permanently deletes the user’s stored trap and automatic-detection history, appeals, counts, and scheduled database actions in this guild. Minimal evidence message references remain so Delete Evidence still works on existing Discord cards.'
              : 'This clears active spammer/alert state, closes active detection windows, and cancels pending database ban actions while preserving history and incident counts.',
            '',
            '**Existing Discord timeouts or bans are not removed.**',
          ].join('\n'),
          components: [confirmationButtons(customId, interaction.user.id)],
          allowedMentions: { parse: [] },
        });
        return true;
      }

      if (subcommand === 'guild-reset') {
        const customId = `${BUTTON_PREFIX}:confirm:guild:${guildId}:${interaction.user.id}`;
        await interaction.reply({
          content: [
            `## Confirm Guild Settings Reset`,
            `**Guild:** ${safeName(guild.name)} (\`${guildId}\`)`,
            '',
            'This restores all guild settings to disabled defaults. Incident history, notice records, AI usage, persistent bypasses, and already scheduled incident actions are preserved.',
          ].join('\n'),
          components: [confirmationButtons(customId, interaction.user.id)],
          allowedMentions: { parse: [] },
        });
        return true;
      }

      throw new Error(`Unsupported Super Admin command: ${subcommand}`);
    } catch (error) {
      await replyError(interaction, error);
      return true;
    }
  }

  async function handleButton(interaction) {
    if (!await requireSuperAdmin(interaction)) return true;
    if (interaction.guildId) {
      await interaction.reply({ content: 'Use `/spam-admin` buttons in a DM with this bot.', allowedMentions: { parse: [] } }).catch(() => null);
      return true;
    }
    const parts = interaction.customId.split(':');

    try {
      if (parts[1] === 'guilds') {
        const requesterId = parts[3];
        if (requesterId !== interaction.user.id) throw new Error('This guild list belongs to another Super Admin.');
        await interaction.update(guildsPayload(requesterId, Number(parts[2])));
        return true;
      }

      if (parts[1] === 'bypasses') {
        const requesterId = parts[3];
        if (requesterId !== interaction.user.id) throw new Error('This bypass list belongs to another Super Admin.');
        await interaction.deferUpdate();
        await interaction.editReply(await bypassesPayload(requesterId, Number(parts[2])));
        return true;
      }

      if (parts[1] === 'cancel') {
        if (parts[2] !== interaction.user.id) throw new Error('This confirmation belongs to another Super Admin.');
        await interaction.update({ content: 'Cancelled.', components: [], allowedMentions: { parse: [] } });
        return true;
      }

      if (parts[1] !== 'confirm') return false;
      const action = parts[2];

      if (action === 'user') {
        const [, , , scope, guildId, userId, requesterId] = parts;
        if (requesterId !== interaction.user.id) throw new Error('This confirmation belongs to another Super Admin.');
        connectedGuild(guildId);
        await interaction.deferUpdate();
        const result = await runSpamCatcherUserReset(
          guildId,
          userId,
          () => runAutomaticUserReset(
            guildId,
            userId,
            () => configStore.resetUserDatabaseState(guildId, userId, scope, interaction.user.id)
          )
        );
        logger.info('Reset user database state', { adminId: interaction.user.id, guildId, userId, ...result });
        await interaction.editReply({
          content: [
            '✅ User database reset complete.',
            `**Guild ID:** \`${guildId}\``,
            `**User ID:** \`${userId}\``,
            `**Scope:** \`${result.scope}\``,
            `**Automatic user rows:** \`${result.automaticUserCount}\``,
            `**Automatic events:** \`${result.automaticEventCount}\``,
            `**Trap events:** \`${result.trapEventCount}\``,
            '',
            'Existing Discord timeouts or bans were not changed.',
          ].join('\n'),
          components: [],
          allowedMentions: { parse: [] },
        });
        return true;
      }

      if (action === 'guild') {
        const [, , , guildId, requesterId] = parts;
        if (requesterId !== interaction.user.id) throw new Error('This confirmation belongs to another Super Admin.');
        const guild = connectedGuild(guildId);
        await interaction.deferUpdate();
        await runGuildConfigOperation(guildId, async () => {
          await configStore.saveSpamCatcherConfig(guildId, configStore.DEFAULT_SPAM_CATCHER_CONFIG);
          invalidateGuildConfig(guildId);
        });
        logger.info('Reset guild settings to defaults', { adminId: interaction.user.id, guildId });
        await interaction.editReply({
          content: `✅ Settings for **${safeName(guild.name)}** (\`${guildId}\`) were restored to disabled defaults. History, notices, usage, bypasses, and already scheduled incident actions were preserved.`,
          components: [],
          allowedMentions: { parse: [] },
        });
        return true;
      }

      throw new Error('Unknown Super Admin confirmation action.');
    } catch (error) {
      await replyError(interaction, error);
      return true;
    }
  }

  async function handleInteraction(interaction) {
    if (interaction.isChatInputCommand() && interaction.commandName === COMMAND_NAME) {
      return handleCommand(interaction);
    }
    if (interaction.isButton() && interaction.customId.startsWith(`${BUTTON_PREFIX}:`)) {
      return handleButton(interaction);
    }
    return false;
  }

  return {
    commandData,
    handleInteraction,
    enabled: superAdminUserIds.size > 0,
  };
}

module.exports = { createSuperAdminCommandManager };
