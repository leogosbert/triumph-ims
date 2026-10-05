import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";

export const metadata = {
  title: "Delete your account",
  description: "How to delete your LeMoSp account or close your company, what is deleted and what is kept.",
};

/**
 * Public page (no sign-in): how to delete a LeMoSp account. App stores ask for a page like this.
 * Support address: NEXT_PUBLIC_SUPPORT_EMAIL (Netlify → Environment variables).
 */
export default async function DeleteAccountInfoPage() {
  await primeLang();
  const email = (process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "").trim();
  const support = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;

  return (
    <div className="auth-wrap">
      <img className="auth-logo" src="/brand/lemosp-on-dark.svg" alt={tr("LeMoSp")} />
      <article className="auth-card del-card del-info">
        <h1 className="del-title">{tr("Delete your LeMoSp account")}</h1>
        <p className="muted">{tr("You can delete your account yourself, in the app, at any time.")}</p>

        <section className="del-section">
          <h2>{tr("How to delete your account")}</h2>
          <ol className="del-list">
            <li>{tr("Sign in to LeMoSp.")}</li>
            <li>{tr("Open Your account: tap your company name at the top, or More → Company & account → Your account.")}</li>
            <li>{tr("Choose Delete my account, enter your password and type DELETE.")}</li>
          </ol>
          <p className="small muted" style={{ marginBottom: 0 }}>
            {tr("If you are the only manager of a company where other people work, make someone else a manager first.")}
          </p>
        </section>

        <section className="del-section">
          <h2>{tr("What is deleted")}</h2>
          <ul className="del-list">
            <li>{tr("Your name, email address, phone number and password")}</li>
            <li>{tr("Your two-step verification, the devices you signed in from and your sign-in history")}</li>
            <li>{tr("Your notifications, phone notification settings and your access to every company")}</li>
          </ul>
        </section>

        <section className="del-section">
          <h2>{tr("What is kept")}</h2>
          <p className="small" style={{ marginTop: 0, marginBottom: 0 }}>
            {tr("Business records you created belong to your company and stay with it, for example quotations, invoices, deliveries and the company's Activity log. Your name is removed from them: they show \"Deleted user\".")}
          </p>
        </section>

        <section className="del-section">
          <h2>{tr("When")}</h2>
          <ul className="del-list">
            <li>{tr("Your account: 7 days after you ask. Until then you can sign in and choose Keep my account.")}</li>
            <li>{tr("A whole company (a manager chooses Settings → Company details → Close company account): all its data is deleted 30 days after the request. Until then a manager can cancel it.")}</li>
            <li>{tr("After that it cannot be undone.")}</li>
          </ul>
        </section>

        <section className="del-section">
          <h2>{tr("Can't sign in?")}</h2>
          <p className="small" style={{ marginTop: 0, marginBottom: 0 }}>
            {tr("Contact")}{" "}
            {support ? (
              <a href={`mailto:${support}?subject=${encodeURIComponent("Delete my LeMoSp account")}`}>{support}</a>
            ) : (
              <strong>{tr("LeMo Tech Solutions support")}</strong>
            )}{" "}
            {tr("from the email address of your account and ask us to delete it. We check that the request is really from you first.")}
          </p>
        </section>

        <p className="small" style={{ marginBottom: 0 }}>
          <Link href="/login">{tr("Sign in")}</Link>
        </p>
      </article>
      <p className="auth-foot">{tr("LeMoSp · a LeMo Tech Solutions product")}</p>
    </div>
  );
}
