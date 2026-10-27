# Nexora OS — operations

Running, deploying, backing up and restoring the application.

---

## 1. Local development

```bash
npm install
cp .env.example .env.local        # then fill in AUTH_SECRET and CRON_SECRET

npm run db:start                  # terminal 1 — embedded PostgreSQL on :5434
npm run db:migrate                # apply the checked-in migrations
npm run bootstrap:admin           # create the first Owner account
npm run db:seed                   # optional: clearly-labelled [DEMO] data

npm run dev                       # terminal 2 — http://localhost:3000
```

Generate the two required secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### Why `npm run db:start`

The development machine this was built on has neither PostgreSQL nor Docker.
`db:start` runs **PGlite** — PostgreSQL compiled to WebAssembly — and exposes
it on port 5434 over the genuine PostgreSQL wire protocol. Prisma, `psql` and
any other client connect to it normally, and `NUMERIC`, transactions,
constraints and migrations behave exactly as they do on a server.

If you _do_ have PostgreSQL available, skip `db:start` and point
`DATABASE_URL` at it. Nothing else changes.

### Verifying a change

```bash
npm run verify     # lint + typecheck + unit/integration tests + build
npm run test:e2e   # Playwright, needs a build and the seed
```

The E2E suite drives the real UI, so it writes real records. Everything it
creates is named with an `E2E ` prefix, and a global teardown removes exactly
those rows when the run finishes — without it the residue buries the demo data
and inflates the dashboard and report totals. Set `E2E_KEEP_DATA=1` to keep
them for inspection after a failure, and `npm run test:e2e:clean` to remove
them later.

---

## 2. Production deployment

### 2.1 Prerequisites

| Requirement          | Notes                                                            |
| -------------------- | ---------------------------------------------------------------- |
| Node.js 20.11+       | 22 LTS recommended                                               |
| PostgreSQL 14+       | Managed (Neon, Supabase, RDS, Cloud SQL) or self-hosted          |
| S3-compatible bucket | **Private.** Public-read will leak client documents              |
| SMTP credentials     | Optional; without them the app records but never sends email     |
| A scheduler          | Vercel Cron, a systemd timer, or any cron that can send a header |

### 2.2 Environment

Set every variable from `.env.example`. The application validates them at
startup and refuses to boot on a bad configuration, so a missing secret is a
failed deploy rather than a silent downgrade.

Production specifically requires:

- `AUTH_SECRET` — 32+ random bytes. Rotating it invalidates all sessions and
  makes existing encrypted TOTP secrets unreadable, so users must re-enrol.
- `CRON_SECRET` — 16+ random bytes, sent as `Authorization: Bearer …`.
- `STORAGE_DRIVER=s3` with the `S3_*` values. Leaving it `local` in
  production puts uploads on the app server's disk, where they are lost on
  the next deploy — the Settings page flags this.
- `EMAIL_DRIVER=smtp` with the `SMTP_*` values, if you want invoices emailed.

The placeholders in `.env.example` are rejected in production: a deploy with
`AUTH_SECRET=replace-me-…` fails to start.

### 2.3 Deploy

```bash
npm ci
npx prisma migrate deploy      # never `migrate dev` in production
npm run build
npm run start                  # or hand off to your platform's runner
```

Run `migrate deploy` as a release step, before the new code serves traffic.

### 2.4 Bootstrap the first account

```bash
BOOTSTRAP_OWNER_EMAIL=you@office.com npm run bootstrap:admin
```

Prints a generated password once. It is stored only as an argon2id hash and
cannot be recovered. Sign in, change it, and enrol in two-factor straight
away — Owner, Admin and Finance roles require it.

### 2.5 Scheduled jobs

One endpoint does the daily work: overdue recalculation, renewal reminders
and overdue-invoice reminders.

```
GET /api/cron/reminders
Authorization: Bearer <CRON_SECRET>
```

**Vercel** — add to `vercel.json`:

```json
{ "crons": [{ "path": "/api/cron/reminders", "schedule": "0 7 * * *" }] }
```

Vercel sends `Authorization: Bearer $CRON_SECRET` automatically when that
variable is set.

**Anywhere else** — a daily cron entry:

```cron
0 7 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://your-host/api/cron/reminders
```

Running it more than once a day is safe. Reminders are deduplicated by a
unique key per charge cycle, and the job itself skips if it already succeeded
in the last 12 hours.

---

## 3. Backup and restore

### 3.1 What to back up

1. **The database** — everything except uploaded file contents.
2. **The object store** — uploaded files and generated invoice PDFs.

Both are needed. A database backup alone restores an invoice record whose
PDF will not download.

### 3.2 Primary backup: `pg_dump`

For a real PostgreSQL server this is the right tool — it captures sequences,
extensions and ownership that a logical export does not.

