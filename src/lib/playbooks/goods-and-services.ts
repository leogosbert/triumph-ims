import type { Playbook } from "./types";

/**
 * Playbook: running a business that supplies goods AND provides services, for example a company that
 * supplies pipes, installs and maintains them, and gives consultation. Registering, setting LeMoSp up for
 * Both, one quotation for goods and services, delivery notes for goods only, installation jobs with
 * materials from stock, maintenance, equipment, consulting, withholding tax, other ways of supplying and a
 * monthly routine.
 * Kiswahili: src/lib/playbooks/sw/goods-and-services.ts.
 */
export const GOODS_AND_SERVICES: Playbook = {
  id: "goods-and-services",
  title: "Supply goods and services together",
  tagline: "Supply the pipes, install them, maintain them and advise the client, all joined up from one quotation to one invoice.",
  audience: "Owners and managers of companies that sell goods and also install, maintain, repair or advise.",
  minutes: 40,
  icon: "activity",
  color: "#0d9488",
  chapters: [
    {
      id: "register",
      title: "Register and set up the company",
      intro:
        "A company that sells goods and services needs the papers of a trader and of a service provider: business registration, tax, licences, and professional registration for the work you do on site. Rules change, so confirm the current ones with TRA or your accountant.",
      steps: [
        {
          id: "brela",
          title: "Register the business with BRELA",
          body:
            "A business name suits one owner or partners and leaves the owners personally liable. A company limited by shares is a separate legal person and is usually needed for tenders, CRB registration and big clients.",
          do: [
            "Choose between a business name and a company. For supply-and-install work, a company is usually better.",
            "Search and reserve the name on the BRELA online system, register and pay the fee.",
            "In the objects of the company, include both trading in goods and the services you will provide.",
            "Keep the certificate. Its number goes into LeMoSp as the Registration number. A company files an annual return every year.",
          ],
          who: "Owner",
          example: {
            kind: "Registration",
            title: "Maji Bora Ltd",
            lines: [
              ["Type", "Company limited by shares"],
              ["Business", "Supply, installation and maintenance of water systems; consultancy"],
              ["Office", "Njiro, Arusha"],
            ],
            mark: 1,
            stamp: "Registered",
            tone: "ok",
          },
          scales: "all",
        },
        {
          id: "tax",
          title: "Get a TIN, register for VAT and expect withholding tax",
          body:
            "You need a TIN from TRA. Register for VAT when sales reach TZS 200 million in twelve months; VAT is 18% on goods and services alike. On the service part of an invoice, many clients withhold 5% and give you a certificate.",
          do: [
            "Apply for the business TIN at TRA with the BRELA certificate and the directors' TINs and NIDA numbers.",
            "Ask your accountant whether to register for VAT now; supply-and-install clients usually prefer a VAT-registered supplier.",
            "Issue a fiscal receipt from an EFD or VFD for every sale, goods and services.",
            "Expect clients to withhold 5% on the service lines only, not on the goods. Collect each withholding certificate and claim it against your income tax.",
          ],
          who: "Owner with your accountant",
          example: {
            kind: "Invoice",
            title: "INV-2026-0140",
            lines: [
              ["Goods", "TZS 8,000,000"],
              ["Services", "TZS 3,000,000"],
              ["VAT 18%", "TZS 1,980,000"],
              ["Client may withhold 5% of services", "TZS 150,000"],
            ],
            mark: 3,
            stamp: "Services only",
            tone: "info",
          },
          tip: "These are the main rules at the time of writing. Tax rules change with each budget, so confirm current rates and thresholds with TRA or your accountant.",
          scales: "all",
        },
        {
          id: "licence-professional",
          title: "Get licences and professional registration",
          body:
            "Selling goods needs a business licence and sometimes a product permit. Installing and advising may need registration with a professional or safety body.",
          do: [
            "Apply for the business licence for each place you trade from, and renew it every year.",
            "Installation contractors register with CRB; engineers and engineering consultants register with ERB.",
            "Register your workplace with OSHA, and take public liability insurance for work at client sites.",
            "Check product rules for what you sell, for example TBS standards for pipes and fittings.",
            "Scan each certificate into Documents with its expiry date.",
          ],
          where: ["Company & account", "Documents"],
          href: "/documents",
          who: "Owner or Management",
          scales: "all",
        },
        {
          id: "staff-money",
          title: "Register your staff and open your accounts",
          body:
            "Register as an employer, protect the staff who work on site, and keep business money apart from personal money.",
          do: [
            "Register with NSSF and WCF and pay the contributions every month; deduct PAYE and, with ten or more employees, pay SDL.",
            "Give site staff safety equipment and keep a record of it.",
            "Open a business bank account and a mobile money lipa number, and put both in Company details & branding.",
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
      title: "Set up LeMoSp for goods and services",
      intro:
        "Choose Both and LeMoSp gives you stock, deliveries and purchasing for the goods, and service jobs, maintenance and equipment for the work. Small, Medium and Enterprise are modes of one app; nothing is lost when you change.",
      steps: [
        {
          id: "what-you-sell",
          title: "Choose Both and your business level",
          body:
            "Both switches on the goods screens and the service screens together. Your level decides how much control each has; single features can still be switched on or off.",
          do: [
            "Open Features & business level.",
            "Under What you sell, choose Both.",
            "Choose your level. Medium suits most supply-and-install companies; Enterprise adds projects, timesheets, approval steps and budgets.",
            "Switch on Projects & consulting or Timesheets & billable hours on their own if you need them before Enterprise.",
          ],
          where: ["Settings", "Features & business level"],
          href: "/settings/features",
          who: "Management",
          example: {
            kind: "Features & business level",
            title: "Maji Bora Ltd",
            lines: [
              ["What you sell", "Both"],
              ["Business level", "Medium"],
              ["Service jobs", "On"],
              ["Maintenance contracts", "On"],
              ["Projects & consulting", "On"],
            ],
            mark: 0,
            stamp: "Saved",
            tone: "ok",
          },
          scales: "all",
        },
        {
          id: "company-rules",
          title: "Set VAT, withholding tax and terms",
          body:
            "One set of rules covers both goods and services. The withholding tax rate is applied only to service lines on invoices.",
          do: [
            "Open Company details & branding.",
            "Set the VAT rate % to 18, or 0 if you are not registered for VAT.",
            "Set the Withholding tax rate % to 5.",
            "Set the Minimum margin %, Clients pay within (days) and the Standard invoice terms, for example \"Installation warranty 12 months; pipes as per manufacturer's warranty.\" Press Save company details.",
          ],
          where: ["Settings", "Company details & branding"],
          href: "/settings/company",
          who: "Management",
          scales: "all",
        },
        {
          id: "items",
          title: "Add goods and services with the right type and unit",
          body:
            "Goods are counted in stock and go on delivery notes. Services, labour, consultancy and hire are never counted as stock, and the invoice knows they carry withholding tax.",
          do: [
            "Open Products and press + New product.",
            "Goods: pipes in m, fittings and pumps in pcs. Set the Type to Goods.",
            "Services: installation per job or m, maintenance per visit. Set the Type to Service.",
            "Labour per hour or day, Consultancy per hour or day, and Hire per day for equipment you rent out.",
          ],
          where: ["Stock & delivery", "Products"],
          href: "/products",
          who: "Management",
          example: {
            kind: "Products",
            title: "Maji Bora Ltd",
            lines: [
              ["HDPE pipe 63 mm", "Goods · m · TZS 9,500"],
              ["Pipe installation", "Service · m · TZS 3,000"],
              ["Pump maintenance visit", "Service · visit · TZS 150,000"],
              ["Plumber labour", "Labour · hour · TZS 15,000"],
              ["Water engineer consultancy", "Consultancy · hour · TZS 80,000"],
            ],
            mark: 1,
            stamp: "Added",
            tone: "info",
          },
          scales: "all",
        },
        {
          id: "team",
          title: "Invite your team with the right roles",
          body:
            "Goods and services need different people: store and drivers for the goods, technicians on site for the work, and finance for both.",
          do: [
            "Open Team & roles and invite each person.",
            "Management, Sales, Procurement, Warehouse, Finance and Driver as in any goods business.",
            "Technicians and plumbers can take the Warehouse role so they can use materials from stock on their jobs; they see the jobs they are assigned to.",
          ],
          where: ["Settings", "Team & roles"],
          href: "/settings/team",
          who: "Management",
          scales: "all",
        },
      ],
    },
    {
      id: "quote",
      title: "Quote goods and services together",
      intro:
        "The client wants one price for the whole job. Put the goods and the services on one quotation, price each part properly and let the client see what they will pay.",
      steps: [
        {
          id: "one-quote",
          title: "Put pipes and installation on one quotation",
          body:
            "One quotation with goods lines and service lines is easier for the client to approve and keeps the whole order together, from delivery to invoice.",
          do: [
            "Open Quotations and press + New quotation, then choose the client.",
            "Add the goods: pipes, fittings, pump.",
            "Add the services: installation, testing and commissioning, training of the client's staff.",
            "Press Submit quotation, then Share PDF.",
          ],
          where: ["Sales", "Quotations"],
          href: "/quotations",
          who: "Sales",
          example: {
            kind: "Quotation",
            title: "QT-2026-0093",
            lines: [
              ["Client", "Meru Coffee Estate"],
              ["HDPE pipe 63 mm", "800 m × TZS 9,500"],
              ["Submersible pump 3 hp", "1 pcs × TZS 2,400,000"],
              ["Pipe installation", "800 m × TZS 3,000"],
              ["Testing and commissioning", "1 job × TZS 600,000"],
              ["Total incl. VAT", "TZS 15,340,000"],
            ],
            mark: 5,
            stamp: "Sent",
            tone: "info",
          },
          scales: "all",
        },
        {
          id: "price-both",
          title: "Price goods and services each on its own cost",
          body:
            "Goods are priced from the landed cost plus a margin. Services are priced from the hours and people needed, the transport to site and a margin. Do not give the installation away to win the goods.",
          do: [
            "For goods, check the last cost of each item and keep above the Minimum margin %.",
            "For services, count the days, the people and the transport: 800 m of pipe may need four plumbers for three days plus a pickup to Arusha.",
            "Add a line for travel or a call-out fee if the site is far.",
          ],
          who: "Sales and Management",
          scenarios: [
            {
              title: "The client wants the installation for free",
              problem: "Meru Coffee Estate says another supplier offered free installation.",
              fix: [
                "Show the installation separately so the client sees its value: four plumbers, three days, testing.",
                "Compare total prices, not the installation line alone; the other supplier's pipes may cost more.",
                "If you lower the price, take it from the margin on goods and services together, and stay above the Minimum margin %.",
              ],
              tone: "warn",
            },
          ],
          scales: "all",
        },
        {
          id: "accept",
          title: "Win the order and plan the work",
          body:
            "When the client accepts, the goods need buying or picking, and the installation needs people and a date.",
          do: [
            "Type the client's LPO number in Client's answer and press Client accepted.",
            "Press Create purchase order for goods you do not have, or Create delivery note for goods in stock.",
            "Open Service jobs and press New job for the installation, linked to the client and the site.",
          ],
          where: ["Sales", "Quotations"],
          href: "/quotations",
          who: "Sales and Procurement",
          scales: "all",
        },
      ],
    },
    {
      id: "deliver-install",
      title: "Deliver the goods, install with a service job",
      intro:
        "The goods travel on a delivery note; the work is done on a service job. Keep them apart and both stock and profit stay right.",
      steps: [
        {
          id: "delivery",
          title: "Deliver the goods with a delivery note",
          body:
            "The delivery note carries only the goods. The service lines on the quotation are not delivered; they are done on the job and invoiced.",
          do: [
            "On the won quotation, press Create delivery note and choose the store. Only the goods lines appear.",
            "Press Dispatch now. At the site, the driver records proof of delivery with the receiver's name, signature and a photo.",
            "If the supplier delivers straight to the site, use a purchase order ticked Supplier delivers straight to the client and press Record delivery to client when it arrives.",
          ],
          where: ["Stock & delivery", "Deliveries"],
          href: "/deliveries",
          who: "Warehouse and Driver",
          example: {
            kind: "Delivery note",
            title: "DN-2026-0081",
            lines: [
              ["Client", "Meru Coffee Estate"],
              ["HDPE pipe 63 mm", "800 m"],
              ["Submersible pump 3 hp", "1 pcs"],
              ["Received by", "Daniel Laizer, farm manager"],
            ],
            mark: 3,
            stamp: "Delivered",
            tone: "ok",
          },
          scales: "all",
        },
        {
          id: "install-job",
          title: "Install with a service job, materials from stock",
          body:
            "The installation is a service job. Small materials used on site, such as fittings, tape and clamps, are added to the job and leave stock when the job is completed.",
          do: [
            "Open the installation job: kind Installation, the site, the date and the plumbers.",
            "Add the checklist: trench depth checked, joints welded, pressure test, pump wiring checked, client trained.",
            "On site, add materials lines for fittings used from stock, and labour lines for the hours.",
            "The client's manager signs on the phone; the plumber presses Complete. The materials leave stock.",
          ],
          where: ["Services", "Service jobs"],
          href: "/jobs",
          who: "Technician",
          example: {
            kind: "Service job",
            title: "JOB-0058",
            lines: [
              ["Kind", "Installation"],
              ["Client", "Meru Coffee Estate"],
              ["HDPE elbow 63 mm", "24 pcs"],
              ["Plumber labour", "96 hour"],
              ["Signed by", "Daniel Laizer"],
            ],
            mark: 4,
            stamp: "Completed",
            tone: "ok",
          },
          scenarios: [
            {
              title: "The site needs more pipe than quoted",
              problem: "On site, the plumbers find the route is 60 m longer than measured.",
              fix: [
                "Call the client and agree the extra length and installation before laying it.",
                "Make a revision of the quotation or a new quotation for the 60 m, and get it accepted.",
                "Deliver the extra pipe on a new delivery note and add the extra hours to the job.",
              ],
              tone: "warn",
            },
          ],
          scales: "medium+",
        },
        {
          id: "register-equipment",
          title: "Record what you installed in the equipment register",
          body:
            "After installation, record the pump and the main pipework in Equipment. You then know the serial number, the warranty end and when it needs service.",
          do: [
            "Open Equipment and press Add.",
            "Choose the client and enter the item, serial number, location, install date, warranty end and service interval.",
          ],
          where: ["Services", "Equipment"],
          href: "/equipment",
          who: "Technician or Sales",
          example: {
            kind: "Equipment",
            title: "Submersible pump 3 hp",
            lines: [
              ["Client", "Meru Coffee Estate"],
              ["Serial number", "SP3-2026-11842"],
              ["Location", "Borehole 2, lower farm"],
              ["Warranty ends", "20 Oct 2027"],
              ["Next service", "20 Apr 2027"],
            ],
            mark: 3,
            stamp: "Added",
            tone: "info",
          },
          scales: "medium+",
        },
      ],
    },
    {
      id: "maintain-advise",
      title: "Maintain, advise and keep the client",
      intro:
        "The installation is the start of the relationship. Maintenance contracts bring steady income, and consultation turns your knowledge into revenue.",
      steps: [
        {
          id: "maintenance",
          title: "Offer a maintenance contract after installation",
          body:
            "A client who just installed a pump is the easiest client for a maintenance contract. The visits are planned for you and become service jobs.",
          do: [
            "Open Maintenance and press New contract.",
            "Choose the client, the frequency (monthly, quarterly, half-yearly or yearly), the first visit date and the price per period.",
            "Write what to check on each visit.",
            "Press Plan due visits: each visit becomes a service job two weeks ahead.",
          ],
          where: ["Services", "Maintenance"],
          href: "/maintenance",
          who: "Sales",
          example: {
            kind: "Maintenance contract",
            title: "MC-011",
            lines: [
              ["Client", "Meru Coffee Estate"],
              ["What", "Pump and pipeline service"],
              ["Frequency", "Half-yearly"],
              ["Price per period", "TZS 450,000"],
            ],
            mark: 2,
            stamp: "Active",
            tone: "ok",
          },
          scales: "medium+",
        },
        {
          id: "consult",
          title: "Bill consultation by the hour or as a project",
          body:
            "Advice such as a borehole site study or a water system design is a service too. Small advice is billed by the hour; bigger studies run as projects with milestones.",
          do: [
            "Short advice: add Consultancy hours to a quotation or a service job of kind Consultation.",
            "Bigger studies: open Projects, press New project and choose billed by milestone or by time.",
            "Everyone records hours in Timesheets against the project.",
            "Press Invoice milestones or hours on the project when a milestone is done or at month end.",
          ],
          where: ["Services", "Projects"],
          href: "/projects",
          who: "Management",
          example: {
            kind: "Project",
            title: "PRJ-004",
            lines: [
              ["Client", "Babati Town Water Authority"],
              ["Name", "Borehole siting study"],
              ["Billed", "By time"],
              ["Hours this month", "46 × TZS 80,000"],
            ],
            mark: 3,
            stamp: "Invoice hours",
            tone: "info",
          },
          scales: "medium+",
        },
        {
          id: "repairs",
          title: "Handle repair calls and warranty work",
          body:
            "When an installed pump breaks, open a repair job on the same client. The equipment history shows whether it is still under warranty.",
          do: [
            "Open Equipment, find the unit and look at the warranty end.",
            "Open Service jobs, press New job, kind Repair, and choose the technician.",
            "Under warranty: do not charge the parts covered; record them on the job so the cost is known.",
          ],
          where: ["Services", "Service jobs"],
          href: "/jobs",
          who: "Sales and Technician",
          scenarios: [
            {
              title: "The pump failed because of the client's dry running",
              problem: "The pump burnt out after the borehole ran dry. The client expects a free repair under warranty.",
              fix: [
                "Write the findings on the job with photos.",
                "Explain that dry running is not covered and quote the repair.",
                "Offer a low-level cut-off switch as a goods line on the quotation to prevent it happening again.",
              ],
              tone: "warn",
            },
          ],
          scales: "medium+",
        },
      ],
    },
    {
      id: "paid",
      title: "Invoice and get paid",
      intro:
        "One invoice for goods and services, with the services total and the withholding tax clearly shown, gets you paid faster and with fewer questions.",
      steps: [
        {
          id: "invoice",
          title: "Invoice goods and services together",
          body:
            "Invoice the goods from the delivery note and the installation from the job, or invoice the whole quotation once both are done. The invoice shows the services total and the withholding tax the client may deduct.",
          do: [
            "Open the delivered delivery note and press Create invoice for the goods.",
            "Open the completed job and press Make invoice for the installation; or add the service lines to the same invoice.",
            "Check the services total and the withholding tax shown, then press Issue invoice.",
          ],
          where: ["Finance", "Invoices"],
          href: "/invoices",
          who: "Finance",
          example: {
            kind: "Invoice",
            title: "INV-2026-0151",
            lines: [
              ["Goods", "TZS 10,000,000"],
              ["Services", "TZS 3,000,000"],
              ["VAT 18%", "TZS 2,340,000"],
              ["Total incl. VAT", "TZS 15,340,000"],
              ["Client may withhold 5% of services", "TZS 150,000"],
            ],
            mark: 4,
            stamp: "Issued",
            tone: "info",
          },
          scales: "all",
        },
        {
          id: "wht",
          title: "Record payments and withholding certificates",
          body:
            "If the client withholds tax on the services, the bank payment is short by that amount. Record the certificate as a payment so the invoice is paid in full.",
          do: [
            "Record the money received with + Record a payment received.",
            "When the certificate arrives, record a payment with the method Withholding tax certificate and the certificate number as the reference.",
            "Chase missing certificates from Money owed to us: without the certificate you cannot claim the tax.",
          ],
          where: ["Finance", "Payments received"],
          href: "/payments",
          who: "Finance",
          example: {
            kind: "Payments on INV-2026-0151",
            title: "Meru Coffee Estate",
            lines: [
              ["Bank transfer", "TZS 15,190,000"],
              ["Withholding tax certificate", "TZS 150,000"],
              ["Balance", "TZS 0"],
            ],
            mark: 1,
            stamp: "Paid",
            tone: "ok",
          },
          scales: "all",
        },
        {
          id: "profit-split",
          title: "See profit on goods and on services",
          body:
            "Goods and services earn money differently. Service reports show services income against goods income and profit per job, so you see which side carries the business.",
          do: [
            "Open Service reports and choose the month.",
            "Compare services income and goods income, and look at profit per job.",
            "Open Profit for margin by product on the goods side.",
          ],
          where: ["Services", "Service reports"],
          href: "/service-reports",
          who: "Management",
          scales: "medium+",
        },
      ],
    },
    {
      id: "other-ways",
      title: "Other ways of supplying",
      intro:
        "Beyond goods, services and both, there are other ways to supply. Here is how LeMoSp handles each, and what is still to come.",
      steps: [
        {
          id: "hire",
          title: "Hire or rental",
          body:
            "Pumps, generators or trench diggers you own and rent out are items of Type Hire. Hire tracks what is out and bills per day, week or month; long hires can be invoiced every month while still out.",
          where: ["Services", "Hire"],
          href: "/hire",
          who: "Sales and Warehouse",
          scales: "medium+",
        },
        {
          id: "indent",
          title: "Indent or direct supply",
          body:
            "Large pipes straight from the factory to the site: a purchase order ticked Supplier delivers straight to the client, then Record delivery to client. The goods never enter your store.",
          where: ["Purchasing", "Purchase orders"],
          href: "/purchase-orders",
          who: "Procurement",
          scales: "all",
        },
        {
          id: "contracting",
          title: "Contracting, supply and install",
          body:
            "This is your main model: service jobs with materials for each installation, and projects billed by milestone for big works such as a town water scheme.",
          where: ["Services", "Projects"],
          href: "/projects",
          who: "Management",
          scales: "medium+",
        },
        {
          id: "manufacturing",
          title: "Manufacturing or fabrication",
          body:
            "If you make tanks, stands or manifolds, record the raw materials and finished goods as products and adjust stock when you produce. Full manufacturing is planned for a later phase.",
          who: "Warehouse",
          scales: "all",
        },
        {
          id: "distribution",
          title: "Distribution and wholesale with route sales",
          body:
            "Selling pipes and fittings to plumbers and hardware shops at agreed prices uses Contracts and delivery notes. Route sales from a vehicle are planned for a later phase.",
          where: ["Sales", "Contracts"],
          href: "/contracts",
          who: "Sales",
          scales: "medium+",
        },
        {
          id: "recurring",
          title: "Subscription or recurring supply",
          body:
            "Regular service runs as a maintenance contract; regular goods, such as water treatment chemicals every month, run on a contract with agreed prices and a monthly delivery. Automatic recurring invoices are planned for a later phase.",
          where: ["Services", "Maintenance"],
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
        "A goods-and-services company has two sets of checks: the stock and deliveries, and the jobs and hours. Do both every month.",
      steps: [
        {
          id: "weekly",
          title: "Every week",
          body: "Short checks for both sides of the business.",
          do: [
            "Monday: What to reorder, Purchasing overview, and Plan due visits in Maintenance.",
            "Every day: delivered notes and completed jobs are invoiced the same day.",
            "Friday: timesheets complete, Money owed to us checked, certificates chased.",
          ],
          who: "Procurement, Finance and Management",
          scales: "all",
        },
        {
          id: "monthly",
          title: "At the end of every month",
          body: "The month-end checklist for a goods-and-services company.",
          do: [
            "Finish the stock count and explain every adjustment, including materials used on jobs.",
            "Check that no delivery note, completed job or finished milestone is left uninvoiced.",
            "Record every withholding tax certificate received.",
            "Open Service reports: services against goods income, profit per job, late jobs, visits due, warranties ending.",
            "Open Profit & loss for the whole month.",
            "Give your accountant the sales and purchases for the VAT return, due by the 20th of the next month, and pay PAYE, NSSF and WCF on time.",
          ],
          where: ["Services", "Service reports"],
          href: "/service-reports",
          who: "Management and Finance",
          example: {
            kind: "Month end",
            title: "October 2026",
            lines: [
              ["Goods income", "TZS 54,000,000"],
              ["Services income", "TZS 21,500,000"],
              ["Jobs not invoiced", "0"],
              ["Certificates still missing", "2"],
              ["Stock counted", "All stores"],
            ],
            mark: 3,
            stamp: "Closed",
            tone: "ok",
          },
          tip: "Due dates in this list are general guidance. Confirm the current dates for VAT, PAYE, NSSF and WCF with TRA or your accountant.",
          scales: "all",
        },
        {
          id: "yearly",
          title: "Once a year",
          body: "The yearly dates for a company that trades and works on site.",
          do: [
            "Renew the business licence, CRB, ERB and OSHA registrations and your insurance.",
            "File the BRELA annual return (companies).",
            "Full stock count of every store at the year end; give the accountant all withholding certificates.",
            "Review your business level in Features & business level as the company grows.",
          ],
          who: "Owner and Management",
          scales: "all",
        },
      ],
    },
  ],
};
