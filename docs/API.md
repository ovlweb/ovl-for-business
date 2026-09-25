# API guide

- Base path: `/api/v1`
- Interactive reference: `/api/docs` (OpenAPI JSON at `/api/docs/json`)
- Platform metadata (currencies, roles, license types, workflows): `GET /api/v1/meta`

## Authentication

```bash
curl -X POST https://business.example.com/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"login":"alice","password":"…"}'
# → { "accessToken": "…", "refreshToken": "…", "expiresIn": 900, "user": { … } }

curl https://business.example.com/api/v1/me -H "authorization: Bearer $ACCESS_TOKEN"
```

Access tokens live 15 minutes. Exchange the refresh token with `POST /auth/refresh` — refresh
tokens rotate, so always store the new one. `POST /auth/logout` signs the device out.

Every sign-in starts a **session** (one per device). `GET /me/sessions` lists them with a device
name parsed from the `User-Agent` ("Chrome on Windows", "OVL Business app on Android"),
`DELETE /me/sessions/:id` signs one out and `POST /me/sessions/sign-out-others`, `GET /me/2fa`, `POST /me/2fa/{setup,enable,disable,recovery-codes}`, `POST /me/email`, `POST /me/email/verification`, `POST /auth/verify-email`, `POST /auth/password/{forgot,reset}` signs out every
device but the current one. A signed-out session stops working immediately: its access tokens are
refused and its realtime connection closes. Re-using a refresh token more than a minute after it
was rotated is treated as theft and signs that whole session out. Changing the password signs out
every other device.

**Two-step verification.** `POST /me/2fa/setup` returns a secret, an `otpauth://` link and a QR
code; `POST /me/2fa/enable {code}` turns it on and returns ten one-time recovery codes. After that,
`POST /auth/login` answers `401 two_factor_required` until the request also carries `code` (an
authenticator code — each one works once — or a recovery code). `POST /me/2fa/recovery-codes`
replaces the recovery codes and `POST /me/2fa/disable {password, code}` turns it off. Secrets are
stored encrypted (AES-256-GCM, key derived from `JWT_SECRET` — rotating that secret requires
people to set two-step verification up again).

Errors always look like `{ "error": "code", "message": "Human readable", "details"?: … }`
(`validation_error`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `insufficient_funds`…).

## Public API for other services

Registry and stock data are public. Anonymous callers get `PUBLIC_RATE_LIMIT` requests per minute
per IP; with a developer key (created in the client under _Profile → Developer API keys_) you get
`API_KEY_RATE_LIMIT`.

```bash
# Search licenses, organizations and virtual countries
curl 'https://business.example.com/api/v1/registry?q=aurora&kind=organization' -H "X-API-Key: $KEY"

# Look up a registry number
curl https://business.example.com/api/v1/registry/OVL-LIC-000001 -H "X-API-Key: $KEY"

# Stock exchange
curl https://business.example.com/api/v1/stock/listings -H "X-API-Key: $KEY"
curl https://business.example.com/api/v1/stock/listings/AURA -H "X-API-Key: $KEY"
```

Registry query parameters: `q`, `kind` (`organization` | `license` | `virtual_country`),
`licenseType`, `status` (default `active`), `limit` (≤ 100), `offset`.

## Secondary market

Holdings (`GET /stock/portfolio`) say how many shares are `sellable`: shares bought on the market
at once, shares from an investment after its lock period, minus what is already offered.
`POST /stock/listings/:ticker/orders {side: 'buy' | 'sell', shares, price}` places a limit order. It
trades at once with the best opposite orders (best price first, then the oldest), at the resting
order's price, and whatever is left waits in the book; a buy order sets its money aside
(`stock_order` lock) until it is filled or cancelled with `DELETE /stock/orders/:id`. Nobody trades
with their own orders. Each trade moves the money (`trade_out` / `trade_in` ledger entries) and the
shares, and becomes the listing's price. `GET /stock/listings/:ticker/book` (public) shows price
levels and the latest trades; `GET /stock/orders?status=open` lists yours. Everyone connected
receives `stock.updated` with the ticker.

## Investor protection

