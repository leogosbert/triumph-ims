import type { Playbook } from "./types";

/**
 * Playbook: running a mining services company that supplies and works on mine sites: drilling
 * consumables and roof support, mining chemicals, conveyor parts, pumps, valves and lubricants,
 * equipment rental, contract drilling, fabrication and installation, and lubrication and pump servicing.
 * Kiswahili: src/lib/playbooks/sw/mining-services.ts.
 */
export const MINING_SERVICES: Playbook = {
  id: "mining-services",
  title: "Run a mining services company",
  tagline: "Supply the mine, rent and run the machines, drill by the metre and keep every job, hour and certificate on record.",
  audience: "Owners and managers of companies that supply, rent equipment to, drill for, fabricate for or service mines and process plants.",
  minutes: 35,
  icon: "stock",
  color: "#0e7490",
  chapters: [
    {
      id: "set-up",
      title: "Set up LeMoSp for a mining services company",
      intro:
        "A mining services company sells goods and services together: consumables and spares from the store, machines on hire, drilling by the metre and skilled work on site. The examples use Madini Mining Services Ltd, a sample company.",
      steps: [
        {
          id: "what-you-sell",
          title: "Choose Goods and services, then switch on what you run",
          body:
            "Goods and services switches on stock, purchasing and invoices together with service jobs, maintenance, equipment and hire. Projects, timesheets and fleet tracking are switched on one by one, so you only see what you use.",
          do: [
            "Open Features & business level and choose What you sell: Goods and services.",
            "Choose Medium if you have a store, a few technicians and several mine clients.",
            "Switch on Projects & consulting for fabrication and installation work, Timesheets & billable hours for hours on site and Fleet & logistics tracking for your own trucks, rigs and bowsers.",
            "Changing level or a switch later never removes data.",
          ],
          where: ["Settings", "Features & business level"],
          href: "/settings/features",
          who: "Management",
          example: {
            kind: "Features",
            title: "Madini Mining Services Ltd",
            lines: [
              ["What you sell", "Goods and services"],
              ["Business level", "Medium"],
              ["Projects & consulting", "On"],
              ["Timesheets & billable hours", "On"],
              ["Fleet & logistics tracking", "On"],
            ],
            mark: 0,
            stamp: "Saved",
            tone: "ok",
          },
          scales: "all",
        },
        {
          id: "service-lines",
          title: "Use one category per service line",
          body:
            "Mines buy from you line by line: roof support, drilling consumables, chemicals, conveyor parts, pumps, valves, lubricants. When every item carries its line as the Category, reports show which line makes money.",
          do: [
            "Open Products and give each item a Category, for example Roof support, Drilling consumables, Mining chemicals, Conveyor equipment, Pumps, Valves, Lubricants.",
            "Use Subcategory for the next level, for example Idlers, Pulleys or Belt cleaners under Conveyor equipment.",
            "Fill in Brand and Manufacturer part no.: mine buyers order by brand and part number.",
          ],
          where: ["Stock & delivery", "Products"],
          href: "/products",
          who: "Management or Procurement",
          example: {
            kind: "Products",
            title: "Madini Mining Services Ltd",
            lines: [
              ["Rock bolt, resin, 2.4 m", "Roof support · pcs"],
              ["Button bit, 45 mm", "Drilling consumables · pcs"],
              ["Steel idler, troughing", "Conveyor equipment · Idlers"],
              ["Slurry pump", "Pumps · set"],
              ["Hydraulic oil ISO VG 68", "Lubricants · drum"],
            ],
            mark: 2,
            stamp: "Added",
            tone: "info",
          },
          scales: "all",
        },
        {
          id: "rates",
          title: "Add your services, hire machines and drilling rates as items",
          body:
            "Everything you charge for is an item, so it can go on quotations and invoices. The Type keeps services and hire out of stock counts, and the Unit is how the mine pays you.",
          do: [
            "Open Products and press + New product.",
            "Drilling: Type Service, Unit m, for example Diamond core drilling per metre.",
            "Machines you rent out: Type Hire, Unit day, for example Excavator 20 t, with operator.",
            "Work on site: Type Labour, Unit hour, for example Fitter or Boilermaker.",
            "Surveys and advice: Type Consultancy, for example Lubrication survey.",
          ],
          where: ["Stock & delivery", "Products"],
          href: "/products",
          who: "Management",
          example: {
            kind: "Products",
            title: "Madini Mining Services Ltd",
            lines: [
              ["Diamond core drilling, NQ", "Service · m · TZS 190,000"],
              ["Excavator 20 t, with operator", "Hire · day · TZS 1,400,000"],
              ["Boilermaker", "Labour · hour · TZS 35,000"],
              ["Lubrication survey", "Consultancy · job · TZS 2,500,000"],
            ],
            mark: 0,
            stamp: "Added",
            tone: "info",
          },
          tip: "The prices in the examples are samples. Use your own rates from your price list or contract.",
          scales: "all",
        },
        {
          id: "sites",
          title: "Record each mine as a client with its sites",
          body:
            "A mine often has several sites, stores and buyers. Recording them once means every quotation, delivery and invoice goes to the right place and person.",
          do: [
            "Open Clients and press + New client for each mine or contractor you work for.",
            "Enter the buyer, the site address and the payment terms in the contract.",
            "Put their vendor number and the approved-vendor status in the client's details.",
          ],
          where: ["Sales", "Clients"],
          href: "/clients",
          who: "Sales",
          scales: "all",
        },
      ],
    },
    {
      id: "supply",
      title: "Supply consumables, chemicals and spares",
      intro:
        "Mines run day and night, and a missing bit, bolt or seal stops production. Good stock control is what keeps a mine buying from you.",
      steps: [
        {
          id: "reorder",
          title: "Set reorder levels for the fast movers",
          body:
            "Drill bits, rods, rock bolts, idlers and greases are used every week. A reorder level warns you before you run out, and the maximum level stops you tying up cash.",
          do: [
            "Open the product and enter the Reorder level and Maximum stock level.",
            "Open What to reorder every Monday: it lists every product below its reorder level, with a suggested quantity.",
            "Press Order to create draft purchase orders, then send them to the suppliers.",
          ],
          where: ["Stock & delivery", "What to reorder"],
          href: "/stock/reorder",
          who: "Procurement and Warehouse",
          example: {
            kind: "Stock",
            title: "Button bit, 45 mm",
            lines: [
              ["In stock", "18 pcs"],
              ["Reorder level", "40 pcs"],
              ["Maximum stock level", "150 pcs"],
              ["Suggested order", "132 pcs"],
            ],
            mark: 3,
            stamp: "Reorder",
            tone: "warn",
          },
          scales: "medium+",
        },
        {
          id: "chemicals",
          title: "Handle mining chemicals safely and by batch",
          body:
            "Mines will not accept a chemical without its safety data sheet, and they check the batch and expiry date. Recording them in LeMoSp lets you answer any question about a delivery.",
          do: [
            "On each chemical tick Hazardous, enter the UN no. and CAS no., and tick SDS on file.",
            "Enter the Shelf life (months).",
            "When goods arrive, record the batch number and expiry date on the goods received note.",
            "Send the oldest batch first, and scan the safety data sheet into Documents.",
          ],
          where: ["Stock & delivery", "Products"],
          href: "/products",
          who: "Warehouse",
          example: {
            kind: "Product",
            title: "Water treatment chemical, 25 kg",
            lines: [
              ["Hazardous", "Yes"],
              ["UN no.", "UN 1791"],
              ["SDS on file", "Yes"],
              ["Batch", "B-2610 · Expires Mar 2027"],
            ],
            mark: 2,
            stamp: "Ready to send",
            tone: "ok",
          },
          scales: "medium+",
        },
        {
          id: "direct",
          title: "Supply pumps and valves straight from the maker",
          body:
            "Big items such as slurry pumps or large valves are often ordered for one mine and shipped straight to site. They never enter your store, but the order, delivery and invoice are still on record.",
          do: [
            "Quote the mine with the item, the brand, the lead time and the Incoterm.",
            "When the mine orders, raise the purchase order and press Supplier delivers straight to the client.",
            "When it arrives at site, press Record delivery to client, then make the invoice.",
          ],
          where: ["Purchasing", "Purchase orders"],
          href: "/purchase-orders",
          who: "Procurement",
          scenarios: [
            {
              title: "The pump arrived with the wrong flange",
              problem: "The mine rejects a pump because the flange does not match their pipework.",
              fix: [
                "Do not invoice it: the delivery is not accepted.",
                "Send the supplier the mine's pipework details and agree the replacement and the date.",
                "Tell the mine the new date in writing, and keep the letters and the drawing in Documents.",
              ],
              tone: "warn",
            },
          ],
          scales: "all",
        },
      ],
    },
    {
      id: "hire-drilling",
      title: "Equipment rental and drilling",
      intro:
        "Rental and drilling are paid by the day, the hour or the metre. The money is made by recording every day and every metre, and invoicing them on time.",
      steps: [
        {
          id: "hire",
          title: "Rent out machines with Equipment hire",
          body:
            "Equipment hire shows which dozer, excavator, haul truck or bowser is out, at which mine, and when it is due back. It bills every day on hire.",
          do: [
            "In Products, set each machine's Type to Hire and receive the units you own into a store.",
            "Open Equipment hire and press + Hire: the client, the site, the date out and the date due back.",
            "Add the machines with the rate per day, week or month, and the deposit if there is one.",
            "When a machine comes back, press Record return, then Make invoice. For long hires, invoice every month.",
          ],
          where: ["Services", "Equipment hire"],
          href: "/hire",
          who: "Sales and Warehouse",
          example: {
            kind: "Equipment hire",
            title: "HIRE-0031",
            lines: [
              ["Client", "Kahama Gold Mine Ltd"],
              ["Excavator 20 t, with operator", "1 × TZS 1,400,000 a day"],
              ["Water bowser 20,000 L", "1 × TZS 650,000 a day"],
              ["Out", "1 Oct 2026"],
              ["Due back", "31 Oct 2026"],
            ],
            mark: 1,
            stamp: "On hire",
            tone: "info",
          },
          scales: "medium+",
        },
        {
          id: "fleet",
          title: "Keep your own machines in Vehicles",
          body:
            "Your rigs, trucks and bowsers need services, insurance and fuel. Vehicles keeps each one's papers and service dates, so a machine is not stopped at the gate or broken down on site.",
          do: [
            "Open Deliveries → Vehicles and press + Vehicle for each truck, rig and bowser.",
            "Fill in Insurance expires, Inspection / road licence expires and Next service date.",
            "Record fuel and repairs, so you can see what each machine costs to run.",
          ],
          where: ["Deliveries", "Vehicles"],
          href: "/fleet",
          who: "Management",
          scales: "enterprise",
        },
        {
          id: "drilling",
          title: "Run each drilling contract as a project, billed by the metre",
          body:
            "Exploration, geotechnical and blast hole drilling are paid by the metre drilled, often with standby hours and mobilisation. A project keeps the whole contract together; every shift's metres go on it.",
          do: [
            "Open Projects and press + Project for the drilling contract, billed By milestone or By time (hours).",
            "Add the drilling rates as items: metres drilled, mobilisation, standby per hour.",
            "Record each shift's metres and hours, and the bits and rods used from stock, on the project's service jobs.",
            "At month end, invoice the metres drilled, with the drilling log attached.",
          ],
          where: ["Services", "Projects"],
          href: "/projects",
          who: "Management and the drilling supervisor",
          example: {
            kind: "Drilling invoice",
            title: "INV-2026-0204",
            lines: [
              ["Diamond core drilling, NQ", "1,240 m × TZS 190,000"],
              ["Mobilisation", "1 × TZS 18,000,000"],
              ["Standby", "16 hours × TZS 450,000"],
              ["Bits used", "From stock, on the job"],
            ],
            mark: 0,
            stamp: "Ready to invoice",
            tone: "ok",
          },
          scenarios: [
            {
              title: "The mine disputes the metres",
              problem: "The geologist's log shows fewer metres than your driller recorded.",
              fix: [
                "Compare hole by hole using the daily drilling reports on the project.",
                "Agree the figure with the geologist and get it signed.",
                "Invoice the signed metres, and attach the signed log in Documents.",
              ],
              tone: "warn",
            },
          ],
          scales: "enterprise",
        },
      ],
    },
    {
      id: "fabrication",
      title: "Fabrication, installation and servicing",
      intro:
        "Steel structures, conveyor installations, crusher and pump repairs, lubrication surveys: this is work done by your people with your materials. Record the hours and materials as they are used, and nothing is left unbilled.",
      steps: [
        {
          id: "fab-project",
          title: "Run fabrication and installation as projects",
          body:
            "A conveyor installation or a steel structure has a budget, materials and many days of work. A project shows whether it is making money while it is still running.",
          do: [
            "Open Projects and press + Project: the client, How it is billed and the budget in money and hours.",
            "Add milestones, for example Design approved, Steel fabricated, Installed and commissioned.",
            "Issue the steel, bolts and paint to the project's jobs, so their cost is counted.",
            "Your team records their hours in Timesheets every day.",
          ],
          where: ["Services", "Projects"],
          href: "/projects",
          who: "Management",
          example: {
            kind: "Project",
            title: "PRJ-018",
            lines: [
              ["Client", "Kahama Gold Mine Ltd"],
              ["Name", "Conveyor CV-03 stringer and idler install"],
              ["Billed", "By milestone"],
              ["Steel fabricated", "TZS 64,000,000 · Invoiced"],
              ["Installed and commissioned", "TZS 38,000,000 · Open"],
            ],
            mark: 3,
            stamp: "Active",
            tone: "info",
          },
          scales: "enterprise",
        },
        {
          id: "service-jobs",
          title: "Service pumps, valves and conveyors as service jobs",
          body:
            "A repair or a service visit at the mine is a service job: who goes, what they check, what they use and the client's signature. It ends in an invoice.",
          do: [
            "Open Service jobs and press + Job: the client, the kind of work, the site and the technicians.",
            "The technician ticks the checklist on the phone and adds the parts and hours used.",
            "The mine's supervisor signs, then press Make invoice.",
          ],
          where: ["Services", "Service jobs"],
          href: "/jobs",
          who: "Technicians and Sales",
          scales: "medium+",
        },
        {
          id: "equipment",
          title: "Keep the mine's pumps and lube systems in Equipment",
          body:
            "When you install or look after a pump, valve or automatic lubrication system, record it at the client. LeMoSp reminds you when its next service is due, which is work you can quote before anyone else.",
          do: [
            "Open Equipment and press + Equipment: the client, the item, the serial number and the location on site.",
            "Enter how often it is serviced and when its warranty ends.",
            "Sell the regular visits as a maintenance contract.",
          ],
          where: ["Services", "Equipment"],
          href: "/equipment",
          who: "Sales or the service supervisor",
          example: {
            kind: "Equipment",
            title: "Slurry pump, mill discharge",
            lines: [
              ["Client", "Kahama Gold Mine Ltd"],
              ["S/N", "SP-77120"],
              ["Service", "Every 3 months"],
              ["Next service", "12 Nov 2026"],
            ],
            mark: 3,
            stamp: "Service due",
            tone: "warn",
          },
          scales: "medium+",
        },
        {
          id: "lube-contract",
          title: "Sell lubrication and condition monitoring as a contract",
          body:
            "Lubrication surveys, oil sampling and auto-lube servicing are regular work. A maintenance contract plans the visits and invoices them on time every month.",
          do: [
            "Open Maintenance contracts and press + Contract.",
            "Choose the client, the visits per year and the price per visit or per month.",
            "Each visit becomes a service job; the oil analysis results go in its findings.",
          ],
          where: ["Services", "Maintenance contracts"],
          href: "/maintenance",
          who: "Sales and Management",
          scales: "medium+",
        },
      ],
    },
    {
      id: "win-paid",
      title: "Win the work and get paid",
      intro:
        "Mines buy through tenders, approved-vendor lists and contracts, and they pay on terms. Paperwork that is complete and on time is what gets you paid.",
      steps: [
        {
          id: "tenders",
          title: "Track tenders and keep your certificates current",
          body:
            "Mine tenders ask for the same papers every time: registration, TIN and VAT, tax clearance, insurance, safety and quality certificates. Keep them in Documents with their expiry dates, and track each tender to the end.",
          do: [
            "Open Tenders and record each tender with its closing date and value.",
            "Scan each certificate into Documents with its expiry date, so the app reminds you before it ends.",
            "When you win, record the agreed prices and terms in Contracts.",
          ],
          where: ["Sales", "Tenders"],
          href: "/tenders",
          who: "Management and Sales",
          scales: "medium+",
        },
        {
          id: "wht-usd",
          title: "Invoice in TZS or USD and record withholding tax",
          body:
            "Many mines pay in US dollars and withhold tax on services. Show it on the invoice and collect every withholding tax certificate: you claim them against your income tax.",
          do: [
            "Choose the currency on the quotation; the invoice follows it.",
            "Service, labour and hire lines carry withholding tax; goods lines do not.",
            "When the mine pays, record the money received, and record the amount withheld as a payment by Withholding tax certificate with its Certificate number.",
          ],
          where: ["Finance", "Invoices"],
          href: "/invoices",
          who: "Finance",
          example: {
            kind: "Invoice",
            title: "INV-2026-0211",
            lines: [
              ["Client", "Kahama Gold Mine Ltd"],
              ["Currency", "USD"],
              ["Pump service (labour)", "USD 4,200"],
              ["Withheld by client (5%)", "USD 210"],
              ["Spares (goods)", "USD 9,800"],
            ],
            mark: 3,
            stamp: "Certificate due",
            tone: "warn",
          },
          tip: "Tax rules change with each budget, so confirm current rates with TRA or your accountant.",
          scales: "all",
        },
        {
          id: "statements",
          title: "Send statements and follow up every week",
          body:
            "Mines pay on 30 to 60 day terms and many invoices are lost in their approval chain. A weekly look at what is due, and a statement sent to the buyer, keeps the cash coming.",
          do: [
            "Open Money owed to us every week and sort by days overdue.",
            "Send each mine its statement and ask which invoices are still waiting for approval.",
            "Press + Log a reminder or promise to pay after each call, so the next call is about the right invoice.",
          ],
          where: ["Finance", "Money owed to us"],
          href: "/receivables",
          who: "Finance",
          scales: "all",
        },
      ],
    },
  ],
};
