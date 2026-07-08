require('dotenv').config();

const { DISCORD_TOKEN, requireRuntimeEnv } = require('../src/bot/env');

const USAGE = `Usage:
  node scripts/deploy-commands.js
  node scripts/deploy-commands.js --guild-id 123

Options:
  --guild-id <id>    Deploy to one guild (instant, for testing).
                     Without this, deploys globally (may take up to 1 hour).
  --help             Show this help.
`;

const API_BASE = 'https://discord.com/api/v10';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--help' || item === '-h') return { help: true };
    if (item === '--guild-id') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--guild-id requires a value.');
      args.guildId = value.trim();
      index += 1;
      continue;
    }
    throw new Error(`Unexpected argument: ${item}`);
  }
  return args;
}

async function getBotApplicationId() {
  const res = await fetch(`${API_BASE}/users/@me`, {
    headers: { Authorization: `Bot ${DISCORD_TOKEN}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to get bot info: ${res.status} ${await res.text().catch(() => '')}`);
  }
  const data = await res.json();
  return data.id;
}

function buildCommandJson() {
  return {
    name: 'spam-catcher',
    description: 'Manage Spam Catcher for this server',
    default_member_permissions: '8',
    type: 1,
    options: [
      {
        type: 1,
        name: 'setup',
        description: 'Open the Spam Catcher setup panel',
        options: [],
      },
      {
        type: 1,
        name: 'lang',
        description: 'Set the Spam Catcher interface language',
        options: [
          {
            type: 3,
            name: 'language',
            description: 'Language to use for Spam Catcher UI in this server',
            required: true,
            choices: [
              { name: 'English', value: 'en' },
              { name: 'Indonesia', value: 'id' },
            ],
          },
        ],
      },
      {
        type: 1,
        name: 'check',
        description: 'Check spam status for a user',
        options: [
          {
            type: 6,
            name: 'user',
            description: 'User to check',
            required: true,
          },
        ],
      },
    ],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }
  requireRuntimeEnv();

  const commandJson = buildCommandJson();
  const appId = await getBotApplicationId();

  let url = `${API_BASE}/applications/${appId}/commands`;
  let scope = 'global';
  if (args.guildId) {
    url = `${API_BASE}/applications/${appId}/guilds/${args.guildId}/commands`;
    scope = `guild ${args.guildId}`;
  }

  console.log(`Deploying commands (${scope})...`);
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${DISCORD_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([commandJson]),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Discord rejected deploy (${scope}): ${res.status} ${detail}`);
  }

  const result = await res.json();
  const names = Array.isArray(result)
    ? result.map((cmd) => `  /${cmd.name} (id: ${cmd.id})`).join('\n')
    : `  /${result.name}`;
  console.log(`Deployed ${scope} commands:\n${names}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