Before the first investment or buy order, investors read and accept the risk disclosure:
`GET /stock/risk` returns its `version`, `title` and `points` (and `acceptedAt` for you), and
`POST /stock/risk/accept {version}` accepts it. Until then those calls fail with 403
`risk_disclosure_required` (switch off with `STOCK_REQUIRE_RISK_ACK=false`). The disclosure has a
version; a new one has to be accepted again.

Investments and buy orders also stay within the platform's per-investor limits
(`GET /stock/limit-settings`, public; `PUT /admin/stock/limits` with `stock.manage`):

- `maxHoldingPercent` (25 by default): nobody holds more of one company, counting open buy orders;
- `monthlyLimit` and `unverifiedMonthlyLimit`: the most someone invests and buys in 30 days
  (investments, trades and open buy orders, in the exchange base currency). People without a
  verified identity get the lower one; `""` turns a limit off.

`GET /stock/limits` shows the limits that apply to you, what you used and what is left. A purchase
over a limit is refused with 409. Selling is never limited.

## Shareholders

Company members see who holds the shares at `GET /organizations/:id/shareholders`. The owner or a
director can:

- pay a **dividend** with `POST /organizations/:id/dividends {walletId, perShare, note?}`: everyone
  holding shares at that moment gets `perShare × shares` on their personal balance (`dividend_in`);
  at or above the approval limit it waits for a second signature (202, `status: 'pending'`). The
  history is public at `GET /stock/listings/:ticker/dividends`;
- open a **shareholder vote** with `POST /organizations/:id/proposals {title, description, closesAt,
options?}` (For / Against / Abstain by default). Holders vote once with
  `POST /stock/proposals/:id/vote {option}`, weighted by the shares they held when it opened, so
  buying more later adds nothing. `GET /stock/listings/:ticker/proposals` shows the tallies, turnout
  and the winner once closed (`POST …/proposals/:pid/close` ends it early);
- publish **results** with `POST /organizations/:id/reports {period, title, body, revenue?, profit?,
attachments?}` (documents uploaded with `POST /files`), public at `GET /stock/listings/:ticker/reports`.

## Webhooks

Register an endpoint with `POST /webhooks {url, events, description?}` (Settings → Developer on
the web). Events: `registry.created`, `registry.updated` (status, renewal, expiry, a new currency),
`listing.created`, `listing.updated` (price, status). The response carries the signing secret, only
once (`POST /webhooks/:id/rotate-secret` makes a new one). Each delivery is a JSON `POST`:

```json
{ "id": "<event id>", "type": "registry.updated", "createdAt": "…", "data": { …registry entry… } }
```

with `X-OVL-Event`, `X-OVL-Delivery` and `X-OVL-Signature: t=<unix seconds>,v1=<hex>`, where the hex
is HMAC-SHA256 of `"<t>.<raw body>"` with the secret. Verify it (and that `t` is recent) before
trusting the body; the SDK's `verifyWebhookSignature(secret, header, rawBody)` does both. Answer with
any 2xx within 10 seconds. Failed deliveries are retried after 1 min, 5 min, 30 min, 2 h and 12 h;
after 20 failures in a row the endpoint is switched off (`PATCH /webhooks/:id {active: true}` turns it
back on). `GET /webhooks/:id/deliveries` shows the log, `POST …/deliveries/:id/redeliver` sends one
again and `POST /webhooks/:id/test` sends a `ping`. Events are recorded in the same transaction as the
change, so none are lost; in production, URLs must be https and may not point at private networks.

## TypeScript SDK

```ts
import { OvlClient } from '@ovl/sdk';

const ovl = new OvlClient({ baseUrl: 'https://business.example.com' });
await ovl.auth.login({ login: 'alice', password: '…' });

const wallets = await ovl.wallets.list();
const listings = await ovl.stock.listings();
await ovl.stock.invest('AURA', '250.00');

const live = ovl.realtime();
live.on((event) => {
  if (event.type === 'message.created') console.log(event.message.body);
});
```

Server-to-server: `new OvlClient({ baseUrl, apiKey: 'ovl_…' })` and use `registry.*` / `stock.*`.

## Messages

- **Attachments**: upload with `POST /files`, then send
  `POST /chats/:id/messages {body, fileIds}` (up to 10; the text may be empty). Messages carry
  `attachments` with signed links that work in `<img>`; only people who can read the chat can open
  them.
