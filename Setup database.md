# 🗄️ Set Up The Database

Spam Catcher needs a database to remember server settings, moderation incidents, appeals, notices, and AI Verdict usage.

This guide explains two beginner-friendly ways to create that database:

| Option | Best for | Difficulty |
| --- | --- | --- |
| **Supabase cloud database** | You want the easiest setup and do not want to manage PostgreSQL yourself. | Easy |
| **PostgreSQL on your VPS** | Your bot already runs on a Linux VPS and you want the database on the same server. | Moderate |

> [!IMPORTANT]
> Spam Catcher requires **PostgreSQL**. MongoDB and MongoDB Atlas are not compatible. Supabase works because Supabase provides a PostgreSQL database.

---

## Before You Start

You need:

- the Spam Catcher project downloaded on the computer or VPS that will run the bot
- Node.js `18+`
- a Discord bot token
- access to the project's `.env` file

Keep every database password and connection URL private. Anyone with the connection URL may be able to read or change your bot data.

Choose **one** setup option below. You do not need to complete both.

---

## Option A: Supabase Cloud PostgreSQL

Use this option if you want Supabase to host and maintain PostgreSQL for you.

### 1. Create A Supabase Project

1. Open [https://supabase.com](https://supabase.com).
2. Create an account or sign in.
3. Select **New project**.
4. Choose an organization.
5. Enter a project name such as `spam-catcher`.
6. Create a strong database password and save it in a password manager.
7. Choose the region closest to the server running your Discord bot.
8. Create the project and wait until Supabase finishes preparing it.

> [!WARNING]
> Do not lose the database password. Spam Catcher needs it to connect.

### 2. Copy The PostgreSQL Connection URL

Supabase may change the names or placement of dashboard buttons. Look for **Connect**, **Database**, or **Connection string**.

1. Open your Supabase project.
2. Select **Connect**.
3. Choose a PostgreSQL connection string or URI.
4. Prefer the **Session pooler** connection for a long-running bot, especially when the bot server does not support IPv6.
5. Copy the connection string.
6. Replace the password placeholder with the database password you created.

The result will look similar to this:

```text
postgresql://postgres.PROJECT_REFERENCE:YOUR_PASSWORD@HOST.pooler.supabase.com:5432/postgres
```

Your real host and project reference will be different. Always use the connection string shown by your Supabase project.

If your password contains characters such as `@`, `:`, `/`, `?`, `#`, or `%`, those characters may need URL encoding. If the connection fails, reset the Supabase database password to a long random password containing letters and numbers, then copy the new value into the URL.

### 3. Add Supabase To `.env`

Open the `.env` file in the Spam Catcher project and set:

```env
DISCORD_TOKEN=your_discord_bot_token
DATABASE_URL=your_complete_supabase_postgresql_url
PG_SSL_MODE=require
BOT_POSTGRES_POOL_MAX=2
```

Example structure only:

```env
DATABASE_URL=postgresql://postgres.example:password@example.pooler.supabase.com:5432/postgres
PG_SSL_MODE=require
```

Do not copy the example literally. Use the URL from your own Supabase dashboard.

### 4. Start Spam Catcher

From the Spam Catcher project folder, run:

```bash
npm install
npm run check
npm start
```

Spam Catcher creates its PostgreSQL tables automatically. After the bot starts, run this command in your Discord server:

```text
/spam-catcher setup
```

Saving the setup confirms that the bot can read and write database data.

### 5. Confirm Supabase Is Working

In Supabase:

1. Open **Table Editor**.
2. Refresh the page after starting the bot and opening `/spam-catcher setup`.
3. Confirm that tables beginning with `spam_catcher_` or `automatic_spam_detection_` exist.

If the tables appear and `/spam-catcher setup` opens normally, the cloud database setup is complete.

---

## Option B: PostgreSQL On An Ubuntu/Debian VPS

Use this option when the bot and PostgreSQL will run on the same VPS.

> [!IMPORTANT]
> These commands are for Ubuntu or Debian. Do not expose PostgreSQL port `5432` to the public internet.

### 1. Connect To Your VPS

Use your VPS provider's browser terminal or connect through SSH:

```bash
ssh YOUR_VPS_USER@YOUR_VPS_IP
```

### 2. Install PostgreSQL

Run:

```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql
```

Check that PostgreSQL is running:

```bash
sudo systemctl status postgresql --no-pager
```

Look for `active (running)`. Press `q` if the status screen remains open.

### 3. Generate A Database Password

Generate a safe password:

```bash
openssl rand -hex 24
```

Copy the result into a password manager. The output contains only numbers and letters, so it can be safely placed inside a PostgreSQL connection URL.

### 4. Create The Database User And Database

Open the PostgreSQL console:

```bash
sudo -u postgres psql
```

Replace `YOUR_GENERATED_PASSWORD` below with the password from the previous step, then run both commands:

```sql
CREATE USER spamcatcher WITH PASSWORD 'YOUR_GENERATED_PASSWORD';
CREATE DATABASE spam_catcher OWNER spamcatcher;
```

Exit PostgreSQL:

```text
\q
```

If PostgreSQL says the user or database already exists, do not delete it. Continue only if it is an existing Spam Catcher database that you intend to reuse.

### 5. Apply The Spam Catcher Tables

Go to the Spam Catcher project folder on the VPS. Confirm that the schema file exists:

```bash
ls scripts/schema-postgres.sql
```

Apply the schema. Replace `YOUR_GENERATED_PASSWORD` with your database password:

```bash
PGPASSWORD='YOUR_GENERATED_PASSWORD' psql \
  -h 127.0.0.1 \
  -U spamcatcher \
  -d spam_catcher \
  -v ON_ERROR_STOP=1 \
  -f scripts/schema-postgres.sql
```

You may see several `CREATE TABLE` and `CREATE INDEX` messages. That is expected.

### 6. Verify The Tables

Run:

```bash
PGPASSWORD='YOUR_GENERATED_PASSWORD' psql \
  -h 127.0.0.1 \
  -U spamcatcher \
  -d spam_catcher \
  -c "\dt"
```

You should see these tables:

- `spam_catcher_config`
- `spam_catcher_events`
- `spam_catcher_notice_messages`
- `automatic_spam_detection_users`
- `automatic_spam_detection_events`
- `automatic_spam_detection_event_messages`
- `automatic_spam_detection_ai_usage`
- `automatic_spam_detection_ai_usage_reservations`

### 7. Add PostgreSQL To `.env`

Open the project's `.env` file and set:

```env
DISCORD_TOKEN=your_discord_bot_token
DATABASE_URL=postgresql://spamcatcher:YOUR_GENERATED_PASSWORD@127.0.0.1:5432/spam_catcher
PG_SSL_MODE=disable
BOT_POSTGRES_POOL_MAX=2
```

Replace `YOUR_GENERATED_PASSWORD` with the real password. Do not add spaces around `=`.

`PG_SSL_MODE=disable` is appropriate only when PostgreSQL and Spam Catcher run on the same trusted VPS and connect through `127.0.0.1`.

### 8. Start Spam Catcher

Run:

```bash
npm install
npm run check
npm start
```

Then open your Discord server and run:

```text
/spam-catcher setup
```

If the setup dashboard opens and saves settings, the VPS database setup is complete.

### 9. Confirm PostgreSQL Is Private

Run:

```bash
sudo ss -ltnp | grep ':5432' || true
```

Safe results show `127.0.0.1:5432`, `::1:5432`, or no public listener. PostgreSQL must not listen on `0.0.0.0:5432` or your public VPS IP unless you have intentionally built a private secured network.

Do not create a public firewall rule for port `5432` when the bot and database are on the same VPS.

---

## Other Cloud Database Providers

You can use another cloud provider if it gives you a standard **PostgreSQL connection URL**.

The URL normally starts with:

```text
postgresql://
```

For another PostgreSQL cloud provider:

1. Create a PostgreSQL database.
2. Copy its connection URL.
3. Set the URL as `DATABASE_URL`.
4. Set `PG_SSL_MODE=require` unless the provider explicitly says otherwise.
5. Start Spam Catcher and run `/spam-catcher setup`.

MongoDB connection URLs start with `mongodb://` or `mongodb+srv://`. Those URLs will not work with Spam Catcher.

---

## Common Problems

<details>
<summary><strong>DATABASE_URL is required</strong></summary>

The bot cannot find the `.env` value.

- Confirm the file is named exactly `.env`.
- Confirm `.env` is in the main Spam Catcher project folder.
- Confirm the line starts with `DATABASE_URL=`.
- Restart the bot after editing `.env`.

</details>

<details>
<summary><strong>Password authentication failed</strong></summary>

The username or password in `DATABASE_URL` is incorrect.

- Recopy the connection URL.
- Confirm you replaced all password placeholders.
- For Supabase, reset the database password if you no longer know it.
- For a VPS, confirm the URL uses the `spamcatcher` user and its password.

</details>

<details>
<summary><strong>Connection refused</strong></summary>

For a VPS database, PostgreSQL may not be running.

```bash
sudo systemctl restart postgresql
sudo systemctl status postgresql --no-pager
```

For a cloud database, confirm that you copied the complete host and port from the provider.

</details>

<details>
<summary><strong>SSL error</strong></summary>

- Supabase and most cloud databases require `PG_SSL_MODE=require`.
- PostgreSQL on the same VPS normally uses `PG_SSL_MODE=disable`.
- Restart the bot after changing the value.

</details>

<details>
<summary><strong>Connection timeout</strong></summary>

- Confirm the cloud database project is running and not paused.
- Check whether the provider requires an IP allowlist.
- Try the Supabase Session pooler URL if the direct URL requires IPv6.
- Confirm your VPS firewall is not blocking outbound database connections.

</details>

---

## Backups

### Supabase

Check the **Backups** section in your Supabase project. Backup availability and retention depend on your Supabase plan.

### VPS

Create a manual backup:

```bash
sudo -u postgres pg_dump spam_catcher > spam_catcher_backup.sql
```

Store the backup somewhere private and separate from the VPS. The backup contains server configuration and moderation history.

---

## Security Checklist

- [ ] The database password is stored privately.
- [ ] `.env` is not uploaded to GitHub or shared publicly.
- [ ] A cloud database uses SSL.
- [ ] A same-VPS database uses `127.0.0.1` and does not expose port `5432` publicly.
- [ ] On a VPS, the bot uses the `spamcatcher` database user instead of the PostgreSQL `postgres` superuser.
- [ ] `/spam-catcher setup` opens and saves settings without a database error.
- [ ] A recent database backup exists.

When every relevant item is checked, the database is ready for Spam Catcher.
