import type { Playbook } from "./types";

/**
 * Playbook: running a business that only sells services (installers, repair and maintenance firms,
 * consultants, engineers, cleaning, security and facility firms, transport). Registering (BRELA, TRA, VAT,
 * withholding tax, professional bodies), setting LeMoSp up for services, service jobs, maintenance
 * contracts, equipment, hire, projects and timesheets, pricing and withholding tax, other ways of
 * supplying and a monthly routine with the service reports.
 * Kiswahili: src/lib/playbooks/sw/services-business.ts.
 */
export const SERVICES_BUSINESS: Playbook = {
  id: "services-business",
  title: "Run a services business",
  tagline: "Plan the work, send the right people, record every hour and material, and invoice each job the day it is done.",
  audience: "Owners and managers of installers, repair and maintenance firms, consultants, engineers, cleaning, security and transport companies.",
  minutes: 40,
  icon: "team",
  color: "#4f46e5",
  chapters: [
    {
      id: "register",
      title: "Register and set up the company",
      intro:
        "A services business sells time, skill and trust. Clients, especially companies and the government, will ask for your registration, tax papers and professional certificates before they give you work. Rules change, so confirm the current ones with TRA or your accountant.",
      steps: [
        {
          id: "brela",
          title: "Register the business with BRELA",
          body:
            "A business name suits a single consultant or a small team; the owners are personally liable. A company limited by shares is a separate legal person and is often required for contracts, tenders and professional registration.",
          do: [
            "Choose between a business name and a company. For engineering, contracting or security work, a company is usually expected.",
            "Search and reserve the name on the BRELA online system, then register and pay the fee.",
            "Keep the certificate of registration (or incorporation). Its number goes into LeMoSp as the Registration number.",
            "A company files an annual return with BRELA every year.",
          ],
          who: "Owner",
          example: {
            kind: "Registration",
            title: "Pwani Cooling Services Ltd",
            lines: [
              ["Type", "Company limited by shares"],
              ["Directors", "Musa Kombo, Halima Kombo"],
              ["Office", "Mikocheni, Dar es Salaam"],
            ],
            stamp: "Registered",
            tone: "ok",
          },
          scales: "all",
        },
        {
          id: "tax",
          title: "Get a TIN, decide on VAT and understand withholding tax",
          body:
            "Every business needs a TIN from TRA. You must register for VAT when sales reach TZS 200 million in twelve months, and some professional services must register whatever their turnover. VAT is 18%. Many clients also withhold part of what they pay you for services.",
          do: [
            "Apply for the business TIN at TRA with the BRELA certificate and the directors' TINs and NIDA numbers.",
            "Ask your accountant whether your kind of service must register for VAT now.",
            "Use an EFD machine or a VFD to issue a fiscal receipt for every sale, as TRA requires.",
            "Expect withholding tax: companies and government bodies may withhold 5% of the service fee when they pay a resident, and pay it to TRA for you.",
            "Collect the withholding tax certificate for every amount withheld. You claim it against your income tax, so a lost certificate is lost money.",
          ],
          who: "Owner with your accountant",
          example: {
            kind: "Withholding tax",
            title: "INV-2026-0112",
            lines: [
              ["Service fee", "TZS 2,000,000"],
              ["VAT 18%", "TZS 360,000"],
              ["Withheld by client (5% of the fee)", "TZS 100,000"],
              ["Paid to you", "TZS 2,260,000"],
              ["Certificate", "Claim against your income tax"],
            ],
            mark: 2,
            stamp: "Certificate due",
            tone: "warn",
          },
          tip: "These are the main rules at the time of writing. Tax rules change with each budget, so confirm current rates and thresholds with TRA or your accountant.",
          scales: "all",
        },
        {
          id: "licence-professional",
          title: "Get your licence and professional registration",
          body:
            "Besides the business licence, many services need registration with a professional or safety body. Clients and tender boards ask for these certificates, and some work is illegal without them.",
          do: [
            "Apply for the business licence for your office and renew it every year.",
            "Engineers and engineering consulting firms: register with ERB (Engineers Registration Board).",
            "Builders and installation contractors: register with CRB (Contractors Registration Board) in the right class.",
            "Electrical installation work needs a licence from EWURA; workplaces register with OSHA for health and safety.",
            "Take insurance: professional indemnity for consultants, public liability for work at client sites.",
            "Scan each certificate into Documents with its expiry date, so the app reminds you before it ends.",
          ],
          where: ["Company & account", "Documents"],
          href: "/documents",
          who: "Owner or Management",
          example: {
            kind: "Documents",
            title: "Pwani Cooling Services Ltd",
            lines: [
              ["Business licence", "Expires 30 Jun 2027"],
              ["CRB registration", "Expires 31 Dec 2026"],
              ["OSHA workplace registration", "Current"],
              ["Public liability insurance", "Expires 15 Nov 2026"],
            ],
            mark: 3,
            stamp: "Renew soon",
            tone: "warn",
          },
          scales: "all",
        },
        {
          id: "staff-money",
          title: "Register your staff and open your accounts",
          body:
            "In a services business your people are the product. Register as an employer, protect them at work, and keep business money apart from personal money.",
          do: [
            "Register with NSSF (pension) and WCF (workers' compensation) and pay the contributions every month. WCF matters most for staff who work at heights, with electricity or on the road.",
            "Deduct PAYE from salaries and pay it to TRA every month. With ten or more employees, SDL is also due.",
            "Open a bank account in the business name and a mobile money lipa number.",
            "Put the bank details and pay numbers in Company details & branding: they are printed on every invoice.",
          ],
          where: ["Settings", "Company details & branding"],
          href: "/settings/company",
          who: "Owner with your accountant",
          scales: "all",
        },
      ],
    },
    {
      id: "configure",
      title: "Set up LeMoSp for a services business",
      intro:
        "Tell LeMoSp you sell services and it switches on service jobs, maintenance, equipment, projects and timesheets, and hides what a services business does not need. Small, Medium and Enterprise are modes of one app; changing level never removes data.",
      steps: [
        {
          id: "what-you-sell",
          title: "Choose Services and your business level",
          body:
            "What you sell decides which screens you see. Choosing Services switches on Service jobs, Maintenance contracts, Equipment, Projects, Timesheets and Service reports.",
          do: [
            "Open Features & business level.",
            "Under What you sell, choose Services.",
            "Choose your level: Small for a few people, Medium for teams of technicians, Enterprise for branches, approval steps and budgets.",
            "Switch single features on or off, for example Equipment hire if you also rent out machines.",
          ],
          where: ["Settings", "Features & business level"],
          href: "/settings/features",
          who: "Management",
          example: {
            kind: "Features & business level",
            title: "Pwani Cooling Services Ltd",
            lines: [
              ["What you sell", "Services"],
              ["Business level", "Medium"],
              ["Service jobs", "On"],
              ["Maintenance contracts", "On"],
              ["Timesheets & billable hours", "On"],
            ],
            mark: 0,
            stamp: "Saved",
            tone: "ok",
          },
          tip: "Start selling spare parts too? Change What you sell to Goods and services. Nothing you recorded is lost.",
          scales: "all",
        },
        {
          id: "company-rules",
          title: "Set VAT, withholding tax and invoice terms",
          body:
            "Company details & branding holds the rules for every quotation and invoice. The withholding tax rate is what invoices show a client may deduct from the service lines.",
          do: [
            "Open Company details & branding.",
            "Enter the Registered name, TIN and, if VAT registered, the VRN.",
            "Set the VAT rate % to 18, or 0 if you are not registered for VAT.",
            "Set the Withholding tax on services % to 5, the usual rate on services by residents.",
            "Set Clients pay within (days) and write the Standard invoice terms, for example \"Call-out fee is charged even if no repair is possible.\" Press Save company details.",
          ],
          where: ["Settings", "Company details & branding"],
          href: "/settings/company",
          who: "Management",
          example: {
            kind: "Company details",
            title: "Pwani Cooling Services Ltd",
            lines: [
              ["VAT rate %", "18"],
              ["Withholding tax on services %", "5"],
              ["Clients pay within (days)", "30"],
              ["Standard invoice terms", "Call-out fee charged on every visit"],
            ],
            mark: 1,
            stamp: "Saved",
            tone: "info",
          },
          scales: "all",
        },
        {
          id: "service-items",
          title: "Add your services as items with a type and unit",
          body:
            "Services are items in Products too, so they can go on quotations and invoices. Their Type keeps them out of stock counts and tells the invoice which lines carry withholding tax.",
          do: [
            "Open Products and press + New product.",
            "Choose the Type: Service for work you sell, Labour for hours of a technician, Consultancy for advice and design, Hire for equipment you rent out.",
            "Choose the unit you charge in: hour, day, visit or job.",
            "Enter the price and press Add product.",
            "Spare parts and gas you use on jobs are Type Goods, so they are counted in stock.",
          ],
          where: ["Stock & delivery", "Products"],
          href: "/products",
          who: "Management",
          example: {
            kind: "Products",
            title: "Pwani Cooling Services Ltd",
            lines: [
              ["Technician labour", "Labour · hour · TZS 22,000"],
              ["Call-out fee, Dar es Salaam", "Service · visit · TZS 50,000"],
              ["AC service, split unit", "Service · job · TZS 60,000"],
              ["Energy audit", "Consultancy · day · TZS 600,000"],
              ["Refrigerant gas R410A", "Goods · kg · TZS 45,000"],
            ],
            mark: 0,
            stamp: "Added",
            tone: "info",
          },
          scales: "all",
        },
        {
          id: "team",
          title: "Invite your team with the right roles",
          body:
            "Technicians do not need to see finance. Each person sees what their job needs; technicians see the jobs they are assigned to on their phone.",
          do: [
            "Open Team & roles and invite each person by email.",
            "Management: owner and managers. Sales: clients, quotations, jobs and contracts. Finance: invoices and payments.",
            "Technicians can be given the Warehouse role, so they can take materials from stock, or any role that fits; they see the jobs they are on.",
            "Procurement buys parts; Driver is for staff who only deliver.",
          ],
          where: ["Settings", "Team & roles"],
          href: "/settings/team",
          who: "Management",
          scales: "all",
        },
      ],
    },
    {
      id: "jobs",
      title: "Run service jobs from start to invoice",
      intro:
        "A service job is one piece of work at a client site: an installation, repair, maintenance visit, inspection or consultation. It holds who goes, what to check, what was used and the client's signature, and it ends in an invoice.",
      steps: [
        {
          id: "new-job",
          title: "Create the job and send the technicians",
          body:
            "Every call from a client becomes a job, so nothing is forgotten and every job is invoiced.",
          do: [
            "Open Service jobs and press + Job.",
            "Choose the client and the kind of work: installation, repair, maintenance, inspection or consultation.",
            "Enter the site, contact person, date and priority, and choose the technicians.",
            "Add the checklist: the steps the technician must tick on site.",
            "If you agreed a fixed price, enter it; otherwise the materials and labour lines are billed.",
          ],
          where: ["Services", "Service jobs"],
          href: "/jobs",
          who: "Sales or Management",
          example: {
            kind: "Service job",
            title: "JOB-0042",
            lines: [
              ["Client", "Upanga Medical Centre"],
              ["Kind", "Repair"],
              ["Site", "Ward 3, Upanga, Dar es Salaam"],
              ["Technicians", "Elia Mwita, Said Ali"],
              ["Priority", "Urgent"],
            ],
            mark: 4,
            stamp: "Scheduled",
            tone: "info",
          },
          scales: "medium+",
        },
        {
          id: "on-site",
          title: "Do the work and record it on the phone",
          body:
            "The technician records the work while on site, not days later from memory. Materials taken from stock and hours worked go on the job as they are used.",
          do: [
            "The technician opens the job on the phone and ticks the checklist.",
            "Press + Add material or work for each part used from stock and for the labour hours.",
            "Write the findings: what was wrong and what was done.",
          ],
          where: ["Services", "Service jobs"],
          href: "/jobs",
          who: "Technician",
          example: {
            kind: "Service job",
            title: "JOB-0042",
            lines: [
              ["Checklist", "Pressure test, clean coils, check drain"],
              ["Refrigerant gas R410A", "2 kg"],
              ["Technician labour", "6 hour"],
              ["Findings", "Leaking valve replaced, gas refilled"],
            ],
            mark: 3,
            stamp: "In progress",
            tone: "info",
          },
          scenarios: [
            {
              title: "A part is needed that you do not have",
              problem: "Elia finds the compressor is dead. You have no compressor in stock.",
              fix: [
                "Write the finding on the job and press Put on hold.",
                "Send the client a quotation for the compressor and the extra labour.",
                "When the client accepts, buy the part, then press Start the job again and finish it.",
              ],
              tone: "warn",
            },
          ],
          scales: "medium+",
        },
        {
          id: "complete",
          title: "Client signs off, then Make invoice",
          body:
            "The client's signature on the phone is the proof the work was done. Signing off the job takes the materials out of stock; finance then turns it into an invoice in one step.",
          do: [
            "The client checks the work and signs on the technician's phone with their name.",
            "The technician presses Finish and sign off. The materials leave stock.",
            "Finance opens the completed job and presses Make invoice: labour, materials and the agreed price become a draft invoice.",
            "Check it and press Issue invoice.",
          ],
          where: ["Services", "Service jobs"],
          href: "/jobs",
          who: "Technician, then Finance",
          example: {
            kind: "Invoice",
            title: "INV-2026-0117",
            lines: [
              ["Service job", "JOB-0042"],
              ["Technician labour", "6 hour × TZS 22,000"],
              ["Refrigerant gas R410A", "2 kg × TZS 45,000"],
              ["Call-out fee, Dar es Salaam", "1 visit × TZS 50,000"],
              ["Total incl. VAT", "TZS 320,960"],
            ],
            mark: 4,
            stamp: "Issued",
            tone: "ok",
          },
          scenarios: [
            {
              title: "Jobs are done but never invoiced",
              problem: "At month end, eight completed jobs have no invoice and the technicians have moved on.",
              fix: [
                "Open Service jobs and look at Completed, not invoiced.",
                "Press Make invoice on each one today.",
                "Make it a rule: finance checks completed jobs every morning.",
              ],
              tone: "bad",
            },
          ],
          scales: "medium+",
        },
      ],
    },
    {
      id: "contracts-equipment",
      title: "Maintenance contracts, equipment and hire",
      intro:
        "Regular contracts bring steady income every month. The equipment register tells you what you look after, and hire earns from machines you own.",
      steps: [
        {
          id: "maintenance",
          title: "Record maintenance contracts",
          body:
            "A maintenance contract is an agreement to service a client's equipment at a fixed frequency for a price per period. LeMoSp plans the visits so none is missed.",
          do: [
            "Open Maintenance contracts and press + Contract.",
            "Choose the client and how often: Every month, Every 3 months, Every 6 months or Every year.",
            "Enter the first visit date, the price per period, the site and what to check on each visit.",
            "Press Plan due visits: each visit becomes a service job two weeks before it is due, with its checklist. Assign the technician.",
          ],
          where: ["Services", "Maintenance contracts"],
          href: "/maintenance",
          who: "Sales or Management",
          example: {
            kind: "Maintenance contract",
            title: "MC-007",
            lines: [
              ["Client", "Bahari Apartments, Msasani"],
              ["What", "Service of 24 split AC units"],
              ["How often", "Every 3 months"],
              ["Price per period", "TZS 2,400,000"],
              ["Next visit", "3 Nov 2026"],
            ],
            mark: 2,
            stamp: "Active",
            tone: "ok",
          },
          scenarios: [
            {
              title: "A client wants to stop for a few months",
              problem: "Bahari Apartments is renovating and asks you to stop visits until February.",
              fix: [
                "Open the contract and pause it. No new visit jobs are planned while it is paused.",
                "Note the reason and the restart date on the contract.",
                "Make it Active again in February and press Plan due visits.",
              ],
              tone: "info",
            },
          ],
          scales: "medium+",
        },
        {
          id: "equipment",
          title: "Keep an equipment register",
          body:
            "The register lists everything you installed or look after at each client: serial number, location, warranty and next service. Each job on a unit is kept in its history.",
          do: [
            "Open Equipment and press + Equipment.",
            "Choose the client, enter the item, serial number and where it is.",
            "Enter the install date, warranty end and how often it needs service.",
            "Warranties ending soon and services due show at the top. Call those clients first.",
          ],
          where: ["Services", "Equipment"],
          href: "/equipment",
          who: "Sales or Technician",
          example: {
            kind: "Equipment",
            title: "Split AC 24,000 BTU",
            lines: [
              ["Client", "Upanga Medical Centre"],
              ["Serial number", "SN 24K-7781"],
              ["Location", "Ward 3"],
              ["Warranty ends", "12 Jan 2027"],
              ["Next service", "3 Dec 2026"],
            ],
            mark: 4,
            stamp: "Due soon",
            tone: "warn",
          },
          tip: "A warranty ending is the best moment to offer a maintenance contract.",
          scales: "medium+",
        },
        {
          id: "hire",
          title: "Hire out equipment you own",
          body:
            "If you rent out generators, scaffolding, pumps or tools, Equipment hire shows what is out, with whom, when it is due back, and bills every day on hire.",
          do: [
            "In Products, set the item's Type to Hire and receive the units you own into a store.",
            "Open Equipment hire and press + Hire: client, site, date out and date due back, then the items with the rate per day, week or month.",
            "When the items come back, press Record return, then Make invoice.",
            "For long hires, invoice every month while the items are still out.",
          ],
          where: ["Services", "Equipment hire"],
          href: "/hire",
          who: "Sales and Warehouse",
          example: {
            kind: "Equipment hire",
            title: "HIRE-0019",
            lines: [
              ["Client", "Dodoma Builders"],
              ["Generator 60 kVA", "1 pcs × TZS 180,000 a day"],
              ["Out", "1 Oct 2026"],
              ["Due back", "10 Oct 2026"],
              ["Returned", "Not yet"],
            ],
            mark: 4,
            stamp: "Late",
            tone: "bad",
          },
          scales: "medium+",
        },
      ],
    },
    {
      id: "projects-time",
      title: "Projects, consulting and timesheets",
      intro:
        "Bigger pieces of work, such as a design, a study or a large installation, run as projects. Everyone records their hours, so you can bill time and see whether the project is making money.",
      steps: [
        {
          id: "project",
          title: "Start a project and choose how it is billed",
          body:
            "A project can be billed at a fixed price, by milestone or by the time spent. Choose what the client agreed in the contract.",
          do: [
            "Open Projects and press + Project.",
            "Choose the client and How it is billed: Fixed price, By milestone or By time (hours).",
            "Enter the budget in money and hours, and the default hourly rate.",
            "For milestone billing, add each milestone with its amount, for example survey, design report, tender documents.",
          ],
          where: ["Services", "Projects"],
          href: "/projects",
          who: "Management",
          example: {
            kind: "Project",
            title: "PRJ-012",
            lines: [
              ["Client", "Kibaha District Council"],
              ["Name", "Water supply design, Kibaha"],
              ["Billed", "By milestone"],
              ["Site survey", "TZS 6,000,000 · Invoiced"],
              ["Design report", "TZS 12,000,000 · Done"],
              ["Tender documents", "TZS 7,000,000 · Open"],
            ],
            mark: 4,
            stamp: "Active",
            tone: "info",
          },
          scales: "enterprise",
        },
        {
          id: "timesheets",
          title: "Record hours in Timesheets",
          body:
            "Every hour on a job or project is recorded, billable or not. Management sets each person's hourly rate and cost once, so invoices and profit use the right figures.",
          do: [
            "Management opens Timesheets, then Team rates, and sets each person's Hourly rate charged and Cost per hour.",
            "Each person opens Timesheets daily and presses Record hours: the day, the job or project, the hours and what they did.",
            "Untick Billable to the client for time the client should not pay for, such as travel included in the price.",
          ],
          where: ["Services", "Timesheets"],
          href: "/timesheets",
          who: "Everyone; Management sets rates",
          example: {
            kind: "Timesheet",
            title: "Eng. Grace Lyimo",
            lines: [
              ["Project", "PRJ-012"],
              ["Hours", "7.5"],
              ["What was done", "Pipe network calculations"],
              ["Hourly rate charged", "TZS 85,000"],
              ["Cost per hour", "TZS 40,000"],
            ],
            mark: 3,
            stamp: "Billable",
            tone: "ok",
          },
          scenarios: [
            {
              title: "The project is using more hours than budgeted",
              problem: "PRJ-012 had a budget of 400 hours; 360 are used and the design report is not finished.",
              fix: [
                "Open the project and compare hours used with the budget.",
                "Talk to the client early if the scope grew: agree a variation and add a milestone for it.",
                "If the overrun is your own, finish the work and note the lesson for the next quotation.",
              ],
              tone: "warn",
            },
          ],
          scales: "enterprise",
        },
        {
          id: "invoice-project",
          title: "Invoice milestones and hours",
          body:
            "Invoice each milestone as soon as it is done, or the hours not yet billed every month. Waiting until the end of a project leaves you financing the client.",
          do: [
            "Open the project and go to Invoice the client.",
            "Tick the finished milestones and choose Invoice billable hours up to, then press Make draft invoice.",
            "Check the draft invoice and press Issue invoice.",
          ],
          where: ["Services", "Projects"],
          href: "/projects",
          who: "Finance",
          scales: "enterprise",
        },
      ],
    },
    {
      id: "pricing-paid",
      title: "Price your services and get paid",
      intro:
        "In services, the price must cover the time of your people, the van, the tools and the office, not only the parts. Then make sure withholding tax certificates are collected, because they are money.",
      steps: [
        {
          id: "hourly-rate",
          title: "Work out your hourly rate",
          body:
            "An hourly rate is the cost of an hour of a person's time, plus a share of the overheads, plus your margin. Count only billable hours: travel, training and waiting are not billed.",
          do: [
            "Add up the person's monthly cost: salary, NSSF, WCF and allowances. Divide by the billable hours in a month, often 120 to 140.",
            "Add overhead per hour: vehicle, fuel, tools, phone, office rent and admin staff, divided by all billable hours.",
            "Add your margin, then round.",
            "Enter the result as the price of the Labour item and as the person's Hourly rate charged in Team rates.",
          ],
          who: "Management",
          example: {
            kind: "Hourly rate",
            title: "Technician",
            lines: [
              ["Cost per hour (salary, NSSF)", "TZS 9,000"],
              ["Overhead per hour (van, tools, office)", "TZS 8,000"],
              ["Margin 30%", "TZS 5,100"],
              ["Hourly rate charged (rounded)", "TZS 22,000"],
            ],
            mark: 3,
            stamp: "Priced",
            tone: "info",
          },
          scales: "all",
        },
        {
          id: "price-models",
          title: "Choose fixed price, time and materials, or call-out fee",
          body:
            "A fixed price suits work you know well, like a standard AC service. Time and materials suits repairs where you cannot know the problem in advance. A call-out fee covers the cost of going to the site at all.",
          do: [
            "For standard work, price per job and enter the agreed price on the service job.",
            "For repairs, quote the call-out fee and your hourly rate, then bill the hours and materials recorded on the job.",
            "Put the call-out fee and what it covers in the Standard invoice terms.",
          ],
          who: "Management and Sales",
          scenarios: [
            {
              title: "A fixed-price job took twice as long",
              problem: "You quoted TZS 600,000 for an installation; it took four technicians two days instead of one.",
              fix: [
                "Open Service reports and look at the profit on that job.",
                "Find the reason in the findings: site not ready, wrong information, or underestimate.",
                "Raise the price for that kind of job, or write in the quotation what the client must have ready.",
              ],
              tone: "warn",
            },
          ],
          scales: "all",
        },
        {
          id: "wht",
          title: "Show withholding tax and record the certificate",
          body:
            "Invoices show the services total and the withholding tax the client may deduct. When the client pays less because of withholding, record the certificate as a payment so the invoice closes.",
          do: [
            "Issue the invoice as usual. It shows the services total and the withholding tax.",
            "Record the money received with + Record a payment received.",
            "When the certificate comes, record another payment with the method Withholding tax certificate, the amount withheld and the certificate number as the reference.",
            "Give your accountant all certificates at the end of the year to claim them against your income tax.",
          ],
          where: ["Finance", "Invoices"],
          href: "/invoices",
          who: "Finance",
          example: {
            kind: "Payments on INV-2026-0112",
            title: "Morogoro Sugar Estates",
            lines: [
              ["Bank transfer", "TZS 2,260,000"],
              ["Withholding tax certificate", "TZS 100,000"],
              ["Reference", "WHT certificate 2026/4418"],
              ["Balance", "TZS 0"],
            ],
            mark: 1,
            stamp: "Paid",
            tone: "ok",
          },
          scenarios: [
            {
              title: "The client withheld but sent no certificate",
              problem: "Three clients paid 5% less on services in the last quarter, but you have no certificates.",
              fix: [
                "Open Money owed to us: those invoices still show the 5% as owed.",
                "Ask each client's finance office for the withholding tax certificate, with the invoice numbers.",
                "Record each certificate when it arrives. Without it you cannot claim the tax.",
              ],
              tone: "warn",
            },
          ],
          scales: "all",
        },
      ],
    },
    {
      id: "other-ways",
      title: "Other ways of supplying",
      intro:
        "Many services companies also supply in other ways. Here is how LeMoSp handles each one, and what is still to come.",
      steps: [
        {
          id: "hire",
          title: "Hire or rental",
          body:
            "Equipment you own and rent out goes on the Equipment hire screen, charged per day, week or month, with returns and late items tracked.",
          where: ["Services", "Equipment hire"],
          href: "/hire",
          who: "Sales and Warehouse",
          scales: "medium+",
        },
        {
          id: "indent",
          title: "Indent or direct supply",
          body:
            "If a client asks you to source equipment for them, buy it on a purchase order ticked Supplier delivers straight to the client and press Record delivery to client when it arrives. It never enters your store. Change What you sell to Goods and services if this becomes regular.",
          where: ["Purchasing", "Purchase orders"],
          href: "/purchase-orders",
          who: "Procurement",
          scales: "all",
        },
        {
          id: "contracting",
          title: "Contracting, supply and install",
          body:
            "Installation work with materials runs as service jobs with materials lines; bigger works run as projects billed by milestone.",
          where: ["Services", "Projects"],
          href: "/projects",
          who: "Management",
          scales: "medium+",
        },
        {
          id: "manufacturing",
          title: "Manufacturing or fabrication",
          body:
            "Workshops that make things, such as steel frames or ducting, can record raw materials and finished goods as products and adjust stock when they produce. Full manufacturing is planned for a later phase.",
          who: "Warehouse",
          scales: "all",
        },
        {
          id: "distribution",
          title: "Distribution with route sales",
          body:
            "Regular deliveries to many customers use delivery notes and agreed prices in Contracts. Route sales from a vehicle are planned for a later phase.",
          where: ["Sales", "Contracts"],
          href: "/contracts",
          who: "Sales",
          scales: "medium+",
        },
        {
          id: "recurring",
          title: "Subscription or recurring service",
          body:
            "Cleaning, security guarding and regular servicing are best run as maintenance contracts: the visits are planned and become jobs. Automatic recurring invoices are planned for a later phase.",
          where: ["Services", "Maintenance contracts"],
          href: "/maintenance",
          who: "Sales",
          scales: "medium+",
        },
      ],
    },
    {
      id: "routine",
      title: "Your monthly routine",
      intro:
        "In a services business, money leaks through jobs not invoiced, hours not recorded and visits missed. These checks close the leaks.",
      steps: [
        {
          id: "weekly",
          title: "Every week",
          body: "Short checks that keep work and money moving.",
          do: [
            "Every morning: finance invoices yesterday's completed jobs.",
            "Monday: Maintenance contracts, press Plan due visits and assign technicians.",
            "Friday: everyone's timesheets are complete for the week.",
            "Friday: Money owed to us, reminders logged, certificates chased.",
          ],
          who: "Management, Finance and everyone",
          scales: "all",
        },
        {
          id: "service-reports",
          title: "Read the service reports",
          body:
            "Service reports show services income against goods, profit per job, late jobs, visits due, warranties ending and how busy each person is.",
          do: [
            "Open Service reports and choose the month.",
            "Look at profit per job: raise prices on kinds of job that lose money.",
            "Look at late jobs and visits due: plan them this week.",
            "Look at workload: share out work from people who are overloaded.",
            "Look at warranties ending: offer those clients a maintenance contract.",
          ],
          where: ["Services", "Service reports"],
          href: "/service-reports",
          who: "Management",
          example: {
            kind: "Service reports",
            title: "October 2026",
            lines: [
              ["Services income", "TZS 38,600,000"],
              ["Goods income", "TZS 6,200,000"],
              ["Jobs completed", "74"],
              ["Jobs late", "5"],
              ["Warranties ending in 60 days", "9"],
            ],
            mark: 3,
            stamp: "Act on it",
            tone: "warn",
          },
          scales: "medium+",
        },
        {
          id: "monthly",
          title: "At the end of every month",
          body: "The month-end checklist for a services business.",
          do: [
            "Check that no completed job and no finished milestone is left uninvoiced.",
            "Invoice monthly hires that are still out and hours not yet billed.",
            "Record every withholding tax certificate received.",
            "Open Profit & loss: income, costs and profit for the month.",
            "Give your accountant the sales and purchases for the VAT return, due by the 20th of the next month.",
            "Pay PAYE, NSSF and WCF on time, and check certificates and insurance expiring in Documents.",
          ],
          where: ["Finance", "Profit & loss"],
          href: "/profit-loss",
          who: "Management and Finance",
          tip: "Due dates in this list are general guidance. Confirm the current dates for VAT, PAYE, NSSF and WCF with TRA or your accountant.",
          scales: "all",
        },
        {
          id: "yearly",
          title: "Once a year",
          body: "The yearly dates that keep you allowed to work.",
          do: [
            "Renew the business licence, ERB, CRB, EWURA and OSHA registrations as they fall due.",
            "Renew insurance and file the BRELA annual return (companies).",
            "Give your accountant all withholding tax certificates for the year.",
            "Review prices and hourly rates against last year's costs.",
          ],
          who: "Owner and Management",
          scales: "all",
        },
      ],
    },
  ],
};
