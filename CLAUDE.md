# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # local dev server on :3000
npm run build      # production build
npm run start      # serve the production build
npm run lint       # next lint (eslint-config-next)
npm run typecheck  # tsc --noEmit
```

There is no test suite. To verify changes: run `npm run typecheck` and `npm run build`. The build is fully static (all routes prerender), so build failures catch most issues.

`next build` needs the Supabase env vars to be set even though everything is static — set placeholders if you're just checking compile:
```bash
NEXT_PUBLIC_SUPABASE_URL=https://x.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=test npx next build
```

## Architecture

This is a small Next.js 14 (App Router) + Supabase app. The whole codebase is roughly five source files plus a SQL schema — the architectural weight is in the security model, not the code.

### The core rule: clients cannot write directly

Row Level Security is configured so the `authenticated` role gets `SELECT` on tables and **nothing else**. Every mutation — earning lei, moving to/from savings, paying out, weekly interest, renaming a kid, setting the rate, editing chores, resetting state — goes through a `SECURITY DEFINER` function declared in `supabase/schema.sql`. The client calls them via `supabase.rpc("name", {...})`.

When adding a new mutation:
1. Add a `SECURITY DEFINER` function in `supabase/schema.sql` with server-side bounds and `set search_path = public`.
2. Add it to the `grant execute on function ... to authenticated` allowlist at the bottom of the schema.
3. Call it from `app/page.tsx` via `supabase.rpc(...)`. Re-clamp the input on the client too (defense in depth).

Never add `insert`/`update`/`delete` grants to `authenticated`. Never write to tables directly from the client.

### Schema is the source of truth, and it's hand-applied

There is no migration tool. `supabase/schema.sql` is run by hand in the Supabase SQL editor. It is idempotent (uses `create ... if not exists`, `create or replace function`, and drops/recreates RLS policies in a `do $$ ... $$` block) so re-running it is safe and is how you "deploy" schema changes.

A stub `schema.sql` at the repo root just points to `supabase/schema.sql` — ignore it; the real schema only lives under `supabase/`.

### Auth gate

`app/page.tsx` is a client component. It calls `supabase.auth.getSession()` on mount, subscribes to `onAuthStateChange`, and renders `<Login />` (`app/login.tsx`) until a session exists. No middleware, no server-side session handling — sessions are persisted in `localStorage` under key `kopilka.auth` (see `lib/supabase.ts`).

Parent accounts are created in the Supabase dashboard, not in the app. There is intentionally no sign-up flow.

### Interest is idempotent and client-triggered

`apply_interest()` is called from the client on every page load (`useEffect` in `app/page.tsx`). It calculates missed weeks since `savings_anchor` and catches up; calling it repeatedly is a no-op once the anchor matches the current Monday. The optional `pg_cron` job in `supabase/schema.sql` is a backup, not the primary mechanism.

### Pinned to Next 14.2.35 deliberately

Do not bump to Next 15 or 16 without a planned React 19 migration. The README's "Known residual risk" section documents which CVEs still apply to 14.x and why they don't matter for this app's feature surface (no image optimizer, no middleware, no rewrites, no Pages Router, no `beforeInteractive` scripts, no WebSocket upgrades, no CSP nonces).

### UI strings are Russian on purpose

This is a private app for the author's family. Code, comments, commits, and docs are in English; user-facing UI strings stay in Russian. Don't translate them when refactoring.

## Files at a glance

- `supabase/schema.sql` — single source of truth: tables, RPCs, RLS, grants.
- `app/page.tsx` — the entire app UI (kid cards, settings modal, confirm modal).
- `app/login.tsx` — email/password login form.
- `app/layout.tsx` — fonts (Comfortaa + Nunito with Cyrillic) and viewport.
- `lib/supabase.ts` — Supabase client with persistent session.
- `lib/types.ts` — `Kid`, `Action`, `Tx` row types matching the schema.
- `next.config.js` — security headers (CSP, HSTS, X-Frame-Options, etc.); the CSP `connect-src` is derived from `NEXT_PUBLIC_SUPABASE_URL` at build time.
