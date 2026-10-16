// Kiswahili for the menu, guide and feature catalogue of the administration package, payroll and accounts
// (merged into SW in src/lib/sw.ts). The screens have their own files: hr.ts, hse.ts, payroll.ts, ledger.ts.
export const SW_ERP: Record<string, string> = {
  // Menu
  "Administration": "Utawala",
  "Employees": "Wafanyakazi",
  "My employee file": "Faili langu la mfanyakazi",
  "Employee files, contracts, certificates and licences with expiry": "Mafaili ya wafanyakazi, mikataba, vyeti na leseni pamoja na tarehe za kuisha",
  "Your details, certificates and leave balance": "Taarifa zako, vyeti na salio la likizo",
  "Leave": "Likizo",
  "Leave requests to approve, who is away and balances": "Maombi ya likizo ya kuidhinisha, walio likizo na salio",
  "Ask for leave and see your balance": "Omba likizo na uone salio lako",
  "Approve timesheets": "Idhinisha rejista za saa",
  "Weeks of hours submitted by the team": "Wiki za saa zilizowasilishwa na timu",
  "Health & safety": "Afya na usalama",
  "Incidents, inspections, toolbox talks and actions": "Matukio, ukaguzi, mazungumzo ya usalama na hatua",
  "Report an incident or near miss, record an inspection": "Ripoti tukio au karibu-ajali, rekodi ukaguzi",
  "Quality": "Ubora",
  "Non-conformance reports: supplier problems, complaints, root cause and actions": "Ripoti za kasoro: matatizo ya wasambazaji, malalamiko, chanzo na hatua",
  "Payroll": "Mishahara",
  "Monthly pay with PAYE, NSSF, SDL and WCF, payslips": "Mishahara ya kila mwezi pamoja na PAYE, NSSF, SDL na WCF, hati za mishahara",
  "My payslips": "Hati zangu za mishahara",
  "Your monthly payslips": "Hati zako za mishahara za kila mwezi",
  "Accounts": "Hesabu",
  "Trial balance, profit & loss, balance sheet, VAT, journals and closing": "Urari, faida na hasara, mizania, VAT, jenali na kufunga vitabu",
  "Fixed assets": "Mali za kudumu",
  "Vehicles, machines and equipment with monthly depreciation": "Magari, mashine na vifaa pamoja na uchakavu wa kila mwezi",

  // Feature category
  "HR & safety": "Rasilimali watu na usalama",
  "Employees, leave, timesheet approval, payroll, health & safety and quality.":
    "Wafanyakazi, likizo, uidhinishaji wa rejista za saa, mishahara, afya na usalama na ubora.",

  // Feature catalogue
  "Employees & leave": "Wafanyakazi na likizo",
  "An employee file for everyone, with or without a login: job, contract and probation dates, NIDA, TIN and NSSF numbers, certificates and licences with expiry reminders, leave requests and balances.":
    "Faili la mfanyakazi kwa kila mtu, awe na akaunti ya kuingia au la: kazi, tarehe za mkataba na majaribio, namba za NIDA, TIN na NSSF, vyeti na leseni pamoja na vikumbusho vya kuisha, maombi ya likizo na salio.",
  "Every company with staff.": "Kila kampuni yenye wafanyakazi.",
  "No expired licence or certificate on site, no forgotten contract end, and leave approved in one tap.":
    "Hakuna leseni au cheti kilichoisha kazini, hakuna mwisho wa mkataba uliosahaulika, na likizo inaidhinishwa kwa mguso mmoja.",
  "Add your people": "Ongeza watu wako",
  "Open Employees and press New employee. Link the person to their LeMoSp login if they have one, so they can ask for leave and see their own file.":
    "Fungua Wafanyakazi na ubonyeze Mfanyakazi mpya. Unganisha mtu na akaunti yake ya LeMoSp kama anayo, ili aweze kuomba likizo na kuona faili lake.",
  "Certificates and licences": "Vyeti na leseni",
  "On the employee, add driving licences, first-aid, working-at-height and other certificates with their expiry date. Those ending in the next 30 days show on the dashboard.":
    "Kwenye mfanyakazi, ongeza leseni za udereva, huduma ya kwanza, kufanya kazi juu na vyeti vingine pamoja na tarehe ya kuisha. Vinavyoisha ndani ya siku 30 zijazo vinaonekana kwenye ukurasa wa mwanzo.",
  "Anyone asks for leave from Leave. Management approves or declines it; the balance of annual leave is worked out for you.":
    "Mtu yeyote anaomba likizo kutoka Likizo. Uongozi unaidhinisha au kukataa; salio la likizo ya mwaka linahesabiwa kwa ajili yako.",
  "Timesheet approval": "Uidhinishaji wa rejista za saa",
  "Each person submits a week of hours; management approves it or sends it back with a note. Approved weeks are locked, so invoices and payroll use checked hours.":
    "Kila mtu anawasilisha wiki ya saa; uongozi unaidhinisha au kuirudisha pamoja na maelezo. Wiki zilizoidhinishwa zinafungwa, hivyo ankara na mishahara vinatumia saa zilizokaguliwa.",
  "Companies that bill for time or pay overtime.": "Kampuni zinazotoza kwa muda au kulipa saa za ziada.",
  "Hours are checked once, before they are invoiced or paid.": "Saa zinakaguliwa mara moja, kabla ya kutolewa ankara au kulipwa.",
  "Submit your week": "Wasilisha wiki yako",
  "In Timesheets, record the hours, then press Submit week.": "Kwenye Rejista za saa, rekodi saa, kisha bonyeza Wasilisha wiki.",
  "Approve": "Idhinisha",
  "Management opens Approve timesheets, checks each week and approves it or sends it back with a note.":
    "Uongozi unafungua Idhinisha rejista za saa, unakagua kila wiki na kuiidhinisha au kuirudisha pamoja na maelezo.",
  "Health & safety (HSE)": "Afya na usalama (HSE)",
  "Report incidents and near misses from the phone, investigate and close them, record site, vehicle and equipment inspections and toolbox talks, and follow up corrective actions.":
    "Ripoti matukio na karibu-ajali kutoka kwenye simu, yachunguze na uyafunge, rekodi ukaguzi wa eneo la kazi, magari na vifaa na mazungumzo ya usalama, na fuatilia hatua za marekebisho.",
  "Companies working on mine sites, construction, transport or with chemicals.": "Kampuni zinazofanya kazi migodini, ujenzi, usafirishaji au na kemikali.",
  "Clients and OSHA ask for safety records: they are ready, and nothing reported is forgotten.":
    "Wateja na OSHA huomba kumbukumbu za usalama: ziko tayari, na hakuna kilichoripotiwa kinachosahaulika.",
  "Report an incident": "Ripoti tukio",
  "Anyone opens Health & safety and presses Report incident: what happened, where, how serious and what was done at once. Management is told at once.":
    "Mtu yeyote anafungua Afya na usalama na kubonyeza Ripoti tukio: kilichotokea, wapi, ukubwa wake na kilichofanyika mara moja. Uongozi unaarifiwa mara moja.",
  "Investigate and act": "Chunguza na uchukue hatua",
  "Management records the root cause, adds corrective actions with an owner and a due date, and closes the incident when they are done.":
    "Uongozi unarekodi chanzo, unaongeza hatua za marekebisho pamoja na mhusika na tarehe ya mwisho, na kufunga tukio zikikamilika.",
  "Inspections and toolbox talks": "Ukaguzi na mazungumzo ya usalama",
  "Record each inspection or talk with the date, the place, the result and who attended.": "Rekodi kila ukaguzi au mazungumzo pamoja na tarehe, mahali, matokeo na waliohudhuria.",
  "Quality (NCRs)": "Ubora (NCR)",
  "Non-conformance reports for wrong or damaged goods from suppliers, client complaints and internal mistakes, with root cause, what was done, the cost and corrective actions.":
    "Ripoti za kasoro kwa bidhaa zisizo sahihi au zilizoharibika kutoka kwa wasambazaji, malalamiko ya wateja na makosa ya ndani, pamoja na chanzo, kilichofanyika, gharama na hatua za marekebisho.",
  "Companies supplying mines, factories or government, often asked for ISO 9001 records.": "Kampuni zinazosambaza migodi, viwanda au serikali, ambazo mara nyingi huombwa kumbukumbu za ISO 9001.",
  "See which supplier or product causes problems, and show clients that complaints are handled.":
    "Ona msambazaji au bidhaa inayoleta matatizo, na waonyeshe wateja kwamba malalamiko yanashughulikiwa.",
  "Raise an NCR": "Andika NCR",
  "Open Quality and press New NCR: where the problem came from, the supplier, client, product or order, and what is wrong.":
    "Fungua Ubora na ubonyeze NCR mpya: tatizo limetoka wapi, msambazaji, mteja, bidhaa au oda, na kipi kina kasoro.",
  "Close it out": "Ifunge",
  "Record the root cause, what was done with the goods and the cost, add corrective actions and close the NCR.":
    "Rekodi chanzo, kilichofanyika na bidhaa na gharama, ongeza hatua za marekebisho na ufunge NCR.",
  "Accounts: ledger & financial statements": "Hesabu: leja na taarifa za fedha",
  "Double-entry books that keep themselves: every invoice, payment, bill, expense and payroll is posted to a chart of accounts. Trial balance, profit & loss, balance sheet, VAT return, journals and closing of months.":
    "Vitabu vya hesabu vya kuingiza pande mbili vinavyojiandika vyenyewe: kila ankara, malipo, bili, matumizi na mishahara vinaingizwa kwenye orodha ya akaunti. Urari, faida na hasara, mizania, ritani ya VAT, jenali na kufunga miezi.",
  "Companies with an accountant, a bank loan, or audited accounts for TRA.": "Kampuni zenye mhasibu, mkopo wa benki, au hesabu zilizokaguliwa kwa ajili ya TRA.",
  "Your accountant gets a trial balance and statements straight from LeMoSp, with every figure traced to the invoice, bill or payment behind it.":
    "Mhasibu wako anapata urari na taarifa za fedha moja kwa moja kutoka LeMoSp, na kila tarakimu inafuatiliwa hadi ankara, bili au malipo yaliyo nyuma yake.",
  "Nothing to post by hand": "Hakuna cha kuingiza kwa mkono",
  "Invoices, payments, supplier bills, expenses and payroll are posted for you. Open Accounts to see the trial balance, profit & loss and balance sheet for any dates.":
    "Ankara, malipo, bili za wasambazaji, matumizi na mishahara vinaingizwa kwa ajili yako. Fungua Hesabu kuona urari, faida na hasara na mizania kwa tarehe zozote.",
  "Opening balances": "Salio za kuanzia",
  "When you start, enter what the bank, cash, loans and capital were on the first day as an opening journal. Unpaid invoices and bills entered in LeMoSp are already in the books.":
    "Unapoanza, ingiza kiasi kilichokuwa benki, fedha taslimu, mikopo na mtaji siku ya kwanza kama jenali ya kuanzia. Ankara na bili ambazo hazijalipwa zilizoingizwa LeMoSp tayari ziko kwenye vitabu.",
  "Journals and closing": "Jenali na kufunga vitabu",
  "Your accountant records adjustments as journals. At month end, management closes the month so nobody changes it again.":
    "Mhasibu wako anarekodi marekebisho kama jenali. Mwisho wa mwezi, uongozi unafunga mwezi ili mtu yeyote asiubadilishe tena.",
  "Fixed assets & depreciation": "Mali za kudumu na uchakavu",
  "A register of vehicles, machines, computers and furniture with cost, life and location; depreciation is posted every month in one tap and sales of assets show the gain or loss.":
    "Daftari la magari, mashine, kompyuta na samani pamoja na gharama, muda wa matumizi na mahali; uchakavu unaingizwa kila mwezi kwa mguso mmoja na mauzo ya mali yanaonyesha faida au hasara.",
  "Companies with vehicles, equipment or machinery.": "Kampuni zenye magari, vifaa au mashine.",
  "Correct depreciation in the accounts and a register ready for the auditor and the insurer.": "Uchakavu sahihi kwenye hesabu na daftari lililo tayari kwa mkaguzi na bima.",
  "Add an asset": "Ongeza mali",
  "Open Accounts → Fixed assets and press Add asset: what it is, when it was bought, the cost, how it was paid and how many years it lasts.":
    "Fungua Hesabu → Mali za kudumu na ubonyeze Ongeza mali: ni nini, ilinunuliwa lini, gharama, ililipwa vipi na inadumu miaka mingapi.",
  "Depreciation": "Uchakavu",
  "Each month press Post depreciation. The amount is spread evenly over the asset's life.": "Kila mwezi bonyeza Ingiza uchakavu. Kiasi kinagawanywa sawa katika muda wa matumizi ya mali.",
  "Payroll (PAYE, NSSF, SDL, WCF)": "Mishahara (PAYE, NSSF, SDL, WCF)",
  "Monthly payroll with PAYE, NSSF, SDL and WCF worked out for you, overtime from approved timesheets, unpaid leave, payslips on each person's phone, and the journals posted to the accounts.":
    "Mishahara ya kila mwezi pamoja na PAYE, NSSF, SDL na WCF zinazohesabiwa kwa ajili yako, saa za ziada kutoka rejista za saa zilizoidhinishwa, likizo bila malipo, hati za mishahara kwenye simu ya kila mtu, na jenali zinazoingizwa kwenye hesabu.",
  "Companies paying salaries every month.": "Kampuni zinazolipa mishahara kila mwezi.",
  "Payroll in minutes, correct statutory figures for TRA, NSSF and WCF returns, and payslips nobody has to print.":
    "Mishahara kwa dakika chache, takwimu sahihi za kisheria kwa ritani za TRA, NSSF na WCF, na hati za mishahara ambazo hakuna anayehitaji kuchapisha.",
  "Pay details": "Taarifa za malipo",
  "Open Payroll → Pay details and enter each employee's basic salary, allowances and how they are paid.":
    "Fungua Mishahara → Taarifa za malipo na uingize mshahara wa msingi wa kila mfanyakazi, posho na jinsi anavyolipwa.",
  "Run the month": "Endesha mwezi",
  "Press New pay run and choose the month. Overtime from approved timesheets and unpaid leave are filled in; add bonuses or deductions, then management approves.":
    "Bonyeza Mzunguko mpya wa mishahara na uchague mwezi. Saa za ziada kutoka rejista zilizoidhinishwa na likizo bila malipo vinajazwa; ongeza bonasi au makato, kisha uongozi unaidhinisha.",
  "Pay and file": "Lipa na uwasilishe",
  "Mark the run paid when the money has gone out. The run shows the PAYE, NSSF, SDL and WCF totals to pay and file; record those payments from the run too.":
    "Weka alama kwamba mzunguko umelipwa fedha zikishatoka. Mzunguko unaonyesha jumla za PAYE, NSSF, SDL na WCF za kulipa na kuwasilisha; rekodi malipo hayo kutoka kwenye mzunguko pia.",

  // Finance hub and guide
  "Administration, payroll and accounts": "Utawala, mishahara na hesabu",
  "Accounts: ledger and financial statements": "Hesabu: leja na taarifa za fedha",
  "Double-entry books that keep themselves, with the trial balance, profit & loss, balance sheet and VAT return.":
    "Vitabu vya pande mbili vinavyojiandika vyenyewe, pamoja na urari, faida na hasara, mizania na ritani ya VAT.",
  "Nothing to post by hand: issued invoices, payments, supplier bills and payments, expenses and payroll go into the books by themselves.":
    "Hakuna cha kuingiza kwa mkono: ankara zilizotolewa, malipo, bili za wasambazaji na malipo yake, matumizi na mishahara vinaingia vitabuni vyenyewe.",
  "Open Accounts for the profit & loss, the balance sheet, the trial balance and the VAT figures for any dates.":
    "Fungua Hesabu kwa faida na hasara, mizania, urari na takwimu za VAT kwa tarehe zozote.",
  "On the first day, enter what the bank, cash, loans and capital were as an opening journal (Journals → + Journal, tick Opening balances).":
    "Siku ya kwanza, ingiza kiasi cha benki, fedha taslimu, mikopo na mtaji kama jenali ya kuanzia (Jenali → + Jenali, weka tiki Salio za kuanzia).",
  "Your accountant records adjustments as journals. A document that is changed or cancelled corrects its own entry.":
    "Mhasibu wako anarekodi marekebisho kama jenali. Hati inayobadilishwa au kufutwa inarekebisha ingizo lake yenyewe.",
  "At month end, management closes the month in Close the books so nobody changes it again.":
    "Mwisho wa mwezi, uongozi unafunga mwezi kwenye Funga vitabu ili mtu yeyote asiubadilishe tena.",
  "If the overview shows a difference or a posting problem, press Post everything again.":
    "Muhtasari ukionyesha tofauti au tatizo la kuingiza, bonyeza Ingiza kila kitu upya.",
  "Each expense category has its own account, so the profit & loss shows fuel, rent and the rest separately.":
    "Kila aina ya matumizi ina akaunti yake, hivyo faida na hasara inaonyesha mafuta, kodi ya pango na mengineyo kando kando.",
  "Vehicles, machines, computers and furniture with their cost, life and monthly depreciation.":
    "Magari, mashine, kompyuta na samani pamoja na gharama, muda wa matumizi na uchakavu wa kila mwezi.",
  "Press + Asset: what it is, when it was bought, the cost, how it was paid and how many years it lasts.":
    "Bonyeza + Mali: ni nini, ilinunuliwa lini, gharama, ililipwa vipi na inadumu miaka mingapi.",
  "Each month press Post depreciation: the cost is spread evenly over the asset's life.":
    "Kila mwezi bonyeza Ingiza uchakavu: gharama inagawanywa sawa katika muda wa matumizi ya mali.",
  "When an asset is sold or scrapped, open it and press Sell or scrap; the gain or loss goes into the accounts.":
    "Mali ikiuzwa au kutupwa, ifungue na ubonyeze Uza au tupa; faida au hasara inaingia kwenye hesabu.",
  "Employees, leave, timesheet approval, payroll, health & safety and quality, working together with the rest of LeMoSp.":
    "Wafanyakazi, likizo, uidhinishaji wa rejista za saa, mishahara, afya na usalama na ubora, vikifanya kazi pamoja na sehemu nyingine za LeMoSp.",
  "An employee file for everyone, with contracts, probation, certificates and licences that expire.":
    "Faili la mfanyakazi kwa kila mtu, pamoja na mikataba, majaribio, vyeti na leseni zinazoisha muda.",
  "Management presses + Employee: name, job, contract and probation dates, NIDA, TIN and NSSF numbers.":
    "Uongozi unabonyeza + Mfanyakazi: jina, kazi, tarehe za mkataba na majaribio, namba za NIDA, TIN na NSSF.",
  "Link the employee to their LeMoSp login so they can ask for leave and see their own file and payslips.":
    "Unganisha mfanyakazi na akaunti yake ya LeMoSp ili aweze kuomba likizo na kuona faili lake na hati za mishahara.",
  "Add certificates and licences with their expiry date. Those ending in the next 30 days show on the dashboard.":
    "Ongeza vyeti na leseni pamoja na tarehe ya kuisha. Vinavyoisha ndani ya siku 30 zijazo vinaonekana kwenye ukurasa wa mwanzo.",
  "When someone leaves, open the file and press Mark as left. Nothing is deleted.": "Mtu akiondoka, fungua faili na ubonyeze Weka ameondoka. Hakuna kinachofutwa.",
  "Everyone sees only their own file. Finance can read files for payroll.": "Kila mtu anaona faili lake tu. Fedha wanaweza kusoma mafaili kwa ajili ya mishahara.",
  "Ask for leave from the phone; management approves it and the balance is worked out for you.":
    "Omba likizo kutoka kwenye simu; uongozi unaidhinisha na salio linahesabiwa kwa ajili yako.",
  "Open Leave, choose the kind of leave, the first and last day and the reason, and press Ask for leave.":
    "Fungua Likizo, chagua aina ya likizo, siku ya kwanza na ya mwisho na sababu, na ubonyeze Omba likizo.",
  "Management is told at once and approves or declines it; you are told the answer.": "Uongozi unaarifiwa mara moja na kuidhinisha au kukataa; unaarifiwa jibu.",
  "Only working days (Monday to Friday) are counted. Annual leave left this year is shown at the top.":
    "Siku za kazi tu (Jumatatu hadi Ijumaa) ndizo zinahesabiwa. Likizo ya mwaka iliyobaki mwaka huu inaonyeshwa juu.",
  "Approved unpaid leave is taken off the pay in the next payroll.": "Likizo bila malipo iliyoidhinishwa inakatwa kwenye mshahara katika mishahara inayofuata.",
  "Each person submits a week of hours; management approves it or sends it back.": "Kila mtu anawasilisha wiki ya saa; uongozi unaidhinisha au kuirudisha.",
  "Record your hours in Timesheets, then press Submit week.": "Rekodi saa zako kwenye Rejista za saa, kisha bonyeza Wasilisha wiki.",
  "Management opens Approve timesheets and approves each week, or sends it back with a note.":
    "Uongozi unafungua Idhinisha rejista za saa na kuidhinisha kila wiki, au kuirudisha pamoja na maelezo.",
  "A submitted or approved week cannot be changed; a week sent back can be fixed and submitted again.":
    "Wiki iliyowasilishwa au kuidhinishwa haiwezi kubadilishwa; wiki iliyorudishwa inaweza kurekebishwa na kuwasilishwa tena.",
  "Hours above 45 in an approved week are paid as overtime in payroll.": "Saa zaidi ya 45 katika wiki iliyoidhinishwa zinalipwa kama saa za ziada kwenye mishahara.",
  "Monthly pay with PAYE, NSSF, SDL and WCF worked out, payslips on the phone and the entries in the accounts.":
    "Mishahara ya kila mwezi pamoja na PAYE, NSSF, SDL na WCF zinazohesabiwa, hati za mishahara kwenye simu na maingizo kwenye hesabu.",
  "In Payroll → Pay details, enter each employee's basic salary, allowances and how they are paid.":
    "Kwenye Mishahara → Taarifa za malipo, ingiza mshahara wa msingi wa kila mfanyakazi, posho na jinsi anavyolipwa.",
  "Press New pay run and choose the month. Overtime and unpaid leave are filled in; add bonuses or deductions.":
    "Bonyeza Mzunguko mpya wa mishahara na uchague mwezi. Saa za ziada na likizo bila malipo vinajazwa; ongeza bonasi au makato.",
  "Management approves the run: it goes into the accounts and each person can see their payslip.":
    "Uongozi unaidhinisha mzunguko: unaingia kwenye hesabu na kila mtu anaweza kuona hati yake ya mshahara.",
  "Mark the run paid when the salaries have gone out, and record the PAYE, SDL, NSSF and WCF payments from the run.":
    "Weka alama kwamba mzunguko umelipwa mishahara ikishatoka, na rekodi malipo ya PAYE, SDL, NSSF na WCF kutoka kwenye mzunguko.",
  "Rates follow Tanzania mainland rules from July 2022; management can change them in Rates & settings when the law changes.":
    "Viwango vinafuata kanuni za Tanzania Bara tangu Julai 2022; uongozi unaweza kuvibadilisha kwenye Viwango na mipangilio sheria ikibadilika.",
  "Report incidents and near misses, investigate them, record inspections and toolbox talks and follow up actions.":
    "Ripoti matukio na karibu-ajali, yachunguze, rekodi ukaguzi na mazungumzo ya usalama na fuatilia hatua.",
  "Anyone presses Report incident: what happened, where, how serious and what was done at once. Management is told at once.":
    "Mtu yeyote anabonyeza Ripoti tukio: kilichotokea, wapi, ukubwa wake na kilichofanyika mara moja. Uongozi unaarifiwa mara moja.",
  "Management records the root cause and adds corrective actions with an owner and a due date.":
    "Uongozi unarekodi chanzo na kuongeza hatua za marekebisho pamoja na mhusika na tarehe ya mwisho.",
  "The owner marks each action done; the incident is closed when every action is finished.":
    "Mhusika anaweka alama kila hatua imekamilika; tukio linafungwa kila hatua ikikamilika.",
  "Record inspections and toolbox talks with the date, place, result and who attended.": "Rekodi ukaguzi na mazungumzo ya usalama pamoja na tarehe, mahali, matokeo na waliohudhuria.",
  "Non-conformance reports for supplier problems, client complaints and internal mistakes.": "Ripoti za kasoro kwa matatizo ya wasambazaji, malalamiko ya wateja na makosa ya ndani.",
  "Press + NCR: where the problem came from, the supplier, client, product or order, and what is wrong.":
    "Bonyeza + NCR: tatizo limetoka wapi, msambazaji, mteja, bidhaa au oda, na kipi kina kasoro.",
  "Record the root cause, what was done with the goods and the cost, and add corrective actions.":
    "Rekodi chanzo, kilichofanyika na bidhaa na gharama, na uongeze hatua za marekebisho.",
  "Management closes the NCR when the actions are done. The list shows which suppliers cause the most problems.":
    "Uongozi unafunga NCR hatua zikikamilika. Orodha inaonyesha wasambazaji wanaoleta matatizo zaidi.",
};
