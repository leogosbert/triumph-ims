# TRIUMPH IMS — Go-live runbook

Follow these steps in order. Most take a few minutes. In the app, **Settings → Go-live checklist** ticks off
everything it can check by itself.

---

## 0. Database updates

In **Supabase → SQL Editor**, make sure every file in `supabase/migrations/` has been run once, in order, ending with
`20261011000200_stage10_security.sql`. Stage 8 contains the security fixes from the pre-launch review, and Stage 10
the demo and two-step verification rules, so both must be run. Also run `20261014000100_security_plus.sql`
("confirm it's you" for sensitive changes, sign-in history, new-device alerts, security check).

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
- **Passwords** (Authentication → Providers → Email, or Authentication → Policies, depending on the dashboard
  version):
  - **Minimum password length: 10**, and **Password requirements: lowercase, uppercase, digits and symbols**.
  - **Prevent use of leaked passwords: ON** (Pro plan and above). The app already refuses leaked passwords on
    sign-up and password change, but this makes it impossible to get around.
  - **Secure password change: ON (required)** — a password can only be changed shortly after signing in. The app
    asks for the password again before changing it, but this setting also protects against someone who calls
    Supabase directly from a stolen, signed-in phone. People will not notice it.
  - **Secure email change: ON** — changing the email address needs confirmation from both addresses.
- **Multi-Factor**: make sure **TOTP (authenticator app)** is enabled (it is by default). Then in the app,
  Management → **Settings → Security** can require two-step verification for everyone.
- **Sessions** (Authentication → Sessions, Pro plan): set **Inactivity timeout** to match the app's automatic
  sign-out (e.g. 8 hours) and, if you like, a **Time-box** of 7 days (everyone signs in again at least weekly).
  Leave *Single session per user* **off** (people use both a phone and a laptop).
- **Rate limits** (Authentication → Rate Limits): keep the defaults or lower *sign-in / sign-up attempts* (e.g. 30
  per 5 minutes per address). Wrong passwords are then slowed down for attackers.
- **Attack Protection → CAPTCHA** (optional, Cloudflare Turnstile): stops bots trying passwords or starting demos
  in bulk. If you turn it on, tell us first — the sign-in page then needs the Turnstile key.
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

### Automatic backups in the app

A third layer that every company's managers can see: **Settings → Backups** (also in **More → Company & account**).

- **What it is.** Every night after 2 am (Tanzania time) the app takes one copy of each company's records — company
  details, team, clients, suppliers, products, prices and costs, RFQs, quotations, purchase orders, stock,
  deliveries, invoices, payments, bills, suggestions. Sunday's copy counts as *weekly*, the 1st of the month's as
  *monthly*. Kept: the last **7 daily, 5 weekly, 12 monthly** and **10 made by hand**; older copies are deleted
  automatically. Demo companies are skipped.
- **Not included:** the Activity log, notifications, phone push keys and secrets, and files (logos, photos,
  signatures). The whole-system GitHub copy above covers the Activity log.
- **Managers can** press **Back up now** (up to 5 times a day, e.g. before a big import) and **Download** any copy as
  one JSON file (`LeMoSp-backup-<company>-<date>.json`). Only management can see or download copies; the copy itself
  can only be read through a database function that checks the manager and writes every download to the Activity log.
- **Warnings.** If the last automatic copy is more than 2 days old, managers get a notification once a day and an
  orange line on the home dashboard ("automatic backup overdue").
- **Restore** is not automatic (too risky): the company contacts LeMo Tech support with the backup date, and we put
  the records back with them.

**Set-up:** nothing beyond running `20261014000200_auto_backups.sql` in the SQL editor. It uses the same scheduled job
and `OUTBOX_SECRET` as alerts (section 3), so alerts must be set up first. Still keep the Supabase Pro plan and the
encrypted GitHub copy above: copies inside the database do not help if the whole database is lost.
The web server's scheduled job backs up a few companies per run, each in its own short step, so one very large
company can never block the others.

*Optional:* you can also run the backups inside the database itself (no web server or secret needed). In Supabase →
**Database → Extensions** turn on **pg_cron**, then run once in the SQL editor:
`select cron.schedule('lemosp-backups', '*/10 * * * *', $$select public.run_company_backups_at(now(), 20, interval '2 minutes')$$);`
(to stop it: `select cron.unschedule('lemosp-backups');`). Both can run together; each company still gets one copy a day.

**Database size.** One copy takes about 150 bytes of database space per record (about 550 bytes per record in the
downloaded file; Postgres compresses the stored copy). A company with 5,000 records uses about 0.75 MB per copy, so
all 34 kept copies together stay around 25 MB; at 20,000 records about 100 MB. Retention keeps this from growing
further. Check **Supabase → Reports → Database size** now and then (free plan limit 500 MB, Pro 8 GB).

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

## 11. LeMoSp ADMIN as its own app

