# OVL For Business (before QSN For Business)

A platform for personal and corporate accounts: business balances in any world currency,
licenses, a public registry, a stock exchange, messaging with tech support, service stories and a
separate admin panel. One Docker-based server with an open API, and clients for every platform.

| Part                                             | Where              | Technology                                                     |
| ------------------------------------------------ | ------------------ | -------------------------------------------------------------- |
| Server + API                                     | `server/`          | Node.js 22, Fastify, PostgreSQL, Drizzle ORM                   |
| Web + web app (PWA)                              | `clients/web/`     | React 19, Vite, Motion, installable PWA                        |
| Native apps: Android, iOS, macOS, Windows, Linux | `clients/app/`     | Flutter, compiled natively for each platform (not a web view)  |
| Admin panel                                      | `admin/`           | Separate React app, separate deployment                        |
| API SDK                                          | `packages/sdk/`    | Typed REST + realtime client used by the web apps              |
| Domain model                                     | `packages/shared/` | Roles, permissions, currencies, workflows, API schemas, themes |
| UI kit                                           | `packages/ui/`     | Shared components, icons, charts, motion and the theme engine  |

## Screenshots

**Web client**: animated sign-in, first-run tour, dashboard, chats and the stock exchange.

|                                                            |                                                                               |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| ![Animated sign-in](docs/screenshots/web/login.png)        | ![First-run tour: pick a theme](docs/screenshots/web/onboarding.png)          |
| ![Home dashboard](docs/screenshots/web/home.png)           | ![Chats](docs/screenshots/web/chats.png)                                      |
| ![Wallet with bank cards](docs/screenshots/web/wallet.png) | ![Listing with an interactive price chart](docs/screenshots/web/exchange.png) |
| ![Themes (Aurora)](docs/screenshots/web/themes.png)        | ![Ctrl/⌘ + K search](docs/screenshots/web/palette.png)                        |

![Web client on a phone (Obsidian theme)](docs/screenshots/web/phones.png)

**Native apps** (Flutter). These screenshots come from the Linux build; the same code runs on
Android, iOS, macOS and Windows.

![Native app on a phone: sign-in, tour, themes, home](docs/screenshots/native/phones-1.png)
![Native app on a phone: chat, wallet, exchange, a dark theme](docs/screenshots/native/phones-2.png)

|                                                                       |                                                                           |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| ![Native desktop: sign-in](docs/screenshots/native/desktop-login.png) | ![Native desktop: home](docs/screenshots/native/desktop-home.png)         |
| ![Native desktop: chats](docs/screenshots/native/desktop-chats.png)   | ![Native desktop: exchange](docs/screenshots/native/desktop-exchange.png) |

**Admin panel**: a separate site for staff.

|                                                                           |                                                                     |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| ![Admin sign-in](docs/screenshots/admin/login.png)                        | ![Admin dashboard (Graphite)](docs/screenshots/admin/dashboard.png) |
| ![Admin dashboard (Daylight)](docs/screenshots/admin/dashboard-light.png) | ![Cash desk](docs/screenshots/admin/cash-desk.png)                  |

## Features

- **Accounts & roles** — `user`, `moderator`, `manager` (finance), `council`, `admin`, `owner`.
  Staff show badges in contacts and chats; council members have their own council badge.
- **Business balance in any currency** — 155 ISO 4217 currencies, exact money in minor units,
  immutable ledger per wallet. Money is **deposited only by finance managers** in the admin panel,
  either as a manager-handled transfer or as **physical cash at the desk**, each with a reference and
  a journal entry. Transfers between people and companies, per-currency balances, statements.
- **Tech support** — tickets are support chats. Moderators, admins and the owner answer from the same
  client in a separate _Support desk_ section; replies carry a staff badge and the owner's replies a
  special owner badge. The council cannot answer tickets.
- **Chats** — direct messages, groups (you can only invite people from your contacts), news channels
  (created only through moderation), the pinned council chat and the moderation team chat. Realtime
  over WebSocket, unread counters, typing indicators.
- **Licenses** — projects, fan-projects, TV / radio channels, verified websites, virtual countries and
  more (virtual only). Approval: **moderation → council vote (quorum) → owner confirmation**, then the
  license is rolled out into the public registry with a registry number.
- **Public registry** — licenses, organizations and virtual countries; searchable in the app and via
  the public API (`X-API-Key` developer keys for other services).
- **Service stories** — short-lived announcements that council members, admins and the owner publish
  from any client; every client shows them in a stories bar.
- **Stock exchange** — a company application is reviewed by a moderator who must confirm a checklist
  of every part of the file, then approved by the council quorum or an admin/owner. Approval creates
  the company, its business license and its listing. Anyone can invest; **30% (configurable) of every
  investment is frozen on the company balance for 3–6 months** (default 90 days). Public API for
  listings and prices.
