# LeMoSp — notes for anyone (human or AI) changing this code

- **Product philosophy:** read [docs/PRODUCT-VISION.md](docs/PRODUCT-VISION.md) before designing any change.
  "Start Simple, Grow With Your Business": one platform; Small / Medium / Enterprise are progressive operating
  modes, not separate apps. Business level sets the default experience; features can be switched on individually.
  Never lose data on level changes. Recommendations must be contextual and the owner stays in control.
- **Roadmap:** [docs/ROADMAP.md](docs/ROADMAP.md).
- **Stack:** Next.js 15 App Router (server components + server actions), Supabase Postgres with RLS, Netlify.
- **Database rules:** every table has RLS; every function is `security definer set search_path = ''` (or invoker)
  with explicit grants; status changes go through functions; tests in `supabase/tests` must pass on both the normal
  and the locked-down variant (`revoke execute ... from public` by default).
- **Two-step policy:** membership checks go through `public.is_member` / `public.has_role` (they enforce
  `require_mfa`). Never check `memberships` directly in a new policy.
- **Text:** screen text is English keys wrapped in `tr()` / `useTr()`; Kiswahili lives in `src/lib/sw.ts`.
- **Owner workflow:** Claude writes code and pushes; the owner runs SQL in Supabase and tests on phone/laptop.
