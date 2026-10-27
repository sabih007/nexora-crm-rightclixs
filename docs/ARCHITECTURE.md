# Nexora OS — architecture

How the code is organised, and the reasoning behind the choices that would
otherwise look arbitrary.

---

## 1. Layout

```
src/
  app/
    (auth)/            login, two-factor challenge
    (app)/             everything behind authentication
    api/               route handlers: downloads, exports, cron, health
  components/
    ui/                primitives — Button, Field, Dialog, Table…
    shared/            domain-aware but feature-agnostic — DataTable,
                       CurrencyAmount, StatusBadge, PageHeader
    layout/            app shell, sidebar, command palette
    providers/         theme and toast providers
  features/
    <feature>/
      schemas.ts       Zod input contracts
      queries.ts       read models (server-only)
      actions.ts       mutations ('use server')
      *.tsx            feature UI
  lib/                 cross-cutting: db, auth, money, dates, storage, email
  generated/prisma/    Prisma client (generated, not committed)
prisma/
  schema.prisma        the data model
  migrations/          checked-in SQL, applied in order
tests/
  unit/                pure logic
  integration/         real PostgreSQL, real server actions
  e2e/                 Playwright against a production build
```

A feature owns its schemas, queries, actions and screens. Anything two
features both need moves to `lib/` or `components/shared/`, never into a
sibling feature.

---

## 2. Request flow

```
Page (server component)
  └─ requireAuthPage()           session, role, MFA gate
  └─ queries.ts                  reads, already scoped to the actor
  └─ renders a client component with plain data

Client component
  └─ calls a server action
       └─ defineAction()
            ├─ requirePermission()   capability, deny-by-default
            ├─ Zod parse             validation
            ├─ assert*Access()       object-level scope
            ├─ prisma.$transaction   the change + its audit entry
            └─ normalised result     no internals leak to the browser
```

`defineAction` in `src/lib/action.ts` is the single spine for mutations. It
means a new action cannot accidentally skip authentication, validation or
error normalisation — those are not things a developer remembers to add.

Errors become `{ ok: false, error, code, fieldErrors }`. Domain failures
carry a message intended for the user; anything else becomes a generic
message and is logged server-side with full detail.

---

## 3. Authorization

Two layers, both required:

**Capability** — `src/lib/permissions.ts` holds one table mapping each role
to a list of permissions. Absent means denied, and an unrecognised
permission string is denied. The sidebar, the Team page's matrix and the
server guard all read that same constant, so the documentation cannot drift
from the behaviour.

**Object scope** — `src/lib/auth/guard.ts` supplies `where` fragments
(`projectScopeWhere`, `clientScopeWhere`) and assertions
(`assertProjectAccess`, `assertFileAccess`). Roles without `project:read_all`
see only what they are attached to, and the restriction is applied in the
database query rather than by filtering afterwards.

Out-of-scope records raise `NotFoundError`, not `AuthorizationError`. A
"forbidden" response would confirm an id exists.

### Roles

| Role    | Shape of access                                                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Owner   | Everything, including ownership transfer                                                                                                         |
| Admin   | Everything except ownership transfer                                                                                                             |
| Finance | Owns invoicing, payments, subscriptions, expenses, reporting; read-only on clients and projects; no team administration                          |
| Manager | Runs delivery: clients, projects, tasks, files. Reads invoices but cannot issue, void or take payment. No card inventory, no office-wide finance |
| Staff   | Only assigned projects and their clients and files. No invoices, payments, cards or audit log, and no sensitive contact details                  |

Owner, Admin and Finance must clear a TOTP challenge once enrolled.

---

## 4. Money

`src/lib/money.ts` is the only place monetary arithmetic happens.

- Storage is `NUMERIC(18,4)`; in TypeScript it is `Decimal` (decimal.js).
- `dec()` rejects malformed input instead of coercing it, and converts a
  JavaScript number through its string form so `0.1` keeps its decimal
  meaning.
- Rounding is HALF_UP to the currency's minor unit, taken from a table that
  knows about zero-decimal currencies (JPY, KRW) and three-decimal ones
  (KWD, BHD).
- Rounding happens at three points only: each line net, each tax amount, and
  the grand total. Subtotals are sums of already-rounded values, so the
  printed figures reconcile.

`src/features/invoices/calculations.ts` is pure and dependency-free: totals,
balances, status derivation, allocation. The browser imports it for the live
preview and the server imports it to compute what it stores, so the two
cannot disagree — and the server recomputes rather than trusting the client.

### Multi-currency

