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

## Realtime events

Connect to `wss://…/api/v1/realtime?token=<accessToken>`. The server sends JSON events:

| Event                  | Payload                                 |
| ---------------------- | --------------------------------------- |
| `ready`                | `userId`                                |
| `message.created`      | `chatId`, `message`                     |
| `message.updated`      | `chatId`, `message` (edits, deletions)  |
| `chat.updated`         | `chatId`                                |
| `chat.removed`         | `chatId`                                |
| `typing`               | `chatId`, `userId`                      |
| `application.updated`  | `applicationId`, `status`, `stageIndex` |
| `story.created`        | `storyId`                               |
| `wallet.updated`       | `walletId`                              |
| `cash_request.updated` | `requestId`, `walletId`, `status`       |
| `invoice.updated`      | `invoiceId`, `status`                   |

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
BOM, CRLF, for spreadsheets). The SDK's `wallets.statementCsv()` returns a `Blob`. Apps that hand
the file to the system browser call `POST /wallets/:id/statement-link` instead: it returns a path
that works for five minutes without an `Authorization` header, for that wallet and range only, and
stops working when the session is signed out.

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

## Main endpoints

| Area         | Endpoints                                                                                                                                                                                                                                                                                                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth & me    | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `GET/PATCH /me`, `POST /me/password`, `GET /me/sessions`, `DELETE /me/sessions/:id`, `POST /me/sessions/sign-out-others`, `GET /me/2fa`, `POST /me/2fa/{setup,enable,disable,recovery-codes}`, `POST /me/email`, `POST /me/email/verification`, `POST /auth/verify-email`, `POST /auth/password/{forgot,reset}` |
| People       | `GET /users/search`, `GET /users/:username`, `GET/POST /contacts`, `DELETE /contacts/:userId`                                                                                                                                                                                                                                                                                          |
| Wallets      | `GET/POST /wallets`, `GET /wallets/:id`, `/entries`, `/locks`, `POST /wallets/transfer`, `GET/POST /wallets/:id/cash-requests`, `POST /cash-requests/:id/cancel`, `GET /wallets/:id/statement.csv`, `POST /wallets/:id/statement-link`                                                                                                                                                 |
| Invoices     | `GET/POST /invoices`, `GET /invoices/:id`, `POST /invoices/:id/pay`, `POST /invoices/:id/cancel`                                                                                                                                                                                                                                                                                       |
| Companies    | `GET /organizations/mine`, `GET /organizations/:slug`, `PATCH /organizations/:id`, members, wallets                                                                                                                                                                                                                                                                                    |
| Applications | `POST /applications`, `GET /applications/mine`, `/queue`, `/:id`, `POST /:id/review`, `/:id/withdraw`, `/:id/resubmit`; `POST /files`, `GET/DELETE /files/:id`                                                                                                                                                                                                                         |
| Registry     | `GET /registry`, `GET /registry/:idOrNumber`                                                                                                                                                                                                                                                                                                                                           |
| Stock        | `GET /stock/listings`, `/stock/listings/:ticker`, `POST …/invest`, `GET /stock/portfolio`                                                                                                                                                                                                                                                                                              |
| Chats        | `GET /chats`, `POST /chats/direct`, `/chats/groups`, `/chats/channels`, `GET /channels`, messages, members, read, pin                                                                                                                                                                                                                                                                  |
| Support      | `POST/GET /support/tickets`, `GET /support/desk`, `POST /support/tickets/:id/status`                                                                                                                                                                                                                                                                                                   |
| Stories      | `GET/POST /stories`, `POST /stories/:id/view`, `DELETE /stories/:id`                                                                                                                                                                                                                                                                                                                   |
| Developer    | `GET/POST /api-keys`, `DELETE /api-keys/:id`                                                                                                                                                                                                                                                                                                                                           |
| Admin        | `/admin/stats`, `/admin/users`, `/admin/organizations`, `/admin/owners`, `/admin/wallets`, `/admin/cash-operations`, `/admin/cash-requests` (+ `/:id/complete`, `/:id/decline`), `/admin/registry/:id`, `/admin/stock/listings/:id`, `/admin/audit-logs`, `/admin/api-keys`                                                                                                            |
