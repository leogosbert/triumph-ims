# TRIUMPH IMS — Go-live runbook

Follow these steps in order. Most take a few minutes. In the app, **Settings → Go-live checklist** ticks off
everything it can check by itself.

---

## 0. Database updates

In **Supabase → SQL Editor**, make sure every file in `supabase/migrations/` has been run once, in order, ending with
`20261011000200_stage10_security.sql`. Stage 8 contains the security fixes from the pre-launch review, and Stage 10
the demo and two-step verification rules, so both must be run.

After running Stage 8, **set your exchange rates** (Finance → Exchange rates) before quoting, buying or invoicing in
USD or any other foreign currency. Documents in TZS are unaffected.

## 1. Your web address (domain)

1. Register **triumphsuppliers.co.tz** with a tzNIC-accredited registrar (needs company registration documents).
2. Netlify → your site → **Domain management → Add a domain** → `ims.triumphsuppliers.co.tz`.
3. At the registrar, add the record Netlify shows (usually a **CNAME** `ims` → `triumph-ims.netlify.app`).
   Netlify then issues the https certificate automatically (can take up to a day).
4. Netlify → **Environment variables**: set `NEXT_PUBLIC_SITE_URL` to `https://ims.triumphsuppliers.co.tz`, then
   **Deploys → Trigger deploy**.

## 2. Supabase sign-in settings

Supabase → **Authentication**:

- **URL Configuration** → *Site URL*: `https://ims.triumphsuppliers.co.tz`. *Redirect URLs*: add
  `https://ims.triumphsuppliers.co.tz/**` (keep the netlify.app one until everyone has moved).
- **Sign In / Providers → Email** → **Confirm email: ON**. Invitations rely on people proving they own the invited
  email address, so this must stay on in production.
- **Passwords** (Authentication → Policies / Passwords): minimum length **10**, require **lower, upper, digits and
  symbols**, turn on **leaked password protection** if your plan has it, and **Secure password change** (asks for a
  fresh sign-in before changing a password). The app checks the same rules, but these settings make them impossible
  to bypass.
- **Multi-Factor**: make sure **TOTP (authenticator app)** is enabled (it is by default). Then in the app,
  Management → **Settings → Security** can require two-step verification for everyone.
- **Sessions** (if your plan has it): set an *inactivity timeout* to match the app's automatic sign-out, so an
  idle sign-in also expires on the server.
- **Sign In / Providers → Allow anonymous sign-ins: ON** — needed for **Try the demo** on the sign-in page
  (guests get a demo company only; real companies are protected by database rules). Also turn on
  **Attack Protection → CAPTCHA** (Cloudflare Turnstile) later so bots cannot start demos in bulk.
- **SMTP Settings** → *Enable custom SMTP* (fixes "email rate limit exceeded" for good):
  host `smtp.resend.com`, port `465`, user `resend`, password = your Resend API key,
  sender `TRIUMPH via LeMoSp <no-reply@triumphsuppliers.co.tz>` (domain must be verified in Resend first).

## 3. Alerts (push and email)

In the app: **More → Alerts setup**. It shows the three settings to add in Netlify (`OUTBOX_SECRET`,
`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`, `RESEND_API_KEY`/`EMAIL_FROM`) and a button to test.

## 4. Clear the test data (once testing is finished)

This keeps the company, team, settings, clients, suppliers, products, prices and stores, and removes RFQs,
quotations, purchase orders, receipts, stock, deliveries, invoices, payments, bills, costs and notifications. Document
numbers restart at 0001. **It cannot be undone** — download an export first (Settings → Export data).

```sql
select public.reset_company_transactions(
  (select id from public.companies where name = 'TRIUMPH General Suppliers Ltd'),
  'TRIUMPH General Suppliers Ltd');
```

(Use your company name exactly as it appears in the app.)

## 5. Close public sign-up of new companies

Staff join by invitation only. Run once:

```sql
update public.platform_settings set allow_new_companies = false;
```

(Invitations keep working. To open it again, set it back to `true`.)

## 6. Nightly backups

Two layers:

- **Supabase plan.** Free projects are *paused after a week without activity* and have no downloadable backups.
  For live business data, upgrade the project to **Pro** (about USD 25/month): daily backups kept 7 days, no pausing.
- **Your own encrypted copy** (free, kept 30 days in GitHub):
  1. Supabase → **Connect** → copy the **Session pooler** connection string and put your database password in it.
  2. GitHub → repository → **Settings → Secrets and variables → Actions** → *New repository secret*:
     - `SUPABASE_DB_URL` = that connection string
     - `BACKUP_PASSPHRASE` = a long passphrase (write it down and keep it somewhere safe offline — without it the
       backups cannot be opened)
  3. **Actions → Nightly database backup → Run workflow** once, and check it finishes green.
  4. Test that you can open it: download the file from the run, then on a laptop
     `gpg -d triumph-ims-YYYYMMDD.tar.gz.gpg > backup.tar.gz && tar -xzf backup.tar.gz`.

**To restore** into a new Supabase project: run `public.sql` in the SQL editor (or with `psql`), then
`auth-storage.sql`; files (logos, signatures, photos) need copying separately from Supabase Storage.

## 7. Make the code private

GitHub → repository → **Settings → General → Danger zone → Change visibility → Private**. Netlify keeps working.
(No passwords or keys are in the code, but your business rules don't need to be public.)

## 8. Load your real data

1. **Master data**: Import (spreadsheet) for clients, suppliers and products, or enter them under More.
2. **Costs** on products (Products → product → Purchasing), so margins and profit are right.
3. **Exchange rates**: Finance → Exchange rates.
4. **Opening stock**: count the stores, fill the template, **Stock → Load opening stock**.
5. **Money owed from before go-live**:
   - each unpaid client invoice → **Invoices → + Invoice → Blank invoice**, one line "Opening balance – invoice
     no. …", set the original invoice date and due date, VAT 0 % (it was already charged), **Issue**;
   - each unpaid supplier invoice → **Supplier bills → + Bill**.
6. **Credit limits** on clients (management/finance).

## 9. People

1. **Settings → Team & roles**: invite everyone with the right role.
2. Each person: open the link, set a password, **add the app to the phone's home screen**, then
   **Notifications → Turn on notifications on this device**.
3. Show each person **More → Help** (a short guide for their role).
4. Drivers: open **My deliveries** once with signal so it works offline.

## 10. First weeks

- Start each day on **Home** (control tower).
- When someone leaves: **Team & roles → switch access off** the same day.
- Once a month: **Settings → Export data → Download everything** and keep it with your company records.

---

### Security summary

- Every table is protected by row-level security; each company sees only its own data and each role only what it
  needs (tested automatically on every change: 360+ checks).
- Status changes, approvals, stock and money only change through checked database functions; nobody can approve
  their own quotation or purchase order; every change is in the activity log.
- No database password or service key is used by the app; alerts use a one-way hashed secret.
- An independent review before go-live found two serious issues (delivery confirmation, exchange-rate bypass of
  approvals and credit limits) and several smaller ones; all are fixed in Stage 8 and covered by tests.
- Accepted, minor: a salesperson can infer that a price is "below minimum margin" from whether a quotation needs
  approval.
