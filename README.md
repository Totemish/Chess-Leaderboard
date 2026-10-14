# ♟️ IITR Chess Leaderboard

A live leaderboard and tournament manager for IIT Roorkee's chess community. It tracks every member's Chess.com rating in Rapid, Blitz and Bullet, pushes rating changes to open browsers as they happen, and runs club Swiss tournaments with optimal pairings.

## Features

| Feature | Details |
|---|---|
| **Leaderboards** | Rapid, Blitz and Bullet rankings with standard competition ranking (tied ratings share a rank), search, and 90-day rating charts |
| **Live updates** | The server re-syncs every player from Chess.com every 10 minutes and pushes changes over Socket.IO; the changed rank square lights up like a chessboard's last-move highlight |
| **Verified sign-up** | Members sign in with Google, GitHub or Discord. Joining requires a verified `@iitr.ac.in` email and proof of ownership of the Chess.com account |
| **Swiss tournaments** | Pairings by minimum-cost perfect matching (Edmonds' blossom algorithm), FIDE-style colour allocation, Buchholz tie-breaks, and a crosstable |
| **Safe under concurrency** | Every tournament write runs in a transaction behind a row lock; standings are recomputed from the games, never incremented |
| **Admin tools** | Admins create tournaments, pair rounds, enter results, finish events, and add players |

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Next.js 16 web app (client/)                                 │
│ React 19 · Tailwind CSS 4 · SWR · Recharts · Auth.js v5      │
│  ├─ public data: calls the API directly + Socket.IO          │
│  └─ signed-in calls: /api/backend/* proxy, which attaches a  │
│     1-minute HS256 JWT signed with the shared AUTH_SECRET    │
└───────────────┬──────────────────────────────────────────────┘
                │ HTTPS + WebSocket
┌───────────────▼──────────────────────────────────────────────┐
│ Express 5 API (server/)                                      │
│  routes/      HTTP only: parse input, call a service         │
│  services/    TournamentService, Chess.com client, sync job  │
│  domain/      pure logic: blossom matching, Swiss pairing,   │
│               colours, standings, ownership codes (tested)   │
└──────┬─────────────────────┬─────────────────────┬───────────┘
       │ Prisma              │ ioredis (optional)  │ HTTPS, serial
┌──────▼──────┐       ┌──────▼──────┐       ┌──────▼──────────┐
│ PostgreSQL  │       │ Redis cache │       │ Chess.com       │
│             │       │ (5 min TTL) │       │ public API      │
└─────────────┘       └─────────────┘       └─────────────────┘
```

## How the Swiss pairing engine works

`server/domain/pairing/swiss.ts` pairs a round as a **minimum-cost perfect matching** on the complete graph of players (plus a "bye" vertex when the count is odd):

1. Every possible board gets a cost built from strict priority tiers, from most to least important:
   1. rematch, or a second bye
   2. two players who both *must* have the same colour
   3. score difference, squared (two half-point floats beat one full-point float)
   4. strong colour preference
   5. mild colour preference
   6. Dutch-system order (top half of a score group meets the bottom half)

   Each tier's unit cost is larger than the worst possible total of all lower tiers, so minimising the sum minimises the rules in that order.
2. **Edmonds' blossom algorithm** (`domain/matching/blossom.ts`, O(n³)) finds the optimal perfect matching. The Hungarian algorithm can't be used: pairing graphs aren't bipartite, so odd cycles ("blossoms") must be handled.
3. Colours follow the FIDE Dutch rules: grant both preferences, otherwise the stronger one, otherwise alternate from the last round the players differed, otherwise the higher-ranked player gets theirs.

Rematches are very expensive but not forbidden, so a round can always be paired; a rematch only happens when no other pairing exists.

**Verified by tests:** the blossom implementation matches an exact brute-force optimum on 6,000 random graphs. The pairing engine matches an exact subset-DP oracle on rematches, colour clashes and score gaps across ~2,300 simulated rounds, and no player exceeds FIDE colour limits at typical event lengths.

Standings (`domain/standings.ts`) are recomputed from the games after every change. Buchholz is the sum of opponents' scores, and a bye counts as an opponent with the player's own score.

## Data integrity

- **One writer per tournament.** Joining, pairing, entering results and finishing each start with a conditional `UPDATE` on the tournament row, which locks it until the transaction commits. Concurrent requests for the same tournament run one after another and see each other's changes.
- **No double counting.** A result is saved with a conditional update (`WHERE status = 'PENDING'`), and scores are derived from games rather than incremented.
- **Integration tests** fire concurrent duplicate results, double "Pair" clicks and parallel results, and check the outcomes.

## Joining the leaderboard

The leaderboard starts empty: every player comes from the database, and members add themselves.

1. Sign in with an account whose `@iitr.ac.in` email the provider has verified. With GitHub or Discord, that address must be the account's main email.
2. On the dashboard, enter your Chess.com username. The API returns a code, an HMAC of your account and the username, so it needs no storage and only works for you.
3. Put the code in the **Location** field of your Chess.com profile and press **Verify**. The API reads it back from Chess.com, adds you to the leaderboard and links the account. You can then remove the code.

Admins can also add or remove players directly (see [Managing players](#managing-players)), for example someone who hasn't signed up.

## Tech stack

| Area | Technology |
|---|---|
| Web app | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, SWR, Recharts, Framer Motion, Auth.js v5 |
| API | Node.js, Express 5, TypeScript, Socket.IO, node-cron, Prisma 6, jsonwebtoken |
| Data | PostgreSQL, Redis (optional cache) |
| Tests | Node's built-in test runner (`node:test`) |

## Project structure

```
client/                      Next.js web app
  src/app/                   routes: leaderboard, tournaments, dashboard, sign-in, API proxy
  src/components/            leaderboard, tournaments (pairings, crosstable), dashboard, charts, ui
  src/lib/                   API client, auth config, chess and tournament helpers
server/                      Express API
  index.ts                   composition root: wires dependencies, CORS, shutdown
  config.ts                  environment, validated at startup
  domain/                    pure, unit-tested logic
    matching/blossom.ts      maximum-weight matching (Edmonds)
    pairing/                 Swiss engine, colour rules, PairingStrategy interface
    standings.ts             scores and Buchholz
    ownership.ts             account-ownership codes
  services/                  TournamentService, Chess.com client and sync, cache, cron
  routes/                    auth, players/leaderboard, tournaments
  middleware/                auth (JWT, admin), errors
  lib/                       error classes, input validation
  scripts/players.ts         admin command: list, add, remove players
  prisma/                    schema, migrations
  tests/                     unit tests; tests/integration needs a database
```

## Setup

Prerequisites: Node.js 22+, a PostgreSQL database, and OAuth apps for the providers you want.

### API (`server/`)

```bash
cd server
npm install
cp .env.example .env        # then fill in DATABASE_URL, AUTH_SECRET, CLIENT_ORIGIN
npx prisma migrate deploy   # create the tables
npm run dev                 # http://localhost:5000
```

**Already have a database created with `prisma db push`?** Mark the baseline migration as applied before deploying, so only the new changes run:

```bash
npx prisma migrate resolve --applied 0_init
npx prisma migrate deploy
```

### Web app (`client/`)

```bash
cd client
npm install
cp .env.example .env.local  # AUTH_SECRET must equal the API's
npm run dev                 # http://localhost:3000
```

### Managing players

Run these in `server/`. They use the database in `server/.env`.

```bash
npm run players -- list                       # everyone on the leaderboard
npm run players -- add hikaru magnuscarlsen   # add by Chess.com username
npm run players -- remove hikaru              # preview what would be deleted
npm run players -- remove hikaru --yes        # delete
```

Removing a player also deletes their rating history and tournament entries, and unlinks their member account. In production, use `node dist/scripts/players.js <command>` after building.

### Making someone an admin

Admin status lives in the database. Open `npx prisma studio` in `server/`, find the member in `User` (after they've signed in once), and set `role` to `ADMIN`.

## Tests

```bash
cd server
npm test                    # unit tests: matching, pairing, standings, ownership codes
npm run typecheck
```

Integration tests run the services and routes against a real, disposable Postgres:

```bash
npx prisma dev --name test --detach        # prints a local postgres:// URL
TEST_DATABASE_URL="postgres://…localhost…&pgbouncer=true" npx prisma migrate deploy
TEST_DATABASE_URL="postgres://…localhost…&pgbouncer=true" npm run test:integration
```

They refuse to run against a non-local host.

## API

All responses are `{ success, data }` or `{ success: false, error }`. "Member" means a signed-in user (Bearer JWT from the web app's proxy).

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/api/leaderboard/:format` | Public | Ranked players for `rapid`, `blitz` or `bullet`. `?cursor=` pages (100 per page), `?search=` filters |
| GET | `/api/players` | Public | Every tracked player |
| GET | `/api/players/:username` | Public | One player with rating history (`?days=`, default 365) |
| GET | `/api/auth/me` | Member | The member, their linked profile and 90 days of history |
| POST | `/api/auth/link-profile/challenge` | Member | `{ chessUsername }` → ownership code |
| POST | `/api/auth/link-profile` | Member | `{ chessUsername }` → verifies the code on Chess.com and links |
| DELETE | `/api/auth/unlink-profile` | Member | Unlinks the member's Chess.com account |
| POST | `/api/auth/sync/:username` | Member / Admin | Refresh ratings now: members their own account (once a minute), admins anyone (adds new players) |
| GET | `/api/tournaments` | Public | All tournaments |
| GET | `/api/tournaments/:id` | Public | Tournament with standings and games |
| POST | `/api/tournaments` | Admin | `{ name, format }` creates a tournament |
| POST | `/api/tournaments/:id/join` | Member | Registers the member's linked account |
| POST | `/api/tournaments/:id/generate-round` | Admin | Pairs the next round |
| POST | `/api/tournaments/:id/matches/:matchId/result` | Admin | `{ result: "white" \| "black" \| "draw" }` |
| POST | `/api/tournaments/:id/finish` | Admin | Closes the tournament once all results are in |
| DELETE | `/api/tournaments/:id` | Admin | Deletes the tournament with its registrations and games (players are kept) |
| GET | `/health` | Public | Liveness check (also pings the database) |

Socket.IO event `player_updated` carries a player's updated profile.

## Deployment

- **Web app:** Vercel. Set the variables from `client/.env.example`. `NEXT_PUBLIC_API_URL` is baked in at build time.
- **API:** an always-on Node host (Render, Railway, Fly.io or a VPS). The Socket.IO server and the sync job need a long-running process, so serverless functions won't work, and free tiers that sleep will pause the sync. Build with `npm run build`, start with `npm start`, and run `npx prisma migrate deploy` on each release. Set `CLIENT_ORIGIN` to the web app's URL.
- **Database:** Neon or Supabase Postgres (add `?pgbouncer=true` when using a pooled connection string). **Cache:** Upstash Redis (optional).
- **OAuth:** register `<web app URL>/api/auth/callback/<provider>` as the redirect URI for each provider.

## License

MIT. See [LICENSE](./LICENSE).
