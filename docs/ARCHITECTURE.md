# Architecture

```
       ┌──────────────── clients ─────────────────┐     ┌── staff ──┐
       │ web / PWA       native apps (Flutter)     │     │  admin    │
       │ (React)         Android · iOS · macOS ·   │     │  panel    │
       │                 Windows · Linux           │     │ (React)   │
       └──────┬──────────────────┬─────────────────┘     └─────┬─────┘
              │ @ovl/sdk         │ Dart client                  │ @ovl/sdk
       ┌──────▼──────────────────▼──────────────────────────────▼──────┐
       │        Caddy reverse proxy (HTTPS, separate admin site)        │
       └───────────────────────────────┬───────────────────────────────┘
                                       │ /api/v1 (REST), /api/v1/realtime (WebSocket)
                     ┌─────────────────▼──────────────────────────────┐
  third-party ──────►│ API server (Fastify, zod-validated, OpenAPI)   │
  services (API key) └─────────────────┬──────────────────────────────┘
                                       │
                              ┌────────▼────────┐
                              │   PostgreSQL    │
                              └─────────────────┘
```

- **Web and native clients.** `clients/web` is a responsive React app that runs in browsers and
  installs as a PWA. `clients/app` is a Flutter app compiled natively for Android, iOS, macOS,
  Windows and Linux, with the same screens, adaptive layouts (bottom bar on phones, sidebar and
  split views on large screens), realtime and multi-account support. Tokens are kept in the
  platform keychain.
- **One design language everywhere.** The eight colour themes live in
  `packages/shared/src/themes.ts`. The web client and the admin panel turn them into CSS
  variables; `pnpm gen:dart` generates the native palettes (and the currency table) from the same
  file, and CI fails if the generated code is stale. The chosen theme and onboarding state are
  stored as account preferences (`PATCH /me/preferences`), so they follow the person across
  devices.
- **One set of translations everywhere.** English text is the key: `t('Send money')` in React,
  `tr('Send money')` in Dart, `t('Bought {0} shares', n)` with values, and `plural(n, 'share')`
  with each language's plural forms. The Russian catalog is built from `scripts/i18n/ru/*.json`
  into `packages/shared/src/locales/ru.ts` (web, admin panel, server) and
  `clients/app/lib/i18n/ru.g.dart` (apps). The server translates what it says (errors into the
  request's `Accept-Language`, which the apps send; notifications and emails into the language
  the account keeps in `preferences.locale`). System lines in chats carry their text and values in
  `meta.text`, so every member reads them in their own language; names in them are never
  translated, only values marked with `label()`. A missing translation falls back to English.
- **The admin panel is a separate app** (`admin/`) with its own build, container, address and
  session storage. It talks to the same API; staff endpoints are protected by permissions on the
  server, never only by the UI.
- **Contract-first API.** Request and response schemas live in `packages/shared` (zod). The server
  validates with them, the OpenAPI document is generated from them, and the SDK and every client
  derive their TypeScript types from them. Clients written in other languages can use
  `/api/docs/json` and `GET /api/v1/meta` (currencies, roles, license types, workflows).

## Server modules (`server/src/modules`)

| Module          | Responsibility                                                       |
| --------------- | -------------------------------------------------------------------- |
| `auth`          | Register, login, rotating refresh tokens, profile, password          |
| `users`         | Search, profiles, contacts                                           |
| `wallets`       | Wallets per owner + currency, ledger, fund locks, transfers          |
| `organizations` | Companies, team roles, business balances                             |
| `applications`  | Approval workflow engine and the effects of approvals                |
| `registry`      | Registry numbers, public search                                      |
| `stock`         | Listings, investing with frozen share, portfolio, price history      |
| `chats`         | Direct, groups, channels, council & moderation chats, tech support   |
| `stories`       | Service stories                                                      |
| `api-keys`      | Developer keys for the public API                                    |
| `admin`         | Stats, users & roles, cash desk, statuses, listing parameters, audit |
| `realtime`      | WebSocket hub                                                        |

## Roles and permissions

Every account has one platform role; permissions are defined in `packages/shared/src/roles.ts`
and checked on the server.

| Permission              | moderator | manager | council | admin | owner |
| ----------------------- | :-------: | :-----: | :-----: | :---: | :---: |
| Admin panel             |     ✓     |    ✓    |         |   ✓   |   ✓   |
| Answer tech support     |     ✓     |         |         |   ✓   |   ✓   |
| Deposits / withdrawals  |           |    ✓    |         |   ✓   |   ✓   |
| Publish service stories |           |         |    ✓    |   ✓   |   ✓   |
| Create news channels    |     ✓     |         |         |   ✓   |   ✓   |
| Manage users & roles    |           |         |         |  ✓ ¹  |   ✓   |
| Registry / stock / orgs |           |         |         |   ✓   |   ✓   |
| Audit log               |           |         |         |   ✓   |   ✓   |

