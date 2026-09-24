# Architecture

```
            ┌──────────── clients ────────────┐        ┌── staff ──┐
            │ web / PWA   Android/iOS  desktop │        │  admin    │
            │ (React)     (Capacitor)  (Tauri) │        │  panel    │
            └───────────────┬─────────────────┘        └─────┬─────┘
                            │  @ovl/sdk (REST + WebSocket)     │
                     ┌──────▼──────────────────────────────────▼──────┐
                     │ Caddy reverse proxy (HTTPS, separate admin site)│
                     └──────────────────────┬─────────────────────────┘
                                            │ /api/v1, /api/v1/realtime
                     ┌──────────────────────▼─────────────────────────┐
  third-party ──────►│ API server (Fastify, zod-validated, OpenAPI)   │
  services (API key) └──────────────────────┬─────────────────────────┘
                                            │
                                   ┌────────▼────────┐
                                   │   PostgreSQL    │
                                   └─────────────────┘
```

- **One UI codebase for all end-user platforms.** `clients/web` is a responsive React app. The same
  build runs in browsers, is installable as a PWA, and is wrapped by Capacitor (Android, iOS) and
  Tauri (macOS, Windows, Linux). Hash routing and relative asset paths make it work inside those
  shells; the API address comes from runtime config, the build, or the sign-in screen.
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
`message.created/updated`, `chat.updated/removed`, `typing`, `application.updated`, `story.created`
and `wallet.updated`. Clients use them to refresh their caches. The hub is in-process; for several
API replicas put Redis or Postgres `LISTEN/NOTIFY` behind `RealtimeHub` (see roadmap).

## Security

- Passwords hashed with scrypt; short-lived HS256 access tokens (15 min) and rotating, revocable
  refresh tokens (stored hashed). Changing the password or suspending an account revokes sessions.
- All input validated with zod; errors never leak internals. Helmet headers, CORS allow-list,
  per-route rate limits (stricter on auth and on the public API).
- Every privileged action writes an audit log entry (actor, action, target, data, IP).
- Developer API keys are stored hashed, scoped (`registry:read`, `stock:read`) and revocable.
