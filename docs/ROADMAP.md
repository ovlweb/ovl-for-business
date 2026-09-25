# Roadmap

## 0.1 — foundation (this release)

- Server with the full domain: accounts and roles, contacts, wallets in 155 currencies with a ledger,
  cash desk, transfers, companies with team roles, application workflows (company, license,
  moderator, council, news channel), public registry, stock exchange with frozen investment share,
  chats with realtime, tech support desk with staff badges, service stories, audit log, developer
  API keys, OpenAPI docs.
- Web client + installable web app with eight themes, an animated sign-in, a first-run tour,
  multi-account and a command palette.
- Native apps built with Flutter for Android, iOS, macOS, Windows and Linux (not web views).
- Separate admin panel with a live dashboard.
- Docker Compose deployment with Caddy (automatic HTTPS), CI.

## Suggested next steps

Grouped by the value they add for businesses. Order within a group is a suggestion.

### Trust & security

- ✅ Two-step verification with authenticator apps and recovery codes (0.2), mandatory for staff
  and for people who move company money.
- ✅ Active sessions list with remote sign-out, refresh-token theft detection (0.2).
- ✅ Passkeys (WebAuthn) for the web client and the admin panel (0.2). Next: passkeys in the native
  apps (platform credential managers with associated domains).
- ✅ Email confirmation, email change and password reset by emailed links (SMTP) (0.2).
- ✅ Identity verification (KYC) for company owners before approval; "verified business" badge on
  companies, the registry and the exchange (0.2).
- ✅ Admin panel with single sign-on (OpenID Connect) and an IP allow-list; four-eyes approval for
  large cash operations (0.2).

### Money

- ✅ Deposit and payout requests that finance managers fulfil or decline, with statuses; a payout
  holds its amount until handled (0.2).
- ✅ Invoices between people and companies, paid from a balance in one step, printable (0.2).
- ✅ Partial invoice payments, recurring invoices (weekly to yearly, issued by a background
  scheduler) and payroll runs that pay a whole team from a company balance (0.2).
- ✅ Currency exchange between balances with managed rates and a fee, on web, in the apps and in
  the admin panel (0.2).
- ✅ Multi-signature company payments: above a company's approval limit, transfers, exchanges and
  invoice payments wait for a second owner, director or accountant, with the money set aside (0.2).
- ✅ Statement export as CSV and PDF on web and in the apps, monthly statements with an optional
  email at the start of each month (0.2).

### Stock exchange

- ✅ Secondary market: a limit-order book so investors trade shares with each other after the lock
  period; the listing price follows the last trade (0.2).
- ✅ Dividends, shareholder registry, shareholder voting weighted by shares at the start (0.2).
- ✅ Company reports (quarterly results with revenue, profit and documents) on the listing page
  (0.2).
- ✅ Per-investor limits (the most of one company a person may hold, and how much they invest per
  30 days, lower without a verified identity) and a risk disclosure accepted before investing (0.2).

### Licenses & registry

- ✅ Certificates for every registry entry (PDF with a QR code that opens a public verification
  page; revoked entries print as not valid) (0.2).
- ✅ Expiry dates and renewals: licences run for a term (`LICENSE_TERM_MONTHS`), holders get
  reminders 30 and 7 days before, and renew through a one-step moderation (0.2).
- ✅ "Request changes" step in every workflow, and documents attached to applications, stored on
  disk or in S3 / MinIO (0.2).
- ✅ Virtual-country currencies: the holder of a virtual country issues one currency (a three-letter
  code outside ISO 4217) and controls its supply; balances anywhere can hold, send and invoice in it
  (0.2).
- ✅ Webhooks for API consumers: new and changed registry entries and stock listings, signed with
  HMAC-SHA256, retried with backoff, with a delivery log and a test button (0.2).

### Messaging

- ✅ Attachments (images, documents), message search, mentions, reactions, read receipts (0.2;
  the apps show attachments, sending files is on the web).
- ✅ OS push notifications (Web Push, FCM, APNs) and a notification center (0.2; the browser
  subscribes itself, the apps register FCM / APNs tokens with `POST /me/push-subscriptions` once a
  Firebase / Apple project is configured for them).
- ✅ Channel posts with comments (0.2).

### Platform

- ✅ Horizontal scaling of realtime (Postgres `LISTEN/NOTIFY` behind `RealtimeHub`, shared
  presence) and shared rate-limit storage (0.2).
- Localisation (English, Russian, …).
- ✅ Observability: Prometheus metrics, W3C trace context in logs, structured audit export
  (CSV / NDJSON); automated backups with retention and a restore script (0.2).
- Governance settings: majority vs. quorum voting, council terms, published transparency reports.
