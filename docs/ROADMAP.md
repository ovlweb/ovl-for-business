# Roadmap

## 0.1 — foundation (this release)

- Server with the full domain: accounts and roles, contacts, wallets in 155 currencies with a ledger,
  cash desk, transfers, companies with team roles, application workflows (company, license,
  moderator, council, news channel), public registry, stock exchange with frozen investment share,
  chats with realtime, tech support desk with staff badges, service stories, audit log, developer
  API keys, OpenAPI docs.
- Web client + installable web app, Android / iOS (Capacitor) and desktop (Tauri) shells.
- Separate admin panel.
- Docker Compose deployment with Caddy (automatic HTTPS), CI.

## Suggested next steps

Grouped by the value they add for businesses. Order within a group is a suggestion.

### Trust & security

- Two-factor authentication (TOTP, passkeys) — mandatory for staff and company owners.
- Email verification, password reset, active sessions list with remote sign-out.
- Identity verification (KYC) for company owners before approval; "verified business" badge.
- Admin panel behind SSO / IP allow-list; four-eyes approval for large cash operations.

### Money

- Withdrawal and deposit _requests_ from users that managers fulfil, with statuses.
- Invoices and payment requests between companies; recurring payments / payroll.
- Currency exchange between balances with managed rates and fees.
- Multi-signature company payments (e.g. director + accountant above a limit).
- Statement exports (CSV / PDF) and monthly statements.

### Stock exchange

- Secondary market: order book so investors can sell shares to each other after the lock period;
  price discovery from trades.
- Dividends, shareholder registry, shareholder voting.
- Company reports (quarterly results) published on the listing page.
- Per-investor limits and risk disclosures.

### Licenses & registry

- Expiry dates and renewals; license certificates (PDF with a QR code that verifies against the
  public registry).
- "Request changes" step in workflows and file attachments (S3 / MinIO storage).
- Virtual-country currencies issued under a virtual-country license.
- Webhooks for API consumers (new / changed registry entries, listing changes).

### Messaging

- Attachments (images, documents), message search, mentions, reactions, read receipts.
- Push notifications (Web Push, FCM, APNs) and a notification center.
- Channel posts with comments.

### Platform

- Horizontal scaling of realtime (Redis or Postgres `LISTEN/NOTIFY` behind `RealtimeHub`) and shared
  rate-limit storage.
- Localisation (English, Russian, …).
- Observability: metrics, tracing, structured audit export; automated backups.
- Governance settings: majority vs. quorum voting, council terms, published transparency reports.