**Why:** a phone treats each web address as a different app. While the admin screens live at `/admin` inside the
company app's address, the phone thinks LeMoSp ADMIN is "already installed" (it is part of LeMoSp). Giving the admin
app its own address makes it a completely separate app on Android and iPhone. Same code, same database, same
accounts — nothing to copy.

**A. Create the admin site (Netlify, about 5 minutes)**

1. Netlify → **Add new site → Import an existing project → GitHub** → choose the **same repository** as the company
   app, same branch (`main`). Leave the build settings as they are (they come from `netlify.toml`).
2. **Site name**: `lemosp-admin` (gives `https://lemosp-admin.netlify.app`). Any name ending in `-admin` works, or
   later a domain starting with `admin.` (for example `admin.lemosp.co.tz`).
3. Before the first deploy, **Site configuration → Environment variables**, add exactly these:

   | Variable | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | same as the company site |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same as the company site |
   | `NEXT_PUBLIC_SITE_URL` | `https://lemosp-admin.netlify.app` (the admin address) |
   | `NEXT_PUBLIC_MAIN_URL` | the company app's address, e.g. `https://ims.triumphsuppliers.co.tz` |
   | `NEXT_PUBLIC_ADMIN_URL` | `https://lemosp-admin.netlify.app` (optional here; needed only if the admin address neither ends in `-admin` nor starts with `admin.`) |
   | `VAPID_PUBLIC_KEY` | **copy exactly** the company site's `VAPID_PUBLIC_KEY` (the PUBLIC one only), so phones can turn on admin notifications |

   Do **not** add `OUTBOX_SECRET`, `VAPID_PRIVATE_KEY`, `RESEND_API_KEY` or `EMAIL_FROM` — and never copy the
   private key: alerts and emails are sent only by the company site (the admin site also refuses that job by
   itself, so nothing is ever sent twice).
4. **Deploys → Trigger deploy**. Wait for "Published".

**B. Point the company app to it**

5. On the **company** site → Environment variables → add `NEXT_PUBLIC_ADMIN_URL` = `https://lemosp-admin.netlify.app`
   → **Deploys → Trigger deploy**. From then on, opening `/admin` in the company app goes to the admin address, and
   **More → Platform admin** opens it there.

**C. Supabase**

6. Supabase → **Authentication → URL Configuration → Redirect URLs** → add `https://lemosp-admin.netlify.app/**`
   (keep the company app's entry). Leave the *Site URL* as the company app.

**D. On the phone**

7. Open `https://lemosp-admin.netlify.app` in **Chrome** (Android) or **Safari** (iPhone). Sign in with your normal
   email and password, then the two-step code (platform admins always need it; if you have not set it up yet the
   page walks you through it).
8. Install: Android shows **Install LeMoSp ADMIN** (or Chrome menu ⋮ → **Install app**); iPhone: **Share → Add to
   Home Screen**. The home-screen icon is called **LeMoSp ADMIN**, next to **LeMoSp**.

**E. Admin notifications** (database update `20261015000200_platform_notifications.sql`)

LeMoSp ADMIN has its own bell (top right) and **Notifications** page: new companies, a company finishing setup or
changing level, new app feedback, account deletions and company closures, automatic backups overdue (urgent, once
per company per day), many sign-ins from new devices in one hour (urgent), and a **daily summary at 08:00**
("Yesterday: N new companies, N active, N feedback items"). No amounts, clients or people's names or emails.
Kept 180 days.
To get them on your phone: open LeMoSp ADMIN → bell → **Turn on notifications on this device** (on each phone or
computer you use; tick **Email me too** if you also want emails). The admin site needs only `VAPID_PUBLIC_KEY`
(step 3, same value as the company site). The company site's scheduled job sends them (it has the private key);
tapping one opens it in LeMoSp ADMIN. Company alerts never go to the admin app and admin alerts never go to the
company app — except while `/admin` still runs inside the company app's address (no admin address yet): then it is
one app on the phone, and that phone gets both.

Notes: people who are not platform admins see "This app is for the LeMoSp platform team" there, never company
data. Forgotten passwords are reset in the company app (same account for both). Each app keeps its own sign-in,
so signing out of one does not sign you out of the other. Until step 5 is done, `/admin` keeps working inside the
company app as before.

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

### Security plus (database update `20261014000100_security_plus.sql`)

- **"Confirm it's you"**: these changes need the password (and the two-step code, if the person uses it) entered
  within the last 10 minutes — checked by the database itself, so a phone left unlocked on a desk is not enough:
  changing a team member's role or access, changing the company's sign-in security, resetting someone's two-step
  verification, changing the company's bank details or any text printed on documents (footer, quotation / purchase
  order / invoice terms — where someone could write "pay to account …"), downloading the data export or a backup,
  changing your own password, and turning two-step verification on for the first time or off. The password itself
  must be typed: a code from an authenticator app alone is not enough. Five wrong passwords in that box sign the
  person out. Demo guests are never asked.
