# Nexora OS — Production-Ready Office CRM

> **Mission:** Build a secure, polished, production-ready internal office CRM called **Nexora OS** for an office team. Do not stop at mockups or placeholder dashboards. Implement working end-to-end workflows, persistence, validation, authorization, and tests.

## 1. Product goals and scope

Nexora OS centralizes **clients, invoices, spreadsheets/documents, card-to-platform subscription tracking, projects, and financial reports** in one application. Support multiple team members with role-based access. Support **PKR, USD, EUR, GBP**, and other ISO 4217 currencies. This is a single-office application, not a multi-tenant SaaS billing platform.

### Non-negotiable principles
- Production quality: no fake metrics, dead buttons, demo-only forms, or unimplemented screens presented as complete.
- Server-enforced access control and strong financial correctness.
- Excellent UX: fast, accessible, responsive, keyboard-friendly, dark/light mode.
- Maintainable modular architecture with migrations, seed data, automated tests, documentation, and deployment guide.
- Never store complete payment card numbers, CVV, PIN, banking passwords, or API secrets in plaintext.
- Do not initiate actual card charges. Card tracking is an inventory of where cards are saved and expected subscription charges.

## 2. Recommended stack

- **Next.js** App Router, TypeScript strict mode, React, server components where appropriate.
- **Tailwind CSS**, shadcn/ui, Radix primitives, Lucide icons, Motion for restrained transitions.
- **PostgreSQL** with **Prisma ORM** and migration files.
- **Auth.js** or an equivalent actively maintained authentication library, with secure session cookies and MFA support for privileged roles.
- **Zod** schemas for server-side input validation; React Hook Form for complex forms.
- **TanStack Table** for searchable/filterable/paginated tables; **Recharts** for charts.
- **S3-compatible private object storage** for uploads and invoice PDFs; signed, short-lived downloads.
- **Background jobs** using a reliable queue/scheduler with retries and idempotency for reminders, import jobs, and scheduled reports. Use a platform-supported scheduler if deploying on Vercel.
- **Vitest** for unit/integration tests; **Playwright** for E2E tests.
- Structured logging and error monitoring; environment validation at startup.

Select compatible stable versions at implementation time. Explain any substitutions in the README.

## 3. Information architecture / navigation

Sidebar:
1. Overview
2. Clients
3. Invoices
4. Sheets & Files
5. Subscriptions
6. Projects
7. Reports
8. Activity Log
9. Team & Roles (admin)
10. Settings

Global header: command search, workspace currency display, date range, notifications, theme toggle, profile menu. Breadcrumbs and clear empty/loading/error states throughout.

## 4. Roles and permissions

- **Owner:** full access, workspace configuration, financial data, role administration.
- **Admin:** manage clients, projects, invoices, subscriptions, files, reports, and most team operations; cannot transfer ownership.
- **Finance:** manage invoices, payments, subscription expenses, and reports; read clients/projects as needed.
- **Manager:** manage clients, projects, assigned files; restricted financial access by explicit policy.
- **Staff:** only assigned projects/clients/files; no card inventory or office-wide finance by default.

Implement a central permission matrix and object-level authorization for every server action, API endpoint, export, and file download. Default deny. All users belong to the single office workspace; record actor IDs on mutations.

## 5. Modules and acceptance criteria

### A. Overview dashboard
- KPIs: issued invoices, collected revenue, unpaid/overdue balances, recurring subscription commitments, active projects, upcoming renewals.
- Charts for revenue vs expenses, invoice status, expenses by category, project status.
- Date filters, currency selection, team scope based on permissions.
- Clearly distinguish **cash collected** from **invoiced revenue** and **forecast subscription cost** from **actual paid expense**.
- All figures must be computed from real database records and show calculation definitions.

### B. Clients
- CRUD for companies and individuals, contacts, email, phone, country, billing address, notes, tags, status, preferred currency, tax identifiers where relevant.
- Client detail: projects, invoices, payments, attachments, activity timeline.
- Search, filtering, CSV import/export, duplicate detection, soft archive.
- Protect sensitive contact data by permissions.

