import type { Playbook } from "./types";

/**
 * Playbook: running a business that only sells goods (traders, general suppliers, distributors, shops,
 * importers). Registering the company (BRELA, TRA, VAT, licence, EFD, NSSF/WCF, bank), setting LeMoSp up
 * for goods, buying, stock, pricing, quoting and delivering, direct supply, getting paid, other ways of
 * supplying and a monthly routine.
 * Kiswahili: src/lib/playbooks/sw/goods-business.ts.
 */
export const GOODS_BUSINESS: Playbook = {
  id: "goods-business",
  title: "Run a goods business",
  tagline: "From registering the company to buying, stocking, delivering and getting paid: everything a trading business needs, step by step.",
  audience: "Owners and managers of traders, general suppliers, distributors, shops and importers.",
  minutes: 35,
  icon: "stock",
  color: "#c2410c",
  chapters: [
    {
      id: "register",
      title: "Register and set up the company",
      intro:
        "Before the first sale, the business must exist on paper and with the tax office. Doing it properly from the start lets you sell to companies and the government, open a bank account and win tenders. Rules change, so confirm the current ones with TRA or your accountant.",
      steps: [
        {
          id: "brela",
          title: "Register the business with BRELA",
          body:
            "BRELA registers businesses in Tanzania, online. A business name suits one owner or partners trading together; the owners are personally liable. A company limited by shares is a separate legal person: big clients, banks and tenders often ask for one.",
          do: [
            "Choose between a business name and a company. If you plan to supply companies, the government or to import, a company is usually better.",
            "Search the name on the BRELA online system and reserve it.",
            "Register online and pay the fee. For a company, you need the directors, the shareholders and the memorandum and articles of association.",
            "Keep the certificate of registration (or incorporation). Its number goes into LeMoSp as the Registration number.",
            "A company files an annual return with BRELA every year. Put the date in your calendar.",
          ],
          who: "Owner",
          example: {
            kind: "Registration",
            title: "Kilimo Supplies Ltd",
            lines: [
              ["Type", "Company limited by shares"],
              ["Directors", "Neema Mushi, Baraka Mushi"],
              ["Office", "Mbezi Beach, Dar es Salaam"],
              ["Annual return", "Every year"],
            ],
            stamp: "Registered",
            tone: "ok",
          },
          tip: "Use the same name everywhere: BRELA certificate, TIN, bank account and LeMoSp. Clients and tender boards check that they match.",
          scales: "all",
        },
        {
          id: "tax",
          title: "Get a TIN and decide on VAT",
          body:
            "Every business needs a TIN (Taxpayer Identification Number) from TRA. You must register for VAT when your sales reach TZS 200 million in twelve months; below that you may register voluntarily. VAT is 18% on most goods.",
          do: [
            "Apply for the business TIN at TRA with the BRELA certificate and the owners' or directors' TINs and NIDA numbers.",
            "Ask your accountant whether to register for VAT now. Many companies and government buyers prefer suppliers with a VRN, because they can claim back the VAT you charge.",
            "Once registered for VAT, file the VAT return every month, even in a month with no sales.",
            "Use an EFD machine or a VFD (virtual fiscal device) to issue a fiscal receipt for every sale, as TRA requires.",
            "Keep every supplier's tax invoice: you claim back the VAT on what you buy only with a proper tax invoice.",
          ],
          who: "Owner with your accountant",
          example: {
            kind: "Tax registration",
            title: "Kilimo Supplies Ltd",
            lines: [
              ["TIN", "123-456-789"],
              ["VRN", "40-012345-A"],
              ["VAT rate", "18%"],
              ["VAT return", "Every month"],
              ["Receipts", "EFD"],
            ],
            mark: 2,
            stamp: "Registered",
            tone: "info",
          },
          scenarios: [
            {
              title: "Sales are close to the VAT threshold",
              problem: "Kilimo Supplies sold TZS 165 million in the last ten months and a big order is coming.",
              fix: [
                "Open Profit & loss and add up sales for the last twelve months.",
                "Tell your accountant early: you must apply to TRA within the time the law gives once you pass TZS 200 million.",
                "After registering, put the VRN and the VAT rate in Company details & branding so every new quotation and invoice shows VAT.",
              ],
              tone: "warn",
            },
          ],
          tip: "These are the main rules at the time of writing. Tax rules change with each budget, so confirm current rates and thresholds with TRA or your accountant.",
          scales: "all",
        },
        {
          id: "licence",
          title: "Get your business licence and product permits",
          body:
            "You need a business licence for each place you trade from. Some goods also need a permit from the body that controls them.",
          do: [
            "Apply for the business licence with your BRELA certificate, TIN and lease or proof of premises. Renew it every year.",
            "For food, cosmetics, medicines or medical devices, check TMDA and TBS requirements.",
            "For chemicals, register with the Government Chemist Laboratory Authority (GCLA) before you import or sell them.",
            "For imports, choose a licensed clearing agent and keep each import's customs papers with the purchase order.",
            "Scan each licence and permit into Documents with its expiry date, so the app reminds you before it ends. In Legal & compliance, press Set up my checklist and record each licence under Licences; Read with AI fills in the details from a photo.",
          ],
          where: ["More", "Documents"],
          href: "/documents",
          who: "Owner or Management",
          example: {
            kind: "Document",
            title: "Business licence 2026",
            lines: [
              ["Issued by", "Kinondoni Municipal Council"],
              ["Expires", "30 Jun 2027"],
              ["Remind before", "30 days"],
            ],
            mark: 1,
            stamp: "Saved",
            tone: "info",
          },
          scales: "all",
        },
        {
          id: "staff-money",
          title: "Register your staff and open your accounts",
          body:
            "Once you employ people, register as an employer with NSSF and WCF, and deduct PAYE. Keep business money apart from personal money from day one: a business bank account and a business mobile money number.",
          do: [
            "Register with NSSF (pension) and WCF (workers' compensation) and pay the contributions every month.",
            "Deduct PAYE from salaries and pay it to TRA every month. With ten or more employees, SDL is also due.",
            "Open a bank account in the business name, and a mobile money lipa number for clients who pay by phone.",
            "Put the bank details and the pay numbers in Company details & branding: they are printed on every invoice.",
            "With staff on salary, add them in Administration \u2192 Employees and run Finance \u2192 Payroll in LeMoSp: PAYE, NSSF, SDL and WCF are worked out for you.",
          ],
          where: ["Settings", "Company details & branding"],
          href: "/settings/company",
          who: "Owner with your accountant",
          example: {
            kind: "On every invoice",
            title: "Kilimo Supplies Ltd",
            lines: [
              ["Bank details", "CRDB Bank, Mlimani City branch"],
              ["Mobile money pay numbers", "M-Pesa Lipa Namba 123456"],
              ["TIN", "123-456-789"],
            ],
            stamp: "Printed",
            tone: "ok",
          },
          tip: "Never pay staff or yourself from the till. Record what you take as an expense or a salary so the profit figures stay true.",
          scales: "all",
        },
      ],
    },
    {
      id: "configure",
      title: "Set up LeMoSp for a goods business",
      intro:
        "LeMoSp is one app with three operating modes: Small, Medium and Enterprise. Tell it you sell goods, set your company rules once, then add products, stores and people. Changing level later never removes data.",
      steps: [
        {
          id: "what-you-sell",
          title: "Choose Goods and your business level",
          body:
            "What you sell decides which screens you see. A goods business does not need service jobs or timesheets, so they stay hidden and the menus stay short.",
          do: [
            "Open Features & business level.",
            "Under What you sell, choose Goods.",
            "Choose the level that matches you today: Small for one shop or a few people, Medium for several staff and a store, Enterprise for branches, approval steps and budgets.",
            "Switch on single features you need even if your level does not include them, for example Batches & expiry dates for food or medicines.",
          ],
          where: ["Settings", "Features & business level"],
          href: "/settings/features",
          who: "Management",
          example: {
            kind: "Features & business level",
            title: "Kilimo Supplies Ltd",
            lines: [
              ["What you sell", "Goods"],
              ["Business level", "Medium"],
              ["Batches & expiry dates", "On"],
              ["Service jobs", "Off"],
            ],
            mark: 0,
            stamp: "Saved",
            tone: "ok",
          },
          scenarios: [
            {
              title: "You start installing what you sell",
              problem: "Clients now ask Kilimo Supplies to install the irrigation pumps it sells.",
              fix: [
                "Open Features & business level and change What you sell to Goods and services.",
                "Service jobs, Maintenance contracts and Equipment appear. All your products, orders and invoices stay as they were.",
                "Read the playbook \"Supply goods and services together\" before the first installation.",
              ],
              tone: "info",
            },
          ],
          tip: "Small, Medium and Enterprise are modes of one app, not separate apps. Move up or down at any time; nothing is lost.",
          scales: "all",
        },
        {
          id: "company-rules",
          title: "Set VAT, terms and approval limits",
          body:
            "Company details & branding holds the rules printed on every document and used in every total. Set them once before the first quotation.",
          do: [
            "Open Company details & branding.",
            "Enter the Registered name as on the BRELA certificate, the TIN and, if VAT registered, the VRN.",
            "Set the VAT rate % to 18, or 0 if you are not registered for VAT.",
            "Leave the Withholding tax on services % at 5. It only applies to service lines, so a goods business rarely sees it.",
            "Set Clients pay within (days), Quotations valid for (days) and the Minimum margin %.",
            "Write the Standard invoice terms, for example \"Goods remain the property of Kilimo Supplies until paid in full.\" Press Save company details.",
          ],
          where: ["Settings", "Company details & branding"],
          href: "/settings/company",
          who: "Management",
          example: {
            kind: "Company details",
            title: "Kilimo Supplies Ltd",
            lines: [
              ["VAT rate %", "18"],
              ["Clients pay within (days)", "30"],
              ["Quotations valid for (days)", "14"],
              ["Minimum margin %", "12"],
              ["Approval needed above", "TZS 5,000,000"],
            ],
            mark: 3,
            stamp: "Saved",
            tone: "info",
          },
          scales: "all",
        },
        {
          id: "products",
          title: "Add your products as Goods, with the right unit",
          body:
            "Every product in a goods business has the Type Goods: it is counted in stock, goes on delivery notes and is costed when sold. Choose the unit you sell in.",
          do: [
            "Open Products and press + New product.",
            "Set the Type to Goods.",
            "Choose the Unit: pcs for pieces, m for pipes and cable sold by length, kg, litre, bag, box or carton.",
            "Enter the Selling price (TZS) and the Reorder level, then press Add product.",
            "Many products? Use Import from spreadsheet with the template.",
          ],
          where: ["Products"],
          href: "/products",
          who: "Management or Procurement",
          example: {
            kind: "Product",
            title: "Drip irrigation pipe 16 mm",
            lines: [
              ["Type", "Goods"],
              ["Unit", "m"],
              ["Selling price (TZS)", "TZS 1,200"],
              ["Reorder level", "2,000"],
            ],
            mark: 0,
            stamp: "Added",
            tone: "info",
          },
          tip: "Transport or fitting charged now and then? Add them as products of Type Service, priced per job. They never touch stock.",
          scales: "all",
        },
        {
          id: "team",
          title: "Invite your team with the right roles",
          body:
            "Each person sees only what their job needs. A role is a set of rights, not a person: one person can hold the work of two roles in a small company.",
          do: [
            "Open Team & roles and invite each person by email.",
            "Management: the owner and managers. Sales: quotations and clients. Procurement: suppliers and purchase orders.",
            "Warehouse: receiving, stock and dispatch. Finance: invoices, payments and bills. Driver: their own deliveries on the phone.",
            "Switch on two-step verification for management and finance in Security.",
          ],
          where: ["Settings", "Team & roles"],
          href: "/settings/team",
          who: "Management",
          example: {
            kind: "Team & roles",
            title: "Kilimo Supplies Ltd",
            lines: [
              ["Neema Mushi", "Management"],
              ["Hassan Said", "Sales"],
              ["Rehema Juma", "Procurement and Finance"],
              ["Peter Mrema", "Warehouse"],
              ["Ally Bakari", "Driver"],
            ],
            stamp: "Invited",
            tone: "ok",
          },
          scales: "all",
        },
      ],
    },
    {
      id: "buying",
      title: "Buy well and receive properly",
      intro:
        "In a goods business, profit is made when you buy. Compare suppliers, order in writing and count what arrives before it goes on the shelf.",
      steps: [
        {
          id: "compare",
          title: "Compare suppliers before you order",
          body:
            "Asking two or three suppliers for the same items usually saves 5 to 15 percent. Compare the total cost: price, transport, lead time and how reliable they are.",
          do: [
            "Open Supplier RFQs and press + New, or press Request supplier quotes on a won quotation.",
            "Add the items and the suppliers to ask, then send the RFQ PDF by WhatsApp or email.",
            "Enter each reply with Enter prices, then look at Compare prices.",
            "Press Award & create PO under the supplier you choose.",
          ],
          where: ["Purchasing", "Supplier RFQs"],
          href: "/supplier-rfqs",
          who: "Procurement",
          example: {
            kind: "Compare prices",
            title: "SRFQ-2026-0018",
            lines: [
              ["Plastic Pipes Kariakoo", "TZS 4,100,000 · 2 days"],
              ["Arusha Irrigation Centre", "TZS 3,950,000 · 10 days"],
              ["Mombasa importer", "TZS 3,600,000 · 35 days"],
              ["Chosen", "Plastic Pipes Kariakoo"],
            ],
            mark: 0,
            stamp: "Best value",
            tone: "ok",
          },
          scenarios: [
            {
              title: "The cheapest supplier is too slow",
              problem: "The Mombasa importer is TZS 500,000 cheaper but takes five weeks. The client needs the pipes in ten days.",
              fix: [
                "Buy this order from the faster local supplier so you keep the client.",
                "Order your regular stock from the importer, early enough, using Purchase planning.",
                "Tell the local supplier the price you were offered; many will come down for regular orders.",
              ],
              tone: "info",
            },
          ],
          scales: "medium+",
        },
        {
          id: "po",
          title: "Order with a purchase order",
          body:
            "A purchase order is your written promise to buy: items, quantities, prices, delivery and payment terms. Big orders wait for management approval.",
          do: [
            "Open Purchase orders and press + New PO, or start from the supplier RFQ or What to reorder.",
            "Check items, prices, Deliver to and Required by, then press Submit purchase order.",
            "Press Open PDF, send it to the supplier, then press I have sent it to the supplier.",
            "When they confirm, enter the Confirmed delivery date and press Supplier confirmed.",
          ],
          where: ["Purchasing", "Purchase orders"],
          href: "/purchase-orders",
          who: "Procurement; Management approves",
          example: {
            kind: "Purchase order",
            title: "PO-2026-0044",
            lines: [
              ["Supplier", "Plastic Pipes Kariakoo"],
              ["Drip irrigation pipe 16 mm", "3,000 m × TZS 820"],
              ["Total", "TZS 2,902,800"],
              ["Required by", "22 Oct 2026"],
            ],
            mark: 2,
            stamp: "Approved",
            tone: "ok",
          },
          scales: "all",
        },
        {
          id: "receive",
          title: "Count the goods in with a goods received note",
          body:
            "Count what arrives against the purchase order before you sign the supplier's delivery note. Recording it creates a GRN and puts the goods into stock.",
          do: [
            "Open Receive goods and choose the purchase order.",
            "Count each item and enter the quantity that really arrived. Write any damage in the note.",
            "Press Record goods received. Stock goes up in the store you chose.",
            "When the supplier's bill comes, record it in Supplier bills and check it on Order, receipt and bill check before paying.",
          ],
          where: ["Purchasing", "Receive goods"],
          href: "/receiving",
          who: "Warehouse",
          example: {
            kind: "Goods received",
            title: "GRN-2026-0039",
            lines: [
              ["Purchase order", "PO-2026-0044"],
              ["Ordered", "3,000 m"],
              ["Received", "2,800 m"],
              ["Note", "2 rolls of 100 m short"],
            ],
            mark: 2,
            stamp: "Part received",
            tone: "warn",
          },
          scenarios: [
            {
              title: "The supplier billed more than you received",
              problem: "Plastic Pipes Kariakoo billed 3,000 m but only 2,800 m arrived.",
              fix: [
                "Open Order, receipt and bill check: the line shows billed more than received.",
                "Pay only for 2,800 m, or wait until the last 200 m arrive and receive them on the same purchase order.",
                "Ask the supplier for a credit note if the rest will not come.",
              ],
              tone: "warn",
            },
          ],
          scales: "all",
        },
      ],
    },
    {
      id: "stock",
      title: "Keep stock and stores under control",
      intro:
        "Stock is cash sitting on a shelf. Know what you have in each store, reorder before you run out, count regularly and clear slow goods before they lose value.",
      steps: [
        {
          id: "stores",
          title: "Set up stores and load opening stock",
          body:
            "Each store, warehouse or shop has its own stock. Count everything once, load it, and from then on every receipt, delivery and adjustment is recorded.",
          do: [
            "Open Stores and add each store with a short code, for example DSM and ARU.",
            "Count every product in every store on a quiet day.",
            "Open Stock, press Load opening stock, fill the template and upload it.",
          ],
          where: ["Stock"],
          href: "/stock/import",
          who: "Management or Warehouse",
          example: {
            kind: "Opening stock",
            title: "DSM",
            lines: [
              ["Drip irrigation pipe 16 mm", "6,400 m"],
              ["Water pump 1 hp", "14 pcs"],
              ["Fertiliser NPK 50 kg", "220 bag"],
            ],
            stamp: "Loaded",
            tone: "ok",
          },
          scales: "all",
        },
        {
          id: "reorder",
          title: "Reorder before you run out",
          body:
            "What to reorder lists every product below its reorder level, with a suggested quantity. One tap turns it into purchase orders.",
          do: [
            "Open What to reorder every Monday.",
            "Check the suggested quantities against what you expect to sell.",
            "Press Order to create draft purchase orders, one per main supplier.",
          ],
          where: ["Stock", "What to reorder"],
          href: "/stock/reorder",
          who: "Procurement",
          example: {
            kind: "What to reorder",
            title: "Monday, 08:30",
            lines: [
              ["Water pump 1 hp", "4 left · order 20"],
              ["Fertiliser NPK 50 kg", "35 left · order 200"],
            ],
            stamp: "Ordered",
            tone: "warn",
          },
          tip: "Set reorder levels from real sales: Purchase planning shows sales per day and days of stock left for each product.",
          scales: "all",
        },
        {
          id: "count",
          title: "Count every month and explain every difference",
          body:
            "A count shows losses early, while they are small. Every difference is recorded with a reason, so you see whether it is breakage, theft or a recording mistake.",
          do: [
            "Count a different group of products each week, so all are counted every month.",
            "Open Stock, choose the product and press Adjust stock for any difference.",
            "Write the real reason, for example \"Pump damaged in store, returned to supplier\".",
            "Management looks at all adjustments at month end.",
          ],
          where: ["Stock"],
          href: "/stock",
          who: "Warehouse; Management checks",
          example: {
            kind: "Adjust stock",
            title: "Fertiliser NPK 50 kg",
            lines: [
              ["In the app", "220 bag"],
              ["Counted", "216 bag"],
              ["Reason", "4 bags torn by rats"],
            ],
            mark: 2,
            stamp: "Adjusted",
            tone: "warn",
          },
          scenarios: [
            {
              title: "The same item goes missing every month",
              problem: "Every count, two or three pumps are missing from the Dar es Salaam store.",
              fix: [
                "Open the Activity log and look at who received and dispatched pumps.",
                "Keep pumps in a locked cage and count them every week instead of every month.",
                "Allow only the store keeper to adjust stock, and have management approve each adjustment.",
              ],
              tone: "bad",
            },
          ],
          scales: "all",
        },
        {
          id: "slow",
          title: "Clear slow-moving stock",
          body:
            "Goods that have not sold for three months tie up cash and may expire or go out of date. Find them and turn them back into money.",
          do: [
            "Open Business insights and look at Slow stock.",
            "Offer slow items to regular clients at a small discount, or bundle them with fast sellers.",
            "Stop reordering them: lower or clear their reorder level.",
          ],
          where: ["Reports", "Business insights"],
          href: "/insights",
          who: "Management",
          scales: "medium+",
        },
      ],
    },
    {
      id: "sell",
      title: "Price, quote and deliver",
      intro:
        "Price from your real cost, send clear quotations, deliver with a note the client signs, and use direct supply when the goods do not need to pass through your store.",
      steps: [
        {
          id: "pricing",
          title: "Price from the cost, protect your margin",
          body:
            "The selling price must cover what the goods cost you landed in your store, your running costs and a profit. The Minimum margin % stops quotations going out below it without approval.",
          do: [
            "Work out the landed cost: supplier price plus transport, clearing and duty, per unit.",
            "Add your margin. Many traders use 15 to 30 percent; on large tenders it may be less.",
            "Set the Selling price (TZS) on the product; quotations start from it.",
            "Set the Minimum margin % in Company details & branding.",
          ],
          where: ["Products"],
          href: "/products",
          who: "Management",
          example: {
            kind: "Price build-up",
            title: "Water pump 1 hp",
            lines: [
              ["Supplier price", "TZS 310,000"],
              ["Transport and clearing", "TZS 25,000"],
              ["Landed cost", "TZS 335,000"],
              ["Margin 20%", "TZS 67,000"],
              ["Selling price (TZS)", "TZS 402,000"],
            ],
            mark: 4,
            stamp: "Priced",
            tone: "info",
          },
          scenarios: [
            {
              title: "Margin is falling and nobody noticed",
              problem: "The supplier raised the pump price twice this year, but the selling price stayed the same.",
              fix: [
                "Confirming each purchase order updates the product's last cost. Open Profit and look at margin by product.",
                "Raise the Selling price (TZS) on the product.",
                "Quotations below the Minimum margin % now go to management for approval.",
              ],
              tone: "warn",
            },
          ],
          scales: "all",
        },
        {
          id: "quote",
          title: "Send a quotation and win the order",
          body:
            "A quotation is your offer in writing. When the client accepts with an LPO, it becomes Won and the delivery, purchase orders and invoice all start from it.",
          do: [
            "Open Quotations and press + New quotation, choose the client and add the items.",
            "Press Submit quotation, then Share PDF and I have sent it to the client.",
            "When the client sends an LPO, type its number in Client's answer and press Client accepted.",
          ],
          where: ["Sales", "Quotations"],
          href: "/quotations",
          who: "Sales",
          example: {
            kind: "Quotation",
            title: "QT-2026-0071",
            lines: [
              ["Client", "Mbeya Farmers Co-operative"],
              ["Drip irrigation pipe 16 mm", "2,500 m × TZS 1,200"],
              ["Water pump 1 hp", "4 pcs × TZS 402,000"],
              ["Total incl. VAT", "TZS 5,437,440"],
            ],
            mark: 3,
            stamp: "Won",
            tone: "ok",
          },
          scales: "all",
        },
        {
          id: "deliver",
          title: "Deliver with a delivery note and proof of delivery",
          body:
            "The delivery note takes the goods out of stock and travels with them. The client's signature or stamp is your proof that the goods arrived, and what you invoice against.",
          do: [
            "On the won quotation, press Create delivery note and choose the store.",
            "Press Dispatch now. The driver sees the delivery on the phone.",
            "At the client, the driver presses Record proof of delivery: name of the receiver, signature and a photo of the stamped note.",
            "The delivery note becomes Delivered and is ready to invoice.",
          ],
          where: ["Deliveries"],
          href: "/deliveries",
          who: "Warehouse and Driver",
          example: {
            kind: "Delivery note",
            title: "DN-2026-0063",
            lines: [
              ["Client", "Mbeya Farmers Co-operative"],
              ["Drip irrigation pipe 16 mm", "2,500 m"],
              ["Water pump 1 hp", "4 pcs"],
              ["Received by", "Joseph Mwakyusa, store keeper"],
            ],
            mark: 3,
            stamp: "Delivered",
            tone: "ok",
          },
          scenarios: [
            {
              title: "The client says only part arrived",
              problem: "Mbeya Farmers say they received 2,300 m of pipe, not 2,500 m.",
              fix: [
                "Open the delivery note and look at the proof of delivery photo and who signed.",
                "If the signed note shows 2,500 m, send the photo to the client.",
                "If 200 m really did not arrive, find out where they are and deliver them on a new delivery note before you invoice the rest.",
              ],
              tone: "warn",
            },
          ],
          scales: "all",
        },
        {
          id: "direct",
          title: "Use direct supply when the supplier delivers to your client",
          body:
            "Sometimes it is cheaper for the supplier to deliver straight to your client, for example a full truck of cement from the factory to a site in Dodoma. The goods never enter your store, but the order, the delivery and the profit are still recorded.",
          do: [
            "On the won quotation, press Create purchase order and tick Supplier delivers straight to the client.",
            "Send the purchase order to the supplier with the client's site and contact.",
            "When the client confirms the goods arrived, open the purchase order and press Record delivery to client.",
            "Enter the date and who received them. The order closes and the client's delivery note is created, ready to invoice. Your stock does not change.",
          ],
          where: ["Purchasing", "Purchase orders"],
          href: "/purchase-orders",
          who: "Procurement",
          example: {
            kind: "Purchase order",
            title: "PO-2026-0051",
            lines: [
              ["Supplier", "Twiga Cement factory"],
              ["Supplier delivers straight to the client", "Yes"],
              ["Deliver to", "Dodoma Builders, Area D site"],
              ["Cement 50 kg", "600 bag"],
            ],
            mark: 1,
            stamp: "Delivered to client",
            tone: "ok",
          },
          tip: "Ask the client to sign the supplier's delivery note and send you a photo the same day. It is your proof when you invoice.",
          scales: "all",
        },
        {
          id: "wholesale-tender",
          title: "Sell wholesale and win tenders",
          body:
            "Wholesale and tender work brings big orders at thinner margins. Agreed prices, a clear tender checklist and a careful cash plan keep them profitable.",
          do: [
            "For regular wholesale buyers, record agreed prices in Contracts so every quotation starts from them.",
            "Record each tender in Tenders with its closing date and tick each paper on the checklist: BRELA certificate, TIN, tax clearance, business licence, bid security.",
            "Before bidding, check the payment terms: government buyers may pay after 60 to 90 days. Plan the cash in Cash-flow forecast.",
          ],
          where: ["Sales", "Tenders"],
          href: "/tenders",
          who: "Sales and Management",
          scales: "medium+",
        },
      ],
    },
    {
      id: "paid",
      title: "Invoice and get paid",
      intro:
        "A sale is only finished when the money is in the bank. Invoice on the day of delivery, record every payment and follow up before invoices become old.",
      steps: [
        {
          id: "invoice",
          title: "Invoice on the day you deliver",
          body:
            "Every day you wait to invoice is a day added to when you are paid. Create the invoice from the delivered delivery note so it matches what the client signed for.",
          do: [
            "Open the delivered delivery note and press Create invoice.",
            "Check the items and the client's LPO number, then press Issue invoice.",
            "Issue the EFD or VFD receipt as required, and press Share PDF to send the invoice.",
          ],
          where: ["Finance", "Invoices"],
          href: "/invoices",
          who: "Finance",
          example: {
            kind: "Invoice",
            title: "INV-2026-0088",
            lines: [
              ["Client", "Mbeya Farmers Co-operative"],
              ["Delivery note", "DN-2026-0063"],
              ["Total incl. VAT", "TZS 5,437,440"],
              ["Due", "14 Nov 2026"],
            ],
            mark: 2,
            stamp: "Issued",
            tone: "info",
          },
          scales: "all",
        },
        {
          id: "payment",
          title: "Record every payment the day it arrives",
          body:
            "Payments come by bank transfer, mobile money, cheque or cash. Recording each one against the invoice keeps Money owed to us true.",
          do: [
            "Open the invoice and press + Record a payment received.",
            "Choose how they paid, enter the amount, date and the transaction code, then press Record payment.",
            "Once a week, tick payments against the bank and mobile money statements in Check payments.",
          ],
          where: ["Finance", "Payments received"],
          href: "/payments",
          who: "Finance",
          example: {
            kind: "Payment received",
            title: "INV-2026-0088",
            lines: [
              ["Method", "Bank transfer"],
              ["Amount", "TZS 5,437,440"],
              ["Reference", "NMB FT26310XQ4"],
            ],
            stamp: "Paid",
            tone: "ok",
          },
          scales: "all",
        },
        {
          id: "chase",
          title: "Follow up money owed every week",
          body:
            "Money owed to us shows who owes what and for how long. A polite reminder before the due date gets you paid faster than an angry call after it.",
          do: [
            "Open Money owed to us every Friday.",
            "Call or WhatsApp clients with invoices due this week or overdue, and log what they say with + Log a reminder or promise to pay.",
            "Send a statement of account to clients with several open invoices.",
            "Stop credit for clients who are far overdue until they pay.",
          ],
          where: ["Finance", "Money owed to us"],
          href: "/receivables",
          who: "Finance",
          scenarios: [
            {
              title: "A big client always pays late",
              problem: "A hotel chain owes TZS 18 million, much of it more than 60 days late, and keeps ordering.",
              fix: [
                "Meet their finance person with the statement of account and agree a payment plan.",
                "Log each promise with its date so the app reminds you.",
                "Ask for part payment before the next delivery, or a shorter credit period on the next quotation.",
              ],
              tone: "bad",
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
        "Not every sale is goods from your shelf. Here is how LeMoSp handles the other ways a goods business can supply, and what is still to come.",
      steps: [
        {
          id: "hire",
          title: "Hire or rental",
          body:
            "If you hire out goods you own, such as tents, scaffolding or generators, mark them as Type Hire. The Equipment hire screen tracks what is out, with whom, when it is due back, and bills every day on hire.",
          do: [
            "In Features & business level, switch on Equipment hire.",
            "Set the product's Type to Hire and receive the units you own into a store.",
            "Open Equipment hire, press + Hire, choose the client and the dates, then add the items with their rate per day, week or month.",
            "When the items come back, press Record return, then Make invoice.",
          ],
          where: ["Services", "Equipment hire"],
          href: "/hire",
          who: "Sales and Warehouse",
          scales: "medium+",
        },
        {
          id: "indent",
          title: "Indent or direct supply",
          body:
            "Indent means you take the client's order, buy from the supplier and the goods go straight to the client. Use a purchase order ticked Supplier delivers straight to the client, then Record delivery to client.",
          who: "Procurement",
          where: ["Purchasing", "Purchase orders"],
          href: "/purchase-orders",
          scales: "all",
        },
        {
          id: "contracting",
          title: "Supply and install, or contracting",
          body:
            "If you also install what you sell, change What you sell to Goods and services. You then get service jobs with materials taken from stock, and projects billed by milestone for bigger works.",
          where: ["Settings", "Features & business level"],
          href: "/settings/features",
          who: "Management",
          scales: "medium+",
        },
        {
          id: "manufacturing",
          title: "Manufacturing or fabrication",
          body:
            "Manufacturing is not built into LeMoSp yet; it is planned for a later phase. For now, record raw materials and finished goods as products, take the raw materials out with Adjust stock when you produce, and add the finished goods the same way.",
          example: {
            kind: "Adjust stock",
            title: "Production, 12 Oct",
            lines: [
              ["Steel sheet 1.2 mm", "−10 pcs"],
              ["Welding rods", "−2 box"],
              ["Water tank stand", "+5 pcs"],
              ["Reason", "Production batch 12 Oct"],
            ],
            mark: 2,
            stamp: "Recorded",
            tone: "info",
          },
          who: "Warehouse",
          scales: "all",
        },
        {
          id: "distribution",
          title: "Distribution and wholesale with route sales",
          body:
            "Distributors with agreed prices per customer use Contracts for the prices and delivery notes for each drop. Selling from a van along a route, with stock on the vehicle, is planned for a later phase.",
          where: ["Sales", "Contracts"],
          href: "/contracts",
          who: "Sales",
          scales: "medium+",
        },
        {
          id: "recurring",
          title: "Subscription or recurring supply",
          body:
            "A client who takes the same goods every month, for example water or office supplies, gets a contract with agreed prices and a delivery each month. Automatic recurring invoices are planned for a later phase.",
          who: "Sales and Finance",
          scales: "all",
        },
      ],
    },
    {
      id: "routine",
      title: "Your monthly routine",
      intro:
        "A goods business stays healthy when the same checks happen every month. Put this list on the wall of the office.",
      steps: [
        {
          id: "weekly",
          title: "Every week",
          body: "Short checks that stop small problems from growing.",
          do: [
            "Monday: What to reorder and Purchasing overview.",
            "Every day: deliveries out, proof of delivery in, invoices issued the same day.",
            "Friday: Money owed to us, reminders logged, payments ticked in Check payments.",
          ],
          who: "Procurement, Warehouse and Finance",
          scales: "all",
        },
        {
          id: "monthly",
          title: "At the end of every month",
          body: "The month-end checklist for a goods business. Each line takes minutes in the app.",
          do: [
            "Finish the stock count for the month and explain every adjustment.",
            "Check Order, receipt and bill check and pay suppliers that are due.",
            "Open Profit & loss: sales, cost of goods, expenses and profit for the month.",
            "Look at margin by product in Profit and raise prices where costs went up.",
            "Look at Slow stock in Business insights and plan to clear it.",
            "Give your accountant the sales and purchases for the VAT return, due by the 20th of the next month.",
            "Pay PAYE, NSSF and WCF on time. Mark each one done in Legal & compliance → Tax & filing calendar.",
          ],
          where: ["Finance", "Profit & loss"],
          href: "/profit-loss",
          who: "Management and Finance",
          example: {
            kind: "Month end",
            title: "October 2026",
            lines: [
              ["Sales", "TZS 86,400,000"],
              ["Cost of goods", "TZS 68,900,000"],
              ["Gross margin", "20.3%"],
              ["Stock counted", "All stores"],
              ["VAT return", "Ready for the accountant"],
            ],
            mark: 2,
            stamp: "Closed",
            tone: "ok",
          },
          tip: "Due dates in this list are general guidance. Confirm the current dates for VAT, PAYE, NSSF and WCF with TRA or your accountant.",
          scales: "all",
        },
        {
          id: "yearly",
          title: "Once a year",
          body: "The yearly dates that, if missed, bring fines or stop you trading.",
          do: [
            "Renew the business licence and any product permits.",
            "File the BRELA annual return (companies). The Tax & filing calendar in Legal & compliance reminds you before it is due.",
            "Do a full stock count of every store at the year end.",
            "Review your business level in Features & business level: move up when you add stores, branches or staff.",
          ],
          who: "Owner and Management",
          scales: "all",
        },
      ],
    },
  ],
};
