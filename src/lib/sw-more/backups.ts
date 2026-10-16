// Kiswahili for backup checks and restore (merged into SW in src/lib/sw.ts).
export const SW_BACKUPS: Record<string, string> = {
  // Backups page
  "A copy of all your company's records is taken every day. Download one any time to keep your own copy.":
    "Nakala ya kumbukumbu zote za kampuni yako inachukuliwa kila siku. Pakua moja wakati wowote ili uwe na nakala yako mwenyewe.",
  "Checked": "Imekaguliwa",
  "Check failed": "Ukaguzi umeshindwa",
  "Not checked yet": "Bado haijakaguliwa",
  "Safety copy taken before a restore": "Nakala ya tahadhari kabla ya kurejesha",
  "Restore requested": "Urejeshaji umeombwa",
  "for the backup of": "kwa nakala ya",
  "LeMo Tech will contact you before anything is changed.": "LeMo Tech watawasiliana nawe kabla ya kubadilisha chochote.",
  "Cancel request": "Ghairi ombi",
  "Cancelling…": "Inaghairi…",
  "Your data was restored to the backup of": "Data yako imerejeshwa kwenye nakala ya",
  "The safety copy from just before is kept here.": "Nakala ya tahadhari ya kabla yake imehifadhiwa hapa.",
  "The restore of the backup of": "Urejeshaji wa nakala ya",
  "could not be done, and nothing was changed. LeMo Tech will contact you.":
    "haukuweza kufanyika, na hakuna kilichobadilishwa. LeMo Tech watawasiliana nawe.",
  "Checked every week": "Hukaguliwa kila wiki",
  "Every copy is opened again and checked: nothing has changed since it was taken, and every record still fits the app today, so it can be put back. Each copy is checked again every week. If a check fails, you and LeMo Tech are told.":
    "Kila nakala hufunguliwa tena na kukaguliwa: hakuna kilichobadilika tangu ilipochukuliwa, na kila kumbukumbu bado inaendana na programu ya leo, hivyo inaweza kurejeshwa. Kila nakala hukaguliwa tena kila wiki. Ukaguzi ukishindwa, wewe na LeMo Tech mnaarifiwa.",
  "Open a backup and press \"Ask LeMo Tech to restore this backup\". You first see what is in it compared with today. LeMo Tech checks with you before anything is changed, and takes a safety copy of your data just before, so a restore can itself be undone. Your team, company settings and LeMoSp billing stay as they are now.":
    "Fungua nakala na ubonyeze \"Omba LeMo Tech warejeshe nakala hii\". Kwanza utaona kilichomo ukilinganisha na leo. LeMo Tech watathibitisha nawe kabla ya kubadilisha chochote, na watachukua nakala ya tahadhari ya data yako kabla, hivyo urejeshaji wenyewe unaweza kutenduliwa. Timu yako, mipangilio ya kampuni na malipo ya LeMoSp vinabaki kama vilivyo sasa.",
  "Restore requested. LeMo Tech has been told and will contact you before anything is changed.":
    "Urejeshaji umeombwa. LeMo Tech wameambiwa na watawasiliana nawe kabla ya kubadilisha chochote.",
  "Restore request cancelled.": "Ombi la kurejesha limeghairiwa.",

  // One backup
  "← Backups": "← Nakala rudufu",
  "Backup of": "Nakala ya",
  "Safety copy taken before a restore. Restore it to undo that restore.":
    "Nakala ya tahadhari iliyochukuliwa kabla ya kurejesha. Irejeshe ili kutendua urejeshaji huo.",
  "Last checked": "Ilikaguliwa mwisho",
  "This backup failed its check, so it cannot be restored. Your other backups are not affected. LeMo Tech has been told.":
    "Nakala hii imeshindwa ukaguzi, hivyo haiwezi kurejeshwa. Nakala zako nyingine haziathiriwi. LeMo Tech wameambiwa.",
  "Fingerprint (SHA-256): matches the downloaded file exactly.": "Alama ya utambulisho (SHA-256): inalingana kabisa na faili utakalopakua.",
  "What is in this backup": "Kilichomo kwenye nakala hii",
  "The comparison could not be loaded.": "Ulinganisho haukuweza kupakiwa.",
  "Area": "Eneo",
  "In this backup": "Kwenye nakala hii",
  "Now": "Sasa",
  "stays as now": "inabaki kama sasa",
  "Numbers in red are different today: a restore brings them back to the backup.":
    "Namba nyekundu ni tofauti leo: urejeshaji unazirudisha kama kwenye nakala.",
  "Restore this backup": "Rejesha nakala hii",
  "Everything recorded after this backup (new clients, quotations, invoices, payments, stock…) is replaced by the records in the backup.":
    "Kila kitu kilichorekodiwa baada ya nakala hii (wateja wapya, nukuu, ankara, malipo, stoo…) kinabadilishwa na kumbukumbu zilizo kwenye nakala.",
  "Your team, company settings and LeMoSp billing stay as they are now. Document numbers never go backwards.":
    "Timu yako, mipangilio ya kampuni na malipo ya LeMoSp vinabaki kama vilivyo sasa. Namba za nyaraka hazirudi nyuma.",
  "A safety copy of today's data is taken first, so the restore can be undone.":
    "Nakala ya tahadhari ya data ya leo inachukuliwa kwanza, hivyo urejeshaji unaweza kutenduliwa.",
  "LeMo Tech checks with you before anything is changed.": "LeMo Tech wanathibitisha nawe kabla ya kubadilisha chochote.",
  "A restore of this backup is already requested.": "Urejeshaji wa nakala hii tayari umeombwa.",
  "A restore of another backup is already requested": "Urejeshaji wa nakala nyingine tayari umeombwa",
  "Cancel it on the Backups page first.": "Ughairi kwanza kwenye ukurasa wa Nakala rudufu.",
  "What happened? (optional)": "Nini kimetokea? (si lazima)",
  "e.g. We deleted invoices by mistake": "mf. Tulifuta ankara kwa makosa",
  "Ask LeMo Tech to restore this backup": "Omba LeMo Tech warejeshe nakala hii",

  // Messages from the database
  "This backup failed its check and cannot be restored. Please choose another one.":
    "Nakala hii imeshindwa ukaguzi na haiwezi kurejeshwa. Tafadhali chagua nyingine.",
  "A restore is already requested. Cancel it first to choose another backup.":
    "Urejeshaji tayari umeombwa. Ughairi kwanza ili kuchagua nakala nyingine.",
  "This request has already been handled.": "Ombi hili tayari limeshughulikiwa.",
  "Request not found.": "Ombi halikupatikana.",
  "A backup failed its check": "Nakala rudufu imeshindwa ukaguzi",
  "One of your backups could not be checked. Your other backups are not affected. LeMo Tech has been told.":
    "Moja ya nakala zako haikuweza kukaguliwa. Nakala zako nyingine haziathiriwi. LeMo Tech wameambiwa.",
  "Your data was restored": "Data yako imerejeshwa",

  // Areas of a backup
  "Clients": "Wateja",
  "Client contacts": "Mawasiliano ya wateja",
  "Suppliers": "Wasambazaji",
  "Products & services": "Bidhaa na huduma",
  "Product costs": "Gharama za bidhaa",
  "Stores": "Stoo",
  "Stock movements": "Mienendo ya stoo",
  "Stock transfers": "Uhamisho wa stoo",
  "Quotations": "Nukuu",
  "Quotation lines": "Mistari ya nukuu",
  "Client RFQs": "RFQ za wateja",
  "Purchase orders": "Oda za ununuzi",
  "Purchase order lines": "Mistari ya oda za ununuzi",
  "Goods received": "Bidhaa zilizopokelewa",
  "Deliveries": "Usafirishaji",
  "Delivery lines": "Mistari ya usafirishaji",
  "Invoices": "Ankara",
  "Invoice lines": "Mistari ya ankara",
  "Payments received": "Malipo yaliyopokelewa",
  "Supplier bills": "Bili za wasambazaji",
  "Supplier payments": "Malipo kwa wasambazaji",
  "Expenses": "Matumizi",
  "Projects": "Miradi",
  "Service jobs": "Kazi za huduma",
  "Hire agreements": "Mikataba ya kukodisha",
  "Contracts": "Mikataba",
  "Tenders": "Zabuni",
  "Timesheets": "Rejista za muda",
  "Vehicles": "Magari",
  "Team": "Timu",
  "Invitations": "Mialiko",
  "Documents": "Nyaraka",

  // Admin site
  "Backups could not be loaded. Check that the latest database update has been run.":
    "Nakala rudufu hazikuweza kupakiwa. Hakikisha sasisho la mwisho la hifadhidata limeendeshwa.",
  "Companies backed up": "Kampuni zenye nakala",
  "Overdue (no copy for 2 days)": "Zimechelewa (hakuna nakala kwa siku 2)",
  "With a failed backup or check": "Zenye nakala au ukaguzi ulioshindwa",
  "Restore requests waiting": "Maombi ya kurejesha yanayosubiri",
  "Space used by all copies": "Nafasi inayotumiwa na nakala zote",
  "Restore requested:": "Urejeshaji umeombwa:",
  "Call the company first to confirm. The restore takes a safety copy, then replaces the company's records with the backup's (team, settings and billing stay). If anything does not fit, nothing is changed.":
    "Piga simu kwa kampuni kwanza kuthibitisha. Urejeshaji unachukua nakala ya tahadhari, kisha unabadilisha kumbukumbu za kampuni na zile za nakala (timu, mipangilio na malipo vinabaki). Kitu chochote kisipoendana, hakuna kinachobadilishwa.",
  "Restore now": "Rejesha sasa",
  "Restoring…": "Inarejesha…",
  "Very large company? Run it in the Supabase SQL editor instead": "Kampuni kubwa sana? Iendeshe kwenye Supabase SQL editor badala yake",
  "Every company": "Kila kampuni",
  "Last automatic copy": "Nakala ya mwisho ya kiotomatiki",
  "Copies": "Nakala",
  "Last good check": "Ukaguzi mzuri wa mwisho",
  "Problems": "Matatizo",
  "None yet": "Bado hakuna",
  "failed checks": "ukaguzi ulioshindwa",
  "Earlier restore requests": "Maombi ya awali ya kurejesha",
  "backup of": "nakala ya",
  "handled": "imeshughulikiwa",
  "Waiting": "Inasubiri",
  "Restored": "Imerejeshwa",
  "Not done": "Haikufanyika",
  "Copies are checked by the scheduled job: new copies first, and every copy again each week. The whole-system encrypted copy (GitHub, every night) is separate and covers the Activity log and files.":
    "Nakala hukaguliwa na kazi iliyopangwa: nakala mpya kwanza, na kila nakala tena kila wiki. Nakala iliyosimbwa ya mfumo mzima (GitHub, kila usiku) ni tofauti na inajumuisha kumbukumbu za shughuli na mafaili.",
  "Restored. The managers have been told, and a safety copy was taken first.":
    "Imerejeshwa. Wasimamizi wameambiwa, na nakala ya tahadhari ilichukuliwa kwanza.",
  "This company is too large to restore from here. Run the SQL shown on this page in the Supabase SQL editor.":
    "Kampuni hii ni kubwa mno kurejeshwa kutoka hapa. Endesha SQL iliyoonyeshwa kwenye ukurasa huu kwenye Supabase SQL editor.",
  "Type the company name exactly as shown to confirm.": "Andika jina la kampuni kama lilivyoonyeshwa ili kuthibitisha.",
};