- **Mentions**: `@username` of a chat member is stored in `mentions` (ids). `unreadMentions` in the
  chat list counts unread messages that mention you.
- **Reactions**: `POST /chats/:id/messages/:messageId/reactions {emoji}` and
  `DELETE …/reactions?emoji=👍` (any single emoji, up to 20 different ones per message). Messages
  carry `reactions: [{emoji, count, mine}]`.
- **Read receipts**: direct chats have `peerReadMessageId`; `GET /chats/:id/receipts` shows how far
  everyone in a group read, and `chat.read` events arrive live. Turning off the `readReceipts`
  preference hides yours and theirs.
- **Search**: `GET /chats/search?q=inv rep&chatId=` finds messages in your chats with every word as a
  prefix, newest first.
- **Channel comments**: subscribers comment with `POST /chats/:id/messages/:postId/comments` and read
  them with `GET …/comments`. Comments have `threadId` (the post), stay out of the feed and the
  unread count, and posts carry `commentCount`. Channel admins switch them off with
  `PATCH /chats/:id {commentsEnabled: false}`.

## Notifications and push

Mentions, replies, comments on your posts, money received (transfers, salary, dividends, sold
shares), invoices, payment approvals, application outcomes, identity checks, cash requests and
licence expiry land in your notification center: `GET /notifications?unread=true&before=<createdAt>`
returns `{items, unreadCount}`, `POST /notifications/read {ids?}` marks some (or all) as read and
`DELETE /notifications/:id` removes one. Connected apps receive `notification.created` live.

People who are away (no open realtime connection) also get a push on their devices, and so do
direct and group messages unless the `pushChats` preference is off:

- **Browsers**: `GET /push/config` gives `webPushKey` (VAPID; the server makes a pair on first use
  unless `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` are set). Subscribe with
  `PushManager.subscribe({applicationServerKey})` and send it with
  `POST /me/push-subscriptions {kind: 'webpush', endpoint, keys: {p256dh, auth}}`. The web client's
  service worker shows the pushes; the payload is `{title, body, link, tag}`.
- **Android / iOS**: `POST /me/push-subscriptions {kind: 'fcm' | 'apns', token}` with
  `FCM_SERVICE_ACCOUNT` or `APNS_KEY` / `APNS_KEY_ID` / `APNS_TEAM_ID` / `APNS_TOPIC` configured.

`GET /me/push-subscriptions` lists your devices, `DELETE /me/push-subscriptions/:id` removes one and
`POST /me/push-subscriptions/test` sends a test to all of them. Devices the push service reports as
gone are forgotten, as are ones that fail 10 times in a row.

## Governance and transparency

`GET /governance` (public) shows how council stages are decided (`councilVoting`: `quorum` with
`councilQuorum` votes capped by the council size, `majority`, or `two_thirds` of active members),
the `votesNeeded` right now, the term length and every council member with the end of their term.
The owner changes the rules with `PUT /admin/governance {councilVoting?, councilQuorum?,
councilTermMonths?}`; new council seats get a term of that many months, and an hourly job returns
members whose term ended to regular accounts (they are told, and it is audited).
`POST /admin/users/:id/council-term {months}` starts a new term.

Transparency reports freeze the numbers of a period: `GET /admin/transparency/preview?from=&to=`
(`transparency.publish`) shows them, `POST /admin/transparency {title, periodStart, periodEnd, notes}`
publishes, `DELETE /admin/transparency/:id` retracts. `GET /transparency` and
`GET /transparency/:id` are public: applications received and decided (by type, with the median time
to decide), council votes, suspensions, identity checks, revoked licences, support tickets, registry
and economy activity. The web client shows them at `/#/transparency`, signed in or not.

## Operations

- `GET /metrics` (outside `/api/v1`): Prometheus text format; `Authorization: Bearer $METRICS_TOKEN`
  when a token is configured, otherwise private networks only.
- `GET /admin/system` (`audit.view`): this instance (id, version, uptime), the number of instances,
  people connected, waiting notifications and webhook deliveries, background jobs and the last
  backup.
- `GET /admin/audit-logs/export?format=csv|ndjson&action=&from=&to=` (`audit.view`): the audit log,
  oldest first, streamed. CSV cells that a spreadsheet would run as formulas are prefixed with `'`.
