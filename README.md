# Nexora OS

An internal office CRM: clients, invoices, payments, subscriptions, the
card-to-platform footprint, projects, files and management reporting — in one
application, with role-based access enforced on the server and an audit trail
behind every financial change.

Built against `NEXORA_OS_CLAUDE_CODE_SPEC.md`.

---

## Quick start

```bash
npm install
cp .env.example .env.local

# Generate the two required secrets and paste them into .env.local
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

npm run db:start        # terminal 1 — embedded PostgreSQL on :5434
npm run db:migrate      # apply the checked-in migrations
npm run bootstrap:admin # create the first Owner account (prints a password once)
npm run db:seed         # optional: clearly-labelled [DEMO] data

npm run dev             # terminal 2 — http://localhost:3000
```

Seeded demo accounts (development only) are `owner@`, `admin@`, `finance@`,
`manager@` and `staff@example.com`, all with the password the seed prints.

---

## What it does

| Area              | Summary                                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Overview**      | KPIs computed from source records, each with its calculation rule on the tile. Cash collected and invoiced revenue are shown as separate figures, never conflated. |
| **Clients**       | Companies and individuals, contacts, tags, notes, duplicate detection, archiving, CSV import and export.                                                           |
| **Invoices**      | Draft → Sent → Partially paid → Paid / Overdue, plus Void and Cancelled. Decimal-exact totals, per-line or invoice-level tax, branded PDF, credit notes.           |
| **Payments**      | Manual recording with idempotency keys, partial payments, oldest-first allocation, overpayment held as credit.                                                     |
| **Subscriptions** | Platform registry, card inventory, "where is this card saved?", renewal forecasting and a 90-day calendar.                                                         |
| **Expenses**      | Real paid charges, kept strictly separate from forecasts.                                                                                                          |
| **Projects**      | Client-linked projects, budgets, members, Kanban and list task views, comments, checklists.                                                                        |
| **Files**         | Private storage, folders, versioning, spreadsheet preview and a confirm-before-commit import.                                                                      |
| **Reports**       | Cash, receivables ageing, revenue by client, project billing, subscription commitment, CSV and PDF export with the definitions included.                           |
| **Activity**      | Searchable audit log of every financial and access change.                                                                                                         |
| **Team**          | Five roles with a generated permission matrix, TOTP for privileged roles.                                                                                          |

---

## Stack and substitutions

| Area            | Choice                                                             |
| --------------- | ------------------------------------------------------------------ |
| Framework       | Next.js 16 (App Router), React 19, TypeScript 5.9 strict           |
| Styling         | Tailwind CSS v4 with CSS design tokens, light and dark             |
| Components      | Radix primitives, hand-authored shadcn/ui-style components         |
| Database        | PostgreSQL via Prisma 7 with a node-postgres driver adapter        |
| Money           | Postgres `NUMERIC(18,4)` ↔ `Decimal` end to end — never a JS float |
| Validation      | Zod 4, shared by the form resolver and the server action           |
| Tables / charts | TanStack Table conventions, Recharts                               |
| PDF             | pdfkit, rendered server-side from the issued snapshot              |
| Spreadsheets    | `exceljs` and `papaparse`                                          |
| Tests           | Vitest (unit + integration), Playwright (E2E)                      |

Three deliberate departures from the specification, each for a stated reason:

**Authentication — custom instead of Auth.js.** Auth.js v5 is still `beta`
and unproven on Next 16. Nexora uses argon2id password hashing with opaque,
database-backed sessions: a revoked session or a suspended user takes effect
on the very next request, which a stateless JWT cannot do. TOTP with
encrypted secrets and single-use recovery codes is built in, and mandatory
for Owner, Admin and Finance.

**Spreadsheets — `exceljs` instead of `xlsx`.** The `xlsx` package on npm is
the unmaintained mirror carrying known prototype-pollution and ReDoS
advisories; the maintained build is only distributed elsewhere. `exceljs` is
actively maintained and on npm.

**Local database — PGlite.** The machine this was built on has neither
PostgreSQL nor Docker. `npm run db:start` runs PostgreSQL compiled to
WebAssembly, served over the real Postgres wire protocol, so migrations,
`NUMERIC` semantics, constraints and transactions behave exactly as on a
server. Production points `DATABASE_URL` at real PostgreSQL and nothing else
changes.

