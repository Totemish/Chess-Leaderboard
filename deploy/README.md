# Deploying for free: Vercel + Render

The website runs on **Vercel**, the API on **Render**, and the database stays on **Supabase**. All three have free plans, and you don't need to buy a domain: you get addresses like these.

```
https://iitr-chess.vercel.app          ← the website (Vercel)
https://iitr-chess-api.onrender.com    ← the API (Render, Singapore)
Supabase Postgres (Singapore)          ← the database you already have
```

Once it's set up, every push to `main`:
- runs the tests in GitHub Actions;
- redeploys the website on Vercel;
- redeploys the API on Render, but only if `server/` changed and the tests passed.

The paid AWS EC2 alternative, which needs a domain, is in [deploy/ec2/README.md](ec2/README.md).

## Before you start

- The code is pushed to your GitHub repository.
- Your database is up to date (`npx prisma migrate status` in `server/` says "Database schema is up to date!").
- **Make a production secret.** Run this on your computer and keep the output somewhere private:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```
  This is your production `AUTH_SECRET`. Use the **same value** on Render and on Vercel.

## 1. Deploy the API on Render

1. Sign up at **render.com** with your GitHub account, and give Render access to your repository when asked.
2. In the Render dashboard, choose **New → Blueprint** and select your repository. Render reads `render.yaml` and shows a free web service called `iitr-chess-api` in Singapore.
3. Fill in the three values it asks for:
   - `DATABASE_URL`: your Supabase connection string, the same as in `server/.env`.
   - `AUTH_SECRET`: the production secret from above.
   - `CLIENT_ORIGIN`: `https://iitr-chess.vercel.app`. This is a guess at your website's address; you'll correct it in step 3 if Vercel gives you a different one.
4. Click **Apply**. The first build takes about 5 minutes.
5. When it shows **Live**, copy the service's address from the top of its page (e.g. `https://iitr-chess-api.onrender.com`). Open `<that address>/health` in a browser. It should show `{"success":true,"data":{"status":"ok",…}}`.

Optional: under the service's **Environment** tab, add `CHESS_COM_CONTACT` with your email, so Chess.com can contact you before ever rate-limiting the app.

## 2. Deploy the website on Vercel

1. Sign up at **vercel.com** with your GitHub account. The free **Hobby** plan is right for this.
2. Choose **Add New → Project** and import your repository.
3. Next to **Root Directory**, click **Edit** and choose `client`. Vercel detects Next.js automatically.
4. Open **Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `AUTH_SECRET` | the production secret (same as on Render) |
   | `NEXT_PUBLIC_API_URL` | your Render address from step 1, without a trailing `/` |
   | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | from `client/.env.local` |
   | `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` | from a **production** GitHub OAuth app (see step 3) |
   | `AUTH_DISCORD_ID`, `AUTH_DISCORD_SECRET` | from `client/.env.local` |

   Don't add `AUTH_URL`: Vercel works out the site's address itself. You can paste lines from `.env.local` into the form, but leave out `AUTH_URL` and use the Render address for `NEXT_PUBLIC_API_URL`.
5. Click **Deploy**. When it finishes, your address is shown on the project page (e.g. `https://iitr-chess.vercel.app`).

## 3. Connect them

1. **If the Vercel address isn't the one you guessed**, go to Render → `iitr-chess-api` → **Environment**, change `CLIENT_ORIGIN` to the real address, and save. Render restarts the API with the new value.
2. **Sign-in redirect URLs.** Each provider must allow your new address:
   - **Google** (Google Cloud Console → APIs & Services → Credentials → your OAuth client): add `https://<your-vercel-address>/api/auth/callback/google` under *Authorized redirect URIs*.
   - **Discord** (Developer Portal → your app → OAuth2 → Redirects): add `https://<your-vercel-address>/api/auth/callback/discord`.
   - **GitHub** allows only one callback URL per OAuth app, so keep your current app for local development. Create a **second** app (GitHub → Settings → Developer settings → OAuth Apps → New) with the callback `https://<your-vercel-address>/api/auth/callback/github`, and put its ID and secret in Vercel. Then redeploy from Vercel's **Deployments** tab so they apply.

## 4. Keep the API awake (free)

Render's free plan puts the API to sleep after 15 minutes without visitors. While it sleeps, the rating sync stops, and the next visitor waits about a minute. A free uptime monitor prevents that by checking the API every 5 minutes:

1. Sign up at **uptimerobot.com** (free plan).
2. **Add New Monitor** → type **HTTP(s)** → URL `https://<your-render-address>/health` → interval **5 minutes** → **Create**.

You also get an uptime history and an email whenever the API is down. Render gives 750 free hours a month, and one always-on service uses about 744, so **keep this as the only free service in your Render account**.

## 5. Try it

1. Open your Vercel address. The leaderboard is empty until members join.
2. Sign in, go to the **Dashboard**, and link your Chess.com account (the code goes in your Chess.com profile's Location field).
3. **Make yourself admin:** in `server/` on your computer, run `npx prisma studio`. It uses the same Supabase database. Open **User** and set your `role` to `ADMIN`.

## Everyday use

| Task | How |
|---|---|
| Deploy a change | Push to `main`. Watch it under **Actions** on GitHub, and on Vercel and Render. |
| API logs | Render → `iitr-chess-api` → **Logs** |
| Website logs | Vercel → project → **Logs** |
| Add or remove players | On your computer, in `server/`: `npm run players -- list` (same database) |
| Change a setting | Render → **Environment**, or Vercel → **Settings → Environment Variables** (then redeploy) |

Optional: Vercel rebuilds the website on every push, even when only `server/` changed. To skip those, open Vercel → **Settings → Git → Ignored Build Step**, choose **Custom**, and enter `git diff --quiet HEAD^ HEAD -- .`

## Limits to know

- **Cost:** $0. Vercel's Hobby plan is for non-commercial projects, which this is.
- **Render free instance:** 512 MB of memory, plenty for this API. Render may occasionally restart it; the uptime monitor wakes it again within 5 minutes.
- **Supabase free:** it pauses a project after a week with no activity. The API's 10-minute rating sync counts as activity, so with the uptime monitor running, it stays awake.
- Free plans can change their terms. If one does, the same code also runs on the EC2 setup or any Docker host.
