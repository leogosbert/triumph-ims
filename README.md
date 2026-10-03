# TRIUMPH IMS

Phone-first system for a general supply company: clients, suppliers, products, RFQs, quotations, purchasing, stock,
deliveries, invoices and payments. It is built for many companies from day one: each company's data is kept apart by
the database itself, and each has its own branding and settings.

**Built with:** Next.js (the app) · Supabase (database, sign-in, file storage) · Netlify (hosting).

## Stages

| Stage | What it adds | Status |
| --- | --- | --- |
| 0 | Accounts and setup | Done |
| 1 | Sign-in, company settings and branding, team and roles, activity log | Done |
| 2 | Clients, suppliers, products (forms and spreadsheet import) | **Built, ready to test** |
| 3 | Client RFQs, quotations with PDF, approvals | Next |
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
| `NEXT_PUBLIC_SITE_URL` | `https://ims.triumphsuppliers.co.tz` (use the `….netlify.app` address until the domain is connected) |

### 1. Database (Supabase)

1. In your Supabase project, open **SQL Editor → New query**.
2. Paste the whole of `supabase/migrations/20261003000100_stage1_foundation.sql` and press **Run**. It should finish with
   "Success. No rows returned". Run each migration once, in file-name order. Later stages add new files.
3. **Authentication → URL Configuration**
   - **Site URL:** your app address, e.g. `https://triumph-ims.netlify.app`
   - **Redirect URLs:** add `http://localhost:3000/**`, `https://*.netlify.app/**` and `https://ims.triumphsuppliers.co.tz/**`
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

### 3. Hosting (Netlify)

1. In Netlify, choose **Add new project → Import an existing project → GitHub**, and pick `leogosbert/triumph-ims`.
   Allow Netlify to access the repository if asked.
2. Netlify reads the build settings from `netlify.toml`, so leave them as they are. You can rename the project to
   `triumph-ims` so the address becomes `https://triumph-ims.netlify.app`, if that name is free.
3. Before the first deploy, or under **Project configuration → Environment variables** afterwards, add:
   - `NEXT_PUBLIC_SUPABASE_URL`: from Supabase → Project Settings → API
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: the anon / publishable key (**never** the service_role key)
   - `NEXT_PUBLIC_SITE_URL`: the Netlify address, e.g. `https://triumph-ims.netlify.app`
4. **Deploy**. If you added the variables after the first deploy, go to **Deploys → Trigger deploy → Deploy project** so
   they take effect. From then on, every push to `main` redeploys automatically.

### 4. Your own web address

1. Netlify → your project → **Domain management → Add a domain** → enter `ims.triumphsuppliers.co.tz`.
2. Netlify shows the DNS record to add, a **CNAME** named `ims` pointing to your `….netlify.app` address. Add exactly
   what it shows in the DNS settings at the company that registered `triumphsuppliers.co.tz`.
3. Once the domain is verified, Netlify adds the HTTPS certificate itself (minutes to a few hours). Then update
   `NEXT_PUBLIC_SITE_URL` in Netlify and the **Site URL** in Supabase to `https://ims.triumphsuppliers.co.tz`, and
   trigger a new deploy.

### 5. Install on a phone

Open the app address in Chrome (Android) or Safari (iPhone), then use **Add to Home Screen**.

## Database updates per stage

Run each file **once**, in order, in Supabase → SQL Editor (paste the file's *contents*, then Run):

| File | Stage |
| --- | --- |
| `supabase/migrations/20261003000100_stage1_foundation.sql` | 1 |
| `supabase/migrations/20261003000200_stage1_grants.sql` | 1 (access fix) |
| `supabase/migrations/20261004000100_stage2_master_data.sql` | 2 |

## Testing Stage 2

1. **More → + New client:** add a client. It gets the ID `C-0001` automatically. Add a purchasing contact.
2. Add a supplier and a product the same way. On the product, set the main supplier and last cost, and check the
   margin.
3. **More → Import from spreadsheet:** download the template, fill a few rows on each tab, and import it. Import the
   same file again: the records are *updated*, not duplicated.
4. Sign in as the *Sales* test user. Sales **can** add clients and products, but **cannot** see suppliers or costs, or
   set a credit limit.
5. **Activity** shows every client, supplier and product change.

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