---

## Commands

| Command                    | Purpose                                                    |
| -------------------------- | ---------------------------------------------------------- |
| `npm run dev`              | Development server                                         |
| `npm run build` / `start`  | Production build and serve                                 |
| `npm run verify`           | lint + typecheck + unit/integration tests + build          |
| `npm test`                 | Vitest, unit and integration                               |
| `npm run test:e2e`         | Playwright (needs a build and the seed)                    |
| `npm run db:start`         | Embedded PostgreSQL for development                        |
| `npm run db:migrate`       | `prisma migrate deploy`                                    |
| `npm run db:makemigration` | Author a new migration from the schema                     |
| `npm run db:seed`          | Clearly-labelled demo data                                 |
| `npm run db:reset`         | Drop, migrate and reseed (development only)                |
| `npm run db:backup`        | Portable logical backup; `-- --verify <file>` to check one |
| `npm run bootstrap:admin`  | Create the first Owner account                             |

---

## How correctness is protected

**Money never touches a float.** Amounts are `NUMERIC(18,4)` in PostgreSQL
and `Decimal` in TypeScript, from the database through the calculation
engine to the PDF. The rounding policy is written down in `src/lib/money.ts`
and applied at exactly three points, so the line totals printed on an
invoice always add up to the total printed beneath them.

**Issued invoices are immutable.** Issuing freezes the amounts and captures
a snapshot of both the totals and the client's billing details. Edits and
deletes are then refused; the correction path is a credit note or a void and
a replacement. The PDF renders from that snapshot, so what the client
received can always be reproduced.

**Payments cannot double-apply.** Every payment carries an idempotency key
under a unique index, inside the transaction that writes the allocations. A
double-click, a retried request or two concurrent submissions produce one
payment.

**Forecasts are never reported as spend.** Subscription commitment is
derived from each schedule and labelled as expected. Money that has actually
left the account is a separate `Expense` record. No screen adds them
together.

**Unlike currencies are never summed.** Consolidated figures use the
exchange rate effective on or before each transaction's own date. Where no
rate exists, the amount is excluded from the total and reported separately
with the reason — the application states what it could not convert rather
than quietly under-reporting.

**Authorization is server-side and deny-by-default.** Every action, route
handler, export and download resolves through a central permission matrix,
then an object-level scope check. Hiding a button is a convenience; the
server check is the boundary. Out-of-scope records return "not found" rather
than "forbidden", so a response cannot be used to probe for ids.

**Card data is structurally limited.** The schema has no column capable of
holding a PAN, CVV or PIN; `last4` is `CHAR(4)` with a digits-only CHECK
constraint. Marking a card "removed from a platform" updates this inventory
and says so — the application cannot and does not claim to have changed
anything on the external service.

---

## Testing

```
229 unit and integration tests   (Vitest, against real PostgreSQL)
 43 end-to-end tests             (Playwright, against a production build)
```

Integration tests boot a throwaway PostgreSQL instance and apply the
checked-in migration SQL — the same statements production runs — so a broken
migration fails the suite. They exercise the real server actions, including
the permission checks, rather than stubbing them.

Covered: invoice arithmetic and rounding edge cases, payment allocation and
idempotency under concurrency, subscription cadence and anchored billing
dates, exchange-rate selection, the permission matrix, object-level scoping
across roles, malicious uploads, CSV formula injection, the spreadsheet
import flow, reminder deduplication, and the end-to-end journeys through the
real UI.

---

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the code is organised and why
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — deploy, cron, backup, restore, monitoring
- [`docs/SECURITY.md`](docs/SECURITY.md) — threat model and controls
- [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) — build plan and status

---

## External services

Nothing is faked as live. Each adapter reports which mode it is in, and the
Settings page shows the status.

| Service          | Without configuration                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Object storage   | Files go to `./.storage`. Fine for development; lost on redeploy in production, and Settings says so.                                       |
| Email            | Messages are written to `./.mail` and logged. The UI reports "recorded, not sent" rather than claiming delivery.                            |
| Malware scanning | Not wired up. Uploads are still checked by extension, declared type and magic bytes, and files are labelled "type verified", never "clean". |
| Exchange rates   | Entered manually. No provider is called.                                                                                                    |

---

## Licence

Private, internal.
