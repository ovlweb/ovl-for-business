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
`DELETE /me/sessions/:id` signs one out and `POST /me/sessions/sign-out-others` signs out every
device but the current one. A signed-out session stops working immediately: its access tokens are
refused and its realtime connection closes. Re-using a refresh token more than a minute after it
was rotated is treated as theft and signs that whole session out. Changing the password signs out
every other device.

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

| Event                 | Payload                                 |
| --------------------- | --------------------------------------- |
| `ready`               | `userId`                                |
| `message.created`     | `chatId`, `message`                     |
| `message.updated`     | `chatId`, `message` (edits, deletions)  |
| `chat.updated`        | `chatId`                                |
| `chat.removed`        | `chatId`                                |
| `typing`              | `chatId`, `userId`                      |
| `application.updated` | `applicationId`, `status`, `stageIndex` |
| `story.created`       | `storyId`                               |
| `wallet.updated`      | `walletId`                              |

Clients may send `{"type":"typing","chatId":"…"}` and `{"type":"ping"}`. A close code `4401`
means the access token expired or the session was signed out: refresh and reconnect (the refresh
fails for a signed-out session).

## Main endpoints

| Area         | Endpoints                                                                                                                                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth & me    | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `GET/PATCH /me`, `POST /me/password`, `GET /me/sessions`, `DELETE /me/sessions/:id`, `POST /me/sessions/sign-out-others`                 |
| People       | `GET /users/search`, `GET /users/:username`, `GET/POST /contacts`, `DELETE /contacts/:userId`                                                                                                                   |
| Wallets      | `GET/POST /wallets`, `GET /wallets/:id`, `/entries`, `/locks`, `POST /wallets/transfer`                                                                                                                         |
| Companies    | `GET /organizations/mine`, `GET /organizations/:slug`, `PATCH /organizations/:id`, members, wallets                                                                                                             |
| Applications | `POST /applications`, `GET /applications/mine`, `/queue`, `/:id`, `POST /:id/review`, `/:id/withdraw`                                                                                                           |
| Registry     | `GET /registry`, `GET /registry/:idOrNumber`                                                                                                                                                                    |
| Stock        | `GET /stock/listings`, `/stock/listings/:ticker`, `POST …/invest`, `GET /stock/portfolio`                                                                                                                       |
| Chats        | `GET /chats`, `POST /chats/direct`, `/chats/groups`, `/chats/channels`, `GET /channels`, messages, members, read, pin                                                                                           |
| Support      | `POST/GET /support/tickets`, `GET /support/desk`, `POST /support/tickets/:id/status`                                                                                                                            |
| Stories      | `GET/POST /stories`, `POST /stories/:id/view`, `DELETE /stories/:id`                                                                                                                                            |
| Developer    | `GET/POST /api-keys`, `DELETE /api-keys/:id`                                                                                                                                                                    |
| Admin        | `/admin/stats`, `/admin/users`, `/admin/organizations`, `/admin/owners`, `/admin/wallets`, `/admin/cash-operations`, `/admin/registry/:id`, `/admin/stock/listings/:id`, `/admin/audit-logs`, `/admin/api-keys` |
