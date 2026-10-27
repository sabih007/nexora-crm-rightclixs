# Nexora OS — security

What this application protects, how, and what it deliberately does not
claim. Written after a review of the implementation, not as an aspiration.

---

## 1. What is worth protecting

| Asset                            | Why it matters                                                    |
| -------------------------------- | ----------------------------------------------------------------- |
| Client contact details and notes | Personal data about named people at client organisations          |
| Invoices and payments            | The financial record; altering it is fraud                        |
| The card footprint               | Shows which platforms hold a company card — a map for an attacker |
| Uploaded documents               | Contracts, spreadsheets, anything the office stores               |
| Credentials and sessions         | Access to all of the above                                        |
| The audit trail                  | The evidence that the rest is trustworthy                         |

Threats considered: a curious or disgruntled colleague with a low-privilege
account; a stolen or guessed password; a malicious file upload; a crafted
spreadsheet; a cross-site request from a page the user is also visiting; an
attacker who has obtained a database dump or a backup file.

---

## 2. Authentication

- **Passwords** — argon2id at the OWASP-recommended parameters (19 MiB,
  t=2, p=1). Never logged, never returned, never recoverable.
- **Sessions** — a 32-byte random token in an `HttpOnly`, `SameSite=Lax`,
  `Secure` cookie using the `__Host-` prefix in production. Only its
  SHA-256 digest is stored, so a database leak yields no usable sessions.
- **Immediate revocation** — every request revalidates against the session
  row, so revoking a session or suspending a user takes effect on the very
  next request. This is the main reason the application does not use
  stateless JWTs.
- **Two-factor** — TOTP (RFC 6238), mandatory for Owner, Admin and Finance.
  Secrets are AES-256-GCM encrypted with a key derived from `AUTH_SECRET`
  via HKDF. Recovery codes are argon2id hashes and single-use.
- **Enumeration** — a wrong password and an unknown account return the same
  message, and a dummy argon2 verification runs for an unknown account so
  the timings are comparable.
- **Brute force** — eight failed attempts per account per fifteen minutes,
  then a fifteen-minute lockout. A per-network backstop of sixty, cleared on
  any successful sign-in so an office behind one NAT address is not locked
  out by ordinary use. Buckets are stored in the database, so the limit
  survives a restart and holds across instances.
- **Password change** — revokes every other session.
- **Role change or removal** — revokes all of that user's sessions, so new
  permissions apply at once.

---

## 3. Authorization

Deny-by-default, enforced server-side, in two layers:

1. **Capability.** One central matrix (`src/lib/permissions.ts`) maps each
   role to a list of permissions. A permission that is absent is denied, and
   an unrecognised permission string is denied. The sidebar, the Team page's
   matrix and the server guard all read that same constant.
2. **Object scope.** Roles without `project:read_all` see only projects they
   own or belong to, and only clients and files reachable through those.
   The restriction is a `where` fragment applied in the query, not a filter
   applied afterwards.

Hiding a control in the UI is a convenience. The server check is the
boundary, and the integration suite asserts it directly by invoking the real
server actions as each role.

**IDOR.** Every mutation addressed by id asserts object access first. An
out-of-scope record raises _not found_ rather than _forbidden_, so the
response cannot be used to probe whether an id exists.

---

## 4. Input and output

- **Validation** — every server action parses its input with Zod before the
  handler runs. There is no path into a mutation that skips it.
- **SQL injection** — all queries go through Prisma with parameterised
  values. The one `$executeRawUnsafe` in the codebase is in the test
  helper's table truncation and interpolates names read from `pg_tables`.
- **Search wildcards** — user terms are escaped for `%` and `_` before
  reaching a `contains` filter.
- **XSS** — React escapes by default; there is no `dangerouslySetInnerHTML`,
  `eval` or `innerHTML` anywhere in `src/`. Stored URLs are validated to be
  `http(s)` at the schema level, so a `javascript:` URL cannot be saved and
  later rendered as a link. External links carry
  `rel="noopener noreferrer nofollow"`.
- **CSV injection** — every exported cell beginning `=`, `+`, `-`, `@`, tab
  or CR is prefixed with a single quote, so a client named
  `=cmd|'/c calc'!A0` exports as inert text. Covered by unit tests,
  including `WEBSERVICE` exfiltration payloads.
