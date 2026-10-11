import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { startDemo } from "@/app/demo-actions";
import { AppBackground } from "@/components/AppBackground";
import { DemoScalePicker } from "@/components/DemoScalePicker";
import { LangSwitch } from "@/components/LangSwitch";
import { JourneyStory } from "@/components/journey/JourneyStory";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "How it works",
  description: "Follow one order in LeMoSp, step by step: from the first call with a customer to the agreed terms, delivery, payment and profit.",
};

/**
 * Public page: the story of one order, step by step (src/lib/journey.ts). Signed-out visitors end
 * with the three demos; people already signed in can open each real screen and go back to the app.
 */
export default async function HowItWorksPage() {
  await primeLang();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const inApp = Boolean(user);

  const end = inApp ? (
    <div className="j-end-card">
      <h2>{tr("That's the whole journey")}</h2>
      <p>{tr("Every step you saw is a real screen in your app. The App guide explains each one in detail, and the quick guide shows them on your own screens.")}</p>
      <div className="j-end-actions">
        <Link href="/guide" className="btn btn-primary">
          {tr("Open the App guide")}
        </Link>
        <Link href="/" className="btn">
          {tr("Back to the app")}
        </Link>
      </div>
    </div>
  ) : (
    <div className="j-end-card">
      <h2>{tr("Now try it yourself")}</h2>
      <p>{tr("Open a demo company full of sample data and try each step yourself. Pick the scale closest to your business. No sign-up needed; it deletes itself after 48 hours.")}</p>
      <DemoScalePicker action={startDemo} tone="dark" />
      <p className="j-end-signin">
        {tr("Already have an account?")} <Link href="/login">{tr("Sign in")}</Link>
      </p>
    </div>
  );

  return (
    <div className="auth-wrap journey-wrap">
      <AppBackground kind="architecture" />
      <header className="j-head">
        <Link href={inApp ? "/" : "/login"} className="j-logo" aria-label={tr("LeMoSp")}>
          <img src="/brand/lemosp-on-dark.svg" alt={tr("LeMoSp")} />
        </Link>
        <LangSwitch />
      </header>
      <div className="j-intro">
        <p className="j-eyebrow">{tr("How it works")}</p>
        <h1>{tr("One order, from the first call to the profit")}</h1>
        <p>{tr("Follow Kilimanjaro Hotels as they buy paper and toner from you: the request, the quotation, the agreed terms, delivery, payment and what you earned. Press Next to go step by step.")}</p>
      </div>
      <JourneyStory end={end} inApp={inApp} />
      <p className="auth-foot">{tr("LeMoSp · a LeMo Tech Solutions product")}</p>
    </div>
  );
}