- Every response carries `traceparent` (the request's trace id, continued from an incoming
  `traceparent`) and `Server-Timing: app;dur=<ms>`.

## Realtime events

Connect to `wss://…/api/v1/realtime?token=<accessToken>`. The server sends JSON events:

| Event                      | Payload                                  |
| -------------------------- | ---------------------------------------- |
| `ready`                    | `userId`                                 |
| `message.created`          | `chatId`, `message`                      |
| `message.updated`          | `chatId`, `message` (edits, deletions)   |
| `chat.updated`             | `chatId`                                 |
| `chat.removed`             | `chatId`                                 |
| `typing`                   | `chatId`, `userId`                       |
| `chat.read`                | `chatId`, `userId`, `messageId`          |
| `notification.created`     | `notification`                           |
| `application.updated`      | `applicationId`, `status`, `stageIndex`  |
| `story.created`            | `storyId`                                |
| `wallet.updated`           | `walletId`                               |
| `cash_request.updated`     | `requestId`, `walletId`, `status`        |
| `invoice.updated`          | `invoiceId`, `status`                    |
| `payment_approval.updated` | `organizationId`, `approvalId`, `status` |
| `payroll.updated`          | `organizationId`, `runId`, `status`      |

Clients may send `{"type":"typing","chatId":"…"}` and `{"type":"ping"}`. A close code `4401`
means the access token expired or the session was signed out: refresh and reconnect (the refresh
fails for a signed-out session).

## Accounts: email and password

Sign-up emails a confirmation link (`POST /auth/verify-email {token}`); `POST /me/email/verification`
sends a new one and `POST /me/email {email, password}` changes the address (the old one is told, the
new one must be confirmed). `POST /auth/password/forgot {email}` always answers 202 and emails a
one-hour link when the address is known; `POST /auth/password/reset {token, password}` sets the new
password and signs out every session. Only the newest link of each kind works.

**Passkeys** (WebAuthn): `POST /me/passkeys/options` → `navigator.credentials.create()` →
`POST /me/passkeys {challengeId, name, response}`; `GET /me/passkeys`, `DELETE /me/passkeys/:id`.
Sign in with `POST /auth/passkey/options` → `navigator.credentials.get()` →
`POST /auth/passkey {challengeId, response}` (user verification is required, so no authenticator
code is asked). They work on the web client and the admin panel origins (`PUBLIC_WEB_URL`,
`PUBLIC_ADMIN_URL`, or `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGINS`). The native apps sign in with a
password and an authenticator code.

`GET /meta` publishes the server's `security` rules. With them on (the default):

- staff without two-step verification act as regular users and get
  `403 two_factor_setup_required` from staff tools;
- company owners, directors and accountants need it to move company money (same error);
- applications need a confirmed email (`403 email_not_verified`).

## Admin security

- **IP allow-list**: with `ADMIN_IP_ALLOWLIST` (IPv4/IPv6 addresses and networks) every
  `/api/v1/admin/*` call from elsewhere gets `403 ip_not_allowed`. Put the admin panel's own site
  behind the same list in Caddy if you want the page hidden too.
- **Four eyes**: a cash desk operation (or completing a cash request) of at least
  `CASH_FOUR_EYES_AMOUNT` in its currency answers `202` with a pending approval instead. A
  different finance manager — not the one who asked and not the owner of the balance — confirms it
  with `POST /admin/cash-approvals/:id/approve` (the money moves then) or rejects it. Payouts hold
  their amount while they wait. `GET /admin/cash-approvals?status=pending` lists them.
