# ♟️ IITR Chess Leaderboard

A live leaderboard and tournament manager for IIT Roorkee's chess community. It tracks every member's Chess.com rating in Rapid, Blitz and Bullet, pushes rating changes to open browsers as they happen, and runs club Swiss tournaments with optimal pairings.

## Features

| Feature | Details |
|---|---|
| **Leaderboards** | Rapid, Blitz and Bullet rankings with standard competition ranking (tied ratings share a rank), search, and 90-day rating charts |
| **Live updates** | The server re-syncs every player from Chess.com every 10 minutes and pushes changes over Socket.IO; the changed rank square lights up like a chessboard's last-move highlight |
| **Verified sign-up** | Members sign in with Google, GitHub or Discord. Joining requires a verified IIT Roorkee email (`@iitr.ac.in` or a department address such as `@ece.iitr.ac.in`) and proof of ownership of the Chess.com account |
| **One account per person** | Every sign-in method with the same verified IITR email opens the same member, with the same Chess.com link and role |
| **Account changes handled** | Accounts Chess.com closes or bans leave the leaderboard, missing ones after a day's grace, and renamed ones keep their history; nothing is deleted |
| **Swiss tournaments** | Pairings by minimum-cost perfect matching (Edmonds' blossom algorithm), FIDE-style colour allocation and byes, Buchholz tie-breaks, and a crosstable |
| **Safe under concurrency** | Every tournament write runs in a transaction behind a row lock; standings are recomputed from the games, never incremented |
| **Admin tools** | Admins create tournaments, choose each event's players, pair rounds, enter and correct results, finish events, and manage the leaderboard |

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
   3. score difference, squared (two half-point floats beat one full-point float). As in the FIDE Dutch rules, a bye is measured against a virtual opponent one point below the lowest score, so it goes to the lowest score group even when that costs other floats
   4. strong colour preference
   5. mild colour preference
   6. Dutch-system order (top half of a score group meets the bottom half)

   Each tier's unit cost is larger than the worst possible total of all lower tiers, so minimising the sum minimises the rules in that order.
2. **Edmonds' blossom algorithm** (`domain/matching/blossom.ts`, O(n³)) finds the optimal perfect matching. The Hungarian algorithm can't be used: pairing graphs aren't bipartite, so odd cycles ("blossoms") must be handled.
3. Colours follow the FIDE Dutch rules: grant both preferences, otherwise the stronger one, otherwise alternate from the last round the players differed, otherwise the higher-ranked player gets theirs.

Rematches are very expensive but not forbidden, so a round can always be paired; a rematch only happens when no other pairing exists. Each round is optimal on its own, so a field of 5–6 players playing nearly an all-play-all can run out of clean pairings in its last rounds; the admin page warns when a round goes past *players − 2*.

**Verified by tests:** the blossom implementation matches an exact brute-force optimum on 6,000 random graphs. The pairing engine matches an exact subset-DP oracle on rematches, colour clashes and score gaps across ~2,300 simulated rounds, and no player exceeds FIDE colour limits at typical event lengths. An integration test plays a whole 9-player, 5-round event through the service and the database and checks every rule: one board per player per round, no rematches or second byes, FIDE colour limits, stored standings equal to a fresh computation, and the published order.

Standings (`domain/standings.ts`) are recomputed from the games after every change. Buchholz is the sum of opponents' scores, and a bye counts as an opponent with the player's own score. Players are ranked by points, then Buchholz, then seed rating; the crosstable shows both numbers so the order can be checked.

**Running an event.** Admins build the field from the leaderboard and can add or remove players until round 1 is paired, so nobody can enter an event just to disrupt it. A result entered by mistake can be corrected while its round is the latest one; earlier rounds are fixed, because later pairings were made from them.

## Data integrity

- **One writer per tournament.** Adding or removing players, pairing, entering or correcting results, and finishing each start with a conditional `UPDATE` on the tournament row, which locks it until the transaction commits. Concurrent requests for the same tournament run one after another and see each other's changes.
- **No double counting.** A result is saved with a conditional update (`WHERE status = 'PENDING'`), and scores are derived from games rather than incremented.
- **One member per person, without locks.** A first sign-in creates or joins its member through upserts keyed on unique columns (`Identity.authId`, `User.instituteEmail`), which Postgres runs as `INSERT … ON CONFLICT`. If two first sign-ins race, both land on the same rows. Any other collision fails on a unique index and is retried (optimistic concurrency).
- **Integration tests** fire concurrent duplicate results, double "Pair" clicks, parallel results and racing first sign-ins, and check the outcomes.

## Members and sign-ins

A member (`User`) is one person; each Google, GitHub or Discord account they sign in with is an `Identity` (one-to-many, like Auth.js's own User/Account tables). The member holds the Chess.com link and the admin role, so every way in reaches the same account.

- The member is identified by their **verified institute email**. A sign-in seen for the first time joins the member who already has that address. With GitHub or Discord, it must be the account's main email.
- Sign-ins without a verified institute email are never merged into anyone. Merging trusts exactly what joining already trusts, nothing more.
- The ownership code is an HMAC of the member and the username, so it's the same whichever way the member signs in.

## When a Chess.com account changes

Players are never deleted automatically. Each sync moves a player through a small state machine (`domain/player-status.ts`), and only `ACTIVE` players are ranked:

| Chess.com says | Result |
|---|---|
| The account is closed | `CLOSED` at once (or `CLOSED_FAIR_PLAY` for a cheating ban) |
| No such player | Still listed for a 24-hour grace period, since one bad answer can be an outage; then `MISSING` |
| The account is back | `ACTIVE` again: automatic hides undo themselves |

- **Renames.** Chess.com gives every account a permanent `player_id`, which is stored with the player. When a renamed account turns up under its new name, its row moves to that username. `ON UPDATE CASCADE` carries the rating history, tournament games and member link along: the username is a natural key, and the `player_id` is what proves it's the same account.
- **Admin removals** (`REMOVED`) stick through syncs until an admin adds the player again or the owner links the account again.
- **Hidden players keep everything** (soft delete). Their history stays, past crosstables still show them, and their member sees why on the dashboard, with a button to link another account. They can't join new tournaments.
- **Live pages refetch on structural changes.** Open pages patch a row on `player_updated`, and refetch the board on `leaderboard_changed` (a player joined, left or was renamed).

## Joining the leaderboard

The leaderboard starts empty: every player comes from the database, and members add themselves.

1. Sign in with an account whose IIT Roorkee email the provider has verified: `@iitr.ac.in` or a department subdomain such as `@ece.iitr.ac.in` (the check matches whole domain labels, so `@notiitr.ac.in` doesn't pass). With GitHub or Discord, that address must be the account's main email.
2. On the dashboard, enter your Chess.com username. The API returns a code, an HMAC of your account and the username, so it needs no storage and only works for you.
3. Put the code in the **Location** field of your Chess.com profile and press **Verify**. The API reads it back from Chess.com, adds you to the leaderboard and links the account. You can then remove the code.

If an admin already added your Chess.com account, linking claims that existing row, so your rating history and tournament entries stay. The code is still needed: it proves the account is yours.

Admins can also add or remove players directly (see [Managing players](#managing-players)), for example someone who hasn't signed up.

## Tech stack

| Area | Technology |
|---|---|
| Web app | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, SWR, Recharts, Framer Motion, Auth.js v5 |
| API | Node.js, Express 5, TypeScript, Socket.IO, node-cron, Prisma 6, jsonwebtoken |
| Data | PostgreSQL, Redis (optional cache) |
| Tests | Node's built-in test runner (`node:test`) |
| Deployment | Vercel, Render (Docker), GitHub Actions CI; optional AWS EC2 with Docker Compose and Caddy |

## Project structure

```
.github/workflows/           ci.yml: tests on every push; deploy-ec2.yml: optional manual EC2 deploy
render.yaml                  Render Blueprint for the API
deploy/                      deployment guide (Vercel + Render); ec2/ holds the optional EC2 setup
client/                      Next.js web app (Dockerfile builds a standalone server)
  src/app/                   routes: leaderboard, tournaments, dashboard, sign-in, API proxy
  src/components/            leaderboard, tournaments (pairings, crosstable), dashboard, charts, ui
  src/lib/                   API client, auth config, chess and tournament helpers
server/                      Express API (Dockerfile; migrations run on container start)
  index.ts                   composition root: wires dependencies, CORS, shutdown
  config.ts                  environment, validated at startup
  domain/                    pure, unit-tested logic
    matching/blossom.ts      maximum-weight matching (Edmonds)
    pairing/                 Swiss engine, colour rules, PairingStrategy interface
    standings.ts             scores and Buchholz
    ownership.ts             account-ownership codes
    institute.ts             which emails count as IIT Roorkee addresses
    player-status.ts         when players leave and rejoin the leaderboard (state machine)
  services/                  MemberService, TournamentService, Chess.com client and sync, cache, cron
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
npm run players -- list                         # every player, and why any are hidden
npm run players -- add hikaru magnuscarlsen     # add by Chess.com username (also restores a removed one)
npm run players -- remove hikaru                # preview
npm run players -- remove hikaru --yes          # take off the leaderboard, keeping history and results
npm run players -- remove hikaru --purge --yes  # delete with their history (refused if they've played a tournament)
```

Both kinds of removal unlink the player's member account. Purging someone who has played in a tournament is refused: their games would lose a player and count as byes, rewriting those standings. In production, use `node dist/scripts/players.js <command>` after building.

### Making someone an admin

Admin status lives in the database, on the member. Open `npx prisma studio` in `server/`, find the member in `User` by their `instituteEmail` (after they've signed in once), and set `role` to `ADMIN`. Every way they sign in is then an admin.

## Tests

```bash
cd server
npm test                    # unit tests: matching, pairing, standings, ownership codes, emails, player status
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
| GET | `/api/players` | Public | Every player on the leaderboard |
| GET | `/api/players/:username` | Public | One player with rating history (`?days=`, default 365), including players off the leaderboard; `status` says which |
| GET | `/api/auth/me` | Member | The member, their sign-in methods, linked profile and 90 days of history |
| POST | `/api/auth/link-profile/challenge` | Member | `{ chessUsername }` → ownership code |
| POST | `/api/auth/link-profile` | Member | `{ chessUsername }` → verifies the code on Chess.com and links |
| DELETE | `/api/auth/unlink-profile` | Member | Unlinks the member's Chess.com account |
| POST | `/api/auth/sync/:username` | Member / Admin | Refresh ratings now: members their own account (once a minute), admins anyone (adds new players) |
| GET | `/api/tournaments` | Public | All tournaments |
| GET | `/api/tournaments/:id` | Public | Tournament with standings and games |
| POST | `/api/tournaments` | Admin | `{ name, format }` creates a tournament |
| POST | `/api/tournaments/:id/players` | Admin | `{ username }` adds a leaderboard player before round 1, seeded by the event's time control |
| DELETE | `/api/tournaments/:id/players/:username` | Admin | Removes a player before round 1 |
| POST | `/api/tournaments/:id/generate-round` | Admin | Pairs the next round |
| POST | `/api/tournaments/:id/matches/:matchId/result` | Admin | `{ result: "white" \| "black" \| "draw" }` enters a result |
| PUT | `/api/tournaments/:id/matches/:matchId/result` | Admin | Corrects a result in the latest round |
| POST | `/api/tournaments/:id/finish` | Admin | Closes the tournament once all results are in |
| DELETE | `/api/tournaments/:id` | Admin | Deletes the tournament with its registrations and games (players are kept) |
| GET | `/health` | Public | Liveness check (also pings the database) |

Socket.IO events: `player_updated` carries a player's updated profile; `leaderboard_changed` (no payload) means a player joined or left the board, or was renamed, so clients refetch it.

## Deployment

The site runs for free on three hosts:

- **Vercel** serves the website.
- **Render** runs the API from `server/Dockerfile`, configured by `render.yaml`, in Singapore next to the database.
- **Supabase** hosts Postgres.

On every push, **GitHub Actions** runs the type-check, the unit tests and the integration tests against a real Postgres. Render deploys the API only after those checks pass, and the API container applies database migrations on startup.

Step-by-step setup: **[deploy/README.md](deploy/README.md)**.

The API needs an always-on process, because the Socket.IO server and the sync job can't run as serverless functions; that's why it lives on Render rather than Vercel.

There is also an optional self-hosted setup on **AWS EC2**: Docker Compose runs both apps behind Caddy for HTTPS, and a manual GitHub Actions workflow builds the images and deploys over SSH. See [deploy/ec2/README.md](deploy/ec2/README.md).

## License

MIT. See [LICENSE](./LICENSE).
