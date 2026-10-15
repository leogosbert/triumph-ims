/**
 * What's new in each version of LeMoSp. The newest goes FIRST.
 * When you publish an upgrade, add an entry here: people using the app
 * see it in the "new version" pop-up.
 */
export type Release = { version: string; date: string; en: string[]; sw: string[] };

export const RELEASES: Release[] = [
  {
    version: "1.21.3",
    date: "2026-10-15",
    en: [
      "A fresher look: cool colour blends drawn from your company colours, screens that fade in, menu pills that glide and snap to where you tap, icons that magnify in the menus and quick actions, and cards that fade up as you scroll.",
    ],
    sw: [
      "Mwonekano mpya: michanganyiko ya rangi tulivu kutoka rangi za kampuni yako, skrini zinazoingia kwa kufifia, vidonge vya menyu vinavyoteleza na kunasa pale unapogusa, aikoni zinazokuzwa kwenye menyu na vitendo vya haraka, na kadi zinazoibuka unaposogeza.",
    ],
  },
  {
    version: "1.21.2",
    date: "2026-10-15",
    en: [
      "LeMoSp ADMIN looks neater and feels smoother: a one-row header with an account menu, a pill that slides between sections, pages that glide in, numbers that count up, bars that grow and a calm outline while a page loads.",
    ],
    sw: [
      "LeMoSp ADMIN inaonekana nadhifu zaidi na inaenda laini: kichwa cha mstari mmoja chenye menyu ya akaunti, kidonge kinachoteleza kati ya sehemu, kurasa zinazoingia taratibu, namba zinazohesabika, mistari inayokua na muhtasari tulivu ukurasa unapopakia.",
    ],
  },
  {
    version: "1.21.1",
    date: "2026-10-15",
    en: [
      "Playbooks made for your company: your company's name in the examples, your TIN and level where an example shows them, and only the steps that fit your size, what you sell and the features you use. \"Show the full playbook\" shows everything, and the PDF is your company's own copy.",
    ],
    sw: [
      "Miongozo iliyoandaliwa kwa ajili ya kampuni yako: jina la kampuni yako kwenye mifano, TIN na kiwango chako pale mfano unapoonyesha, na hatua zinazoendana na ukubwa wako, unachouza na vipengele unavyotumia tu. \"Onyesha mwongozo mzima\" inaonyesha kila kitu, na PDF ni nakala ya kampuni yako.",
    ],
  },
  {
    version: "1.21",
    date: "2026-10-15",
    en: [
      "Goods and services: tell LeMoSp whether you sell goods, services or both. Products can be goods, a service, labour, consultancy or hire; one quotation and one invoice can hold the pipes and the installation, and the invoice shows the withholding tax a client may deduct.",
      "Service jobs: plan installation, repair and maintenance at client sites, give technicians a checklist on their phone, record materials and hours, get the client's signature and make the invoice in one tap.",
      "Maintenance contracts, an installed-equipment register with warranties and service dates, projects with milestones, timesheets with rates, equipment hire, and service reports.",
      "Direct supply: when the supplier delivers straight to your client, record it on the purchase order; the goods never pass through your store.",
      "Services & prices: see what LeMo Tech offers (training, setup, add-ons, playbooks) and request it in the app. Plan & billing shows your plan, your LeMoSp invoices and how to pay. Playbooks are now given on request, including three new ones for goods, service and goods-and-services businesses.",
    ],
    sw: [
      "Bidhaa na huduma: iambie LeMoSp kama unauza bidhaa, huduma au vyote. Bidhaa zinaweza kuwa bidhaa, huduma, kazi ya mikono, ushauri au ukodishaji; nukuu moja na ankara moja vinaweza kuwa na mabomba na ufungaji wake, na ankara inaonyesha kodi ya zuio ambayo mteja anaweza kukata.",
      "Kazi za huduma: panga ufungaji, matengenezo na ukarabati kwa wateja, wape mafundi orodha ya ukaguzi kwenye simu zao, rekodi vifaa na saa, pata sahihi ya mteja na utengeneze ankara kwa mguso mmoja.",
      "Mikataba ya matengenezo, daftari la vifaa vilivyofungwa pamoja na dhamana na tarehe za huduma, miradi yenye hatua, rejista za muda zenye viwango, ukodishaji wa vifaa, na ripoti za huduma.",
      "Ugavi wa moja kwa moja: msambazaji akipeleka moja kwa moja kwa mteja wako, rekodi kwenye agizo la ununuzi; bidhaa hazipiti stoo yako.",
      "Huduma na bei: ona kile LeMo Tech inatoa (mafunzo, usanidi, nyongeza, miongozo) na uombe ndani ya programu. Mpango na malipo unaonyesha mpango wako, ankara zako za LeMoSp na jinsi ya kulipa. Miongozo sasa inatolewa kwa ombi, ikiwemo mitatu mipya kwa biashara za bidhaa, huduma na bidhaa pamoja na huduma.",
    ],
  },
  {
    version: "1.20",
    date: "2026-10-15",
    en: [
      "Faster: screens open sooner and moving between them feels instant, because the app now gets the next screen ready while your finger is still on the link.",
      "Playbooks: long step-by-step guides with live examples and \"If this happens\" situations, for setting up, order to payment, getting paid, stock, numbers and decisions, daily routines, security, bigger businesses and connecting other systems. Each one is also a PDF to print or share.",
      "Business assistant: ask \"who owes us money?\", \"what should we reorder?\" or \"draft a reminder to a client\" in English or Kiswahili and get the answer with the records behind it. Also from the box on the home screen.",
      "Integrations & API: monthly files for your accountant (invoices, payments, supplier bills, expenses), and API keys so other systems can read your data safely.",
      "Settings and Your account have a cleaner layout, with the status of each setting at a glance and the language choice on Your account.",
    ],
    sw: [
      "Kasi zaidi: skrini zinafunguka mapema na kuhama kati yake ni papo hapo, kwa sababu programu sasa inaandaa skrini inayofuata kidole chako kikiwa bado kwenye kiungo.",
      "Miongozo ya kazi: miongozo mirefu ya hatua kwa hatua yenye mifano hai na hali za \"Hili likitokea\", kwa kusanidi, oda hadi malipo, kulipwa, stoku, takwimu na maamuzi, ratiba za kila siku, usalama, biashara kubwa na kuunganisha mifumo mingine. Kila mmoja pia ni PDF ya kuchapisha au kushirikisha.",
      "Msaidizi wa biashara: uliza \"nani anadaiwa na sisi?\", \"tuagize nini tena?\" au \"andaa ukumbusho kwa mteja\" kwa Kiingereza au Kiswahili na upate jibu pamoja na kumbukumbu husika. Pia kupitia kisanduku kwenye skrini ya mwanzo.",
      "Miunganisho na API: faili za kila mwezi kwa mhasibu wako (ankara, malipo, bili za wasambazaji, matumizi), na funguo za API ili mifumo mingine isome data yako kwa usalama.",
      "Mipangilio na Akaunti yako zina mpangilio safi zaidi, hali ya kila mpangilio ikionekana kwa haraka na chaguo la lugha kwenye Akaunti yako.",
    ],
  },
  {
    version: "1.19",
    date: "2026-10-11",
    en: [
      "New look: a city skyline in your company's colours fades in behind every screen (change it under Your account → Appearance). Screens now fade and rise smoothly as you move between them.",
      "How it works: follow one order step by step, from the first call with a customer to the agreed terms, delivery, payment and profit, with animated examples. Open it from the App guide, the demo bar or the sign-in page.",
      "English or Kiswahili can now be chosen on the sign-in page too.",
      "Safer sign-in: after five wrong passwords on a device, sign-in waits before the next try, and the app sends extra browser protections.",
    ],
    sw: [
      "Mwonekano mpya: mandhari ya majengo ya jiji kwa rangi za kampuni yako yanafifia nyuma ya kila skrini (badilisha kwenye Akaunti yako → Mwonekano). Skrini sasa zinafifia na kuinuka taratibu unapohama kati yake.",
      "Jinsi inavyofanya kazi: fuatilia oda moja hatua kwa hatua, kutoka simu ya kwanza na mteja hadi masharti mliyokubaliana, ufikishaji, malipo na faida, kwa mifano inayosonga. Ifungue kutoka Mwongozo wa programu, upau wa majaribio au ukurasa wa kuingia.",
      "Kiingereza au Kiswahili sasa kinaweza kuchaguliwa pia kwenye ukurasa wa kuingia.",
      "Kuingia kwa usalama zaidi: baada ya manenosiri matano yasiyo sahihi kwenye kifaa, kuingia kunasubiri kabla ya jaribio linalofuata, na programu inatuma kinga za ziada za kivinjari.",
    ],
  },
  {
    version: "1.18",
    date: "2026-10-09",
    en: [
      "Branches: put stores and people in branches; quotations, invoices, purchase orders and expenses go to the branch of the person who makes them. Head-office figures show every branch side by side.",
      "Approval steps for purchase orders: for example finance checks every order and management approves the big ones. Each person is told when it is their turn.",
      "Budgets vs actual for sales, profit and expenses, and a cash-flow forecast week by week from the cash you have today.",
      "Purchase planning from what you sell: days of stock left, when to order and how much. Vehicles with insurance, inspection and service reminders and a fuel and repair log.",
      "Scheduled reports: any report sent to you every day, week or month, as an alert and an email.",
    ],
    sw: [
      "Matawi: weka stoo na watu kwenye matawi; nukuu za bei, ankara, oda za ununuzi na matumizi zinaenda kwenye tawi la mtu anayeziandaa. Takwimu za makao makuu zinaonyesha kila tawi bega kwa bega.",
      "Hatua za kuidhinisha oda za ununuzi: kwa mfano fedha wanakagua kila oda na uongozi unaidhinisha oda kubwa. Kila mtu anaarifiwa zamu yake inapofika.",
      "Bajeti dhidi ya halisi kwa mauzo, faida na matumizi, na utabiri wa mtiririko wa fedha wiki kwa wiki kuanzia fedha ulizonazo leo.",
      "Mipango ya ununuzi kutokana na unachouza: siku za stoku zilizobaki, lini kuagiza na kiasi gani. Magari yenye vikumbusho vya bima, ukaguzi na huduma, na kumbukumbu ya mafuta na matengenezo.",
      "Ripoti zilizopangwa: ripoti yoyote inakutumiwa kila siku, wiki au mwezi, kama arifa na barua pepe.",
    ],
  },
  {
    version: "1.17",
    date: "2026-10-09",
    en: [
      "Sales pipeline: follow every possible order from the first call to the purchase order, log calls, visits and messages, plan the next step and remember clients' important dates.",
      "Tenders: closing dates with reminders, a checklist of the papers to prepare, and the result against the winning price. Contracts: agreed prices for a client that a quotation can use in one tap.",
      "Documents library: licences, certificates, safety data sheets and other papers in one place, linked to clients, suppliers and products, with reminders before they expire.",
      "Stock transfers between stores, purchase requests that management approves and procurement turns into orders, and a reorder list with suggested quantities.",
      "Order, receipt and bill check for purchase orders, a list of accepted orders still to deliver, and Business insights for management.",
    ],
    sw: [
      "Mfululizo wa mauzo: fuatilia kila oda inayowezekana kuanzia simu ya kwanza hadi oda ya ununuzi, rekodi simu, ziara na jumbe, panga hatua inayofuata na kumbuka tarehe muhimu za wateja.",
      "Zabuni: tarehe za kufunga pamoja na vikumbusho, orodha ya nyaraka za kuandaa, na matokeo dhidi ya bei iliyoshinda. Mikataba: bei zilizokubaliwa na mteja ambazo nukuu inaweza kutumia kwa kugusa mara moja.",
      "Maktaba ya nyaraka: leseni, vyeti, karatasi za taarifa za usalama na nyaraka nyingine mahali pamoja, zikiunganishwa na wateja, wasambazaji na bidhaa, pamoja na vikumbusho kabla hazijaisha muda.",
      "Uhamisho wa stoo kati ya stoo, maombi ya ununuzi ambayo uongozi unaidhinisha na manunuzi wanayageuza kuwa oda, na orodha ya kuagiza tena yenye idadi zinazopendekezwa.",
      "Ukaguzi wa oda, mapokezi na ankara za oda za ununuzi, orodha ya oda zilizokubaliwa ambazo bado kupelekwa, na Maarifa ya biashara kwa uongozi.",
    ],
  },
  {
    version: "1.16.2",
    date: "2026-10-09",
    en: [
      "A new look on laptops: a deeper sidebar with grouped sections, a frosted top bar with your name (click it for your account and company), wider pages and quick actions as cards.",
      "Backgrounds: choose Aurora, Grid, Waves, Mountains or Plain behind the app, drawn in your company's colours. Find it under More → Appearance or Your account.",
      "Change password is now in the menu and when you tap the company logo. A reset link from Forgot your password? opens straight at the new-password box.",
    ],
    sw: [
      "Mwonekano mpya kwenye kompyuta: menyu ya pembeni yenye makundi, upau wa juu wenye jina lako (bofya kwa akaunti na kampuni yako), kurasa pana zaidi na vitendo vya haraka kama kadi.",
      "Mandharinyuma: chagua Aurora, Gridi, Mawimbi, Milima au Wazi nyuma ya programu, kwa rangi za kampuni yako. Ipo kwenye Zaidi → Mwonekano au Akaunti yako.",
      "Badilisha nenosiri sasa lipo kwenye menyu na unapogusa nembo ya kampuni. Kiungo cha Umesahau nenosiri? kinafungua moja kwa moja kwenye kisanduku cha nenosiri jipya.",
    ],
  },
  {
    version: "1.16.1",
    date: "2026-10-09",
    en: [
      "App guide: every function of the app explained step by step, with where to find it on a phone and on a laptop and who can use it. Open it from More → App guide, from Help, or by tapping your company logo. You can search it, show only what your role can use, and print it.",
    ],
    sw: [
      "Mwongozo wa programu: kila kazi ya programu imeelezwa hatua kwa hatua, pamoja na mahali pa kuipata kwenye simu na kwenye kompyuta na nani anaweza kuitumia. Ufungue kupitia Zaidi → Mwongozo wa programu, kupitia Msaada, au kwa kugusa nembo ya kampuni yako. Unaweza kutafuta ndani yake, kuonyesha tu unachoweza kutumia, na kuuchapisha.",
    ],
  },
  {
    version: "1.16",
    date: "2026-10-09",
    en: [
      "Expenses: record rent, fuel, airtime, wages and other spending with a photo of the receipt. Everyone can record their own; management and finance see them all, by category.",
      "Profit & loss: sales, cost of sales, expenses and net profit for the month, compared with last month and the year so far.",
      "Statements of account for clients and suppliers, as PDF, with the running balance and what is overdue.",
      "Mobile money: record M-Pesa, Mixx by Yas (Tigo Pesa), Airtel Money, HaloPesa or AzamPesa with the transaction code, print your pay numbers on invoices, and tick payments off against the statement (or paste the statement and let the app find them).",
      "Follow-ups and reminders: ready-made WhatsApp, SMS or email messages in English or Kiswahili to follow up quotations and remind clients about invoices, with a log of each call and the date the client promised to pay.",
    ],
    sw: [
      "Matumizi: rekodi kodi ya pango, mafuta, muda wa maongezi, mishahara na matumizi mengine pamoja na picha ya risiti. Kila mtu anaweza kurekodi yake; uongozi na fedha wanaona yote, kwa kundi.",
      "Faida na hasara: mauzo, gharama ya mauzo, matumizi na faida halisi ya mwezi, ikilinganishwa na mwezi uliopita na mwaka hadi sasa.",
      "Taarifa za akaunti za wateja na wasambazaji, kama PDF, zenye salio linaloendelea na kilichochelewa.",
      "Pesa za simu: rekodi M-Pesa, Mixx by Yas (Tigo Pesa), Airtel Money, HaloPesa au AzamPesa pamoja na namba ya muamala, chapisha namba zako za malipo kwenye ankara, na hakiki malipo dhidi ya taarifa (au bandika taarifa na programu itayatafuta).",
      "Ufuatiliaji na vikumbusho: jumbe tayari za WhatsApp, SMS au barua pepe kwa Kiingereza au Kiswahili kufuatilia nukuu za bei na kuwakumbusha wateja kuhusu ankara, pamoja na kumbukumbu ya kila simu na tarehe mteja aliyoahidi kulipa.",
    ],
  },
  {
    version: "1.15",
    date: "2026-10-07",
    en: [
      "New Reports section (menu → Reports): 18 reports on sales, purchasing, stock, deliveries, payments, profit and your lists.",
      "Pick any dates (today, this month, last quarter, or your own from–to dates), filter by client, supplier, store or status, and choose the columns.",
      "Print the report, or download it as PDF or Excel. Save the reports you use often.",
    ],
    sw: [
      "Sehemu mpya ya Ripoti (menyu → Ripoti): ripoti 18 za mauzo, manunuzi, stoku, uwasilishaji, malipo, faida na orodha zako.",
      "Chagua tarehe yoyote (leo, mwezi huu, robo iliyopita, au tarehe zako kutoka–hadi), chuja kwa mteja, msambazaji, ghala au hali, na uchague safu.",
      "Chapisha ripoti, au uipakue kama PDF au Excel. Hifadhi ripoti unazotumia mara kwa mara.",
    ],
  },
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
