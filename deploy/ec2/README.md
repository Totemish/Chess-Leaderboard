# Deploying to AWS EC2

One EC2 server runs three Docker containers: the website, the API, and Caddy, which serves both over HTTPS with free, auto-renewing certificates. The database stays on Supabase. A manual GitHub Actions workflow builds the Docker images and deploys them to the server. This is the optional alternative to the free Vercel + Render setup in [deploy/README.md](../README.md).

```
                ┌──────────── EC2 server (Ubuntu + Docker) ────────────┐
your domain ──► │ Caddy :443 ─┬─ chess.yourdomain     → web (Next.js)  │
                │             └─ api.chess.yourdomain → api (Express)  │
                └──────────────────────────────────────────────────────┘
                                         │
                                Supabase Postgres

git push ─► GitHub Actions: tests ─► build images (ghcr.io) ─► SSH deploy
```

You'll need: an AWS account, a domain name, and this project on GitHub.

Throughout, replace `chess.yourdomain.com`, `api.chess.yourdomain.com`, `YOUR-IP` and `your-github-username` with your own values.

## 1. Before you start

**Upgrade the database once.** If your Supabase database was created before this project had migrations, run this from the `server/` folder on your computer:

```bash
npx prisma migrate resolve --applied 0_init
```

Without it, the API container stops at startup with error `P3005`. Skip this for a brand-new, empty database.

**Get a domain.** The GitHub Student Developer Pack usually includes one free for a year. You'll use two names on it: one for the website (e.g. `chess.yourdomain.com`) and one for the API (e.g. `api.chess.yourdomain.com`).

## 2. Create the server (AWS console)

1. **Pick the region** in the top-right corner: **Asia Pacific (Singapore) `ap-southeast-1`**. Your Supabase database is there, and every API request talks to the database several times, so keeping them close matters more than being close to India.
2. Go to **EC2 → Launch instance**:
   - **Name:** `iitr-chess`
   - **Image:** Ubuntu Server 24.04 LTS (64-bit **x86**)
   - **Instance type:** `t3.micro`, or `t3.small` if it's marked *Free tier eligible*. Don't pick a `t4g` type: those are ARM processors, and the images are built for x86.
   - **Key pair:** Create new → name it `iitr-chess` → type RSA → format `.pem`. The file downloads once; keep it safe, because it's the only way into the server.
   - **Network settings:** Allow SSH traffic from **Anywhere**, which GitHub Actions needs to deploy. Ubuntu only accepts the key, not passwords. Also tick **Allow HTTPS traffic** and **Allow HTTP traffic** from the internet.
   - **Storage:** 20 GiB gp3.
   - Click **Launch instance**.
3. Give it a fixed address: **EC2 → Elastic IPs → Allocate Elastic IP address → Allocate**. Then **Actions → Associate Elastic IP address**, choose the `iitr-chess` instance, and associate. This IP is `YOUR-IP` from now on.

## 3. Point the domain at the server

At your domain registrar (or Route 53), add two **A records**, both pointing to `YOUR-IP`:

| Name | Type | Value |
|---|---|---|
| `chess` | A | `YOUR-IP` |
| `api.chess` | A | `YOUR-IP` |

Changes can take a few minutes to an hour to spread. Check with `nslookup chess.yourdomain.com`.

## 4. Prepare the server

On Windows, first lock down the key file. OpenSSH refuses keys that other users can read. In PowerShell, in the folder with the `.pem`:

```powershell
icacls .\iitr-chess.pem /inheritance:r /grant:r "$($env:USERNAME):R"
```

Copy the setup script to the server and run it. Run these from the project folder:

```bash
scp -i path/to/iitr-chess.pem deploy/ec2/setup-server.sh ubuntu@YOUR-IP:~
```
```bash
ssh -i path/to/iitr-chess.pem ubuntu@YOUR-IP
```

Then, on the server:

```bash
sh setup-server.sh
```

It installs Docker, adds 2 GB of swap, and creates `/opt/iitr-chess`. Type `exit`, then reconnect with the same `ssh` command so Docker works without `sudo`.

## 5. Add the configuration files to the server

Make three files on your computer inside `deploy/ec2/`. They are git-ignored, so they will never be committed:

- `deploy/ec2/.env`: copy `deploy/ec2/.env.example` and set your two domains and your GitHub username in **lowercase**.
- `deploy/ec2/api.env`: copy `deploy/ec2/api.env.example` and fill in your Supabase `DATABASE_URL`, `AUTH_SECRET`, and `CLIENT_ORIGIN=https://chess.yourdomain.com`.
- `deploy/ec2/web.env`: copy `deploy/ec2/web.env.example` and fill in the same `AUTH_SECRET`, `AUTH_URL=https://chess.yourdomain.com`, and your OAuth IDs and secrets.

Upload them:

```bash
scp -i path/to/iitr-chess.pem deploy/ec2/.env deploy/ec2/api.env deploy/ec2/web.env ubuntu@YOUR-IP:/opt/iitr-chess/
```

## 6. Connect GitHub Actions to the server

In your GitHub repository, open **Settings → Secrets and variables → Actions**.

Under **Secrets**, add:

| Name | Value |
|---|---|
| `EC2_HOST` | `YOUR-IP` |
| `EC2_SSH_KEY` | The entire contents of `iitr-chess.pem`, including the `-----BEGIN` and `-----END` lines |

Under **Variables**, add:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.chess.yourdomain.com` |

## 7. Deploy

Open **Actions → Deploy to EC2 → Run workflow**. (Pushes to `main` only run the tests; deploying to EC2 is manual, so it never conflicts with Vercel + Render.) The workflow:

1. builds both Docker images and pushes them to `ghcr.io/your-github-username/`;
2. copies `docker-compose.yml` and `Caddyfile` to the server, pulls the new images, and restarts the containers.

The tests run separately, in the CI workflow, on every push. Check that the latest commit's CI run passed before deploying.

The first run takes about 10 minutes, and later runs are faster thanks to caching. Then open `https://chess.yourdomain.com`. The first visit can take a few seconds while Caddy gets the HTTPS certificate.

## 8. After the first deploy

1. **OAuth redirect URLs.** In each provider's developer console, add the production callback URL:
   - Google: `https://chess.yourdomain.com/api/auth/callback/google`
   - GitHub: `https://chess.yourdomain.com/api/auth/callback/github`
   - Discord: `https://chess.yourdomain.com/api/auth/callback/discord`
2. **Make yourself admin.** Sign in on the site once, then run `npx prisma studio` in `server/` on your computer (it uses the same Supabase database), open **User**, and set your `role` to `ADMIN`.

## Everyday operations

Run these on the server (`ssh` in, then `cd /opt/iitr-chess`):

| Task | Command |
|---|---|
| See what's running | `docker compose ps` |
| Follow the API's logs | `docker compose logs -f api` |
| HTTPS or certificate problems | `docker compose logs caddy` |
| Restart everything | `docker compose up -d` |
| Roll back to an earlier build | set `IMAGE_TAG=<commit SHA>` in `.env`, then `docker compose up -d` |
| Manage players | `docker compose exec api node dist/scripts/players.js list` |

## Costs

- On AWS's free plan, everything here is paid from the sign-up credits. Check **Billing → Free tier** in the console.
- After the free period, expect about $10 a month: the instance plus its public IPv4 address. Supabase and GitHub Actions stay free at this size.
- To stop paying, terminate the instance **and** release the Elastic IP. An unattached Elastic IP is still charged.