### C. Invoices & payments
- Draft -> Sent -> Partially Paid -> Paid / Overdue; Void and Cancelled as explicit controlled states.
- Unique configurable invoice numbers; issue/due dates; line items, quantity, unit price, discount, tax, notes, terms, client billing snapshot.
- Decimal-safe calculations, configurable per-line vs invoice-level tax rules, explicit rounding policy, totals recalculated server-side.
- Generate branded PDF and store immutable issued snapshots. Never silently rewrite issued invoice amounts; use a credit note / revised invoice workflow where appropriate.
- Record manual payments with date, amount, currency, method, reference, notes, attachments; support partial payments and overpayments through explicit credit allocation rules.
- PDF download, send-via-email integration (if configured), mark-sent action, reminder scheduling, overdue calculation.
- No payment processor required in v1. Do not claim payment was received merely because an email was sent.
- Avoid duplicate payment creation using idempotency keys and database transactions.

### D. Sheets & files
- Folder organization by client/project/category, tagging, metadata, uploader, version history.
- Upload XLSX, CSV, PDF, and common office formats with configurable size limits, MIME/extension checks, malware scanning where available, and private object storage.
- Spreadsheet import: preview headers, map columns, validate rows, show errors, import only after confirmation; preserve original uploaded file.
- For v1, provide secure file preview/download and CSV/XLSX data preview. **Do not promise full Excel formula editing or perfect Excel compatibility.**
- Optional Google Sheets integration in a later phase via OAuth with minimum scopes, token encryption, revocation, sync conflict handling, and audit events.
- Never expose arbitrary S3 keys or unrestricted public URLs.

### E. Cards, platforms & subscriptions
- **Payment card inventory:** user-defined card nickname, issuer/bank label, card brand, last four digits, optional expiry month/year, owner, status, notes. Do **not** collect PAN/full card number, CVV, PIN, or card screenshots.
- **Platform registry:** platform/service name, website URL, category, account email/username (non-secret), login owner, support/cancellation URL, notes.
- **Card-platform association:** track which cards are saved on which platforms, linked date, last verified date, status (active/removed/unknown), and responsible person.
- **Subscription records:** platform, plan, category, associated card (optional), billing amount, ISO currency, billing cadence (monthly/quarterly/annual/custom), billing anchor/next charge date, start/end date, trial end, renewal mode, notice period, cost center, client/project attribution, tax inclusion, status.
- **Expected charge forecast:** monthly equivalent, annualized commitment, upcoming 7/30/90-day charges, renewal calendar. Annual plan monthly equivalent = annual amount / 12; quarterly = amount / 3. For custom cadence use actual schedule, not fabricated averages.
- **Actual expenses:** separately record real paid charges and link to subscriptions, optionally with receipts; do not count forecast charges as paid expenses.
- Reminder rules: configurable 30/14/7/1 days before renewal; timezone-aware; deduplicated jobs and retry history.
- Filters by card, platform, currency, owner, category, billing frequency, renewal date, and active state.
- Dashboard view: 'Where is this card saved?' and 'What is due next?'.
- Removal workflow: mark platform card link removed with date and audit trail; do not claim remote removal from the external service.

### F. Projects & tasks
- Project linked to client, owner, team, budget, currency, start/due dates, status, priority, notes, files.
- Tasks with assignee, due date, status, priority, comments, attachments, checklist, activity.
- Kanban and list views, filters, deadline indicators, project progress.
- Optional link from invoices and expenses to projects; keep project profitability calculations transparent.

### G. Reports
- Cash received by period, invoiced revenue, accounts receivable aging, subscription forecasts, actual expenses, client revenue, project performance.
- Date filters, currency filters, grouping, export to CSV/PDF.
- Multi-currency policy: preserve original transaction currency and original amount. For consolidated reports, use stored **dated exchange-rate snapshots**, source, and base currency; disclose missing rates and never silently add unlike currencies.
- Support manual exchange-rate entry initially; optionally integrate a reputable rate provider later. Do not hardcode current rates.
- Document accounting assumptions and label reports as management reports, not certified financial statements.

## 6. Data model — Prisma/PostgreSQL design

Create normalized Prisma models with UUID primary keys, timestamps, foreign keys, indexes, constraints, and appropriate `onDelete` rules. Minimum entities:

