# Nexora OS — final implementation report

Date: 2026-10-28
Scope: `NEXORA_OS_CLAUDE_CODE_SPEC.md`, implemented in full across Phases 0–7.

---

## 1. What was built

A working internal office CRM, not a mockup. Every screen reads and writes real
PostgreSQL rows through Prisma, every mutation passes an authorization check and
leaves an audit entry, and every monetary figure is computed in exact decimal
arithmetic and stored as `NUMERIC(18,4)`.

| Area                      | Status   | Substance                                                                                                                                                                        |
| ------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth & sessions           | Complete | argon2id passwords, opaque DB-backed sessions (SHA-256 token digests), per-IP and per-account login rate limiting, forced re-auth on password change                             |
| Two-factor                | Complete | TOTP (`otpauth`), secrets encrypted with AES-256-GCM under a key derived from `AUTH_SECRET`; single-use recovery codes; mandatory for Owner, Admin and Finance                   |
| RBAC                      | Complete | Deny-by-default capability matrix (one constant, read by the sidebar, the Team page and the server guard) plus object-level scope predicates applied inside the SQL query        |
| Clients                   | Complete | CRUD, contacts, tags, notes, soft delete, duplicate detection, CSV/XLSX import with mapping and confirm-before-write, CSV export                                                 |
| Projects & tasks          | Complete | Projects with budgets and members, Kanban board with drag-and-drop and fractional ordering, task assignment, due dates, checklists                                               |
| Invoicing                 | Complete | Draft → issued → paid/void lifecycle, immutable issued snapshot, line-level discounts and tax, multi-currency, PDF generation from the snapshot, email send recorded not claimed |
| Payments                  | Complete | Partial payments, over-allocation held as credit, oldest-first allocation across invoices, currency match enforced, idempotency keys under a unique index                        |
| Cards & platforms         | Complete | Card inventory (brand, last4, expiry, holder — never PAN or CVV), platform links with placement and removal workflow, audit trail                                                |
| Subscriptions             | Complete | Cadence engine with billing-anchor preservation, renewal calendar, forecast commitment kept structurally separate from recorded actual expense                                   |
| Files                     | Complete | Three-axis upload validation (extension / declared MIME / magic bytes), private download route with per-object authorization, versioning, soft delete, CSV & XLSX preview        |
| Reporting                 | Complete | Cash collected vs invoiced revenue, receivables aging, revenue by client, project margin, subscription commitment, dashboard charts, CSV **and** PDF export                      |
| Multi-currency            | Complete | Original currency and amount preserved; consolidation uses dated rate snapshots with source; unconvertible amounts excluded and disclosed, never estimated                       |
| Notifications & reminders | Complete | In-app notifications, one authenticated cron endpoint for overdue recalculation and reminders, deduplicated per charge cycle                                                     |
| Audit log                 | Complete | Written in the same transaction as the change it describes, with field-level redaction                                                                                           |
| Settings / team           | Complete | Workspace profile, invoice defaults, exchange-rate management, user invitation and role changes, visible permission matrix                                                       |

34 Prisma models · 32 pages · 9 API route handlers · 197 TypeScript source files.

---

## 2. Commands run, and their results

| Command                   | Result                                                       |
| ------------------------- | ------------------------------------------------------------ |
| `npm run lint`            | **Pass** — 0 errors, 4 warnings                              |
| `npm run typecheck`       | **Pass** — clean under `strict` + `noUncheckedIndexedAccess` |
| `npm run format:check`    | **Pass**                                                     |
| `npm run test`            | **Pass** — 229 tests across 11 files                         |
| `npm run build`           | **Pass** — production build, 43 routes                       |
| `npm run test:e2e`        | **Pass** — 45 Playwright tests                               |
| `npm audit`               | **Clean** — 0 vulnerabilities (dev and production trees)     |
| `npm run db:migrate`      | **Pass** — migrations apply to an empty database             |
| `npm run db:seed`         | **Pass** — demo data, every record prefixed `[DEMO]`         |
| `npm run db:backup`       | **Pass** — 246 rows across 31 tables, verified on re-read    |
| `npm run bootstrap:admin` | **Pass** — creates the first Owner, prints the password once |

### The 4 lint warnings

