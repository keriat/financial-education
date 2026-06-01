# Kopilka — lei tracker (Next.js + Supabase)

A small app I built for my two children to teach financial literacy. You award lei for chores and routines (positive-only — nothing is ever taken away). Money can be moved into a "growth" bucket that compounds weekly (default 20%/week), withdrawn back any weekday, or paid out as cash. Full history and settings are inside the app.

## What you need

- Node.js 18+ (20 recommended)
- A free [Supabase](https://supabase.com) project

## 1. Set up Supabase

1. Create a project on supabase.com.
2. Open **SQL Editor → New query**, paste the contents of `supabase/schema.sql`, and click **Run**. This creates the tables, RPC functions, starter kids (Eva, Seryozha), and the chore list — all with strict Row Level Security and validated server-side functions.
3. Create a parent account: **Authentication → Users → Add user → Create new user**. Use any email and a long password. Set **Auto Confirm User** so you don't need to verify by email. You can create one shared account for both parents, or one per parent.
4. *(Optional)* Auto-charge interest every Monday: **Database → Extensions** → enable `pg_cron`, then uncomment the last `select cron.schedule(...)` line in `schema.sql` and run it. If you skip this, the app catches up missed weeks on every open (the function is idempotent — it won't double-charge).

## 2. Configure local environment

**Project Settings → API**, copy `Project URL` and the `anon public` key. Create a `.env.local` file:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

## 3. Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000 and sign in with the parent account you created.

## 4. Deploy to Vercel

1. Push the repo to GitHub.
2. In Vercel, **Add New → Project**, import the repo.
3. Under **Environment Variables**, add the same `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. Deploy.
5. In Supabase → **Authentication → URL Configuration**, add your Vercel production URL to **Site URL** and **Redirect URLs**.

## How it works

- **Earn buttons** on each kid card add lei to "Available". The chore list and amounts are editable in ⚙︎ Settings.
- **"To growth →" / "← Withdraw"** moves money between "Available" and "Growth".
- **Interest** accrues weekly on the "Growth" balance every Monday (default 20% — change in Settings). Want to take the interest out? Just withdraw it. Leave it and it keeps compounding.
- All operations are logged. **"Pay out cash"** zeroes the available balance and records the payout.

## Security model

This app is designed for a **private family deploy** with the following protections:

- **Authentication required.** The app shows a login screen until you sign in with a Supabase Auth account. There is no public registration — only accounts you create in the Supabase dashboard can log in.
- **Strict Row Level Security.** Tables are readable only to the `authenticated` role. Direct writes from the client are denied.
- **All writes go through validated `SECURITY DEFINER` functions.** Amounts are clamped server-side (no negative earns, no oversized values, no fractional cents). The interest rate is bounded to 0–100%. Names and labels have length limits.
- **Tight HTTP headers**: HSTS, `X-Frame-Options: DENY`, strict referrer policy, content security policy, permissions policy. See `next.config.js`.
- **No service-role key** is used or shipped — only the anon key, which on its own can do nothing without a logged-in session.

### Recommended for production

- Use a **long, random password** for the parent account(s). The login form is the entire perimeter.
- In Supabase → **Authentication → Rate Limits**, lower the sign-in attempts limit to discourage brute force.
- In Supabase → **Authentication → Policies**, disable public sign-ups if it isn't already disabled (Authentication → Providers → Email → **Enable email signups → off**).
- Optionally enable **Vercel Password Protection** (Pro plan) as a second layer.
- Keep `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel env vars only — never commit `.env.local`.

### Known residual risk

We pin `next@14.2.35` (latest patch in the 14.x line). Some advisories that apply to 14.x are only fully resolved in Next 15+ — they cover features this app does not use (image optimizer, middleware, rewrites, WebSocket upgrades, beforeInteractive scripts, Pages Router, CSP nonces). Bumping to Next 15+ requires a React 19 migration; if you'd like to do that, fork and test thoroughly.

## Stack

Next.js 14 (App Router) · TypeScript · @supabase/supabase-js · plain CSS. Fonts: Comfortaa + Nunito (with Cyrillic). UI strings are in Russian.

## Scripts

```bash
npm run dev        # local dev server
npm run build      # production build
npm run start      # serve the production build
npm run lint       # next lint
npm run typecheck  # tsc --noEmit
```