- `Workspace(id, name, baseCurrency, timezone, invoicePrefix, createdAt, updatedAt)`
- `User(id, name, email, passwordHash? / authProviderId?, status, createdAt, updatedAt)`
- `Membership(id, workspaceId, userId, role, createdAt)`
- `Client(id, workspaceId, type, name, email, phone, addressJson, billingCurrency, taxId, status, notes, createdAt, updatedAt, archivedAt)`
- `ClientContact(id, clientId, name, email, phone, position)`
- `Project(id, workspaceId, clientId, name, description, ownerId, status, priority, budgetAmount Decimal?, currency, startDate, dueDate, createdAt, updatedAt)`
- `ProjectMember(id, projectId, userId, role)`
- `Task(id, projectId, assigneeId?, title, description, status, priority, dueDate, position, createdAt, updatedAt)`
- `TaskComment(id, taskId, authorId, body, createdAt)`
- `Invoice(id, workspaceId, clientId, projectId?, invoiceNumber, status, currency, issueDate, dueDate, subtotal Decimal, discountTotal Decimal, taxTotal Decimal, grandTotal Decimal, amountPaid Decimal, clientSnapshotJson, terms, notes, issuedAt?, voidedAt?, createdAt, updatedAt)`
- `InvoiceLine(id, invoiceId, description, quantity Decimal, unitPrice Decimal, discountAmount Decimal, taxRate Decimal, lineTotal Decimal, position)`
- `Payment(id, workspaceId, clientId, invoiceId?, amount Decimal, currency, paymentDate, method, reference, notes, createdById, createdAt)`
- `PaymentAllocation(id, paymentId, invoiceId, allocatedAmount Decimal)`
- `CreditNote(id, workspaceId, invoiceId, number, currency, amount Decimal, reason, issuedAt)`
- `FileAsset(id, workspaceId, clientId?, projectId?, uploadedById, storageKey, originalName, mimeType, byteSize, checksum, scanStatus, version, createdAt, deletedAt?)`
- `Folder(id, workspaceId, parentId?, clientId?, projectId?, name, createdAt)`
- `FileFolderLink(fileId, folderId)`
- `PaymentCard(id, workspaceId, nickname, issuer, brand, last4, expiryMonth?, expiryYear?, ownerId?, status, createdAt, updatedAt)`
- `Platform(id, workspaceId, name, websiteUrl?, category, accountIdentifier?, cancellationUrl?, ownerId?, notes)`
- `PlatformCardLink(id, workspaceId, platformId, cardId, status, linkedAt?, removedAt?, lastVerifiedAt?, notes)`
- `Subscription(id, workspaceId, platformId, cardId?, projectId?, clientId?, planName, amount Decimal, currency, cadence, intervalCount?, nextChargeAt, startedAt, endsAt?, trialEndsAt?, autoRenew, status, category, noticeDays?, createdAt, updatedAt)`
- `Expense(id, workspaceId, subscriptionId?, projectId?, clientId?, amount Decimal, currency, paidAt, category, description, receiptFileId?, createdById, createdAt)`
- `ExchangeRate(id, baseCurrency, quoteCurrency, rate Decimal, effectiveDate, source, createdAt)`
- `ReminderRule(id, workspaceId, entityType, daysBefore, channel, enabled)`
- `Notification(id, workspaceId, userId, type, title, body, readAt?, createdAt)`
- `JobExecution(id, workspaceId?, jobKey, status, attempts, lastError?, executedAt?)`
- `AuditLog(id, workspaceId, actorId?, action, entityType, entityId, beforeJson?, afterJson?, ipHash?, createdAt)`
- `Setting(id, workspaceId, key, valueJson)`

Implementation notes:
- Use Prisma `Decimal`/Postgres NUMERIC for monetary values; **never use JS floating-point for financial calculations**.
- ISO currency strings and consistent rounding policy; validate amounts and allocation totals.
- Unique constraints: `(workspaceId, invoiceNumber)`, `(workspaceId, platformId, cardId)` as applicable, and idempotency keys for payment/reminder operations.
- Add indexes on workspace/client/status/date foreign keys and all major filter columns.
- Enforce workspace scoping on every query even though v1 uses one workspace.
- Maintain audit logs for financial and card/platform changes; redact secrets and private file content.
- Consider immutable journal/event records for financial changes and transaction boundaries for totals.

## 7. Routes and server boundaries

Suggested App Router pages:

```
/app/(auth)/login
/app/(app)/dashboard
/app/(app)/clients
/app/(app)/clients/[id]
/app/(app)/invoices
/app/(app)/invoices/new
/app/(app)/invoices/[id]
/app/(app)/files
/app/(app)/subscriptions
/app/(app)/subscriptions/cards
/app/(app)/subscriptions/platforms
/app/(app)/subscriptions/calendar
/app/(app)/projects
/app/(app)/projects/[id]
/app/(app)/reports
/app/(app)/activity
/app/(app)/settings
/app/api/uploads/sign
/app/api/uploads/complete
/app/api/files/[id]/download
/app/api/invoices/[id]/pdf
/app/api/cron/reminders
```

