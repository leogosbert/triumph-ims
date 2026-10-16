// Kiswahili for payroll: pay runs, pay details, payslips and payroll rates (merged into SW in src/lib/sw.ts).
export const SW_PAYROLL: Record<string, string> = {
  // Pay runs list
  "Monthly pay with PAYE, NSSF, SDL and WCF worked out for you, payslips on each person's phone, and the journals posted to the accounts.":
    "Mishahara ya kila mwezi ambapo PAYE, NSSF, SDL na WCF zinakokotolewa kwa ajili yako, hati za mshahara kwenye simu ya kila mtu, na maingizo yanaingizwa kwenye hesabu.",
  "Pay runs": "Malipo ya mishahara",
  "Pay run": "Malipo ya mishahara",
  "Rates & settings": "Viwango na mipangilio",
  "Start with pay details": "Anza na taarifa za mshahara",
  "No employee has pay details yet. Enter each person's basic salary, allowances and how they are paid, then run the month.":
    "Hakuna mfanyakazi mwenye taarifa za mshahara bado. Weka mshahara wa msingi wa kila mtu, posho zake na jinsi anavyolipwa, kisha endesha mishahara ya mwezi.",
  "Enter pay details": "Weka taarifa za mshahara",
  "New pay run": "Mishahara mipya ya mwezi",
  "Pay date": "Tarehe ya malipo",
  "pay date": "tarehe ya malipo",
  "Everyone with pay details who works in that month is added. Overtime from approved timesheets and unpaid leave are filled in.":
    "Kila mwenye taarifa za mshahara anayefanya kazi mwezi huo anaongezwa. Saa za ziada kutoka kwenye rejista za saa zilizoidhinishwa na likizo isiyolipwa zinajazwa.",
  "Working it out…": "Inakokotoa…",
  "Create pay run": "Andaa mishahara",
  "1 pay run is waiting to be approved or paid.": "Mishahara ya mwezi 1 inasubiri kuidhinishwa au kulipwa.",
  "pay runs are waiting to be approved or paid.": "ya mishahara inasubiri kuidhinishwa au kulipwa.",
  "No pay runs yet. Create one for this month above.": "Bado hakuna mishahara iliyoandaliwa. Andaa ya mwezi huu hapo juu.",
  "person": "mtu",
  "Gross": "Jumla ya mshahara",
  "net": "halisi",
  "Payroll rates": "Viwango vya mishahara",

  // Statuses and methods

  // Months
  "January": "Januari",
  "February": "Februari",
  "March": "Machi",
  "April": "Aprili",
  "November": "Novemba",
  "December": "Desemba",

  // Pay run
  "← Payroll": "← Mishahara",
  "approved": "imeidhinishwa",
  "paid": "imelipwa",
  "Gross pay": "Jumla ya mshahara (ghafi)",
  "PAYE": "PAYE",
  "NSSF": "NSSF",
  "SDL": "SDL",
  "WCF": "WCF",
  "TRA": "TRA",
  "NSSF employee": "NSSF ya mfanyakazi",
  "NSSF employer": "NSSF ya mwajiri",
  "Other deductions": "Makato mengine",
  "Net to pay": "Mshahara halisi wa kulipa",
  "Total cost to the company": "Gharama yote kwa kampuni",
  "Total cost to the company is gross pay plus employer NSSF, SDL and WCF.":
    "Gharama yote kwa kampuni ni jumla ya mshahara pamoja na NSSF ya mwajiri, SDL na WCF.",
  "Check and approve": "Kagua na uidhinishe",
  "This pay run is a draft. Change overtime, bonuses, deductions or unpaid days below. When it is right, management approves it: it is posted to the accounts and each person sees their payslip.":
    "Mishahara hii bado ni rasimu. Badilisha saa za ziada, bonasi, makato au siku zisizolipwa hapa chini. Ikiwa sawa, uongozi unaidhinisha: inaingizwa kwenye hesabu na kila mtu anaona hati yake ya mshahara.",
  "Refresh from pay details, leave and timesheets": "Sasisha kutoka taarifa za mshahara, likizo na rejista za saa",
  "Refreshing…": "Inasasisha…",
  "Approving…": "Inaidhinisha…",
  "Management approves the pay run.": "Uongozi ndio unaidhinisha mishahara.",
  "Mark as paid": "Weka kuwa imelipwa",
  "When the salaries have gone out. Use the payment list below for the bank or mobile money.":
    "Mishahara ikishatumwa. Tumia orodha ya malipo hapa chini kwa benki au pesa za simu.",
  "Payslips": "Hati za mshahara",
  "Nobody is in this pay run. Refresh it after entering pay details.":
    "Hakuna mtu kwenye mishahara hii. Isasishe baada ya kuweka taarifa za mshahara.",
  "Basic": "Msingi",
  "Allowances": "Posho",
  "allowances": "posho",
  "Overtime": "Saa za ziada",
  "Bonus": "Bonasi",
  "Unpaid days": "Siku zisizolipwa",
  "Deductions": "Makato",
  "Net": "Halisi",
  "Change a payslip": "Badilisha hati ya mshahara",
  "Overtime hours are paid at the overtime rate. Unpaid days are working days of unpaid leave.":
    "Saa za ziada zinalipwa kwa kiwango cha saa za ziada. Siku zisizolipwa ni siku za kazi za likizo isiyolipwa.",
  "Overtime hours": "Saa za ziada",
  "Remove from this pay run": "Ondoa kwenye mishahara hii",
  "Statutory payments": "Malipo ya kisheria",
  "What to pay and file for this month. Record each payment once, when it has been made.":
    "Unachopaswa kulipa na kuwasilisha kwa mwezi huu. Rekodi kila malipo mara moja, yakishafanyika.",
  "NSSF (employee + employer)": "NSSF (mfanyakazi + mwajiri)",
  "Lenders and others": "Wakopeshaji na wengine",
  "with PAYE": "pamoja na PAYE",
  "e.g. control number or receipt": "mf. namba ya malipo (control number) au risiti",
  "Payments recorded since this run was approved": "Malipo yaliyorekodiwa tangu mishahara hii iidhinishwe",
  "Downloads": "Vya kupakua",
  "Lists to open in Excel: for the bank or mobile money, and for the PAYE and NSSF returns.":
    "Orodha za kufungua kwenye Excel: kwa benki au pesa za simu, na kwa ritani za PAYE na NSSF.",
  "Payment list": "Orodha ya malipo",
  "PAYE list": "Orodha ya PAYE",
  "NSSF list": "Orodha ya NSSF",
  "Cancel this pay run": "Ghairi mishahara hii",
  "The journal posted to the accounts is reversed and payslips are hidden again.":
    "Ingizo lililowekwa kwenye hesabu linarudishwa na hati za mshahara zinafichwa tena.",
  "The draft is set aside. You can create a new pay run for the month.":
    "Rasimu inawekwa pembeni. Unaweza kuandaa mishahara mipya ya mwezi huo.",
  "Cancel pay run": "Ghairi mishahara",

  // Payslip
  "Payslip": "Hati ya mshahara",
  "← Pay run": "← Mishahara ya mwezi",
  "← My payslips": "← Hati zangu za mshahara",
  "Earnings": "Mapato",
  "Basic salary": "Mshahara wa msingi",
  "hours": "saa",
  "Less unpaid leave": "Toa likizo isiyolipwa",
  "NSSF (employee)": "NSSF (mfanyakazi)",
  "NSSF (employer)": "NSSF (mwajiri)",
  "PAYE (income tax)": "PAYE (kodi ya mapato ya ajira)",
  "Total deductions": "Jumla ya makato",
  "Net pay": "Mshahara halisi",
  "Paid by the employer (not taken from your pay)": "Inalipwa na mwajiri (haikatwi kwenye mshahara wako)",
  "SDL (skills development levy)": "SDL (tozo ya kuendeleza ujuzi)",
  "WCF (workers compensation)": "WCF (fidia kwa wafanyakazi)",
  "Total paid by the employer": "Jumla inayolipwa na mwajiri",

  // My payslips
  "Your monthly payslips appear here once management has approved the pay run.":
    "Hati zako za mshahara za kila mwezi zinaonekana hapa baada ya uongozi kuidhinisha mishahara.",
  "No payslips yet. When your company runs payroll and you are linked to your employee record, your payslips will show here.":
    "Bado hakuna hati za mshahara. Kampuni yako ikiandaa mishahara na ukiwa umeunganishwa na kumbukumbu yako ya mfanyakazi, hati zako zitaonekana hapa.",

  // Pay details
  "← Pay details": "← Taarifa za mshahara",
  "Each employee's basic salary, allowances, monthly deduction and how they are paid. Only management and finance see this.":
    "Mshahara wa msingi wa kila mfanyakazi, posho, makato ya kila mwezi na jinsi anavyolipwa. Ni uongozi na fedha pekee wanaoona hii.",
  "No employees yet. Management adds employees first, then you enter their pay here.":
    "Bado hakuna wafanyakazi. Uongozi unaongeza wafanyakazi kwanza, kisha unaweka mishahara yao hapa.",
  "Go to employees": "Nenda kwa wafanyakazi",
  "1 employee has no pay details yet and will not be paid.": "Mfanyakazi 1 hana taarifa za mshahara bado na hatalipwa.",
  "employees have no pay details yet and will not be paid.": "hawana taarifa za mshahara bado na hawatalipwa.",
  "NSSF no.": "Namba ya NSSF",
  "The TIN or NSSF number is missing. Add it on the employee file so the PAYE and NSSF lists are complete.":
    "TIN au namba ya NSSF haipo. Iweke kwenye faili la mfanyakazi ili orodha za PAYE na NSSF zikamilike.",
  "Salary and allowances": "Mshahara na posho",
  "Housing allowance": "Posho ya nyumba",
  "Transport allowance": "Posho ya usafiri",
  "Other allowance": "Posho nyingine",
  "Monthly deduction": "Makato ya kila mwezi",
  "What the deduction is for": "Makato ni ya nini",
  "e.g. salary advance, loan": "mf. malipo ya awali ya mshahara, mkopo",
  "Tax and overtime": "Kodi na saa za ziada",
  "NSSF member": "Mwanachama wa NSSF",
  "Exempt from PAYE": "Hakatwi PAYE",
  "Paid overtime (from approved timesheets)": "Analipwa saa za ziada (kutoka rejista za saa zilizoidhinishwa)",
  "How they are paid": "Jinsi anavyolipwa",
  "Pay method": "Njia ya malipo",
  "Bank name": "Jina la benki",
  "e.g. CRDB": "mf. CRDB",
  "Account number": "Namba ya akaunti",
  "Mobile money number": "Namba ya pesa za simu",
  "Monthly estimate": "Makadirio ya mwezi",
  "A normal month without overtime, bonus or unpaid leave. The pay run works out the real figures.":
    "Mwezi wa kawaida bila saa za ziada, bonasi wala likizo isiyolipwa. Mishahara ya mwezi ndiyo inakokotoa takwimu halisi.",
  "taxable": "kinachotozwa kodi",
  "Paid by the employer: NSSF, SDL and WCF": "Inalipwa na mwajiri: NSSF, SDL na WCF",
  "Save pay details": "Hifadhi taarifa za mshahara",

  // Rates & settings
  "These rates follow the Tanzania mainland rules from July 2022. Check them whenever the budget changes the law.":
    "Viwango hivi vinafuata sheria za Tanzania Bara tangu Julai 2022. Vikague kila bajeti inapobadilisha sheria.",
  "Last changed": "Ilibadilishwa mwisho",
  "These are the standard rates. They are saved for your company the first time you run payroll or save them.":
    "Hivi ni viwango vya kawaida. Vinahifadhiwa kwa kampuni yako mara ya kwanza unapoandaa mishahara au unapovihifadhi.",
  "PAYE bands (monthly)": "Ngazi za PAYE (kwa mwezi)",
  "Each rate is charged on the part of taxable pay above its starting amount, up to the next band. Taxable pay is gross pay less the employee's NSSF.":
    "Kila kiwango kinatozwa kwenye sehemu ya mshahara unaotozwa kodi iliyo juu ya kiasi chake cha kuanzia, hadi ngazi inayofuata. Mshahara unaotozwa kodi ni jumla ya mshahara toa NSSF ya mfanyakazi.",
  "Rate %": "Kiwango %",
  "Leave a row empty to remove it. Empty rows are for new bands.": "Acha mstari wazi ili kuuondoa. Mistari iliyo wazi ni kwa ngazi mpya.",
  "and above": "na zaidi",
  "NSSF, SDL, WCF and overtime": "NSSF, SDL, WCF na saa za ziada",
  "NSSF from the employee": "NSSF kutoka kwa mfanyakazi",
  "NSSF from the employer": "NSSF kutoka kwa mwajiri",
  "SDL applies from this many employees": "SDL inaanza kuanzia idadi hii ya wafanyakazi",
  "Overtime after hours per week": "Saa za ziada baada ya saa hizi kwa wiki",
  "Overtime rate (times the hourly pay)": "Kiwango cha saa za ziada (mara malipo ya saa moja)",
  "Working hours in a month (for the hourly pay)": "Saa za kazi kwa mwezi (kwa malipo ya saa moja)",
  "Hourly pay is the basic salary divided by the working hours in a month. SDL is only charged when the company has at least the number of employees set here.":
    "Malipo ya saa moja ni mshahara wa msingi ukigawanywa kwa saa za kazi za mwezi. SDL inatozwa tu kampuni ikiwa na angalau idadi ya wafanyakazi iliyowekwa hapa.",
  "Save rates": "Hifadhi viwango",

  // Notices
  "Pay run created. Check each person, then approve it.": "Mishahara imeandaliwa. Kagua kila mtu, kisha uidhinishe.",
  "Payslip updated.": "Hati ya mshahara imesasishwa.",
  "Removed from this pay run.": "Ameondolewa kwenye mishahara hii.",
  "Pay run refreshed from pay details, leave and timesheets.": "Mishahara imesasishwa kutoka taarifa za mshahara, likizo na rejista za saa.",
  "Pay run approved and posted to the accounts. Payslips are now on each person's phone.":
    "Mishahara imeidhinishwa na kuingizwa kwenye hesabu. Hati za mshahara sasa ziko kwenye simu ya kila mtu.",
  "Pay run cancelled.": "Mishahara imeghairiwa.",
  "Salaries marked as paid.": "Mishahara imewekwa kuwa imelipwa.",
  "Payment recorded in the accounts.": "Malipo yamerekodiwa kwenye hesabu.",
  "Pay details saved. Draft pay runs pick them up when you refresh them.":
    "Taarifa za mshahara zimehifadhiwa. Mishahara iliyo rasimu itazichukua utakapoisasisha.",
  "Payroll rates saved. New and refreshed pay runs use them.": "Viwango vya mishahara vimehifadhiwa. Mishahara mipya na iliyosasishwa itavitumia.",

  // Errors (screen checks and the database)
  "Choose the pay date.": "Chagua tarehe ya malipo.",
  "Choose the date paid.": "Chagua tarehe ya kulipa.",
  "The reference is too long.": "Kumbukumbu ni ndefu mno.",
  "Amounts must be numbers of zero or more.": "Kiasi lazima kiwe namba ya sifuri au zaidi.",
  "Some details are too long.": "Baadhi ya taarifa ni ndefu mno.",
  "Enter the bank account number, or choose another way to pay.": "Weka namba ya akaunti ya benki, au chagua njia nyingine ya kulipa.",
  "Enter the mobile money number, or choose another way to pay.": "Weka namba ya pesa za simu, au chagua njia nyingine ya kulipa.",
  "Check the rates: one of them is out of range.": "Kagua viwango: kimoja kiko nje ya kiwango kinachoruhusiwa.",
  "Only management or finance can run payroll.": "Ni uongozi au fedha pekee wanaoweza kuandaa mishahara.",
  "Choose this month or an earlier one.": "Chagua mwezi huu au wa nyuma.",
  "There is already a pay run for that month.": "Tayari kuna mishahara iliyoandaliwa kwa mwezi huo.",
  "Enter the pay details of your employees first.": "Weka kwanza taarifa za mshahara za wafanyakazi wako.",
  "Pay run not found.": "Mishahara haikupatikana.",
  "Only a draft pay run can be changed.": "Ni mishahara iliyo rasimu pekee inayoweza kubadilishwa.",
  "Payslip not found.": "Hati ya mshahara haikupatikana.",
  "Amounts cannot be negative.": "Kiasi hakiwezi kuwa hasi.",
  "Only management can approve payroll.": "Ni uongozi pekee unaoweza kuidhinisha mishahara.",
  "This pay run is not a draft.": "Mishahara hii si rasimu.",
  "The pay run is empty.": "Mishahara hii haina mtu.",
  "Someone's deductions are more than their pay. Check the payslips.": "Makato ya mtu mmoja ni zaidi ya mshahara wake. Kagua hati za mshahara.",
  "Only management or finance can do this.": "Ni uongozi au fedha pekee wanaoweza kufanya hivi.",
  "Only an approved pay run can be paid.": "Ni mishahara iliyoidhinishwa pekee inayoweza kulipwa.",
  "Unknown payment method.": "Njia ya malipo haijulikani.",
  "Choose PAYE, NSSF, SDL, WCF or other deductions.": "Chagua PAYE, NSSF, SDL, WCF au makato mengine.",
  "Only management can cancel an approved pay run.": "Ni uongozi pekee unaoweza kughairi mishahara iliyoidhinishwa.",
  "A paid or cancelled pay run cannot be cancelled.": "Mishahara iliyolipwa au iliyoghairiwa haiwezi kughairiwa.",
  "Only management can change payroll rates.": "Ni uongozi pekee unaoweza kubadilisha viwango vya mishahara.",
  "Each tax band needs a starting amount and a rate between 0 and 100.": "Kila ngazi ya kodi inahitaji kiasi cha kuanzia na kiwango kati ya 0 na 100.",
  "Use the buttons on the pay run.": "Tumia vitufe vilivyo kwenye mishahara ya mwezi.",
};