- **Single sign-on**: set `OIDC_ISSUER`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET` (and register
  `PUBLIC_ADMIN_URL/` as the redirect URI). The admin panel then shows `OIDC_LABEL`; the provider
  confirms the email address and the matching staff account signs in (authorization code with
  PKCE, ID token checked against the provider's keys). Accounts are never created by single sign-on.
  Passkey and single sign-on sessions satisfy the two-step rules.

## Identity checks and verified businesses

`POST /me/identity` sends legal name, date of birth, country, document type and number, and the id
of an uploaded document photo (optionally a selfie). Only the number's last four characters and a
keyed hash are kept; the hash flags a document already used by another verified account.
Staff with `identity.review` work through `GET /admin/identity-checks?status=pending` and
`POST /admin/identity-checks/:id/{approve,reject,revoke}` (reasons for the last two; nobody decides
their own). With `REQUIRE_IDENTITY_FOR_COMPANIES` (default on) a company application cannot be
approved until the applicant is verified (`409 identity_not_verified`). Companies whose owner is
verified carry `verified: true` in organizations, registry holders and stock listings.

## Files and applications

Upload with `POST /files?name=plan.pdf`, sending the file's bytes as the body with its own
`Content-Type` (images, PDF, text, office documents, zip; no SVG or HTML; up to `MAX_UPLOAD_MB`).
Every file listing carries a signed `url` that works for about an hour without a token (for
`<img>` and links); `GET /files/:id` also works with a normal token when the caller may read the
file. Files are private to the uploader until attached.

Attach up to 10 files when submitting an application (`attachments: [fileId…]`); the applicant and
staff who review applications can read them. A reviewer can answer `request_changes` (with a
comment): the application becomes `changes_requested` and the applicant sends the corrected payload
(and more files) with `POST /applications/:id/resubmit`. The stage then starts again in a new
`round`; each review records its round.

## Deposits, payouts and statements

People and company finance roles ask for money to come in or go out; a finance manager handles it
in the admin panel's cash desk:

1. `POST /wallets/:id/cash-requests` with `{type: 'deposit' | 'withdrawal', method: 'manager_transfer' | 'physical_cash', amount, note?}`.
   A withdrawal holds the amount at once (it shows as frozen, with the lock reason
   `withdrawal_request`), so it cannot be spent twice.
2. The manager calls `POST /admin/cash-requests/:id/complete` with a `reference` (records the cash
   operation and moves the money) or `/decline` with a `reason`. The requester can
   `POST /cash-requests/:id/cancel` while it is pending. Managers cannot handle their own requests.
3. Everyone who can see the wallet receives `cash_request.updated` and `wallet.updated`.

`GET /wallets/:id/statement.csv?from=YYYY-MM-DD&to=YYYY-MM-DD` returns the ledger as CSV (UTF-8 with
BOM, CRLF, for spreadsheets), and `GET /wallets/:id/statement.pdf` (same range) a printable PDF with
the opening and closing balance, money in and out, and every operation (dates in UTC). The SDK's
`wallets.statementCsv()` and `wallets.statementPdf()` return a `Blob`. Apps that hand the file to
the system browser call `POST /wallets/:id/statement-link {from?, to?, format: 'csv' | 'pdf'}`
instead: it returns a path that works for five minutes without an `Authorization` header, for that
wallet and range only, and stops working when the session is signed out.

`GET /wallets/:id/statements` lists calendar months with activity (opening and closing balance,
money in and out, number of operations) for one-click monthly PDFs. People who turn on
`preferences.statementEmails` (and have a confirmed email) get an email early each month with a
7-day PDF link for every balance they can see that moved the month before.

## Licence expiry and renewals

Licences and virtual countries run for `LICENSE_TERM_MONTHS` (12 by default; `0` turns expiry off)
and carry `expiresAt` in the registry; company registrations and business licences never expire.
The holder (or a company owner or director) gets emails 30 and 7 days before, and the entry turns
`expired` on the day. `GET /me/licences` lists what you hold with `renewalApplicationId` for a
renewal in progress. Renewing is an application:
`POST /applications {type: 'renewal', payload: {registryEntryId, note?}}`, open from 60 days before
expiry until 90 days after it. One moderator approves it; the new term starts at the old expiry
date (or today, if it had already expired). Staff can also move an expiry date with
`PATCH /admin/registry/:id {expiresAt}`.

## Virtual-country currencies

The holder of an active virtual country (or its company's owner or a director) creates its currency
once with `POST /registry/:id/currency {code, name, decimals}`: three letters that are not an ISO
4217 code. `POST /virtual-currencies/:code/issue {amount, note?}` puts new money on the holder's
balance (an `issuance` ledger entry) and `/redeem` takes it back out (`redemption`); the
`supply` is public at `GET /virtual-currencies/:code`. From then on the code works everywhere a
currency does: balances, transfers, invoices, payroll, and exchange once staff publish a rate.
`GET /currencies` lists ISO and virtual currencies (clients load it at start-up so they know the
new codes' decimals). Staff with `registry.manage` can suspend new issuance with
`PATCH /admin/virtual-currencies/:code {status}`; an expired or revoked country cannot issue either.

## Registry certificates

`GET /registry/:idOrNumber/certificate.pdf` (public, no token) renders a certificate for a company
registration, licence or virtual country. Its QR code opens `PUBLIC_WEB_URL/#/verify/<number>`, a
page anyone can open, signed in or not, that shows whether the entry is still active. A revoked or
suspended entry still renders, stamped "not valid". The SDK's `registry.certificateUrl(number)`
builds the link.