All four are the same React Compiler notice — `react-hooks/incompatible-library`
on React Hook Form's `watch()` in `project-form.tsx` and `subscription-form.tsx`.
The compiler declines to memoize those two components. That is correct behaviour,
not a defect: memoizing a value derived from `watch()` is exactly how the stale
invoice-totals bug (see §5) was introduced. Left as warnings deliberately.

### Test breakdown

**Unit — 149 tests**

| File                           | Tests | Covers                                                                                |
| ------------------------------ | ----- | ------------------------------------------------------------------------------------- |
| `invoice-calculations.test.ts` | 35    | Totals, discounts, tax modes, balances, status derivation, payment allocation         |
| `forecast.test.ts`             | 32    | Cadence arithmetic, billing-anchor preservation, 31 Jan → 28 Feb → 28 Mar, leap years |
| `file-safety.test.ts`          | 27    | Upload validation, CSV formula injection, path traversal, double extensions           |
| `permissions.test.ts`          | 21    | The capability matrix, including that unknown permissions are denied                  |
| `exchange.test.ts`             | 19    | Dated rate lookup, inversion, refusal to guess, disclosure text                       |
| `money.test.ts`                | 15    | Decimal parsing, HALF_UP rounding, zero- and three-decimal currencies                 |

**Integration — 80 tests, against a real PostgreSQL instance and the real server actions**

| File                        | Tests | Covers                                                                          |
| --------------------------- | ----- | ------------------------------------------------------------------------------- |
| `invoice-lifecycle.test.ts` | 28    | Draft→issue→pay, snapshot immutability, idempotency under genuine concurrency   |
| `authorization.test.ts`     | 17    | Every role against every guarded action; out-of-scope ids return NotFound       |
| `client-import.test.ts`     | 16    | Preview/validate/commit, nothing written before confirmation, no value coercion |
| `reminders.test.ts`         | 12    | Overdue recalculation, reminder dedupe, replay protection                       |
| `schema.test.ts`            | 7     | Database CHECK constraints hold even when application code is bypassed          |

**E2E — 45 Playwright tests** across sign-in, MFA, navigation by role, the
client→invoice→payment workflow, the card footprint workflow, project delivery,
reporting and exports, API boundaries, CSRF and security headers.

---

## 3. Outstanding limitations

Stated plainly, because the spec asked for unfinished work to be identified
rather than quietly skipped.

**Deliberate scope boundaries** — these were required by the spec, not shortfalls:

1. **No card charging.** Card records are an inventory of where cards are stored
   and what is expected to be billed. Nexora OS never contacts a payment network.
2. **No remote removal.** Marking a platform link removed records the office's own
   action and date. It does not and cannot remove the card from the external service.
3. **No payment processor.** "Invoice sent" means an email was dispatched (or
   recorded, if SMTP is unconfigured). It never means money arrived.
4. **Spreadsheets are read, not edited.** CSV and XLSX preview and import work.
   There is no formula engine and no claim of Excel fidelity.
5. **Reports are management reporting.** Not statements, not tax-ready, no accruals.
   Every report says so on its face and in both export formats.

**Real limitations a future phase would address:**

6. **No virus scanning.** Uploads are validated by extension, declared MIME type
   and magic bytes, and are never served inline as HTML. They are not scanned.
   `FileAsset.scanStatus` exists and is set to `SKIPPED`; wiring ClamAV or a
   hosted scanner is a contained change.
7. **Rate limiting is per-process, in memory.** Correct for a single instance.
   Behind more than one replica, move it to Redis or the database.
8. **Exchange rates are entered by hand.** There is no provider integration — a
   deliberate choice, since the spec forbids hardcoded rates and an unattended
   feed would need its own audit story. Missing rates are disclosed, never guessed.
9. **One workspace.** Every table carries `workspaceId` and every query is scoped,
   so multi-tenancy is a routing and onboarding problem rather than a data-model one,
   but the UI assumes one workspace.
10. **Email delivery is fire-and-forget.** Failures are logged and surfaced; there
    is no retry queue or bounce handling.
11. **Local development uses PGlite**, PostgreSQL compiled to WebAssembly, served
    over the real wire protocol on port 5434, because this machine has neither
    PostgreSQL nor Docker. Production uses ordinary PostgreSQL via the same
    `DATABASE_URL` contract. The integration tests run against PGlite, so they
    exercise real SQL, real constraints and real transactions — but not a real
    server's concurrency, replication or extension set.
