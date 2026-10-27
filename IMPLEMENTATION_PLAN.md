# Nexora OS — Implementation Plan

Living checklist for building Nexora OS per `NEXORA_OS_CLAUDE_CODE_SPEC.md`.
Status legend: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked/deferred (reason noted)

---

## 0. Environment findings (inspected 2026-10-27)

| Item              | Result                                                                       |
| ----------------- | ---------------------------------------------------------------------------- |
| Working directory | `C:\Users\Sabih Ul Ebad Khan\Desktop\CRM OFFICE`                             |
| Existing files    | `NEXORA_OS_CLAUDE_CODE_SPEC.md` only — **no existing user code to preserve** |
| Git repo          | No — will `git init` locally for checkpointing                               |
| Node / npm        | v24.20.0 / 11.19.0                                                           |
| PostgreSQL server | **Not installed**                                                            |
| Docker            | **Not installed**                                                            |

### Consequence: local database strategy

The spec mandates PostgreSQL + Prisma. No Postgres server and no Docker are available on this
machine, so the app targets **real PostgreSQL in production** and uses **PGlite** locally —
PostgreSQL itself compiled to WebAssembly, exposed over the real Postgres wire protocol by
`@electric-sql/pglite-socket`. Prisma connects to it through an ordinary `DATABASE_URL`, so
migrations, SQL, transactions and `NUMERIC` semantics are genuine PostgreSQL behaviour, not a
mock. Switching to Neon/Supabase/RDS in production is a `DATABASE_URL` change only.

Shadow-database note: PGlite is single-database, so `prisma migrate dev` (which creates a
throwaway shadow DB) is not used. Migration SQL is authored with `prisma migrate diff` and
applied with `prisma migrate deploy` — real, checked-in, ordered migration files either way.

---

## 1. Stack decisions (and substitutions vs. the spec)

| Area            | Choice                                                                                                                                    | Note                                                                                                                                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework       | Next.js 16 (App Router) + React 19                                                                                                        |                                                                                                                                                                                                                               |
| Language        | TypeScript 5.9, `strict: true`                                                                                                            | TS 7 native port skipped — too new for the ecosystem here                                                                                                                                                                     |
| Styling         | Tailwind CSS v4 + CSS design tokens                                                                                                       |                                                                                                                                                                                                                               |
| Components      | Hand-authored shadcn/ui-style primitives on Radix + CVA                                                                                   | **Substitution:** components are vendored into `src/components/ui` rather than pulled by the shadcn CLI, so versions are pinned and auditable                                                                                 |
| Icons / motion  | lucide-react, motion                                                                                                                      |                                                                                                                                                                                                                               |
| ORM / DB        | Prisma 7.10.1 + PostgreSQL (`Decimal`/`NUMERIC` for money)                                                                                |                                                                                                                                                                                                                               |
| Auth            | **Custom credentials auth**: argon2id hashing, opaque DB-backed sessions, HttpOnly/SameSite=Lax cookies, TOTP MFA for Owner/Admin/Finance | **Substitution:** Auth.js v5 is still `beta` and unproven on Next 16. A DB-session design is fully testable, supports the required per-role MFA and server-side revocation, and has no beta dependency. Documented in README. |
| Validation      | Zod 4 + React Hook Form                                                                                                                   |                                                                                                                                                                                                                               |
| Tables / charts | TanStack Table, Recharts                                                                                                                  |                                                                                                                                                                                                                               |
| Money           | Prisma `Decimal` (decimal.js) end to end — no JS floats                                                                                   |                                                                                                                                                                                                                               |
| Storage         | S3 adapter (`@aws-sdk/client-s3` + presigner); local encrypted-token filesystem adapter for dev                                           | Private only; downloads always via signed, short-lived, authorized route                                                                                                                                                      |
| Spreadsheets    | `exceljs` (XLSX) + `papaparse` (CSV)                                                                                                      | **Substitution:** npm `xlsx@0.18.5` is the unmaintained mirror with known prototype-pollution/ReDoS advisories; `exceljs` is maintained                                                                                       |
| PDF             | `pdfkit` server-side                                                                                                                      | Deterministic, no headless browser needed                                                                                                                                                                                     |
| Email           | `nodemailer`; dev transport writes to disk + logs                                                                                         | Never claims delivery it cannot prove                                                                                                                                                                                         |
| Jobs            | Authenticated cron route handlers (`/api/cron/*`) + `JobExecution` ledger with idempotency keys & retries                                 | Vercel Cron compatible                                                                                                                                                                                                        |
| Tests           | Vitest (unit + integration on PGlite), Playwright (E2E)                                                                                   |                                                                                                                                                                                                                               |

---

## Phase 0 — Repository & architecture