Use server actions or route handlers as appropriate. All mutations validate inputs, authorize the actor, enforce domain invariants, use transactions, and emit audit events. External cron endpoints must authenticate requests. Signed upload flow must enforce file ownership, size, content type, and post-upload validation.

## 8. UI/UX and design system

Visual identity: **Nexora OS**, sophisticated productivity/fintech aesthetic, minimal and highly readable. Suggested palette:
- Navy ink `#0B1220`, blue `#315CFD`, cyan `#38BDF8`, light canvas `#F7F9FC`, white `#FFFFFF`.
- Semantic success/warning/danger colors with accessible contrast.
- Font: **Inter** or **Geist** with a strong typographic scale.
- Sidebar with collapsible sections, compact top bar, generous spacing, consistent radii, fine borders, subtle shadows, restrained Motion transitions.
- Light and dark themes; persist preference per user.
- Responsive desktop/tablet/mobile layouts; tables adapt to mobile cards or horizontal scrolling without clipping.
- Include polished forms, validation feedback, skeleton loaders, toast messages, empty states, confirmation dialogs, accessible charts, and keyboard navigation.
- Critical financial actions need explicit confirmations; destructive actions must not be one-click.
- Design reusable components: `PageHeader`, `StatCard`, `DataTable`, `CurrencyAmount`, `StatusBadge`, `DateRangePicker`, `EntitySelect`, `FileUploader`, `ActivityTimeline`, `ConfirmDialog`.
- Avoid decorative complexity that hurts usability; no gratuitous 3D effects.

## 9. Security, privacy, and reliability

- Enforce authorization on the server and prevent IDOR across all entity IDs.
- Passwords hashed with a modern password-hashing algorithm if using credentials; prefer secure OAuth where suitable. Rate-limit login and sensitive actions.
- Secure, HttpOnly, SameSite cookies; CSRF protections as appropriate to the auth mechanism; strict security headers and CSP.
- Zod input validation, safe URL handling, output escaping, safe SQL through ORM, strict file upload policies.
- Private storage, signed download URLs, encrypted sensitive integration tokens, least-privilege cloud credentials.
- Never log secrets, credentials, payment card PAN/CVV, or sensitive attachment contents.
- Payment card tracking stores **only last four digits and non-sensitive metadata**; no full PAN/CVV entry fields.
- Audit all role changes, invoice issuance/voiding, payments, card associations, subscription updates, and exports.
- Automated database backups with documented restore procedure; retention and deletion policy; health checks and error monitoring.
- Production configuration separated from local/dev; `.env.example` contains placeholders only.
- Email reminders must be idempotent and allow per-user opt-out/configuration.
- Prevent CSV formula injection on exports and unsafe spreadsheet parsing; process untrusted uploads defensively.

## 10. Key end-to-end workflows

1. **New client to payment:** Create client -> create project -> draft invoice -> review totals -> issue PDF -> send -> record partial/full payment -> update balance and reports.
2. **Card footprint:** Add card nickname/last4 -> add platform -> link card to platform -> add subscription -> see upcoming charges and all linked platforms -> mark card removed from a platform with audit trail.
3. **Renewal monitoring:** Save next charge date and billing cadence -> schedule reminders -> show upcoming renewals -> mark actual charge paid via expense record -> forecast rolls forward according to subscription rules.
4. **Spreadsheet management:** Upload file -> scan/validate -> preview -> organize into folder -> import CSV/XLSX data with mapping and row errors -> access under permissions.
5. **Project delivery:** Create project -> assign team -> add tasks -> update Kanban -> attach files -> track due dates -> optionally connect invoice and expenses.
6. **Management reporting:** Choose date range and base currency -> compute cash, receivables, actual expenses, forecast commitments -> convert with documented dated rates -> export.

## 11. Implementation phases and completion gates

### Phase 0 — Repository and architecture
- Inspect existing repository; preserve user code if present. Write architecture plan and decisions.
- Initialize stack, lint/typecheck/test scripts, env validation, CI pipeline, design tokens, base layout.
- **Gate:** clean build, lint, typecheck, working authentication shell.

