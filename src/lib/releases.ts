/**
 * What's new in each version of LeMoSp. The newest goes FIRST.
 * When you publish an upgrade, add an entry here: people using the app
 * see it in the "new version" pop-up.
 */
export type Release = { version: string; date: string; en: string[]; sw: string[] };

export const RELEASES: Release[] = [
  {
    version: "1.14",
    date: "2026-10-07",
    en: [
      "Delete my account: under Your account. You have 7 days to change your mind.",
      "Managers can close the company account (Settings → Company). All data is deleted after 30 days — download a final backup first.",
      "Remove LeMoSp from this phone: simple steps, and a button that clears this device and signs you out.",
      "LeMoSp ADMIN now has notifications: new companies, feedback, deletion requests, overdue backups and a daily summary.",
    ],
    sw: [
      "Futa akaunti yangu: chini ya Akaunti yako. Una siku 7 za kubadili uamuzi.",
      "Viongozi wanaweza kufunga akaunti ya kampuni (Mipangilio → Kampuni). Data yote inafutwa baada ya siku 30 — pakua nakala rudufu ya mwisho kwanza.",
      "Ondoa LeMoSp kwenye simu hii: hatua rahisi, na kitufe cha kusafisha kifaa hiki na kutoka.",
      "LeMoSp ADMIN sasa ina arifa: kampuni mpya, maoni, maombi ya kufuta, nakala rudufu zilizochelewa na muhtasari wa kila siku.",
    ],
  },
  {
    version: "1.13",
    date: "2026-10-06",
    en: [
      "LeMoSp ADMIN now has its own web address, so it installs as a separate app next to LeMoSp.",
      "Demo: choose Small, Medium or Large, follow the quick guide, then see the guide for another scale.",
      "Automatic backups: your company's data is copied every night. See Settings → Backups.",
      "More security: alerts for sign-ins from a new device, sign out of all other devices, and a password check before sensitive changes.",
      "The app blurs when you switch away, and a security check on Settings → Security shows what to improve.",
    ],
    sw: [
      "LeMoSp ADMIN sasa ina anwani yake ya mtandao, hivyo inasakinishwa kama programu tofauti kando ya LeMoSp.",
      "Demo: chagua Ndogo, Kati au Kubwa, fuata mwongozo mfupi, kisha uone mwongozo wa kiwango kingine.",
      "Nakala rudufu za kiotomatiki: data ya kampuni yako inanakiliwa kila usiku. Angalia Mipangilio → Nakala rudufu.",
      "Usalama zaidi: arifa za kuingia kutoka kifaa kipya, toka kwenye vifaa vingine vyote, na kuthibitisha nenosiri kabla ya mabadiliko nyeti.",
      "Programu hufifia ukihamia programu nyingine, na ukaguzi wa usalama kwenye Mipangilio → Usalama unaonyesha cha kuboresha.",
    ],
  },
  {
    version: "1.12",
    date: "2026-10-06",
    en: [
      "Three demos: try a Small, Medium or Enterprise sample business from the sign-in page and switch between them.",
      "Guided tours: the app walks you through the real screens step by step — start one from Help at any time.",
      "LeMoSp ADMIN: platform admins can install a separate admin app on Android and iPhone.",
    ],
    sw: [
      "Demo tatu: jaribu biashara ya mfano Ndogo, ya Kati au Kubwa kutoka ukurasa wa kuingia na ubadilishe kati yake.",
      "Ziara za maelekezo: programu inakuongoza kwenye skrini halisi hatua kwa hatua — anza moja kutoka Msaada wakati wowote.",
      "LeMoSp ADMIN: wasimamizi wa jukwaa wanaweza kusakinisha programu ya usimamizi kwenye Android na iPhone.",
    ],
  },
  {
    version: "1.11",
    date: "2026-10-05",
    en: [
      "Business levels: Small, Medium and Enterprise — the app shows what fits your business today and grows with you.",
      "Growth & recommendations: the app notices when your business grows and suggests features, with the reason and a short tutorial.",
      "Turn individual features on or off under Settings → Business level & features.",
      "Suggestion Box: everyone can propose improvements; managers review, assign and track them.",
    ],
    sw: [
      "Viwango vya biashara: Ndogo, Kati na Kubwa — programu inaonyesha kinachofaa biashara yako leo na inakua pamoja nawe.",
      "Ukuaji na mapendekezo: programu hutambua biashara yako inapokua na kupendekeza vipengele, pamoja na sababu na mafunzo mafupi.",
      "Washa au zima vipengele kimoja kimoja kwenye Mipangilio → Kiwango cha biashara na vipengele.",
      "Sanduku la Mapendekezo: kila mtu anaweza kupendekeza maboresho; viongozi huyapitia, kuyakabidhi na kuyafuatilia.",
    ],
  },
  {
    version: "1.10",
    date: "2026-10-04",
    en: [
      "Try the demo: sample company with clients, quotations, stock and invoices — no sign-up.",
      "Two-step verification with an authenticator app; management can require it for everyone.",
      "Stronger passwords: strength meter and a check against leaked passwords.",
      "Automatic sign-out when the app is left idle (set by management).",
      "This pop-up tells you when a new version is ready.",
      "App lock: your password is asked again whenever you come back to the app (change it under Your account → Security).",
    ],
    sw: [
      "Jaribu demo: kampuni ya mfano yenye wateja, nukuu za bei, stoku na ankara — bila kujisajili.",
      "Uthibitishaji wa hatua mbili kwa programu ya uthibitishaji; uongozi unaweza kuulazimisha kwa wote.",
      "Manenosiri imara zaidi: kipimo cha uimara na ukaguzi wa manenosiri yaliyovuja.",
      "Kutoka kiotomatiki programu ikiachwa bila kutumika (huwekwa na uongozi).",
      "Dirisha hili linakujulisha toleo jipya likiwa tayari.",
      "Kufuli ya programu: nenosiri lako huombwa tena kila unaporudi kwenye programu (badilisha kwenye Akaunti yako → Usalama).",
    ],
  },
  {
    version: "1.9",
    date: "2026-10-04",
    en: ["New LeMoSp logo, slide-up menu, company panel, install card, dark mode and animations."],
    sw: ["Nembo mpya ya LeMoSp, menyu inayoteleza, paneli ya kampuni, kadi ya kusakinisha, hali ya giza na michoro hai."],
  },
];

export const APP_VERSION = RELEASES[0].version;

/** Identifies this exact build (Netlify sets COMMIT_REF while building). */
export const BUILD_ID = (process.env.NEXT_PUBLIC_BUILD_ID ?? "").slice(0, 12);