- **Content Security Policy** — `default-src 'self'`, `object-src 'none'`,
  `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, plus
  HSTS, `nosniff`, `X-Frame-Options: DENY` and a restrictive
  `Permissions-Policy`.

### Known CSP limitation

`script-src` includes `'unsafe-inline'`. The Next.js App Router emits inline
bootstrap scripts, and a nonce-based policy requires rendering every route
dynamically with a per-request nonce. This is stated rather than hidden. It
is partially compensated by `object-src 'none'`, strict `base-uri` and
`form-action`, the absence of any HTML-injection sink in the codebase, and
the fact that no third-party script origins are allowed at all.

---

## 5. Cross-site request forgery

Server Actions are covered by Next.js' own Origin/Host verification.

Route handlers that change state call `assertStateChangeAllowed`
(`src/lib/auth/csrf.ts`), which requires:

1. an `Origin` matching the deployment (or absent, which a cross-site
   browser request cannot arrange for a POST), and
2. a double-submit token — the session issues a script-readable CSRF cookie
   and the client echoes it in `x-csrf-token`. A cross-site attacker can
   cause the cookie to be _sent_ but cannot read it, so cannot set the
   header.

An E2E test asserts that a POST with a foreign `Origin` is refused with 403.

---

## 6. File handling

**Uploads** are validated on three independent axes before anything is
stored, because each alone is spoofable:

1. extension, against an allow-list — executables, scripts, `.svg` and
   `.html` are refused, and a double extension such as `invoice.exe.pdf` is
   caught;
2. the browser's declared MIME type, which must agree with the extension;
3. the actual leading bytes, which must match the claimed format.

Also enforced: a size limit, a rejection of path separators, traversal
sequences and control characters in the name, and a binary-content check for
formats that have no signature.

**Downloads** go through an authenticated route that checks the capability
and then object-level scope, and serves with
`Content-Type: application/octet-stream`, `Content-Disposition: attachment`,
`nosniff` and `default-src 'none'; sandbox`. Serving user content inline
from our own origin is how a stored file becomes stored XSS; this does not.

Storage keys are opaque UUID paths and never reach the browser. S3 objects
are written private and server-side encrypted.

**Spreadsheets** are parsed with row and column caps applied before
allocation, so a sheet declaring a million rows cannot exhaust memory.
Formulas are read as their cached value and never evaluated. The original
file is preserved unmodified.

### Known limitation

No antivirus engine is connected. Files are labelled "type verified", never
"clean", and the Settings page states that scanning is not configured. To
add one, scan in `uploadFiles` before `putObject` and set `scanStatus`; the
download route already refuses anything marked `INFECTED`.

---

## 7. Financial integrity

- Monetary values are `NUMERIC(18,4)` and `Decimal` end to end. No
  JavaScript float touches money.
- Totals are always recomputed server-side from the line items; a
  client-submitted total is never trusted.
- Issuing an invoice freezes its amounts and captures an immutable snapshot
  of the totals and the client's billing details. Edits and deletes are then
  refused — the correction path is a credit note, or a void and a
  replacement.
- Issuing re-derives the totals from the stored lines and refuses if they
  disagree with the cached values, which would indicate a direct write.
- Payments carry an idempotency key under a unique index, inside the same
  transaction as their allocations. A double-click, a retry or two
  concurrent submissions produce one payment — asserted by a concurrency
  test.
- A payment is only ever allocated to invoices in its own currency.
- Voiding is refused when payments exist, so history cannot be erased.
- Database CHECK constraints enforce positive amounts, valid currency codes
  and a due date not before the issue date, independently of application
  code.

---

## 8. Payment card data

The card module is an **inventory**, not a wallet.

- The schema has no column capable of holding a PAN, CVV, PIN or banking
  password. `last4` is `CHAR(4)` with a `~ '^[0-9]{4}$'` CHECK constraint,
  so storing a full number is structurally impossible — proven by an
  integration test that attempts it.
- The form offers no such field, caps the input at four digits, and says on
  screen that only the last four are stored.
- The application cannot charge a card and never contacts a payment
  processor.
- Marking a card "removed from a platform" updates this record and the audit
  entry says exactly that: it does not and cannot change anything on the
  external service.

---

## 9. Secrets and logging

- `AUTH_SECRET` and `CRON_SECRET` are validated at startup; a deployment
  still carrying the `.env.example` placeholders refuses to boot in
  production.
- `.env.example` contains placeholders only. `.env*` is git-ignored.
- The logger redacts by key name — passwords, secrets, tokens, authorization
  headers, cookies, card fields, API keys — before anything is written.
- The audit log redacts the same fields and never records file contents.
- IP addresses are stored only as a salted hash.
- Backups exclude password hashes, TOTP secrets and recovery codes unless
  `--include-credentials` is passed explicitly.

---

## 10. Scheduled endpoints

`/api/cron/reminders` requires a shared secret compared in **constant time**
and accepts it as either `Authorization: Bearer` or `x-cron-secret`. Every
run is recorded in `job_executions`, and a run that already succeeded within
twelve hours short-circuits, so a replayed delivery is a no-op. Reminders
themselves are deduplicated by a unique key per charge cycle.

---

## 11. Dependencies

`npm audit --omit=dev` reports no vulnerabilities. CI fails on a high or
critical advisory in production dependencies.

Two supply-chain decisions worth recording:

- **`xlsx` was not used.** The npm package is the unmaintained mirror with
  known prototype-pollution and ReDoS advisories. `exceljs` is used instead.
- **`uuid` is pinned via an override.** `exceljs` depends on `uuid@^8`,
  which carries a moderate advisory for a missing bounds check in the
  v3/v5/v6 `buf` path. `exceljs` only calls `v4` with no buffer, so it is
  not reachable — but the override to `^11.1.1` keeps the audit clean rather
  than relying on that analysis surviving the next upgrade.

---

## 12. What is not covered

Stated plainly so nobody assumes otherwise:

- No malware scanning of uploads (§6).
- `'unsafe-inline'` in `script-src` (§4).
- No rate limiting on general reads — only on authentication, uploads and
  exports. A compromised account can enumerate data it is already entitled
  to see.
- No field-level encryption at rest beyond TOTP secrets. Protect the
  database with the platform's encryption and access controls.
- No SSO or SCIM. Accounts are created by an administrator.
- No automated PII retention or deletion policy. Archiving a client hides
  it; it does not erase it.
- The audit log is append-only by convention, not by database permission. A
  party with direct database access can alter it.
- Session cookies use `SameSite=Lax`, which is right for a login-redirect
  flow but is not `Strict`.

---

## 13. Reporting a problem

Internal application: raise it with the workspace Owner. Include what you
did, what happened, and the time, so it can be matched against the audit
log and the server logs. Do not post a working exploit in a shared channel.
