const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { createTranslator } = require('./i18n');

const APPEAL_PREFIX = 'moderation_appeal';
const APPEAL_MODAL_PREFIX = 'moderation_appeal_modal';

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
      new ButtonBuilder()
        .setCustomId(appealCustomId(eventId))
        .setLabel(t('moderation.appealButton'))
        .setStyle(ButtonStyle.Secondary)
    );
  }

  async function dmUser(userId, payload) {
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) return false;
    return user.send(payload).then(() => true).catch(() => false);
  }

  async function sendTimeoutDm({ userId, guildName, eventId, config, alreadyTimedOut = false }) {
    const t = createTranslator(config.language);
    return dmUser(userId, {
      content: t(alreadyTimedOut ? 'moderation.alreadyTimedOutDm' : 'moderation.timeoutDm', { guild: guildName }),
      components: [appealButton(eventId, config)],
    });
  }

  async function sendBanDm(userId, config = {}) {
    const t = createTranslator(config.language);
    return dmUser(userId, { content: t('moderation.banDm') });
  }

  async function sendTimeoutRemovedDm({ userId, guildName, config }) {
    const t = createTranslator(config.language);
    return dmUser(userId, { content: t('moderation.timeoutRemovedDm', { guild: guildName }) });
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
    handleInteraction,
    ownsAppealInteraction,
    sendBanDm,
    sendTimeoutDm,
    sendTimeoutRemovedDm,
  };
}

module.exports = { createModerationWorkflow };
