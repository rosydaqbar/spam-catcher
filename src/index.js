require('dotenv').config();

const { Client, Events, GatewayIntentBits, MessageFlags } = require('discord.js');
const configStore = require('./config-store');
const { createSpamCatcherManager } = require('./bot/spam-catcher');
const { createSetupCommandManager } = require('./bot/setup-command');
const { DISCORD_TOKEN, requireRuntimeEnv } = require('./bot/env');
const { createLogger } = require('./lib/logger');

const logger = createLogger('spam-catcher');

requireRuntimeEnv();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

const spamCatcherManager = createSpamCatcherManager({
  client,
  configStore,
});
const setupCommandManager = createSetupCommandManager({
  client,
  configStore,
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}. Shutting down...`);

  try {
    spamCatcherManager.stopLoop?.();
  } catch (error) {
    logger.error('Failed to stop Spam Catcher loop:', error);
  }

  try {
    if (client.isReady()) {
      await client.destroy();
    }
  } catch (error) {
    logger.error('Failed to destroy Discord client:', error);
  }

  try {
    await configStore.close?.();
  } catch (error) {
    logger.error('Failed to close database pool:', error);
  }

  process.exit(0);
}

process.on('SIGTERM', () => {
  shutdown('SIGTERM').catch((error) => {
    console.error('Graceful shutdown failed:', error);
    process.exit(1);
  });
});

process.on('SIGINT', () => {
  shutdown('SIGINT').catch((error) => {
    console.error('Graceful shutdown failed:', error);
    process.exit(1);
  });
});

client.once(Events.ClientReady, () => {
  logger.info(`Logged in as ${client.user.tag}`);
  setupCommandManager.registerCommands().catch((error) => {
    logger.error('Failed to register setup command:', error);
  });
  spamCatcherManager.startLoop?.();
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (await setupCommandManager.handleInteraction(interaction)) {
      return;
    }
    await spamCatcherManager.handleInteraction(interaction);
  } catch (error) {
    console.error('Failed to handle interaction:', error);
    if (!interaction.isRepliable()) return;

    const payload = {
      content: 'Failed to process this Spam Catcher interaction.',
      flags: MessageFlags.Ephemeral,
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload).catch(() => null);
      return;
    }

    await interaction.reply(payload).catch(() => null);
  }
});

client.on(Events.MessageCreate, async (message) => {
  try {
    await spamCatcherManager.handleMessage(message);
  } catch (error) {
    console.error('Failed to handle Spam Catcher message:', error);
  }
});

client.login(DISCORD_TOKEN).catch((error) => {
  logger.error('Failed to login to Discord:', error);
  process.exit(1);
});