### Phase 1 — Auth, workspace, RBAC, database
- Prisma schema/migrations, login/session flow, roles, protected routes, seed fixtures, audit log foundation.
- **Gate:** unauthorized requests are denied in integration tests.

### Phase 2 — Clients and projects
- CRUD, filters, details, tasks, comments, assignments, activity timeline.
- **Gate:** complete client/project workflows and E2E tests.

### Phase 3 — Invoices and payments
- Draft/issue/send/void, calculations, PDF, payments, partial balances, overdue states.
- **Gate:** monetary edge-case tests pass, immutable issued snapshots work.

### Phase 4 — Cards, platforms, subscriptions
- Card footprint inventory, platform links, subscriptions, expense records, renewal forecasts, notifications.
- **Gate:** forecast calculations, reminders, and card-link filtering tested.

### Phase 5 — Files and spreadsheet workflows
- Private upload/download, folder management, preview, CSV/XLSX import and export, versioning.
- **Gate:** access control and malicious-file tests pass.

### Phase 6 — Reporting and polish
- KPI queries, charts, multi-currency conversion, export, mobile optimization, accessibility, performance.
- **Gate:** report totals reconcile to source records; no fabricated data.

### Phase 7 — Production hardening and deployment
- CI, backups, restore drill, monitoring, security review, production environment, deployment documentation.
- **Gate:** smoke tests, Playwright suite, lint/typecheck/build pass and deployment checklist is complete.

## 12. Required testing

- Unit: invoice arithmetic, rounding, payment allocations, overdue logic, subscription cadence/next-charge calculation, monthly/annual equivalents, exchange-rate conversions.
- Integration: permissions, CRUD, transactions, import validation, signed file access, audit logging, idempotency.
- E2E: login, client creation, invoice issuance and payment, card-platform linking, subscription reminder, spreadsheet upload, project tasks, reports export.
- Security: unauthorized access, role escalation, malicious uploads, CSV injection, duplicate payment requests, replayed cron requests.
- Accessibility: keyboard navigation, labels, focus, contrast, reduced motion.

## 13. Deliverables

- Working full-stack source code, schema, migrations, tests, CI config, and seed script.
- `.env.example`, README, architecture overview, API/server-action conventions, deployment and backup/restore instructions.
- A beautiful, responsive functional UI with realistic **clearly labeled demo seed data only in development**.
- Admin bootstrap process and permission documentation.
- No hardcoded production credentials or fabricated financial data.
- Final implementation report: completed modules, commands run, tests passing/failing, outstanding limitations, and deployment steps.

## 14. Instructions to Claude Code

You are the lead engineer and product designer. Implement this application incrementally, not just describe it.

1. Inspect the repo and environment; identify existing code and constraints.
2. Produce a concise implementation plan and checklist (`IMPLEMENTATION_PLAN.md`).
3. Build Phase 0 through Phase 7 in order, committing or checkpointing after each stable phase where permitted.
4. Prioritize working workflows and data integrity before visual embellishments.
5. Run available lint, typecheck, tests, and production build after each phase; fix failures before continuing.
6. If external credentials/services are unavailable, provide a secure local adapter/mock only for development, document exact setup, and do not pretend integrations are live.
7. Ask only when a decision materially blocks implementation; otherwise choose sensible defaults and document them.
8. Never delete existing user data or overwrite an existing project without explicit approval.
9. Do not silently skip requirements; maintain a status checklist and clearly identify unfinished features.
10. At the end, provide local run commands, production deployment instructions, and a concise security/QA summary.

### Suggested local setup commands (adapt to actual package manager)

```bash
npm install
cp .env.example .env.local
# Configure DATABASE_URL, auth secret, storage credentials, email provider, etc.
npx prisma migrate dev
npx prisma db seed
npm run dev
```

### Claude Code launch command

Save this file as `NEXORA_OS_CLAUDE_CODE_SPEC.md` at the root of your repository, open Claude Code in that directory, then enter:

```text
Read @NEXORA_OS_CLAUDE_CODE_SPEC.md completely. You are the lead full-stack engineer and UI/UX designer. Create IMPLEMENTATION_PLAN.md, then implement Nexora OS phase by phase as a secure, production-ready application. Do not build only a mockup. Use real PostgreSQL persistence, enforce RBAC server-side, implement the specified workflows, add tests, and verify lint, typecheck, and production build after each phase. Preserve any existing project files. Clearly document required external credentials and any unfinished work. Begin by inspecting the repository and showing the plan, then proceed with implementation.
```
