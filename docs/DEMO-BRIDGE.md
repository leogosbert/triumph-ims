# Demo mode for the LeMo Demonstrator

The LeMo Command Center's Demonstrator shows LeMoSp on a "big table": several devices side by side, each signed in as a
different person of one made-up company, playing a story step by step. Demo mode is how the table drives the app.

## When it is on

Only in a build with `NEXT_PUBLIC_DEMO_BRIDGE=1`, never when `NEXT_PUBLIC_APP_ENV=production`, and only for the parent
pages listed in `NEXT_PUBLIC_DEMO_PARENT_ORIGINS` (exact addresses, e.g. `https://lemo-command-center.netlify.app`).
The live site sets none of these, so nothing changes there. The rules are in `src/demoBridge/demoConfig.ts`.

## What changes in a demo build

- **Framing:** `frame-ancestors` lists the Command Center's addresses instead of `'none'`, and `X-Frame-Options` is
  left out (`next.config.ts`).
- **Sign-in cookies:** `SameSite=None; Secure; Partitioned`, because browsers only give a framed site its cookies that
  way. Partitioned keeps them to the table.
- **One address per seat:** the sign-in is a cookie, and one browser shares a cookie between every frame of one
  address. So each seat opens the app at its own address: Netlify deploy aliases on the demo site
  (`https://<seat>--<site>.netlify.app`, from `netlify deploy --alias <seat>`), or `http://<seat>.localhost:3000` on a
  computer. The table builds these addresses itself (its kit sets `seatAddress: 'own'`).
- **The bridge** (`src/demoBridge/bridge.ts`, `DemoBridge.tsx`, added to the root layout only in demo builds): answers
  the table's commands (sign in through `/login`, open a page, press, fill, choose, highlight) from the listed parent
  page only, and tells the table what happens. It never sends field values or passwords back. The protocol is the
  Command Center's `docs/demonstrator/BRIDGE_PROTOCOL.md`; `protocol.ts`, `dom.ts` and `bridge.ts` are the same files
  as in the other LeMo apps.

Demo passwords are kept for the team in the Command Center, never in this repository.

## The demo company

Leo's decision (2026-10-30): the Demonstrator's company lives inside the live project as a **kept demo**:
`is_demo` (sample data, never billed, no emails or pushes) with no expiry, so the scheduled purge leaves it and nobody
can end, reset or switch it from the app (`supabase/migrations/20261030000100_kept_demos.sql`; its demo bar only says
it is a demonstration company). Only LeMo Tech's six demo logins are members, one per role; a client is added only when
they ask. Made with `scripts/demo/demonstrator-accounts.sql` then `scripts/demo/demonstrator-company.sql` (the demo
manager builds the usual Medium demo, which is then kept, renamed "Mwanga Supplies Ltd (DEMO)" and joined by the others).
To remove it, give it an expiry; the purge then takes it.

## Tests

`npm run test:demo` (`scripts/test-demo.ts`): off by default, refused on the live site, exact addresses only, the seat
read from the address, and the cookie and framing rules. `supabase/tests/stage21_kept_demos_test.sql`: the kept demo
is built, has one member per role, survives the purge and Exit demo, takes a client but never a guest, and ordinary
demos are unchanged.