12. **Accessibility** has had a working pass (labels, roles, distinguishable
    accessible names, keyboard paths, focus states) but no screen-reader audit.

---

## 4. Running it

### Local

```bash
npm install
cp .env.example .env.local          # fill in AUTH_SECRET and CRON_SECRET

npm run db:start                    # terminal 1 — embedded PostgreSQL on :5434
npm run db:migrate
npm run bootstrap:admin             # first Owner account; prints the password once
npm run db:seed                     # optional, development only — [DEMO] data

npm run dev                         # terminal 2 — http://localhost:3000
```

Generate each secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

If PostgreSQL is available, skip `db:start` and point `DATABASE_URL` at it.
Nothing else changes.

### Verifying a change

```bash
npm run verify      # lint + typecheck + tests + build
npm run test:e2e    # Playwright; needs a build, the seed and the database running
```

### Production deployment

1. **Provision** PostgreSQL 14+, a **private** S3-compatible bucket, and SMTP
   credentials if invoices are to be emailed.
2. **Configure** every variable in `.env.example`. The app validates them at
   startup and refuses to boot on a bad configuration — a missing secret is a
   failed deploy, not a silent downgrade. The placeholder values are rejected
   outright in production.
   - `STORAGE_DRIVER=s3` with the `S3_*` values. Leaving it `local` puts uploads
     on the app server's disk, where the next deploy destroys them; the Settings
     page flags this.
   - `EMAIL_DRIVER=smtp` with the `SMTP_*` values.
3. **Release step**, before new code serves traffic:
   ```bash
   npm ci
   npx prisma migrate deploy        # never `migrate dev` in production
   npm run build
   npm run start
   ```
4. **Bootstrap** the first account:
   ```bash
   BOOTSTRAP_OWNER_EMAIL=you@office.com npm run bootstrap:admin
   ```
   Sign in, change the password, enrol in two-factor immediately.
5. **Schedule** the daily job — `GET /api/cron/reminders` with
   `Authorization: Bearer $CRON_SECRET`. On Vercel, add the `crons` entry in
   `vercel.json`; anywhere else, a cron line with `curl`. Running it more often
   than daily is safe: reminders are deduplicated and the job skips if it already
   succeeded within 12 hours.