- **Important — Supabase setting:** turn on **Authentication → Secure password change** (see section 2). Without
  it, someone holding a signed-in phone could change the password directly through Supabase instead of the app.
- **Sign-in history**: Your account → *Signed-in devices & activity* shows the last 20 sign-ins and security
  changes; management sees the last 50 for the whole company under Settings → Security → *Team sign-ins*. Only
  "browser on system" (e.g. "Chrome on Android") and the start of the internet address (e.g. 41.59.x.x) are kept,
  for 180 days.
- **New-device alert**: a sign-in from a phone or computer the person has not used before sends them an alert
  (in the app, by phone notification and email): "If this wasn't you, change your password and sign out of all
  devices." At most 5 such alerts per person per day (every sign-in is still in the history).
- **Security check** (Settings → Security): green / orange / red marks for two-step required, how many people use
  it, automatic sign-out, number of managers (2–3 is best, so you are never locked out), and people who have not
  signed in for 60 days.
- **Privacy screen**: when the app goes to the background, the screen is blurred so recent-apps previews do not
  show figures.
- **Browser protections**: the site tells browsers to always use https (HSTS, two years), to only run the app's
  own code and talk only to Supabase (Content-Security-Policy), and never to show the app inside another website.

**After deploying**, check once that everything still loads: sign in, open a quotation PDF, upload a logo, turn on
phone notifications. If something is blocked, the browser console names the "Content-Security-Policy" rule —
send us that line.

## 12. Deleting accounts and companies

Database update: `20261015000100_deletion.sql` (run it in the SQL editor like the others). It uses the same scheduled
job and `OUTBOX_SECRET` as alerts (section 3).

- **Delete my account** (Your account → *Delete my account*): the person confirms with their password and types
  DELETE. Straight away they lose access to every company, are signed out on every device, their phone
  notifications stop, and they get an email (sent by the scheduled job; needs `RESEND_API_KEY`/`EMAIL_FROM`,
  section 3). People who use two-step verification must enter their code first. For **7 days** they can sign in and choose **Keep my account** —
  everything comes back (except a membership a manager switched off meanwhile). Refused while they are the only manager of a company where other people work (make
  someone else manager first). The only person in a company must close the company too (same step, or first).
  Platform admins and demo guests cannot use it.
- **What is deleted after 7 days:** name, email, phone, password, sign-in methods, sessions, two-step verification,
  devices, sign-in history, notifications and settings, memberships, and their email in team invitations. The
  sign-in account itself is anonymised and blocked (not removed), so **business records stay exactly as they were**
  (quotations, invoices, deliveries, Activity log) and show "Deleted user". One "account deleted" line, without
  personal details, is written to each company's Activity log. The email address can be used to sign up again.
- **Close company account** (Settings → Company details → *Close company account*, management only): password,
  type the exact company name. The page first offers **Download a final backup** — Tanzanian law requires keeping
  business records (e.g. tax records) for several years; the downloaded file is the company's own copy. Straight
  away everyone except management loses access and every member is notified; managers see only a "This company
  will be deleted on …" screen with *Cancel closure*, *Download final backup* and *Sign out*. After **30 days** all
  the company's data is deleted: records, backups and the company itself; from that moment nobody, management
  included, can sign in to it or cancel. Only an anonymous row (no name) is kept so the platform can count
  closures. People keep their own accounts. **Files** (logo, signatures, photos): newer Supabase does not let the
  database delete them, so **Admin → Deletions** shows "Files to remove: N folders" — a platform admin presses
  **Remove files** (allowed only for those folders). Please check that tab after closures.
- **Platform admin → Deletions** lists scheduled and finished deletions (dates, status, company name while closing,
  only the first letter of a person's name; cancelled requests are forgotten after 90 days). It is read-only:
  nobody at LeMo Tech can cancel or speed one up.
  "Not finished: retrying" means the scheduled job hit an error; it retries every hour (a very large company is
  deleted a slice at a time over a few runs). To finish one by hand: SQL editor →
  `select public.run_due_deletions_at(now(), 50, interval '2 minutes');`
- **Public page** `/delete-account` (no sign-in, linked from the sign-in page; app stores ask for it) explains all
  this. Set **`NEXT_PUBLIC_SUPPORT_EMAIL`** in Netlify → Environment variables (company site and admin site) to the
  address people write to when they cannot sign in; without it the page says "LeMo Tech Solutions support".
- **Irreversible.** After the 7 or 30 days nothing in the app can bring the data back. The platform team can only
  restore from the **encrypted nightly GitHub backup** (section 6), which keeps 30 days.
- **Remove LeMoSp from this phone** (Your account; also on the admin overview): steps to uninstall on Android and
  iPhone, and *Clear this device and sign out* (removes the offline pages, saved settings and the driver's offline
  deliveries — it warns first if some have not been sent). Uninstalling never deletes the account.