Original currency and amount are never altered. Consolidation
(`src/features/reports/exchange.ts`) picks the most recent rate effective on
or before the transaction's own date, inverts a stored pair only when no
direct rate exists, and returns both the total and an explicit list of what
it could not convert. Reports print the rate, its date and its source.

---

## 5. Data model notes

- UUID primary keys via `gen_random_uuid()`, available in PostgreSQL core.
- Every business table carries `workspaceId` and is queried through a
  workspace-scoped helper, even though v1 runs one workspace.
- `onDelete` is RESTRICT for financial relationships and CASCADE only for
  genuinely owned children. An invoice can never lose its client.
- Domain invariants that must hold regardless of application code are CHECK
  constraints in the migration: four-digit `last4`, three-letter currency
  codes, positive amounts, due date not before issue date, a custom-cadence
  subscription requiring an interval.
- Uniqueness carries real meaning: `(workspaceId, invoiceNumber)`,
  `(workspaceId, platformId, cardId)`, and the idempotency and reminder
  dedupe keys.

Migrations are authored with `prisma migrate diff` and applied with
`migrate deploy`, because PGlite is single-database and cannot host the
shadow database `migrate dev` expects. The result is ordinary checked-in SQL.

---

## 6. Auditing

`recordAudit()` accepts an optional transaction client, so the audit row
commits with the change it describes — there is no window in which a
payment exists without its trail. Field names matching a redaction list
(password hashes, TOTP secrets, storage keys, tokens) are replaced before
anything is written, and `Decimal` values are stored as exact strings.

Labels live in `src/lib/audit-labels.ts`, separate from the writer, so the
activity feed can render them in the browser without dragging Prisma and the
argon2 binding into the client bundle.

---

## 7. Files

Uploads post to a server action, so the bytes are validated before they
reach storage: extension against an allow-list (`.svg` and `.html` are
refused — they execute), the browser's declared type, and the real leading
bytes. A mismatch is rejected, which is how a script uploaded as a
"spreadsheet" is caught.

Downloads go through `/api/files/[id]/download`, which authenticates, checks
the capability, checks object scope, and streams with
`Content-Type: application/octet-stream`, `nosniff` and a sandbox CSP.
Storage keys never leave the server. A short-lived signed token can
accompany a link, but it is additive — it never replaces the session check.

Spreadsheet reading caps rows and columns before allocating, reads formulas
as their cached value and never evaluates them, and preserves the original
file untouched.

---

## 8. Scheduled work

One authenticated endpoint, `/api/cron/reminders`, runs the daily job:
overdue recalculation, renewal reminders, overdue-invoice reminders.

Safety comes from three places: a constant-time secret comparison; a
`JobExecution` row per run with status, attempts and error; and a dedupe key
per reminder (`subscriptionId:chargeDate:daysBefore:channel`) under a unique
index. Running the job twice sends nothing twice.

---

## 9. UI conventions

- Server components by default. A component becomes a client component only
  when it needs state, an event handler or a browser API. `StatCard` is
  deliberately a server component so pages can pass it an icon component —
  a function cannot cross the server/client boundary.
- List state lives in the URL, so a filtered view is a shareable link and
  the back button behaves. Sorting, filtering and pagination are
  server-driven; `DataTable` reports intent and never slices data itself.
- Tables become labelled cards below `md` rather than scrolling horizontally.
- Every figure that could mislead carries its definition. Every destructive
  action is confirmed, and the genuinely irreversible ones (voiding an
  issued invoice, removing a colleague) require typing an exact phrase.
- `useSyncExternalStore` rather than `useState` + `useEffect` for values
  read from `localStorage`, so the server and first client render agree and
  no cascading render is triggered.

---

## 10. Testing strategy

**Unit** — pure logic with no I/O: money, invoice arithmetic, subscription
cadence, exchange-rate selection, the permission matrix, upload validation,
CSV escaping. Fast, and they encode the edge cases that are easy to regress.

**Integration** — a throwaway PostgreSQL per run with the real migrations
applied, exercising the real server actions through `defineAction`,
including the permission checks. Only the request-scoped Next APIs are
mocked. This is where idempotency under concurrency, transaction boundaries,
scoping across roles and the import flow are proven.

**End-to-end** — Playwright against a production build, signing in as each
role once and reusing the session. Covers every page rendering without a
browser error, the role boundaries, API authentication, security headers,
and the specification's named workflows.

The E2E suite has already paid for itself: it caught a server/client
boundary violation that broke three pages in production builds, a duplicate
`id` that made the password field unlabelled, and a live-preview bug where
invoice totals silently stayed at zero.