## Invoices

A person, or a company's owner, director or accountant, bills another person or company with
`POST /invoices`: `from` (`{type: 'user'}` or `{type: 'organization', organizationId}`), `to` (a
username or a company slug), `currency`, `dueDate` and up to 50 `items` (`description`, whole
`quantity`, `unitPrice`). Numbers run per issuer and year (`INV-2026-0001`).

The recipient pays in full with `POST /invoices/:id/pay {walletId}` from one of their balances in
the invoice currency (for a company, one of its business balances); the money moves as a transfer
whose ledger entries reference the invoice. The issuer can `POST /invoices/:id/cancel` while it is
open. `GET /invoices?direction=incoming|outgoing&status=open|paid|cancelled` lists both sides; each
invoice says whether it is `incoming` or `outgoing` for the caller and whether it is `overdue`.
Both sides receive `invoice.updated`.

**Partial payments.** `POST /invoices/:id/pay {walletId, amount}` pays part of an invoice; without
`amount` it pays everything still due. Invoices carry `amountPaid`, `amountDue` and their
`payments`, and stay `open` until paid in full. An invoice with a paid part can no longer be
cancelled.

**Recurring invoices.** `POST /invoice-schedules` takes the same body as an invoice without
`dueDate`, plus `interval` (`weekly`, `monthly`, `quarterly`, `yearly`), `startDate`, an optional
`endDate` and `dueDays` (payment term). A schedule starting today sends its first invoice at once;
the server's scheduler issues the rest on their day (months count from the start day, so the 31st
becomes the last day of shorter months). `GET /invoice-schedules` lists yours and your companies';
`PATCH /invoice-schedules/:id {status: 'paused' | 'active' | 'ended'}` pauses, resumes (missed
periods are skipped) or ends one. Invoices it issued carry `recurring: {scheduleId, interval}`.

## Payroll

Owners, directors and accountants pay up to 200 people at once with
`POST /organizations/:id/payroll {walletId, title, items: [{username, amount, note?}]}`. The company
balance shows one `payroll_out` entry; each person receives a `payroll_in` entry on their personal
balance in that currency (opened if needed). Above the approval limit the run answers **202** with
`status: 'pending'` and an `approvalId`, and is paid when a second finance member approves it.
`GET /organizations/:id/payroll` lists the runs; the finance team receives `payroll.updated`.

## Currency exchange

Staff with `exchange.manage` publish rates with `PUT /admin/exchange {base?, feePercent?, rates?}`:
each rate says what one unit of a currency is worth in the base currency (`{currency: 'EUR', rate:
'1.08'}`), and a `null` rate removes a currency. `GET /exchange` returns the base, the fee and the
rates. `POST /exchange/quote {fromWalletId, toCurrency, amount}` shows what the owner would get: the
fee is taken from the amount first, and the result is rounded down to the target currency's minor
unit. `POST /exchange` with the same body moves the money into the owner's balance in the target
currency (opened if needed); the ledger shows `exchange_out` and `exchange_in` entries that
reference the exchange.

## Multi-signature company payments

A company's owner or director sets `approvalLimit` (in its base currency) with
`PATCH /organizations/:id`; it needs at least two owners, directors or accountants, and `""` turns
it off. From then on a transfer, exchange or invoice payment of at least the limit (other currencies
are compared at the exchange rates, and count as above the limit without one) answers **202** with a
`PaymentApproval` instead of moving the money. The amount is set aside at once (lock reason
`payment_approval`). Another finance member calls
`POST /organizations/:id/payment-approvals/:approvalId/approve` to make the payment, or `/reject`
with a `reason` (the requester can withdraw their own this way). Cancelling an invoice declines its
waiting payment. `GET /organizations/:id/payment-approvals?status=pending` lists them, and the finance
team receives `payment_approval.updated` and `wallet.updated`.

