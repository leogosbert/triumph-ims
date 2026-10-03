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
| 2 | Clients, suppliers, products (forms and spreadsheet import) | Done |
| 3 | Client RFQs, quotations with PDF, approvals | Done |
| 4 | Supplier RFQs, comparison, purchase orders | Done |
| 5 | Goods received, stock, deliveries, proof of delivery (offline) | Done |
| 6 | Invoices, payments, receivables and payables, profit | **Built, ready to test** |
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
| `supabase/migrations/20261005000100_stage3_quotations.sql` | 3 |
| `supabase/migrations/20261006000100_stage4_purchasing.sql` | 4 |
| `supabase/migrations/20261007000100_stage5_stock_deliveries.sql` | 5 |
| `supabase/migrations/20261008000100_stage6_finance.sql` | 6 |

## Testing Stage 6

1. **More → Company details → Invoices:** set how many days clients have to pay (default 30) and your standard invoice
   terms. Check your bank details and VRN are filled in (the invoice says *TAX INVOICE* when you have a VRN).
2. Invite a colleague as **Finance** (or test as management). The bottom menu now has a **Finance** tab.
3. Open a **delivered** delivery note → **Create invoice**. It bills exactly what was delivered, at the quoted prices.
   Check it, then **Issue invoice**: it gets its INV- number and due date and can be shared as a PDF.
4. On a client, set a **credit limit** smaller than what they owe plus a new invoice. Issuing as *Finance* is refused;
   management can issue it and the override is recorded.
5. **Record a payment** (part, then the rest). Each payment has a **Receipt** PDF. As management, try **Void** on one.
6. **Finance → Money owed to us** shows what each client owes by age (current, 1–30, 31–60, 61–90, 90+ days).
7. On a confirmed purchase order: **Record supplier's invoice**, then pay it (part payments and foreign currency rates
   work). **Money we owe** shows totals per currency.
8. Still on the PO: under **Import costs & landed cost**, add duty, clearing and port charges, check the landed cost
   per unit, then **Use landed cost as product cost**.
9. On the accepted quotation, **Order costs & profit** shows sales, cost of goods, other costs and gross profit. Add a
   transport cost and watch the profit change. **Finance → Profit** shows the month by order, client, industry and
   salesperson.

## Testing Stage 5

1. **More → Team & roles:** invite a colleague (or a second email of yours) as **Driver**.
2. **More → Stores:** a *Main store* exists already. Add others (e.g. Geita) if you need them.
3. **Receive goods:** open a confirmed PO → **Receive goods**. Enter the quantities that arrived, and the batch number
   and expiry date for chemicals and lubricants. A goods received note (GRN) is created and the stock goes up. Receive
   part now and the rest later to see *Partly received*.
4. **Stock:** check the quantities per store and batch. Batches expiring within 60 days are flagged.
   **Adjust stock** corrects a count (a reason is required and it is logged).
5. Open the **accepted** quotation → **Create delivery note**. Choose the store, delivery site, driver and vehicle,
   then **Dispatch**. Stock goes down (oldest expiry first). **Share PDF** prints the delivery note.
6. On the driver's phone, sign in and open **Deliveries** once while online. Then switch on **airplane mode**,
   reopen the app, press **Record delivery**, take the receiver's name, signature and a photo, and **Confirm**.
   It says *waiting to send*. Switch airplane mode off: it sends by itself (or press **Send now**).
7. Back on the delivery note: status *Delivered*, with signature, photo, GPS and time. **Share PDF** now prints a
   *Proof of delivery*. Try **Could not deliver** on another one: the goods go back into stock.

## Testing Stage 4

1. **More → Company details → Purchase orders:** check the approval limit (TZS 2,500,000) and add standard PO terms.
2. Open an **accepted** client quotation, then **Purchasing for this order → Request supplier quotes**. The items are copied.
3. **Add 2–3 suppliers**, and use **Share PDF** next to each one to send them the request for quotation (WhatsApp or
   email).
4. When they reply, use **Enter prices** for each supplier, in their currency (for example a USD supplier with rate
   2,600, plus freight).
5. **Compare prices** shows every supplier side by side in TZS, with the cheapest in green. Press **Award & create PO**
   on the winner.
6. Check the draft PO (VAT is 0% for foreign suppliers and 18% for Tanzanian ones), then **Submit**. As *Procurement*,
   a PO above the limit waits for a manager's approval.
7. **Share PDF** to the supplier, mark it **sent**, then **Supplier confirmed** with their order number. The products'
   last cost updates, so margins on new quotations use the real price.

## Testing Stage 3

1. **More → Company details → Quotations:** check the VAT rate (18%), validity (30 days), minimum margin (12%),
   approval limit (TZS 25,000,000), and add your standard terms.
2. **Sales → + RFQ:** record a client request (for example 20 drums of hydraulic oil, received by WhatsApp, due Friday)
   and add the items.
3. **Create quotation from these items.** Prices come from the catalogue. Adjust prices and discounts, set delivery
   time, then **Preview PDF**.
4. **Submit.** As management it is approved straight away. As *Sales* with a margin under 12%, it waits for approval.
5. As a second manager, open it from **Home → waiting for your approval**, and **Send back** with a note or
   **Approve**.
6. **Share PDF** opens the phone's share sheet (WhatsApp, Gmail…). Then mark it **sent** and record the client's
   answer. Accepting it marks the RFQ as *won*.
7. **Make a revision** of a sent quotation: it becomes R1, and the old one is marked as replaced.

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

- **Database rules:** more than 120 tests prove that each company sees only its own data and each role only what it should.
- **App build:** compiles and type-checks the whole app.
- **PDF samples:** builds sample quotation, purchase order and supplier RFQ PDFs, so layout errors are caught.

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