```bash
pg_dump --format=custom --no-owner --no-privileges \
  --file "nexora-$(date -u +%Y%m%dT%H%M%SZ).dump" "$DATABASE_URL"
```

Restore into an empty database:

```bash
createdb nexora_restored
pg_restore --no-owner --no-privileges --dbname nexora_restored nexora-….dump
```

Most managed providers also offer point-in-time recovery. Turn it on; it is
better than any scheduled dump.

### 3.3 Portable backup: `npm run db:backup`

A logical JSON export through Prisma. It works against any target including
the embedded development database, which `pg_dump` cannot reach.

```bash
npm run db:backup                            # .backups/nexora-<timestamp>.json
npm run db:backup -- --out /mnt/backups/n.json
npm run db:backup -- --verify /mnt/backups/n.json
```

Password hashes, TOTP secrets and recovery codes are **excluded** by default,
so a leaked backup does not hand over accounts. Pass
`--include-credentials` for a full-fidelity dump and treat that file as a
secret.

### 3.4 Object storage

```bash
aws s3 sync "s3://$S3_BUCKET" ./storage-backup --exact-timestamps
```

Enable bucket versioning so an overwrite or delete is recoverable without a
separate copy.

### 3.5 Restore drill

Test the restore, not just the backup. Quarterly, and after any change to the
schema or the storage layout:

1. Provision an empty PostgreSQL database.
2. Restore the most recent dump into it.
3. Point a staging deployment at it with `STORAGE_DRIVER=s3` and a **read-only**
   credential for the real bucket, or a copy of it.
4. Verify:
   - sign in with a real account;
   - open an issued invoice and download its PDF;
   - check `/reports` totals against the figures from before the restore;
   - confirm `/activity` still shows the audit history.
5. Record the date, the backup used and how long it took.

A backup nobody has restored is a hypothesis.

### 3.6 Retention

| Item                  | Suggested retention                              |
| --------------------- | ------------------------------------------------ |
| Daily database dump   | 30 days                                          |
| Weekly dump           | 12 weeks                                         |
| Monthly dump          | 24 months                                        |
| Object store versions | 90 days                                          |
| Audit log rows        | Keep indefinitely — they are the financial trail |

Check your own legal and tax requirements; these are starting points, not
advice.

---

## 4. Monitoring

### 4.1 Health check

```
GET /api/health
```

`200` with `{"status":"ok"}` when the database answers; `503` when it does
not. Point your uptime monitor here, not at `/`, which redirects.

### 4.2 Logs

Structured single-line JSON in production. Secrets, passwords, card data and
file contents are redacted by key name before anything is written.

### 4.3 Error monitoring

`captureException` in `src/lib/logger.ts` is the single hook for a Sentry or
Rollbar SDK. It currently logs; wire the SDK there and every handled error
flows through it.

### 4.4 Job health

`/settings` shows the last scheduled run and its error, and every run is a
row in `job_executions`. Alert if no `SUCCEEDED` row appears for 36 hours.

---

## 5. Security operations

### 5.1 Rotating `AUTH_SECRET`

Rotation invalidates every session **and** makes stored TOTP secrets
undecryptable. Plan it:

1. Tell users two-factor must be re-enrolled.
2. Deploy the new secret.
3. Clear the stored secrets:
   ```sql
   UPDATE users SET "mfaSecretEnc" = NULL, "mfaEnabled" = false,
                    "mfaRecoveryCodes" = NULL;
   DELETE FROM sessions;
   ```
4. Have privileged roles re-enrol at Settings → Profile & security.

### 5.2 Suspected account compromise

```sql
-- End every session for one user
UPDATE sessions SET "revokedAt" = now() WHERE "userId" = '<uuid>';

-- Lock the account out entirely
UPDATE users SET status = 'SUSPENDED' WHERE id = '<uuid>';
```

Then review `/activity` filtered to that person.

### 5.3 Offboarding

Remove them from Team & Roles. That ends their sessions and suspends the
account while keeping their name on the invoices, payments and audit entries
they created, so history stays complete.

---

## 6. Troubleshooting

| Symptom                                             | Likely cause                                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Boot fails with "Invalid environment configuration" | A required variable is missing or still a placeholder. The message names each one.                                              |
| Totals exclude some transactions                    | No exchange rate on or before those dates. Add them in Settings → Exchange rates; the app says which currencies were skipped.   |
| Reminders never fire                                | The scheduler is not calling `/api/cron/reminders`, or `CRON_SECRET` does not match. Check `job_executions`.                    |
| Uploads rejected                                    | The file failed extension, declared-type or magic-byte validation. The rejection message states which.                          |
| Invoice PDF 404s                                    | The file row exists but the object does not — usually `STORAGE_DRIVER=local` with files lost on redeploy. Use "Regenerate PDF". |
| "This invoice has already been issued"              | Working as designed. Issue a credit note, or void and raise a replacement.                                                      |
