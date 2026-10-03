# TRIUMPH IMS

Phone-first system for a general supply company: clients, suppliers, products, RFQs, quotations, purchasing, stock,
deliveries, invoices and payments. It is built for many companies from day one: each company's data is kept apart by
the database itself, and each has its own branding and settings.

**Built with:** Next.js (the app) · Supabase (database, sign-in, file storage) · Vercel (hosting).

## Stages

| Stage | What it adds | Status |
| --- | --- | --- |
| 0 | Accounts and setup | In progress |
| 1 | Sign-in, company settings and branding, team and roles, activity log | **Built, ready to test** |
| 2 | Clients, suppliers, products (spreadsheet import) | Next |
| 3 | Client RFQs, quotations with PDF, approvals | |
| 4 | Supplier RFQs, comparison, purchase orders | |
| 5 | Goods received, stock, deliveries, proof of delivery (offline) | |
| 6 | Invoices, payments, receivables and payables, profit | |
| 7 | Dashboard, notifications, email | |
| 8 | Go-live: security review, backups, data import, training | |

## First-time setup

**TRIUMPH's values** (safe to share; the publishable key only works within the database security rules):

| Setting | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://ocewtmyvddszgebbhxak.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_gP-oEbo7273JYMsQccJABA_EFTmahMx` |
| `NEXT_PUBLIC_SITE_URL` | `https://ims.triumphsuppliers.co.tz` (use the `….vercel.app` address until the domain is connected) |

### 1. Database (Supabase)

1. In your Supabase project, open **SQL Editor → New query**.
2. Paste the whole of `supabase/migrations/20261003000100_stage1_foundation.sql` and press **Run**. It should finish with
   "Success. No rows returned". Run each migration once, in file-name order. Later stages add new files.
3. **Authentication → URL Configuration**
   - **Site URL:** your app address, e.g. `https://triumph-ims.vercel.app`
   - **Redirect URLs:** add `http://localhost:3000/**`, `https://*.vercel.app/**` and `https://ims.triumphsuppliers.co.tz/**`
4. **Authentication → Emails → Templates**. Change the link in two templates so email links work on any phone:
   - *Confirm signup*: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/`
   - *Reset password*: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/account?reset=1`

   Supabase's built-in email only sends a few messages an hour. That is fine for testing. Stage 7 connects a proper
   email service.

### 2. Run it on your laptop (optional, but useful)

```bash
npm install
cp .env.example .env.local     # then fill in the Supabase URL and anon key
npm run dev                    # open http://localhost:3000
```

After the first `npm install`, commit the generated `package-lock.json` so every build uses the same versions.

### 3. Hosting (Vercel)

1. **Add New → Project**, and import the `triumph-ims` GitHub repository.
2. Under **Environment Variables**, add:
   - `NEXT_PUBLIC_SUPABASE_URL`: from Supabase → Project Settings → API
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: the anon / publishable key (**never** the service_role key)
   - `NEXT_PUBLIC_SITE_URL`: the Vercel address, e.g. `https://triumph-ims.vercel.app`
3. Press **Deploy**. Every push to `main` redeploys automatically.

### 4. Your own web address

1. Vercel → your project → **Settings → Domains** → add `ims.triumphsuppliers.co.tz`.
2. Vercel shows a DNS record to add, usually a **CNAME** named `ims` pointing to a `vercel-dns.com` address. Add exactly
   what it shows in the DNS settings at the company that registered `triumphsuppliers.co.tz`.
3. When Vercel shows the domain as valid (minutes to a few hours), update `NEXT_PUBLIC_SITE_URL` in Vercel and the
   **Site URL** in Supabase to `https://ims.triumphsuppliers.co.tz`, then redeploy.

### 5. Install on a phone

Open the app address in Chrome (Android) or Safari (iPhone), then use **Add to Home Screen**.

## Testing Stage 1

1. Create an account, confirm the email, and create **TRIUMPH General Suppliers Ltd**. You become its manager.
2. **Settings → Company details:** add the TIN, address, phone and bank details, upload the logo, and change the colours.
   The top bar should change colour.
3. **Settings → Team:** invite a second email address you own, as *Sales*.
4. In another browser (or a private window), create an account with that second email. It should offer to join TRIUMPH.
   As Sales, check that you **cannot** see Activity or Team, or edit company details.
5. Back as manager: change the Sales person's role, switch their access off, and check that they lose access.
6. **Activity** shows each of these changes with who made them and when.

## Checks

Every push runs the automatic checks in `.github/workflows/ci.yml`:

- **Database rules:** about 40 tests prove that each company sees only its own data and each role only what it should.
- **App build:** compiles and type-checks the whole app.

To run the database tests locally, you need Postgres 16:
`PGHOST=localhost PGUSER=postgres npm run test:db`.

## How the code is organised

```
supabase/migrations/   database structure and security rules, one file per change, applied in order
supabase/tests/        tests for the security rules
src/app/login …        sign-in, sign-up, password reset, welcome (create or join a company)
src/app/(app)/         the signed-in app: home, settings, team, activity, account
src/lib/               shared helpers: Supabase clients, current user and company, roles, formatting
src/middleware.ts      keeps people signed in, and sends signed-out visitors to /login
```

**Security model:** the app always talks to the database *as the signed-in person*, so the database's row-level
security rules decide what anyone can see or change, whatever the screen shows. The service_role key is never used
in the app.