- [x] Inspect repo/environment, record constraints
- [x] Write `IMPLEMENTATION_PLAN.md`
- [x] `git init`, `.gitignore`, `.env.example`
- [x] Next.js + TS strict + Tailwind v4 scaffold, path aliases
- [x] Env validation at startup (Zod, fails fast)
- [x] Lint / typecheck / test / build scripts; CI workflow
- [x] Design tokens, light+dark themes, app shell (sidebar, topbar, breadcrumbs)
- [x] UI primitives: Button, Input, Card, Badge, Dialog, Dropdown, Select, Table, Toast …
- **Gate:** clean `lint`, `typecheck`, `build`

## Phase 1 — Auth, workspace, RBAC, database

- [x] Full Prisma schema (all spec entities), indexes, constraints, `onDelete` rules
- [x] Initial migration + `migrate deploy` against PGlite
- [x] argon2id password hashing, session create/rotate/revoke, login rate limiting
- [x] TOTP MFA enrolment + challenge for privileged roles
- [x] Central permission matrix + `authorize()` guard; default deny; object-level checks
- [x] Audit log foundation (`recordAudit`) wired into mutation helper
- [x] Seed script (clearly labelled demo data, dev only) + admin bootstrap
- **Gate:** integration tests prove unauthorized requests are denied

## Phase 2 — Clients & projects

- [x] Client CRUD, contacts, tags, archive, duplicate detection
- [x] Client CSV import/export (moved to Phase 5 with the spreadsheet tooling)
- [x] Client detail: projects, invoices, payments, files, activity timeline
- [x] Project CRUD, members, budget, status/priority
- [x] Tasks: list + Kanban (drag/drop), comments, checklist, assignees, due dates
- **Gate:** E2E client→project→task workflow passes

## Phase 3 — Invoices & payments

- [x] Invoice builder (line items, discount, per-line vs invoice tax, terms)
- [x] Server-side decimal totals + documented rounding policy
- [x] Status machine: Draft→Sent→Partially Paid→Paid/Overdue, Void, Cancelled
- [x] Configurable numbering, immutable issued snapshot, client billing snapshot
- [x] Branded PDF generation + signed download
- [x] Payments: partial, overpayment/credit allocation, idempotency keys, transactions
- [x] Credit notes; mark-sent; overdue computation
- **Gate:** monetary edge-case unit tests pass; issued invoices cannot be silently rewritten

## Phase 4 — Cards, platforms & subscriptions

- [x] Card inventory (last4 + metadata only — no PAN/CVV fields anywhere)
- [x] Platform registry; card↔platform links with verify/remove + audit
- [x] Subscriptions: cadence, anchor date, trial, notice period, attribution
- [x] Forecast engine: monthly equivalent, annualized, 7/30/90-day, renewal calendar
- [x] Actual expenses linked to subscriptions (never counted as forecast)
- [x] Reminder rules (30/14/7/1d), timezone-aware, deduplicated cron job
- **Gate:** forecast/cadence/reminder unit tests pass

## Phase 5 — Files & spreadsheets

- [x] Signed upload flow (size, MIME + extension + magic-byte checks)
- [x] Folders, tags, metadata, versioning, soft delete
- [x] Private download route with per-object authorization
- [x] CSV/XLSX preview, column mapping, row validation, confirm-then-import
- [x] CSV-injection-safe exports
- **Gate:** access-control and malicious-upload tests pass

## Phase 6 — Reporting & polish

- [x] KPI queries from real records, with visible calculation definitions
- [x] Cash vs invoiced, AR aging, forecasts, actual expenses, client/project performance
- [x] Dated exchange-rate snapshots, manual entry, explicit missing-rate disclosure
- [x] CSV/PDF export; dashboard charts
- [x] Mobile/responsive, a11y pass, skeletons, empty/error states
- **Gate:** report totals reconcile to source records in tests

## Phase 7 — Hardening & deployment

- [x] Security headers + CSP, rate limiting, CSRF, IDOR sweep
- [x] Backup/restore documentation and script
- [x] Health check, structured logging, error monitoring hook
- [x] Playwright E2E suite, CI pipeline green
- [x] README, architecture doc, deployment checklist, final report
- **Gate:** lint + typecheck + unit/integration + build pass; deployment checklist complete

---

## Required external credentials (production)

| Variable       | Needed for                     | Dev fallback                               |
| -------------- | ------------------------------ | ------------------------------------------ |
| `DATABASE_URL` | PostgreSQL                     | PGlite socket on `localhost:5434`          |
| `AUTH_SECRET`  | Session/token signing          | generated placeholder in `.env.example`    |
| `S3_*`         | Private object storage         | local filesystem adapter under `.storage/` |
| `SMTP_*`       | Email sending                  | dev transport → `.mail/` + log             |
| `CRON_SECRET`  | Authenticating scheduler calls | required in all envs                       |

Nothing here is faked as "live": every adapter reports which mode it is running in, and the UI
labels unavailable integrations rather than pretending they succeeded.