¹ Admins can only move accounts between user, moderator and manager. Council and admin are granted
by the owner (or through applications). The owner role is never assignable.

## Approval workflows

`packages/shared/src/workflows.ts` defines each application type as ordered stages. A stage passes
when **any** approver group reaches its quorum of approvals, and fails when a group reaches its
quorum of rejections (rejections need a reason). The council quorum is `COUNCIL_QUORUM`, capped by
the number of active council members so a small council keeps working. The owner can act on any
stage as an override. Stages may carry a **checklist** that each approving reviewer must confirm.

| Type           | Stages                                                            | On approval                                                                                          |
| -------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `company`      | moderation (5-item checklist) → council quorum **or** admin/owner | company + owner membership + business wallet + ORG and business LIC registry entries + stock listing |
| `license`      | moderation (3-item checklist) → council quorum → owner            | LIC (or VC for virtual countries) registry entry                                                     |
| `moderator`    | council quorum or admin → admin/owner                             | role `moderator`, joins the moderation chat                                                          |
| `council`      | council quorum → owner                                            | role `council`, joins the pinned council chat                                                        |
| `news_channel` | moderation                                                        | public news channel owned by the applicant                                                           |

When an application reaches a stage, a card is posted into the council and/or moderation chat, and
the review queue in the client shows everything waiting for the current user.

## Money

- Amounts are stored as integer **minor units** (`bigint`) with the currency's exponent
  (JPY 0, USD 2, KWD 3…) and exchanged as decimal strings over the API. No floating point.
- Every balance change writes an immutable **ledger entry** with the resulting balance, inside the
  same transaction that updates the wallet row. Wallet rows are locked (`SELECT … FOR UPDATE`) in a
  stable order to avoid deadlocks; a database constraint forbids negative balances.
- **Fund locks** freeze part of a balance until a date. `available = balance − active locks`;
  locks expire by time, so no background job is needed.
- **Cash desk**: deposits and withdrawals are only possible through `/admin/cash-operations`
  (finance managers, admins, owner), with method (`manager_transfer` / `physical_cash`), reference and
  note, a journal and an audit entry.
- **Investing**: amount → whole shares at the current price; the investor's wallet is debited, the
  company's credited, and `freezePercent` of the amount is locked on the company wallet for
  `lockDays` (default 30% / 90 days, adjustable per listing between 3 and 6 months).

## Realtime

`GET /api/v1/realtime?token=<access token>` upgrades to a WebSocket. The server pushes
`message.created/updated`, `chat.updated/removed`, `typing`, `application.updated`, `story.created`,
`wallet.updated`, `notification.created` and more (see API.md). Clients use them to refresh their
caches.

## Running several instances

Any number of API instances can run behind a load balancer on one database; nothing else is
needed:

- **Realtime** (`REALTIME_BROKER=postgres`, the default): every instance keeps its own sockets in
  `RealtimeHub` and publishes each event with `NOTIFY ovl_realtime`; all instances `LISTEN` and
  deliver to the sockets they hold. Events too large for a NOTIFY payload (about 8 KB) are stored
  in `realtime_events` and sent by id. Signing a session out closes its socket wherever it is.
- **Presence**: who is connected where lives in `realtime_presence` (each instance refreshes its
  rows every 30 s, rows of a crashed instance expire after 90 s). Push notifications use it to
  reach only people who are not connected anywhere.
- **Rate limits** (`RATE_LIMIT_STORE=postgres`): counters in `rate_limits`, one upsert per request,
  so a client cannot multiply its allowance by spreading requests over instances. The default,
  `memory`, counts per instance.
- **Background jobs** claim their work with `FOR UPDATE SKIP LOCKED`, so every instance may run
  the scheduler; notifications and webhooks are written in the transaction of the change (outbox)
  and delivered by whichever instance gets there first.
- **Files** need shared storage: the S3 driver (`STORAGE_DRIVER=s3`) or one volume for all.

## Security

- Passwords hashed with scrypt; short-lived HS256 access tokens (15 min) and rotating, revocable
  refresh tokens (stored hashed). Changing the password or suspending an account revokes sessions.
- All input validated with zod; errors never leak internals. Helmet headers, CORS allow-list,
  per-route rate limits (stricter on auth and on the public API).
- Every privileged action writes an audit log entry (actor, action, target, data, IP).
- Developer API keys are stored hashed, scoped (`registry:read`, `stock:read`) and revocable.
