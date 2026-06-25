const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const {
  ContainerBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
} = require('@discordjs/builders');

const COMMAND_NAME = 'spam-catcher';
const SETUP_PREFIX = 'spamsetup';

function createSetupCommandManager({ client, configStore }) {
  function commandData() {
    return new SlashCommandBuilder()
      .setName(COMMAND_NAME)
      .setDescription('Manage Spam Catcher for this server')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addSubcommand((subcommand) => subcommand
        .setName('setup')
        .setDescription('Open the Spam Catcher setup panel'))
      .toJSON();
  }

  async function registerCommands() {
    if (!client.application) return;
    const data = commandData();
    const commands = await client.application.commands.fetch();
    const existing = commands.find((command) => command.name === COMMAND_NAME);
    if (existing) {
      await existing.edit(data);
      return;
    }
    await client.application.commands.create(data);
  }

  function buildInfoPayload(title, body, { ephemeral = true } = {}) {
    return {
      flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
      components: [
        new ContainerBuilder()
          .setAccentColor(0xf59e0b)
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent([
              `### ${title}`,
              body,
            ].join('\n'))
          ),
      ],
      allowedMentions: { parse: [] },
    };
  }

  function isAdmin(interaction) {
    return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) === true;
  }

  async function requireAdmin(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply(buildInfoPayload('Spam Catcher Setup', 'Run this command inside a Discord server.')).catch(() => null);
      return false;
    }
    if (!isAdmin(interaction)) {
      await interaction.reply(buildInfoPayload('Spam Catcher Setup', 'Only users with Administrator permission can configure Spam Catcher.')).catch(() => null);
      return false;
    }
    return true;
  }

  function mentionChannels(ids) {
    if (!ids?.length) return '`not set`';
    return ids.map((id) => `<#${id}>`).join(', ');
  }

  function mentionChannel(id) {
    return id ? `<#${id}>` : '`not set`';
  }

  function formatMinutes(minutes) {
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

  function actionLabel(config) {
    if (!config.autoBanEnabled) return `Timeout only (${formatMinutes(config.timeoutMinutes)})`;
    if (config.banMode === 'immediate') return 'Immediate ban';
    if (config.banMode === 'after_timeout') return `Timeout, then ban after ${formatMinutes(config.timeoutMinutes)}`;
    return `Timeout, then delayed ban after ${formatMinutes(config.banDelayMinutes)}`;
  }

  function setupStatus(config) {
    const missing = [];
    if (!config.channelIds.length) missing.push('trap channel');
    if (!config.reviewChannelId) missing.push('review channel');
    if (!config.logChannelId) missing.push('log channel');
    if (!missing.length) return config.enabled ? 'Ready and enabled' : 'Ready, but disabled';
    return `Incomplete: missing ${missing.join(', ')}`;
  }

  function buildSetupPayload(guildId, config, statusMessage, { ephemeral = false } = {}) {
    const isReady = config.channelIds.length > 0 && config.reviewChannelId && config.logChannelId;
    const flags = MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0);
    const status = statusMessage ? `\n- Last action: ${statusMessage}` : '';

    const container = new ContainerBuilder()
      .setAccentColor(config.enabled ? 0x22c55e : 0xf59e0b)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
          '### Spam Catcher Setup',
          `- Guild: \`${guildId}\``,
          `- Status: **${setupStatus(config)}**${status}`,
          '',
          `- Trap channels: ${mentionChannels(config.channelIds)}`,
          `- Review channel: ${mentionChannel(config.reviewChannelId)}`,
          `- Log channel: ${mentionChannel(config.logChannelId)}`,
          `- Action: **${actionLabel(config)}**`,
        ].join('\n'))
      )
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId(`${SETUP_PREFIX}:trap`)
            .setPlaceholder('Select one or more trap text channels')
            .setChannelTypes(ChannelType.GuildText)
            .setMinValues(1)
            .setMaxValues(25)
        )
      )
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId(`${SETUP_PREFIX}:review`)
            .setPlaceholder('Select admin review text channel')
            .setChannelTypes(ChannelType.GuildText)
            .setMinValues(1)
            .setMaxValues(1)
        )
      )
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId(`${SETUP_PREFIX}:log`)
            .setPlaceholder('Select admin log text channel')
            .setChannelTypes(ChannelType.GuildText)
            .setMinValues(1)
            .setMaxValues(1)
        )
      )
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`${SETUP_PREFIX}:enable`)
            .setLabel('Enable')
            .setStyle(ButtonStyle.Success)
            .setDisabled(!isReady || config.enabled),
          new ButtonBuilder()
            .setCustomId(`${SETUP_PREFIX}:disable`)
            .setLabel('Disable')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!config.enabled),
          new ButtonBuilder()
            .setCustomId(`${SETUP_PREFIX}:post_notices`)
            .setLabel('Post Notices')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(!isReady),
          new ButtonBuilder()
            .setCustomId(`${SETUP_PREFIX}:refresh`)
            .setLabel('Refresh')
            .setStyle(ButtonStyle.Secondary)
        )
      )
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`${SETUP_PREFIX}:mode:timeout`)
            .setLabel('Timeout Only')
            .setStyle(!config.autoBanEnabled ? ButtonStyle.Primary : ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(`${SETUP_PREFIX}:mode:delayed`)
            .setLabel('Delayed Ban')
            .setStyle(config.autoBanEnabled && config.banMode === 'delayed' ? ButtonStyle.Primary : ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(`${SETUP_PREFIX}:mode:after_timeout`)
            .setLabel('Ban After Timeout')
            .setStyle(config.autoBanEnabled && config.banMode === 'after_timeout' ? ButtonStyle.Primary : ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(`${SETUP_PREFIX}:mode:immediate`)
            .setLabel('Immediate Ban')
            .setStyle(config.autoBanEnabled && config.banMode === 'immediate' ? ButtonStyle.Danger : ButtonStyle.Secondary)
        )
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('-# Select channels first, then enable Spam Catcher. Use Post Notices to place warning messages in trap channels. Fine-tune durations with `npm run config:upsert`.')
      );

    return {
      flags,
      components: [container],
      allowedMentions: { parse: [] },
    };
  }

  function webhookPostUrl(webhookUrl) {
    const url = new URL(webhookUrl);
    url.searchParams.set('with_components', 'true');
    url.searchParams.set('wait', 'true');
    return url.toString();
  }

  function buildTrapNoticePayload(caughtCount, config) {
    const safeCount = Math.max(0, Math.floor(Number(caughtCount) || 0));
    const timeoutText = formatMinutes(config.timeoutMinutes);
    const banDelayText = formatMinutes(config.banDelayMinutes);
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
      flags: MessageFlags.IsComponentsV2,
      components: [
        new ContainerBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent([
              '# 🚫 Dilarang Mengirim Pesan di Channel Ini',
              `⚠️ Channel ini dibuat untuk menangkap spammer. Jika kamu mengirim pesan di channel ini, ${actionId} ${appealId}`,
              '',
              '## 😈 Jangan Berani-Berani Mencoba',
              'Kalau cuma mau tes, sistem tetap akan menangkap kamu.',
              '',
              `-# Jumlah user yang sudah tertangkap di channel ini: \`${safeCount}\``,
            ].join('\n'))
          )
          .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent([
              '# 🚫 Do Not Send Messages in This Channel',
              `⚠️ This channel is made to catch spammers. If you send a message in this channel, ${actionEn} ${appealEn}`,
              '',
              "## 😈 Don't Even Think About Trying",
              'Even if you are just testing, the system will still catch you.',
              '',
              `-# Caught users in this channel: \`${safeCount}\``,
            ].join('\n'))
          ),
      ],
      allowedMentions: { parse: [] },
    };
  }

  async function postTrapNotices(guild, config) {
    const notices = [];
    const webhookByChannel = new Map(
      config.webhookEnabled ? config.webhookUrls.map((item) => [item.channelId, item.webhookUrl]) : []
    );

    for (const channelId of config.channelIds) {
      const count = await configStore.getSpamCatcherCaughtCount(guild.id, channelId).catch(() => 0);
      const payload = buildTrapNoticePayload(count, config);
      const webhookUrl = webhookByChannel.get(channelId);

      if (webhookUrl) {
        const response = await fetch(webhookPostUrl(webhookUrl), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }).catch(() => null);
        if (response?.ok) {
          const message = await response.json().catch(() => null);
          if (message?.id) notices.push({ channelId, messageId: message.id, deliveryMethod: 'webhook', webhookUrl });
        }
        continue;
      }

      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased()) continue;
      const message = await channel.send(payload).catch(() => null);
      if (message?.id) notices.push({ channelId, messageId: message.id, deliveryMethod: 'bot' });
    }

    await configStore.saveSpamCatcherNoticeMessages(guild.id, notices);
    return notices;
  }

  async function handleSetupCommand(interaction) {
    if (!await requireAdmin(interaction)) return true;
    const config = await configStore.getSpamCatcherConfig(interaction.guildId);
    await interaction.reply(buildSetupPayload(interaction.guildId, config, null, { ephemeral: true }));
    return true;
  }

  async function saveAndUpdate(interaction, nextConfig, statusMessage) {
    const saved = await configStore.saveSpamCatcherConfig(interaction.guildId, nextConfig);
    await interaction.update(buildSetupPayload(interaction.guildId, saved, statusMessage)).catch(async () => {
      await interaction.editReply(buildSetupPayload(interaction.guildId, saved, statusMessage)).catch(() => null);
    });
  }

  async function handleSelect(interaction) {
    if (!await requireAdmin(interaction)) return true;
    const config = await configStore.getSpamCatcherConfig(interaction.guildId);
    const [, type] = interaction.customId.split(':');

    if (type === 'trap') {
      await saveAndUpdate(interaction, { ...config, channelIds: interaction.values }, 'Trap channels saved.');
      return true;
    }
    if (type === 'review') {
      await saveAndUpdate(interaction, { ...config, reviewChannelId: interaction.values[0] }, 'Review channel saved.');
      return true;
    }
    if (type === 'log') {
      await saveAndUpdate(interaction, { ...config, logChannelId: interaction.values[0] }, 'Log channel saved.');
      return true;
    }
    return false;
  }

  async function handleButton(interaction) {
    if (!await requireAdmin(interaction)) return true;
    const config = await configStore.getSpamCatcherConfig(interaction.guildId);
    const [, action, value] = interaction.customId.split(':');

    if (action === 'refresh') {
      await interaction.update(buildSetupPayload(interaction.guildId, config, 'Panel refreshed.'));
      return true;
    }

    if (action === 'enable') {
      await saveAndUpdate(interaction, { ...config, enabled: true }, 'Spam Catcher enabled.');
      return true;
    }

    if (action === 'disable') {
      await saveAndUpdate(interaction, { ...config, enabled: false }, 'Spam Catcher disabled.');
      return true;
    }

    if (action === 'mode') {
      const nextConfig = value === 'timeout'
        ? { ...config, autoBanEnabled: false, banMode: 'delayed' }
        : { ...config, autoBanEnabled: true, banMode: value };
      await saveAndUpdate(interaction, nextConfig, 'Moderation mode saved.');
      return true;
    }

    if (action === 'timeout') {
      await saveAndUpdate(interaction, { ...config, timeoutMinutes: Number(value) }, 'Timeout duration saved.');
      return true;
    }

    if (action === 'delay') {
      await saveAndUpdate(interaction, { ...config, banDelayMinutes: Number(value) }, 'Ban delay saved.');
      return true;
    }

    if (action === 'post_notices') {
      await interaction.deferUpdate().catch(() => null);
      const saved = await configStore.getSpamCatcherConfig(interaction.guildId);
      const notices = await postTrapNotices(interaction.guild, saved);
      await interaction.editReply(buildSetupPayload(
        interaction.guildId,
        saved,
        `Posted ${notices.length} notice message${notices.length === 1 ? '' : 's'}.`
      )).catch(() => null);
      return true;
    }

    return false;
  }

  async function handleInteraction(interaction) {
    if (interaction.isChatInputCommand()
      && interaction.commandName === COMMAND_NAME
      && interaction.options.getSubcommand(false) === 'setup') {
      return handleSetupCommand(interaction);
    }
    if (interaction.isChannelSelectMenu?.() && interaction.customId.startsWith(`${SETUP_PREFIX}:`)) {
      return handleSelect(interaction);
    }
    if (interaction.isButton() && interaction.customId.startsWith(`${SETUP_PREFIX}:`)) {
      return handleButton(interaction);
    }
    return false;
  }

  return {
    registerCommands,
    handleInteraction,
  };
}

module.exports = { createSetupCommandManager };