6. **Back up** both the database and the object store. `pg_dump` for the database
   (plus the provider's point-in-time recovery), `aws s3 sync` with bucket
   versioning for files. `npm run db:backup` is a portable JSON alternative that
   excludes credentials by default. Run the restore drill in
   `docs/OPERATIONS.md` §3.5 quarterly — a backup nobody has restored is a hypothesis.
7. **Monitor** `GET /api/health` (200 when the database answers, 503 when it does not).

Full detail, including retention schedules and the restore drill, is in
`docs/OPERATIONS.md`.

---

## 5. Security and QA summary

### Controls in place

| Control               | Implementation                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Password storage      | argon2id (`@node-rs/argon2`), per-user salt, never logged                                                                                 |
| Sessions              | Opaque random tokens; only a SHA-256 digest is stored; httpOnly, SameSite=Lax, Secure in production; revoked on logout                    |
| Two-factor            | TOTP, secret encrypted AES-256-GCM with an HKDF-derived key; recovery codes hashed and single-use                                         |
| Authorization         | Deny-by-default capability matrix **and** object-level scope, the latter enforced in the SQL query, not post-filtered                     |
| Enumeration           | Out-of-scope records raise NotFound, not Forbidden — a 403 would confirm the id exists                                                    |
| CSRF                  | Same-origin check plus a double-submit cookie/header token on state-changing route handlers; E2E-tested against a foreign Origin          |
| SQL injection         | Prisma parameterised queries throughout. `$executeRawUnsafe` appears once, in the test truncation helper, never in `src/`                 |
| XSS                   | No `dangerouslySetInnerHTML`, no `innerHTML`, no `eval` anywhere in the source. CSP with `object-src 'none'` and `frame-ancestors 'none'` |
| Upload safety         | Extension allow-list (`.svg` and `.html` rejected), declared MIME check, magic-byte check, size cap, name sanitisation                    |
| CSV formula injection | Every exported cell passes through `escapeCsvCell`; `=`, `+`, `-`, `@` and leading tab are neutralised                                    |
| Object storage        | No public URLs and no arbitrary key access. Downloads go through an authenticated route that resolves the key server-side                 |
| Rate limiting         | Login (per IP and per account), export, and expensive endpoints                                                                           |
| Secrets               | Validated at startup, never logged; audit writer redacts password hashes, TOTP secrets, tokens and storage keys                           |
| Headers               | CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`                                     |
| Dependencies          | `npm audit` clean; `uuid` pinned via `overrides` to clear the advisory reaching the tree through exceljs                                  |

### Card data

No card number, CVV, PIN or banking password is accepted, stored, logged or
displayed. The card form has no field for a full number — there is an E2E test
asserting that. What is stored: brand, last four digits (CHECK-constrained to
four digits), expiry month/year, holder name, a label, and where the card is
saved. That is an inventory, and it is all the office needs.

### Financial correctness

- All money is `decimal.js` in TypeScript and `NUMERIC(18,4)` in PostgreSQL.
  No JavaScript float touches a monetary value at any point.
- Rounding is HALF_UP to the currency's minor unit, at exactly three places —
  line net, line tax, grand total — so printed figures reconcile by construction.
- Totals are recomputed server-side on every write. The browser's live preview
  imports the same pure module but is never trusted.
- Issued invoices freeze a snapshot. Renaming a client does not rewrite history.
- Cash collected and invoiced revenue are separate metrics with their definitions
  printed beside them; forecast subscription cost and actual paid expense are
  separate tables, not two views of one number.
- Consolidation uses a dated rate snapshot with its source. Unconvertible amounts
  are excluded from the total and listed explicitly. Nothing is estimated and no
  rate is hardcoded.

### Issues found during QA and fixed

Each of these was a real defect caught by the tests or the review, not a
test-only adjustment:

1. `assertCsrf` was written but never called — dead code presenting as a control.
   Replaced with an applied origin + double-submit guard on both state-changing
   routes, with an E2E test.
2. `StatCard` was a client component receiving an icon component as a prop, which
   broke the dashboard, subscriptions and settings pages in production builds.
3. A duplicate `id` in `Field` meant `<label for>` resolved to a wrapper `<div>`,
   leaving the password input with no accessible label.
4. Invoice live totals were frozen at zero: `watch('lines')` returns a stable
   reference, so the `useMemo` never invalidated.
5. The seed inserted invoices without advancing `invoiceNextNo`, so the first
   invoice a user created collided. Numbering is now collision-resilient and
   self-correcting.
6. Finance could create a draft invoice but not discard it — a missing capability.
7. The per-IP login limit would lock out an entire NAT'd office; raised, and
   cleared on successful sign-in.
8. Three pairs of buttons shared an accessible name ("Link a platform", "Record a
   card", Kanban card actions) — a genuine screen-reader ambiguity, now distinguished.
9. `lib/audit` pulled the argon2 native binding into the client bundle; labels are
   now a separate module.
10. The Playwright suite wrote real records into the development database and
    never removed them. Found by clicking through the running app: the demo
    data was buried under test residue, and the invoice-list header, dashboard
    and report totals all included E2E amounts. A global teardown now deletes
    exactly the `E2E `-prefixed rows each run creates (`E2E_KEEP_DATA=1` keeps
    them; `npm run test:e2e:clean` removes them later).

### What was not done

No penetration test, no threat-model workshop, no third-party security review, and
no virus scanning on uploads. The controls above are implemented and tested, but
"tested by its author" is a different claim from "audited".

---

## 6. Where things are

| Path                       | Contents                                                     |
| -------------------------- | ------------------------------------------------------------ |
| `IMPLEMENTATION_PLAN.md`   | The phase plan and its status checklist — all items complete |
| `README.md`                | Overview, feature table, quick start                         |
| `docs/ARCHITECTURE.md`     | Layout, request flow, authorization, money, data model       |
| `docs/OPERATIONS.md`       | Local development, deployment, backup/restore, monitoring    |
| `docs/SECURITY.md`         | The security model in detail, and its known gaps             |
| `.github/workflows/ci.yml` | Lint, format, typecheck, test, build on every push           |