- **Registration** — applications to create a company / business account, request a license, join
  the moderation team, join the council or open a news channel.
- **Council** — a role with a pinned council chat where applications waiting for a vote are posted as
  cards, plus normal chit-chat.
- **Themes, onboarding and multi-account**: eight themes (Daylight, Midnight, Graphite,
  Emerald, Obsidian, Ivory, Aurora, High contrast) shared by the web client, the admin panel and
  the native apps. Your choice follows your account to every device. New accounts get a
  first-run tour. Several accounts can be signed in on one device, with one-tap switching.
- **Business extras** — company team roles (owner, director, accountant, member), audit log of every
  privileged action, developer API keys, OpenAPI docs, a Ctrl/⌘ + K command palette. See
  [docs/ROADMAP.md](docs/ROADMAP.md) for what comes next.

## Quick start (Docker)

```bash
cp .env.example .env        # set POSTGRES_PASSWORD, JWT_SECRET, OWNER_PASSWORD
docker compose up -d --build
```

| URL                            | What                                |
| ------------------------------ | ----------------------------------- |
| http://localhost:8080          | Client (web / installable web app)  |
| http://localhost:8081          | Admin panel                         |
| http://localhost:8080/api/docs | Interactive API reference (OpenAPI) |

Sign in with the owner account from `.env`. With real domains in `WEB_ADDRESS` / `ADMIN_ADDRESS`,
Caddy gets HTTPS certificates automatically. The admin panel is a separate site and can be
restricted to office / VPN addresses in `deploy/caddy/Caddyfile`.

## Local development

```bash
pnpm install
pnpm db:up                                 # PostgreSQL in Docker (docker-compose.dev.yml)
cp server/.env.example server/.env
pnpm dev:server                            # API on :4000 (migrations run on start)
pnpm dev:web                               # client on :5173
pnpm dev:admin                             # admin panel on :5174
```

Demo data (people, companies, listings, licenses, chats and stories that go through the real
approval workflows), with the server running:

```bash
pnpm --filter @ovl/server seed:demo        # accounts maria, ivan, elena, arjun, sofia… (password demo-password-1)
```

Native app ([clients/app/README.md](clients/app/README.md)):

```bash
cd clients/app && flutter run              # Android / iOS device or emulator, or -d macos / windows / linux
pnpm gen:dart                              # after changing shared themes or currencies
```

Checks:

```bash
pnpm typecheck
pnpm --filter @ovl/shared test
pnpm --filter @ovl/server test             # needs PostgreSQL; uses TEST_DATABASE_URL or postgres://ovl:ovl@localhost:5432/ovl_test
pnpm test:e2e                              # starts server + web client + admin panel and drives them in Chromium
pnpm build
```

The end-to-end suite (`e2e/`) needs the database from `pnpm db:up` and a Chromium for Playwright
(`pnpm --filter @ovl/e2e exec playwright install chromium`). It recreates its own `ovl_e2e` database.

After changing `server/src/db/schema.ts`, create a migration with `pnpm db:generate`.

Native builds for all five platforms: see [clients/app/README.md](clients/app/README.md). CI builds
them in `.github/workflows/native.yml`.

## Configuration

Server environment variables (see `server/src/config.ts`):

| Variable                                            | Default      | Meaning                                                                                    |
| --------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                      | —            | PostgreSQL connection string                                                               |
| `JWT_SECRET`                                        | —            | ≥ 32 characters                                                                            |
| `OWNER_USERNAME` / `OWNER_EMAIL` / `OWNER_PASSWORD` | `owner`      | The single owner account, created on first start                                           |
| `COUNCIL_QUORUM`                                    | `3`          | Council approvals needed (capped by the council size)                                      |
| `STOCK_FREEZE_PERCENT`                              | `30`         | Frozen share of each investment                                                            |
| `STOCK_LOCK_DAYS`                                   | `90`         | Default lock period; admins may set 90–183 days per listing                                |
| `CORS_ORIGINS`                                      | `*`          | Allowed browser origins                                                                    |
| `TRUST_PROXY`                                       | `true`       | Trust `X-Forwarded-For` from the reverse proxy; set `false` if the API is exposed directly |
| `PUBLIC_RATE_LIMIT` / `API_KEY_RATE_LIMIT`          | `60` / `600` | Requests per minute on the public API                                                      |

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — components, data model, money, workflows, security
- [docs/API.md](docs/API.md) — authentication, public registry / stock API, realtime events
- [docs/ROADMAP.md](docs/ROADMAP.md) — next steps and suggestions

Status: **in development** — foundation release 0.1.