## Main endpoints

| Area         | Endpoints                                                                                                                                                                                                                                                                                                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth & me    | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `GET/PATCH /me`, `POST /me/password`, `GET /me/sessions`, `DELETE /me/sessions/:id`, `POST /me/sessions/sign-out-others`, `GET /me/2fa`, `POST /me/2fa/{setup,enable,disable,recovery-codes}`, `POST /me/email`, `POST /me/email/verification`, `POST /auth/verify-email`, `POST /auth/password/{forgot,reset}` |
| People       | `GET /users/search`, `GET /users/:username`, `GET/POST /contacts`, `DELETE /contacts/:userId`                                                                                                                                                                                                                                                                                          |
| Wallets      | `GET/POST /wallets`, `GET /wallets/:id`, `/entries`, `/locks`, `POST /wallets/transfer`, `GET/POST /wallets/:id/cash-requests`, `POST /cash-requests/:id/cancel`, `GET /wallets/:id/statement.csv`, `POST /wallets/:id/statement-link`, `GET /wallets/:id/statement.pdf`, `GET /wallets/:id/statements`, `GET /exchange`, `POST /exchange/quote`, `POST /exchange`                     |
| Invoices     | `GET/POST /invoices`, `GET /invoices/:id`, `POST /invoices/:id/pay`, `POST /invoices/:id/cancel`, `GET/POST /invoice-schedules`, `PATCH /invoice-schedules/:id`                                                                                                                                                                                                                        |
| Companies    | `GET /organizations/mine`, `GET /organizations/:slug`, `PATCH /organizations/:id`, members, wallets, `GET /organizations/:id/payment-approvals`, `POST …/:approvalId/approve`, `POST …/:approvalId/reject`                                                                                                                                                                             |
| Applications | `POST /applications`, `GET /applications/mine`, `/queue`, `/:id`, `POST /:id/review`, `/:id/withdraw`, `/:id/resubmit`; `POST /files`, `GET/DELETE /files/:id`                                                                                                                                                                                                                         |
| Registry     | `GET /registry`, `GET /registry/:idOrNumber`, `GET /registry/:idOrNumber/certificate.pdf`, `GET /me/licences`, `POST /registry/:id/currency`, `GET /currencies`, `GET /virtual-currencies/:code`, `POST …/issue`, `POST …/redeem`                                                                                                                                                      |
| Stock        | `GET /stock/listings`, `/stock/listings/:ticker`, `POST …/invest`, `GET /stock/portfolio`, `GET …/book`, `POST …/orders`, `GET /stock/orders`, `DELETE /stock/orders/:id`                                                                                                                                                                                                              |
| Chats        | `GET /chats`, `POST /chats/direct`, `/chats/groups`, `/chats/channels`, `GET /channels`, messages, members, read, pin, `GET /chats/search`, reactions, receipts, comments                                                                                                                                                                                                              |
| Support      | `POST/GET /support/tickets`, `GET /support/desk`, `POST /support/tickets/:id/status`                                                                                                                                                                                                                                                                                                   |
| Stories      | `GET/POST /stories`, `POST /stories/:id/view`, `DELETE /stories/:id`                                                                                                                                                                                                                                                                                                                   |
| Developer    | `GET/POST /api-keys`, `DELETE /api-keys/:id`, `GET/POST /webhooks`, `PATCH/DELETE /webhooks/:id`, `POST /webhooks/:id/{test,rotate-secret}`, `GET /webhooks/:id/deliveries`                                                                                                                                                                                                            |
| Admin        | `/admin/stats`, `/admin/users`, `/admin/organizations`, `/admin/owners`, `/admin/wallets`, `/admin/cash-operations`, `/admin/cash-requests` (+ `/:id/complete`, `/:id/decline`), `/admin/registry/:id`, `/admin/stock/listings/:id`, `/admin/audit-logs`, `/admin/api-keys`                                                                                                            |
