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
- **Roles:** a person has a main role (`memberships.role`, shown as their role) plus optional extra roles
  (`memberships.extra_roles`). Decide access with `can(roles, …)` / `hasRole(roles, …)` using `getAppContext().roles`,
  not `role === …`; in SQL use `public.has_role` (it checks both).
- **Text:** screens are English only (no language switch). Keep wrapping screen text in `tr()` / `useTr()`: they
  return the English as given and stay as the one place to change wording. The AI features still understand
  Kiswahili questions (`src/lib/sw.ts` is kept only as search words for the Ask box); messages to clients
  (reminders, follow-ups) can still be written in Kiswahili.
- **Owner workflow:** Claude writes code and pushes; the owner runs SQL in Supabase and tests on phone/laptop.
