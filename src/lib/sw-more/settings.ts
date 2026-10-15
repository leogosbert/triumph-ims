// Kiswahili for the v1.20 settings and account screens (merged into SW in src/lib/sw.ts).
export const SW_SETTINGS: Record<string, string> = {
  // Settings home
  "Set up your company, your team and how the app works for you.": "Weka mipangilio ya kampuni yako, timu yako na jinsi programu inavyokufanyia kazi.",
  "Only management can change company settings.": "Ni uongozi pekee unaoweza kubadilisha mipangilio ya kampuni.",
  "People & security": "Watu na usalama",
  "Features & growth": "Vipengele na ukuaji",
  "Data & backups": "Data na nakala rudufu",
  "View your company's details": "Angalia maelezo ya kampuni yako",
  "Your name, password, appearance and language": "Jina lako, nenosiri, mwonekano na lugha",
  Complete: "Kamili",
  "{n} details to fill in": "Taarifa {n} za kujaza",
  "{n} active": "{n} hai",
  "{n} waiting to join": "{n} wanasubiri kujiunga",
  "Two-step: on": "Hatua mbili: imewashwa",
  "Two-step: off": "Hatua mbili: imezimwa",
  "Level: {level}": "Kiwango: {level}",
  "Not backed up (demo)": "Haihifadhiwi (majaribio)",
  "Backup overdue": "Nakala rudufu imechelewa",
  "Last backup: {date}": "Nakala rudufu ya mwisho: {date}",
  "First backup tonight": "Nakala rudufu ya kwanza usiku huu",
  "{n} of 3 connected": "{n} kati ya 3 zimeunganishwa",

  // Shared
  "Jump to": "Nenda kwenye",

  // Company details
  "Your registration, contact details and branding, and the rules printed on quotations, orders and invoices.":
    "Usajili wako, mawasiliano na utambulisho, pamoja na masharti yanayochapishwa kwenye nukuu za bei, oda na ankara.",
  "Shown in the app and at the top of every document you send.": "Inaonyeshwa kwenye programu na juu ya kila hati unayotuma.",
  "Printed on quotations, invoices and purchase orders. Check them against your certificates.":
    "Zinachapishwa kwenye nukuu za bei, ankara na oda za ununuzi. Zihakiki dhidi ya vyeti vyako.",
  "The main currency is used for totals, reports and approval limits.": "Sarafu kuu inatumika kwa jumla, ripoti na viwango vya idhini.",
  "Approval needed above": "Idhini inahitajika zaidi ya",
  "Changes apply to new documents from now on.": "Mabadiliko yanatumika kwa hati mpya kuanzia sasa.",
  "Type it exactly as shown, including capital letters.": "Liandike kama lilivyoonyeshwa, pamoja na herufi kubwa.",

  // Team
  "Invite people, give each one a role, and switch access off when someone leaves. Nothing they recorded is lost.":
    "Alika watu, mpe kila mmoja jukumu, na zima ruhusa mtu anapoondoka. Hakuna alichorekodi kinachopotea.",
  "Ask them to open the app and create an account with this email. They will be offered to join.":
    "Mwombe afungue programu na afungue akaunti kwa barua pepe hii. Atapewa nafasi ya kujiunga.",
  "The role decides what they can see and change. You can change it later.":
    "Jukumu linaamua anachoweza kuona na kubadilisha. Unaweza kulibadilisha baadaye.",
  "Change a role or switch access off, then press Update. You may be asked for your password.":
    "Badilisha jukumu au zima ruhusa, kisha bonyeza Sasisha. Unaweza kuombwa nenosiri lako.",

  // Security
  "Protect your company's data: two-step verification, automatic sign-out and a record of who signed in.":
    "Linda data ya kampuni yako: uthibitishaji wa hatua mbili, kutoka kiotomatiki na kumbukumbu ya walioingia.",
  "30 minutes suits most offices. Choose Never only if every device is personal and locked.":
    "Dakika 30 zinafaa ofisi nyingi. Chagua Kamwe tu kama kila kifaa ni cha mtu binafsi na kimefungwa.",
  "You may be asked for your password before saving.": "Unaweza kuombwa nenosiri lako kabla ya kuhifadhi.",

  // Features
  "Choose the tools your company sees. Switching something off hides it; your records stay.":
    "Chagua zana ambazo kampuni yako inaziona. Ukizima kitu kinafichwa; kumbukumbu zako zinabaki.",

  // Alerts setup
  "Server key": "Ufunguo wa seva",
  "Alert emails": "Barua pepe za tahadhari",

  // Backups and export
  "A copy of all your company's records is taken every day. Download one any time to keep your own copy.":
    "Nakala ya kumbukumbu zote za kampuni yako inachukuliwa kila siku. Pakua moja wakati wowote ili uwe na nakala yako mwenyewe.",
  "Everything in one file": "Kila kitu katika faili moja",
  "Download CSV": "Pakua CSV",
  "Looking for the daily copies?": "Unatafuta nakala za kila siku?",

  // Go-live checklist
  "{done} of {total} automatic checks done": "Ukaguzi wa kiotomatiki {done} kati ya {total} umekamilika",
  "Items marked • can't be checked from inside the app. Follow the go-live runbook (GO-LIVE.md in the project) for those.":
    "Vipengele vilivyowekwa alama • haviwezi kukaguliwa ndani ya programu. Fuata mwongozo wa kuanza (GO-LIVE.md kwenye mradi) kwa hivyo.",
  "only you so far": "wewe peke yako kwa sasa",
  "runbook step 5 (SQL)": "hatua ya 5 ya mwongozo (SQL)",
  "none needed yet": "hakuna kinachohitajika bado",
  "skip if you only buy to order": "ruka kama unanunua kwa oda tu",
  "runbook step 4 (SQL), once testing is finished": "hatua ya 4 ya mwongozo (SQL), majaribio yakishakamilika",
  "not set": "haijawekwa",
  "runbook step 2": "hatua ya 2 ya mwongozo",
  "runbook step 6": "hatua ya 6 ya mwongozo",
  "runbook step 7": "hatua ya 7 ya mwongozo",

  // Account
  "Your details, password, how the app looks and the language it speaks.":
    "Taarifa zako, nenosiri, jinsi programu inavyoonekana na lugha inayotumia.",
  Devices: "Vifaa",
  "Your name is shown to your team and in the Activity log.": "Jina lako linaonyeshwa kwa timu yako na kwenye Kumbukumbu ya shughuli.",
  "You sign in with this email. It cannot be changed here.": "Unaingia kwa barua pepe hii. Haiwezi kubadilishwa hapa.",
  "At least 10 characters with letters, numbers and symbols. You may be asked for your current password first.":
    "Angalau herufi 10 zenye herufi, namba na alama. Unaweza kuombwa nenosiri lako la sasa kwanza.",
  "The language of menus and screens. You can also switch with EN·SW in the top bar.":
    "Lugha ya menyu na skrini. Unaweza pia kubadilisha kwa EN·SW kwenye upau wa juu.",
  "Sign out on shared phones and computers when you finish.": "Toka kwenye simu na kompyuta za pamoja ukimaliza.",
  // Role hints (Team & roles → "What can each role do?")
  "Sees everything, approves, manages settings and the team": "Anaona kila kitu, anaidhinisha, anasimamia mipangilio na timu",
  "Clients, RFQs, quotations and orders": "Wateja, maombi ya bei (RFQ), nukuu za bei na oda",
  "Suppliers, supplier prices and purchase orders": "Wasambazaji, bei za wasambazaji na oda za ununuzi",
  "Stock, goods received and dispatches": "Stoo, bidhaa zilizopokelewa na usafirishaji",
  "Assigned deliveries and proof of delivery": "Usafirishaji aliopangiwa na uthibitisho wa kufikisha",
  "Invoices, payments, receivables and payables": "Ankara, malipo, madeni tunayodai na tunayodaiwa",
};
