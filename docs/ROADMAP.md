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

- ✅ Two-step verification with authenticator apps and recovery codes (0.2); staff are reminded
  in the admin panel. Next: passkeys, and making it mandatory for staff and company owners.
- ✅ Active sessions list with remote sign-out, refresh-token theft detection (0.2).
- Email verification, password reset.
- Identity verification (KYC) for company owners before approval; "verified business" badge.
- Admin panel behind SSO / IP allow-list; four-eyes approval for large cash operations.

### Money

- ✅ Deposit and payout requests that finance managers fulfil or decline, with statuses; a payout
  holds its amount until handled (0.2).
- ✅ Invoices between people and companies, paid from a balance in one step, printable (0.2).
  Next: partial payments, recurring invoices and payroll.
- Currency exchange between balances with managed rates and fees.
- Multi-signature company payments (e.g. director + accountant above a limit).
- ✅ Statement export as CSV on web and in the apps (0.2). Next: PDF and monthly statements.

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
- OS push notifications (Web Push, FCM, APNs) and a notification center (in-app banners exist).
- Channel posts with comments.

### Platform

- Horizontal scaling of realtime (Redis or Postgres `LISTEN/NOTIFY` behind `RealtimeHub`) and shared
  rate-limit storage.
- Localisation (English, Russian, …).
- Observability: metrics, tracing, structured audit export; automated backups.
- Governance settings: majority vs. quorum voting, council terms, published transparency reports.
