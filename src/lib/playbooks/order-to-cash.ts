import type { Playbook } from "./types";

/**
 * Order to cash: one live order (Kilimanjaro Hotels Ltd buys paper, toner and cleaning supplies) followed
 * from the first call to the money in the bank and the profit on the order, with the problems that
 * happen on the way and how to handle each one in LeMoSp.
 * English is the key; Kiswahili is in ./sw/order-to-cash.ts.
 */
export const ORDER_TO_CASH: Playbook = {
  id: "order-to-cash",
  title: "From the client's order to the money in the bank",
  tagline: "Follow one real order through every screen of LeMoSp, and learn what to do when something goes wrong.",
  audience: "Owners, sales, procurement, warehouse, drivers and finance staff",
  minutes: 45,
  icon: "sales",
  color: "#14b8a6",
  chapters: [
    // ------------------------------------------------------------------ 1
    {
      id: "ch-overview",
      title: "The order we will follow",
      intro:
        "Every step in this playbook uses the same live example, so you can see how one record leads to the next. Nothing is typed twice: the request becomes the quotation, the quotation becomes the purchase order, the delivery note and the invoice.",
      steps: [
        {
          id: "the-example",
          title: "Meet Kilimanjaro Hotels Ltd",
          body:
            "Kilimanjaro Hotels Ltd in Arusha needs office paper, printer toner and liquid soap for its rooms. Asha Mushi, their procurement officer, will send the request. You buy the paper and toner from Dar Office Supplies and the soap from Coastal Cleaning Supplies.",
          example: {
            kind: "The order",
            title: "Kilimanjaro Hotels Ltd",
            lines: [
              ["A4 paper, box of 5 reams", "50 boxes"],
              ["Toner HP 85A", "10 pieces"],
              ["Liquid soap, 20 litres", "12 jerrycans"],
              ["Contact", "Asha Mushi, Procurement"],
              ["Needed by", "25 Oct 2026"],
            ],
            stamp: "Live example",
            tone: "info",
          },
          tip: "To practise without touching real data, sign out and open a Medium demo company from the sign-in page, then follow this playbook in it.",
          scales: "all",
        },
        {
          id: "the-map",
          title: "The road from order to cash",
          body:
            "An order moves through ten stations: client, request, supplier prices, quotation, agreement, buying, receiving, delivering, invoicing and getting paid. At the end you pay your suppliers and see the profit. The coloured bar at the top of every quotation shows how far the order has gone.",
          do: [
            "Open any quotation: the bar shows Quoted, Approved, Sent, Won, Delivered, Invoiced and Paid.",
            "Home lists what needs your attention today: approvals waiting, quotations to follow up, invoices overdue.",
            "Sales shows open RFQs, quotations waiting for approval and quotations waiting for the client's answer.",
          ],
          where: ["Sales"],
          href: "/sales",
          example: {
            kind: "Order progress",
            title: "QT-2026-0042",
            lines: [
              ["Quoted", "Done"],
              ["Approved", "Done"],
              ["Sent", "Done"],
              ["Won", "Done"],
              ["Delivered", "Next"],
              ["Paid", "Waiting"],
            ],
            mark: 4,
            stamp: "On track",
            tone: "info",
          },
          scales: "all",
        },
        {
          id: "the-setup",
          title: "Before the first order: settings that matter",
          body:
            "A few company settings decide how the whole order behaves: the VAT rate, how long quotations are valid, the minimum margin, the approval limits, the payment days and the bank and mobile-money numbers printed on invoices. Set them once.",
          do: [
            "Open Company details & branding.",
            "Under Quotations, set VAT rate %, Quotations valid for (days), Minimum margin % and the amount above which quotations need approval.",
            "Under Purchase orders, set the amount above which purchase orders need approval.",
            "Fill in Bank details and Mobile money pay numbers. They print on every invoice and reminder.",
            "Under Follow-ups and reminders, set Follow up sent quotations after (days), Clients pay within (days), Remind before an invoice is due (days) and Repeat overdue reminders every (days).",
          ],
          where: ["More", "Company details & branding"],
          href: "/settings/company",
          who: "Management",
          example: {
            kind: "Company settings",
            title: "Your company",
            lines: [
              ["VAT rate %", "18"],
              ["Minimum margin %", "12"],
              ["Quotation approval above", "TZS 25,000,000"],
              ["PO approval above", "TZS 2,500,000"],
              ["Clients pay within (days)", "30"],
            ],
            stamp: "Saved",
            tone: "ok",
          },
          tip: "Clients marked as VAT exempt get 0% VAT on their documents automatically.",
          scales: "all",
        },
      ],
    },
    // ------------------------------------------------------------------ 2
    {
      id: "ch-client",
      title: "Finding the client",
      intro:
        "Before there is an order there is a client. Record them properly once, and every quotation, delivery note, invoice and statement picks up the right name, TIN, sites and terms.",
      steps: [
        {
          id: "add-client",
          title: "Add the client",
          body:
            "The client record holds everything the documents need: legal name, TIN and VRN, address, delivery sites, payment terms, currency and the credit limit.",
          do: [
            "Open Clients and press + New client.",
            "Enter the company name, industry, TIN, VRN, physical address and region.",
            "Under Delivery sites, list each place you deliver to, for example the main hotel and the lodge.",
            "Choose the payment terms and the currency.",
            "Management or finance enters the credit limit: the most the client may owe you at one time.",
            "Press Add client, then open the client and press + Add a contact for Asha, with her phone and email.",
          ],
          where: ["Clients"],
          href: "/clients",
          who: "Sales, Finance or Management",
          example: {
            kind: "Client",
            title: "Kilimanjaro Hotels Ltd",
            lines: [
              ["TIN", "123-456-789"],
              ["Delivery sites", "Main hotel, Arusha; Lodge, Karatu"],
              ["Payment terms", "30 days"],
              ["Credit limit", "TZS 10,000,000"],
              ["Contact", "Asha Mushi, Procurement"],
            ],
            stamp: "Added",
            tone: "ok",
          },
          scenarios: [
            {
              title: "You already have 200 clients in Excel",
              problem: "Typing every client again would take days.",
              fix: [
                "Management opens Import from spreadsheet.",
                "Download the template, copy your clients into it and save.",
                "Upload the file. The app checks every row and shows problems before anything is saved.",
                "Confirm to load them all at once.",
              ],
              tone: "info",
            },
          ],
          tip: "A credit limit of 0 means no limit. Set one for every client who buys on credit.",
          scales: "all",
        },
        {
          id: "pipeline",
          title: "Track the opportunity on the Pipeline",
          body:
            "A phone call is not yet a request, but it is a possible order. The Pipeline keeps every possible order with its expected value and the next step, so nothing is forgotten when a salesperson is busy or away.",
          do: [
            "Open Pipeline and press + Opportunity.",
            "Say what the client needs, choose the client (or type the name of a new prospect), the expected value and the expected order date.",
            "Choose who is responsible and the next step with its date. You are reminded on that day.",
            "After each call, visit or message, open the opportunity and press + Log a call, visit or message.",
            "Move it along the stages with the buttons under Move to: Lead, Qualified, Quoted, Negotiation.",
          ],
          where: ["Sales", "Pipeline"],
          href: "/crm",
          who: "Sales and Management",
          example: {
            kind: "Opportunity",
            title: "Kilimanjaro Hotels Ltd",
            lines: [
              ["What the client needs", "Paper, toner and soap every quarter"],
              ["Expected value", "TZS 3,500,000"],
              ["Stage", "Qualified"],
              ["Next step", "Send samples, Friday"],
            ],
            stamp: "New lead",
            tone: "info",
          },
          scenarios: [
            {
              title: "The caller is not a client yet",
              problem: "Zanzibar Resorts calls for the first time. You do not have their TIN or address yet.",
              fix: [
                "Press + Opportunity and type the prospect name instead of choosing a client.",
                "When they ask for a price, open the opportunity and press Make this prospect a client.",
                "Then press Start a quotation from the same opportunity.",
              ],
              tone: "info",
            },
            {
              title: "A salesperson forgets to follow up",
              problem: "The next step date passed and nobody called the client.",
              fix: [
                "The responsible person gets a reminder on the day of each next step.",
                "Management sees follow-ups that are overdue on the Pipeline.",
                "Log the call when it is made and set the next step, so the reminder moves forward.",
              ],
              tone: "warn",
            },
          ],
          tip: "On the client's page you can also save important dates such as the procurement manager's birthday or a contract renewal, with a reminder.",
          scales: "medium+",
        },
        {
          id: "crm-log",
          title: "Log every call and visit, then win or lose the opportunity",
          body:
            "The history of an opportunity lets anyone in the team pick it up. Each call, visit or message is saved with what was agreed and the next step, and the opportunity ends as won or lost, with the reason.",
          do: [
            "Open the opportunity and press + Log a call, visit or message.",
            "Under What, choose Call, Visit, Meeting, WhatsApp, SMS, Email or Note, and set When.",
            "Write What was said or agreed, then the Next step and Next step on. Press Save in the history. The reminder moves to the new date.",
            "When the client moves forward, press the next stage under Move to.",
            "If the client goes elsewhere, open Mark as lost, write why (price, delivery time, competitor) and press Lost. If they come back later, press Reopen.",
            "On Pipeline, Follow up today lists the next steps due. Switch between Mine and Everyone, and open Won & lost to see the Win rate and Value won of the last 6 months.",
          ],
          where: ["Sales", "Pipeline"],
          href: "/crm",
          who: "Sales and Management",
          example: {
            kind: "Calls and visits",
            title: "Kilimanjaro Hotels Ltd",
            lines: [
              ["What", "Visit"],
              ["When", "14 Oct 2026"],
              ["What was said or agreed", "Asha wants samples of the 20 L soap"],
              ["Next step", "Send samples"],
              ["Next step on", "17 Oct 2026"],
            ],
            mark: 3,
            stamp: "Saved in the history",
            tone: "info",
          },
          scenarios: [
            {
              title: "The salesperson in charge leaves the company",
              problem: "Baraka looked after twelve opportunities, including Zanzibar Resorts, and resigned this week.",
              fix: [
                "On Pipeline, choose Everyone and open each of Baraka's opportunities.",
                "Press Edit details, choose another person under Responsible and save. The reminders now go to them.",
                "Read the history under Calls and visits before calling the client, so they do not have to explain everything again.",
              ],
              tone: "warn",
            },
            {
              title: "The client chose a competitor",
              problem: "Dodoma Builders tells you they bought their cleaning supplies from another company because it delivers on the same day.",
              fix: [
                "Open the opportunity, open Mark as lost and write: delivery time, competitor delivers same day. Press Lost.",
                "If a quotation was linked, press Client rejected on it with the same reason, so both records agree.",
                "Once a quarter, read the reasons under Won & lost. If delivery time keeps coming up, fix delivery, not price.",
              ],
              tone: "bad",
            },
            {
              title: "The order comes in without a quotation in the app",
              problem: "Zanzibar Resorts sends an LPO straight away, based on last year's price list.",
              fix: [
                "Press Start a quotation on the opportunity, add the items at the agreed prices and submit it.",
                "Press Client accepted with their LPO number. The opportunity is marked won by itself.",
                "Never deliver without the quotation: the delivery note and the invoice are made from it.",
              ],
              tone: "info",
            },
          ],
          tip: "Log the call while you are still in the car. A note written the same day is worth ten written on Friday.",
          scales: "medium+",
        },
        {
          id: "client-dates",
          title: "Important dates and the client's history",
          body:
            "Clients remember who remembered them. On each client's page the app keeps their opportunities, calls and visits, contracts and important dates, and reminds you a few days before each date.",
          do: [
            "Open Clients and tap the client. Scroll to Important dates.",
            "Open + Add a date. Under What, write for example Procurement manager's birthday, and choose the Type: Birthday, Anniversary, Renewal, Licence, Holiday or Other.",
            "Enter the Date and Remind me (days before). Tick Every year for birthdays and anniversaries, then press Save date.",
            "Below, Opportunities lists the client's possible orders (press + Opportunity to add one), and Calls and visits lists every logged contact.",
            "The Account card shows Owed to us, Overdue and Credit available before you promise anything on credit.",
          ],
          where: ["Clients"],
          href: "/clients",
          who: "Sales and Management",
          example: {
            kind: "Important dates",
            title: "Arusha Medical Stores",
            lines: [
              ["What", "Mr Kimaro's birthday"],
              ["Type", "Birthday"],
              ["Date", "3 Nov"],
              ["Remind me (days before)", "3"],
              ["Every year", "Yes"],
            ],
            stamp: "Save date",
            tone: "ok",
          },
          scenarios: [
            {
              title: "A client's framework contract renews in January",
              problem: "Arusha Medical Stores renews its supplier list every January. Last year you heard about it too late.",
              fix: [
                "Add a date with the Type Renewal on 1 Dec, with Remind me (days before) set to 14, and tick Every year.",
                "When the reminder comes, open the client, check their Calls and visits and their sales this year, and book a visit.",
                "If you have a contract with them, Contracts also reminds you before it ends.",
              ],
              tone: "info",
            },
          ],
          scales: "medium+",
        },
        {
          id: "tender-advert",
          title: "Tenders: when the client buys by tender",
          body:
            "Government bodies and large companies often buy by tender. Record the tender as soon as you see the advert: the app keeps the checklist of papers and reminds you before it closes.",
          do: [
            "Open Tenders and press + Tender.",
            "Enter the buyer, what the tender is for, the tender number, and the closing date and time.",
            "The usual checklist of papers is added for you. Tick each one when it is ready, and add steps such as samples to the buyer.",
            "Enter our bid price, submit the bid, then press Mark as submitted.",
            "When the buyer announces the result, record We won or We lost, with the winner and the winning price.",
          ],
          where: ["Sales", "Tenders"],
          href: "/tenders",
          who: "Sales and Management",
          example: {
            kind: "Tender",
            title: "TND-2026-0004",
            lines: [
              ["Buyer", "Arusha Medical Stores"],
              ["Tender for", "Cleaning supplies for 2027"],
              ["Closes", "30 Oct 2026, 10:00"],
              ["Checklist", "7 of 9 papers ready"],
            ],
            stamp: "Being prepared",
            tone: "warn",
          },
          tip: "You are reminded before the tender closes, more often in the last two days. The full story of a won tender is in the last chapter.",
          scales: "medium+",
        },
        {
          id: "tender-result",
          title: "Tender papers, the decision to bid and the result",
          body:
            "Most tenders are lost on papers, not on price: one missing certificate and the bid is out. The checklist shows who prepares what, and the result you record teaches you how to price the next one.",
          do: [
            "Open the tender. Under Checklist, tick each paper when it is ready. Add your own steps with Add a step, e.g. Samples to the buyer, and remove those that do not apply.",
            "Choose who is Responsible with Edit details, and fill in How to submit, Bid security and the Site visit / pre-bid meeting if there is one.",
            "If you decide not to take part, open We will not bid, write why and press Not bidding. Press Prepare a bid after all if you change your mind.",
            "After submitting, enter Our bid price and press Mark as submitted.",
            "When the result is out, press We won, or open We lost and fill in Who won, Winning price and Why we lost, then press Record as lost. The tender then shows how much higher you were than the winner.",
            "If the buyer cancels the tender, open Cancelled by the buyer and press Cancelled. A wrong result can be fixed with Correct the result.",
          ],
          where: ["Sales", "Tenders"],
          href: "/tenders",
          who: "Sales and Management",
          example: {
            kind: "Tender",
            title: "TND-2026-0006",
            lines: [
              ["Buyer", "Dodoma District Hospital"],
              ["Checklist", "9 of 9 papers ready"],
              ["Our bid price", "TZS 41,300,000"],
              ["Winning price", "TZS 38,900,000"],
              ["Result", "Lost: we were 6.2% higher"],
            ],
            mark: 4,
            stamp: "Record as lost",
            tone: "bad",
          },
          scenarios: [
            {
              title: "The tender closes in two days and papers are missing",
              problem: "The bid closes on Thursday at 10:00. The tax clearance certificate and the bid security are still not ready.",
              fix: [
                "Tenders shows it under Closing within 2 days. Open it and look at the Checklist: 2 papers are not ticked.",
                "Call whoever is Responsible for each paper today. Ask the bank for the bid security letter in the morning.",
                "If a paper cannot be ready in time, decide early: open We will not bid, write the reason and press Not bidding, so nobody wastes more time on it.",
              ],
              tone: "warn",
            },
            {
              title: "The tender is not for products you sell",
              problem: "A tender from a regional council asks for building works together with cleaning supplies. You only supply goods.",
              fix: [
                "Open We will not bid, write: not our products, works included, and press Not bidding.",
                "The reason stays on record, so next year you know why you did not bid.",
              ],
              tone: "info",
            },
          ],
          tip: "Reports → Tenders lists every tender with Our price vs winner. After a year you know how close to the winning price you usually are.",
          scales: "medium+",
        },
      ],
    },
    // ------------------------------------------------------------------ 3
    {
      id: "ch-request",
      title: "The request",
      intro:
        "Asha emails a request for quotation. Record it as a client RFQ the same day: the items you type here flow into the supplier RFQ and the quotation, and you are reminded before the answer is due.",
      steps: [
        {
          id: "client-rfq",
          title: "Record the client RFQ",
          body:
            "A client RFQ is the client's question: what they want, how many, and by when they want your prices. Record every request, however it arrives: email, phone, WhatsApp, visit or tender.",
          do: [
            "Open Client RFQs and press + New RFQ.",
            "Choose the client, how the request was received (Received by), the client's reference and Quote due by.",
            "Press Save RFQ, then add each item: choose it from your products, or type it if it is not in the catalogue.",
            "Add notes such as the brand the client insists on.",
          ],
          where: ["Sales", "Client RFQs"],
          href: "/rfqs",
          who: "Sales",
          example: {
            kind: "Client RFQ",
            title: "RFQ-2026-0018",
            lines: [
              ["Client", "Kilimanjaro Hotels Ltd"],
              ["Received by", "Email"],
              ["Client's reference", "KH/RFQ/88"],
              ["Items requested", "3"],
              ["Due", "18 Oct 2026"],
            ],
            stamp: "Received",
            tone: "info",
          },
          scenarios: [
            {
              title: "The request came as a photo on WhatsApp",
              problem: "Asha sends a photo of a handwritten list. There is no email to file.",
              fix: [
                "Record it as a client RFQ anyway and choose WhatsApp under Received by.",
                "Type the items from the photo. Keep the photo in the client's documents if you have the Documents library.",
              ],
              tone: "info",
            },
            {
              title: "The client asks for something you have never sold",
              problem: "They also want 5 boxes of a special hotel-branded notepad.",
              fix: [
                "Type it as a line that is not in the catalogue; it is marked not in catalogue.",
                "If you will sell it again, ask whoever manages products to add it under Products so it has a SKU, a price and a cost.",
              ],
              tone: "info",
            },
            {
              title: "The client moves the deadline or cancels the request",
              problem: "Asha writes that the hotel's budget is delayed: they now need prices by the end of the month, and may drop the soap.",
              fix: [
                "Press Edit RFQ details, change Quote due by and press Save. The reminder moves to the new date.",
                "Press Remove on any item the client no longer wants.",
                "If the whole request is dropped, press Cancel this RFQ. It stays on record under Lost / cancelled.",
              ],
              tone: "warn",
            },
            {
              title: "The client wants two options",
              problem: "Kilimanjaro Hotels asks for one price with HP original toner and one with a compatible brand.",
              fix: [
                "Press Create quotation from these items for the first option and price it.",
                "Back on the RFQ, press Create another quotation for the second option, change the toner line and price it.",
                "Send both. When the client chooses, press Client accepted on one and Client rejected on the other, with the reason.",
              ],
              tone: "info",
            },
          ],
          tip: "An RFQ that passes its due date shows as Overdue on the list and on Sales, so a late answer is visible to everyone.",
          scales: "all",
        },
      ],
    },
    // ------------------------------------------------------------------ 4
    {
      id: "ch-supplier-prices",
      title: "Supplier prices",
      intro:
        "Before you quote, find out what the goods will cost you. Ask two or three suppliers, enter their replies and let LeMoSp mark the cheapest for each item.",
      steps: [
        {
          id: "srfq-create",
          title: "Ask suppliers for prices",
          body:
            "A supplier RFQ sends the same list of items to several suppliers. It is created from the client RFQ, so the items are already filled in.",
          do: [
            "On the client RFQ press Request supplier quotes.",
            "Set Reply by and Delivery to, and add any notes for suppliers.",
            "Choose each supplier you want prices from and press Add supplier.",
            "Press Open RFQ PDF and share it with each supplier by WhatsApp or email.",
          ],
          where: ["Purchasing", "Supplier RFQs"],
          href: "/supplier-rfqs",
          who: "Procurement",
          example: {
            kind: "Supplier RFQ",
            title: "SRFQ-2026-0012",
            lines: [
              ["For", "RFQ-2026-0018"],
              ["Dar Office Supplies", "Asked"],
              ["Mwanza Stationers", "Asked"],
              ["Coastal Cleaning Supplies", "Asked"],
              ["Reply by", "16 Oct 2026"],
            ],
            stamp: "Sent",
            tone: "info",
          },
          scales: "medium+",
        },
        {
          id: "srfq-prices",
          title: "Enter each supplier's reply",
          body:
            "Type the prices exactly as the supplier quoted them, in their currency, with freight, lead time, payment terms and how long the offer is valid.",
          do: [
            "Open the supplier RFQ and press Enter prices next to the supplier.",
            "Type each unit price. Leave an item empty if they cannot supply it.",
            "Add freight, lead time (days), payment terms, Incoterms, Offer valid until and their quote reference.",
            "Press Save prices. To correct a reply later, press Edit prices.",
          ],
          where: ["Purchasing", "Supplier RFQs"],
          href: "/supplier-rfqs",
          who: "Procurement",
          example: {
            kind: "Their offer",
            title: "Dar Office Supplies",
            lines: [
              ["A4 paper", "TZS 11,500 per box"],
              ["Toner HP 85A", "TZS 150,000 each"],
              ["Liquid soap", "Not quoted"],
              ["Lead time", "3 days"],
            ],
            mark: 2,
            stamp: "Prices saved",
            tone: "ok",
          },
          scenarios: [
            {
              title: "A supplier says no",
              problem: "Mwanza Stationers replies that they have no toner this month and will not quote.",
              fix: [
                "Mark them as Declined on the supplier RFQ.",
                "If they change their mind, press Undo declined and enter their prices.",
              ],
              tone: "info",
            },
            {
              title: "A supplier quotes in US dollars",
              problem: "An importer quotes the toner in USD.",
              fix: [
                "Enter their prices in USD, as quoted. The comparison converts them to TZS at the exchange rate.",
                "Make sure finance has entered today's USD rate under Exchange rates first.",
              ],
              tone: "info",
            },
          ],
          scales: "medium+",
        },
        {
          id: "srfq-compare",
          title: "Compare prices",
          body:
            "The comparison puts every supplier side by side, converted to TZS. The cheapest price for each item is green, and the totals include freight.",
          do: [
            "Open the supplier RFQ and scroll to Compare prices.",
            "Check price, lead time, payment terms and validity, not only the total.",
            "Use the best costs when you set your selling prices.",
            "Wait for the client to accept before you press Award & create PO.",
          ],
          where: ["Purchasing", "Supplier RFQs"],
          href: "/supplier-rfqs",
          who: "Procurement and Management",
          example: {
            kind: "Compare prices",
            title: "SRFQ-2026-0012",
            lines: [
              ["Dar Office Supplies", "TZS 2,075,000 (2 of 3 items)"],
              ["Mwanza Stationers", "Declined"],
              ["Coastal Cleaning Supplies", "TZS 432,000 (1 of 3 items)"],
              ["Best for paper and toner", "Dar Office Supplies"],
            ],
            mark: 0,
            stamp: "Best price",
            tone: "ok",
          },
          scenarios: [
            {
              title: "No supplier priced every item",
              problem: "Dar Office Supplies priced paper and toner, Coastal Cleaning priced only soap.",
              fix: [
                "A supplier that did not price every item shows how many it priced, for example 2 of 3 items.",
                "Later you will make one purchase order per supplier: paper and toner from one, soap from the other.",
              ],
              tone: "info",
            },
          ],
          tip: "Award & create PO makes the purchase order for you, with that supplier's prices. Do it once the client has accepted, so you do not buy goods nobody ordered.",
          scales: "medium+",
        },
      ],
    },
    // ------------------------------------------------------------------ 5
    {
      id: "ch-quote",
      title: "The quotation",
      intro:
        "The quotation is where you win or lose the order. Set the right prices, let the app check the margin, send a clean PDF and follow up until the client answers.",
      steps: [
        {
          id: "quote-create",
          title: "Create the quotation from the RFQ",
          body:
            "One press turns the client RFQ into a draft quotation with the same client and items. You only add prices and terms.",
          do: [
            "On the client RFQ press Create quotation from these items.",
            "For each line, enter the unit price and, if you give one, the discount in Disc. %, then press Update.",
            "Under Details, set the contact, Valid until, Delivery time, Payment terms, Incoterms and Notes to the client, then press Save details.",
            "Press Preview PDF to see exactly what the client will get.",
          ],
          where: ["Sales", "Quotations"],
          href: "/quotations",
          who: "Sales",
          example: {
            kind: "Quotation",
            title: "QT-2026-0042",
            lines: [
              ["A4 paper × 50", "TZS 700,000"],
              ["Toner HP 85A × 10", "TZS 1,850,000"],
              ["Liquid soap × 12", "TZS 540,000"],
              ["VAT 18%", "TZS 556,200"],
              ["Total", "TZS 3,646,200"],
            ],
            mark: 4,
            stamp: "Draft",
            tone: "info",
          },
          tip: "No RFQ? Press + New quotation on Quotations and add the items from the catalogue.",
          scales: "all",
        },
        {
          id: "quote-margin",
          title: "Check the margin",
          body:
            "Management, procurement and finance see the cost and estimated margin of the quotation. Salespeople do not. The cost comes from the product's last cost, which is updated by confirmed purchase orders and landed costs.",
          do: [
            "Scroll to Margin on the draft quotation.",
            "Estimated margin turns orange when it is below the company's minimum margin.",
            "Lines without a cost are counted, because the margin cannot be trusted while costs are missing.",
          ],
          where: ["Sales", "Quotations", "open a quotation"],
          href: "/quotations",
          who: "Management, Procurement and Finance",
          example: {
            kind: "Margin",
            title: "QT-2026-0042",
            lines: [
              ["Sales before VAT", "TZS 3,090,000"],
              ["Cost of goods", "TZS 2,507,000"],
              ["Estimated margin", "18.9%"],
              ["Minimum margin", "12%"],
            ],
            mark: 2,
            stamp: "Healthy",
            tone: "ok",
          },
          scales: "all",
        },
        {
          id: "quote-submit",
          title: "Submit, and let the rules decide",
          body:
            "When you submit, the app checks three things: is the margin below the minimum, are there lines without a known cost, and is the value above the approval limit. If none applies, the quotation is approved at once. Otherwise management is asked.",
          do: [
            "Press Submit quotation.",
            "If it is within the rules, it becomes Approved and you can send it straight away.",
            "If not, it shows Waiting for management approval, with the reason. Management gets an alert.",
          ],
          where: ["Sales", "Quotations", "open a quotation"],
          href: "/quotations",
          who: "Sales",
          example: {
            kind: "Quotation",
            title: "QT-2026-0042",
            lines: [
              ["Margin", "18.9%, above 12%"],
              ["Lines without a cost", "0"],
              ["Value", "Below the approval limit"],
              ["Result", "Approved straight away"],
            ],
            mark: 3,
            stamp: "Approved",
            tone: "ok",
          },
          scenarios: [
            {
              title: "The discount needs management approval",
              problem: "To win the order, the salesperson gives 10% off every line. The margin falls to 9.9%, below the 12% minimum.",
              fix: [
                "Press Submit quotation as usual. It goes to Waiting for management approval because: margin below 12%.",
                "The manager opens the quotation, reads the margin and decides under Your decision.",
                "Approve, with a note such as OK for this client; or Send back for changes with a note such as reduce discount to 5%.",
                "If it is sent back, the note shows in red on the draft. Change the discount, press Update and submit again.",
              ],
              tone: "warn",
            },
            {
              title: "A line has no known cost",
              problem: "The hotel-branded notepad has never been bought, so the app does not know its cost.",
              fix: [
                "The quotation goes for approval because a line has no known cost.",
                "Procurement checks the supplier price and gives it to the manager before approval.",
                "Once you buy it and the supplier confirms the purchase order, the product gets its cost for next time.",
              ],
              tone: "warn",
            },
          ],
          tip: "Nobody approves their own quotation. A manager's own quotation is approved when submitted, and the reason is still recorded.",
          scales: "all",
        },
        {
          id: "quote-send",
          title: "Send the PDF and record that it went",
          body:
            "The PDF carries your logo, the client's details, VAT, validity, delivery time, payment terms and your standard terms and conditions.",
          do: [
            "Press Share PDF to send it by WhatsApp or email from your phone, or Open PDF to download it.",
            "Press I have sent it to the client. The quotation becomes Sent, and the follow-up clock starts.",
          ],
          where: ["Sales", "Quotations", "open a quotation"],
          href: "/quotations",
          who: "Sales",
          example: {
            kind: "Quotation PDF",
            title: "QT-2026-0042",
            lines: [
              ["To", "Asha Mushi, Kilimanjaro Hotels Ltd"],
              ["Valid until", "14 Nov 2026"],
              ["Delivery time", "5 days after LPO"],
              ["Payment terms", "30 days"],
            ],
            stamp: "Sent",
            tone: "info",
          },
          scales: "all",
        },
        {
          id: "quote-follow",
          title: "Follow up until the client answers",
          body:
            "Many orders are lost simply because nobody called back. After the number of days your managers set, the bell reminds you, and the quotation has a ready-made message.",
          do: [
            "Open the quotation. The Follow up card has a ready message in English or Kiswahili.",
            "Choose WhatsApp, SMS or Email, and the contact, then send.",
            "Press + Log a follow-up: write what was said and when to follow up again.",
          ],
          where: ["Sales", "Quotations", "open a quotation"],
          href: "/quotations",
          who: "Sales",
          example: {
            kind: "Follow-up",
            title: "QT-2026-0042",
            lines: [
              ["How", "WhatsApp"],
              ["What was said", "Asha is waiting for the finance manager"],
              ["Next follow-up", "21 Oct 2026"],
            ],
            stamp: "Logged",
            tone: "info",
          },
          scales: "all",
        },
        {
          id: "quote-revise",
          title: "Changes after sending: make a revision",
          body:
            "A sent quotation is never changed silently. Make a revision instead: the app copies it as a new draft with the same number and -R1, and the old one is kept under Versions.",
          do: [
            "Open the sent quotation and press Make a revision.",
            "Change the quantities, prices or terms on the new draft.",
            "Submit it, send the new PDF and press I have sent it to the client.",
          ],
          where: ["Sales", "Quotations", "open a quotation"],
          href: "/quotations",
          who: "Sales",
          example: {
            kind: "Versions",
            title: "QT-2026-0042-R1",
            lines: [
              ["QT-2026-0042", "Replaced"],
              ["QT-2026-0042-R1", "This one"],
              ["A4 paper", "50 → 60 boxes"],
              ["New total", "TZS 3,811,400"],
            ],
            mark: 2,
            stamp: "Revised",
            tone: "info",
          },
          scenarios: [
            {
              title: "The client asks for a lower price after the quotation",
              problem: "Asha says another supplier offers toner at TZS 175,000 instead of your TZS 185,000.",
              fix: [
                "Check the margin first: management sees what a lower price would leave you.",
                "If you agree, press Make a revision and lower the toner price, or give a discount on that line.",
                "Submit it. If the margin falls below the minimum, management approves it first.",
                "Send the new PDF and log the follow-up with what was agreed.",
              ],
              tone: "warn",
            },
            {
              title: "The client changes quantities",
              problem: "The hotel now wants 60 boxes of paper instead of 50, and no soap.",
              fix: [
                "Press Make a revision.",
                "Change the paper quantity to 60 and press Update, then press Remove on the soap line.",
                "Submit and send the new version. The old version is kept for the record.",
              ],
              tone: "info",
            },
            {
              title: "The quotation expired before the client answered",
              problem: "Valid until has passed. The quotation shows expired, and the supplier's prices may have changed.",
              fix: [
                "Check your costs again with the supplier.",
                "Press Make a revision, set a new Valid until date and adjust prices if needed.",
                "Submit and send the new version.",
              ],
              tone: "warn",
            },
            {
              title: "The client says no",
              problem: "Asha writes that the hotel chose another supplier because of delivery time.",
              fix: [
                "Under Client, write the reason in Client's answer, for example Delivery time too long.",
                "Press Client rejected. If it was linked to an opportunity, the opportunity is marked lost by itself.",
                "Business insights later shows your win rate by client and by salesperson.",
              ],
              tone: "bad",
            },
          ],
          tip: "Once a client has accepted a quotation it can no longer be revised. Agree the final version before you press Client accepted.",
          scales: "all",
        },
      ],
    },
    // ------------------------------------------------------------------ 6
    {
      id: "ch-terms",
      title: "Agreeing the terms",
      intro:
        "The client says yes and sends a purchase order, also called an LPO. Record it on the quotation: from that moment the order is won and buying, delivery and invoicing can start.",
      steps: [
        {
          id: "accept",
          title: "Record the client's acceptance and LPO",
          body:
            "The client's LPO number is your proof of the order. Recording it on the quotation means it can be copied onto the invoice later.",
          do: [
            "Open the quotation. Under Client, type the LPO number in Client's answer.",
            "Press Client accepted. The quotation becomes Won.",
            "New cards appear: Purchasing for this order, Deliveries to the client, Invoices and Order costs.",
          ],
          where: ["Sales", "Quotations", "open a quotation"],
          href: "/quotations",
          who: "Sales",
          example: {
            kind: "Agreed terms",
            title: "QT-2026-0042",
            lines: [
              ["Client's LPO", "KH/LPO/311"],
              ["Payment", "30 days after delivery"],
              ["Delivery", "Within 5 days"],
              ["Opportunity", "Won by itself"],
            ],
            stamp: "Accepted",
            tone: "ok",
          },
          scenarios: [
            {
              title: "The client wants to pay a deposit before delivery",
              problem: "Zanzibar Resorts accepts but will only pay 50% now and 50% after delivery.",
              fix: [
                "On the accepted quotation, under Invoices, press Create invoice.",
                "On the draft invoice, change the quantities or prices so it covers the 50% deposit, add a note, and issue it.",
                "After delivery, press Invoice the rest on the quotation for the balance.",
              ],
              tone: "info",
            },
          ],
          scales: "all",
        },
        {
          id: "contract",
          title: "Regular client? Keep the prices in a contract",
          body:
            "If the hotel will buy every quarter at the same prices, record a contract. Next time, one press puts the agreed prices on the quotation, and you are reminded before the contract ends.",
          do: [
            "Open Contracts and press + Contract.",
            "Choose the client, the contract name, start and end dates and payment terms.",
            "Add each product with its agreed price and press Save price.",
            "On a new draft quotation for the client, press Use contract prices.",
          ],
          where: ["Sales", "Contracts"],
          href: "/contracts",
          who: "Sales and Management",
          example: {
            kind: "Contract",
            title: "CTR-2026-0003",
            lines: [
              ["Client", "Kilimanjaro Hotels Ltd"],
              ["A4 paper", "TZS 13,500 per box"],
              ["Toner HP 85A", "TZS 180,000"],
              ["Ends", "31 Oct 2027"],
            ],
            stamp: "Current",
            tone: "ok",
          },
          scenarios: [
            {
              title: "Your supplier's price rises during the contract",
              problem: "The contract price is fixed, but Dar Office Supplies raises the toner price.",
              fix: [
                "Quotations still use the contract price, and Margin shows the smaller margin.",
                "Talk to the client about the renewal. If you agree a new price early, press End contract with the reason and add a new contract with the new prices.",
              ],
              tone: "warn",
            },
          ],
          scales: "medium+",
        },
      ],
    },
    // ------------------------------------------------------------------ 7
    {
      id: "ch-buy",
      title: "Buying the goods",
      intro:
        "Now you order from your suppliers. The purchase order is created from the accepted quotation, checked against your approval rules, sent to the supplier and confirmed.",
      steps: [
        {
          id: "po-create",
          title: "Create the purchase order",
          body:
            "There are three ways: from the supplier RFQ with Award & create PO, from the accepted quotation with Create purchase order, or from scratch with + New PO. Each way links the PO to the client's order.",
          do: [
            "Open the supplier RFQ and press Award & create PO under Dar Office Supplies. The PO gets their prices.",
            "Do the same for Coastal Cleaning Supplies, for the soap.",
            "Or, on the accepted quotation under Purchasing for this order, press Create purchase order and choose the supplier.",
            "Check the items, prices, Deliver to (our store) and the delivery date.",
          ],
          where: ["Purchasing", "Purchase orders"],
          href: "/purchase-orders",
          who: "Procurement",
          example: {
            kind: "Purchase order",
            title: "PO-2026-0031",
            lines: [
              ["Supplier", "Dar Office Supplies"],
              ["For client quotation", "QT-2026-0042"],
              ["A4 paper × 50", "TZS 575,000"],
              ["Toner HP 85A × 10", "TZS 1,500,000"],
              ["Total with VAT", "TZS 2,448,500"],
            ],
            mark: 4,
            stamp: "Draft",
            tone: "info",
          },
          tip: "Purchasing shows Won orders to buy for: accepted quotations that have no supplier RFQ or purchase order yet.",
          scales: "all",
        },
        {
          id: "po-approve",
          title: "Submit, and approvals when the amount is large",
          body:
            "When you submit, a purchase order above the company limit waits for management approval. Larger companies can set approval steps, for example finance first, then management.",
          do: [
            "Press Submit purchase order.",
            "Below the limit, it is approved at once. Above it, the approver gets an alert.",
            "The approver opens it and presses Approve, or Send back for changes with a note.",
          ],
          where: ["Purchasing", "Purchase orders", "open a PO"],
          href: "/purchase-orders",
          who: "Procurement, then Management",
          example: {
            kind: "Purchase order",
            title: "PO-2026-0031",
            lines: [
              ["Total with VAT", "TZS 2,448,500"],
              ["Approval limit", "TZS 2,500,000"],
              ["Result", "Approved straight away"],
            ],
            stamp: "Approved",
            tone: "ok",
          },
          scenarios: [
            {
              title: "A large order must pass finance and management",
              problem: "A PO for TZS 18,000,000 must be checked by finance for budget, then by the managing director.",
              fix: [
                "Management opens Approval steps and adds two rows: Budget check by finance from TZS 5,000,000, and Final approval by management from TZS 10,000,000. Press Save steps.",
                "When the PO is submitted, finance gets the alert first. When finance approves, management is told.",
                "Each approver finds the order under Waiting for you, at the top of Approval steps.",
              ],
              tone: "info",
            },
            {
              title: "The approver sends the PO back",
              problem: "Management sends the PO back with the note: ask for a better price on toner.",
              fix: [
                "The note shows in red at the top of the draft PO.",
                "Change the price after talking to the supplier and submit again.",
              ],
              tone: "warn",
            },
          ],
          tip: "Nobody approves their own order, and one person cannot approve two steps of the same order.",
          scales: "all",
        },
        {
          id: "po-send",
          title: "Send it and record the supplier's confirmation",
          body:
            "The supplier's confirmation is what makes the order firm. Confirming it also updates each product's last cost from this PO, so your next quotations use the real cost.",
          do: [
            "Press Open PDF and share it with the supplier, then press I have sent it to the supplier.",
            "When they confirm, enter Their order / confirmation no. and the Confirmed delivery date.",
            "Press Supplier confirmed.",
          ],
          where: ["Purchasing", "Purchase orders", "open a PO"],
          href: "/purchase-orders",
          who: "Procurement",
          example: {
            kind: "Purchase order",
            title: "PO-2026-0031",
            lines: [
              ["Their order / confirmation no.", "DOS-SO-7781"],
              ["Confirmed delivery date", "20 Oct 2026"],
              ["Product costs", "Updated"],
            ],
            stamp: "Confirmed",
            tone: "ok",
          },
          scenarios: [
            {
              title: "The supplier's price went up after you quoted",
              problem: "Dar Office Supplies now wants TZS 160,000 per toner instead of TZS 150,000. The client already accepted at your old price.",
              fix: [
                "An accepted quotation cannot be revised, so first try to keep the old price with the supplier, or ask other suppliers.",
                "If you must pay more, enter the new price on the draft PO line and press Update before you submit. Management sees the higher cost.",
                "The order's profit shows the smaller margin. If the client agrees to pay more, make a new quotation for the difference.",
                "Next time, set a shorter Valid until on quotations for goods whose price moves often.",
              ],
              tone: "warn",
            },
            {
              title: "The supplier cannot deliver on the date",
              problem: "The confirmed date passes and nothing has arrived.",
              fix: [
                "Purchasing shows Deliveries late, and the PO shows late, was due.",
                "Call the supplier and enter the new Confirmed delivery date.",
                "Tell the client early: log a follow-up on the quotation so the team knows.",
                "Business insights shows which suppliers deliver late over the year.",
              ],
              tone: "warn",
            },
          ],
          scales: "all",
        },
        {
          id: "requisition",
          title: "Purchase requests: when the store needs stock",
          body:
            "Not every purchase starts with a client order. When the store runs low on soap that many clients buy, anyone except drivers can ask for it. Management approves and procurement orders.",
          do: [
            "Open Purchase requests and press + Request. Say what it is for and when it is needed, then add the items.",
            "Press Send for approval. Management approves or rejects it with a note.",
            "Procurement opens the approved request, chooses the supplier and presses Create draft PO.",
          ],
          where: ["Purchasing", "Purchase requests"],
          href: "/requisitions",
          who: "Anyone, then Management and Procurement",
          example: {
            kind: "Purchase request",
            title: "REQ-2026-0009",
            lines: [
              ["What is it for?", "Soap stock for hotel clients"],
              ["Liquid soap, 20 litres", "40 jerrycans"],
              ["Needed by", "1 Nov 2026"],
            ],
            stamp: "Approved",
            tone: "ok",
          },
          tip: "What to reorder lists products at or below their reorder level, grouped by the last supplier, with Create draft PO and Make a purchase request buttons.",
          scales: "medium+",
        },
        {
          id: "landed-cost",
          title: "Imported goods: add import costs for the real cost",
          body:
            "For goods you import, the supplier's price is only part of the cost. Add freight, insurance, duty, clearing and port charges to the purchase order, and the app shares them over the items by value.",
          do: [
            "Open the purchase order and go to Import costs & landed cost.",
            "Press + Add a cost. Choose the type, enter the description, amount, currency and date, then press Add cost.",
            "The table shows the landed cost per unit for each item.",
            "Once the supplier has confirmed, press Use landed cost as product cost. Quotation margins and profit then use the real cost.",
          ],
          where: ["Purchasing", "Purchase orders", "open a PO"],
          href: "/purchase-orders",
          who: "Procurement and Finance",
          example: {
            kind: "Import costs & landed cost",
            title: "PO-2026-0035",
            lines: [
              ["Goods, USD 8,000 at 2,600", "TZS 20,800,000"],
              ["Freight", "TZS 2,340,000"],
              ["Import duty", "TZS 2,500,000"],
              ["Clearing & forwarding", "TZS 900,000"],
              ["Total landed", "TZS 26,540,000"],
            ],
            mark: 4,
            stamp: "Applied",
            tone: "ok",
          },
          tip: "If another clearing bill arrives later, add it and press Re-apply landed cost.",
          scales: "medium+",
        },
      ],
    },
    // ------------------------------------------------------------------ 8
    {
      id: "ch-receive",
      title: "Receiving the goods",
      intro:
        "When the supplier's truck arrives, the storekeeper counts the goods against the purchase order and records what really came. Stock goes up, in the right store, and the order knows what is still to come.",
      steps: [
        {
          id: "grn",
          title: "Record the goods received (GRN)",
          body:
            "The goods received note is the store's proof of what arrived. It also tells finance what to pay: you pay only for what arrived.",
          do: [
            "Open Receive goods. It lists purchase orders waiting for delivery. Choose PO-2026-0031.",
            "Choose the store (Into store) and enter the Supplier's delivery note no.",
            "For each item, enter the Quantity received now. Leave 0 for items that did not come.",
            "Press Record goods received. Stock goes up and a GRN is created.",
          ],
          where: ["Purchasing", "Receive goods"],
          href: "/receiving",
          who: "Warehouse",
          example: {
            kind: "Goods received",
            title: "GRN-2026-0027",
            lines: [
              ["A4 paper", "50 of 50"],
              ["Toner HP 85A", "10 of 10"],
              ["Into store", "Main store, Dar es Salaam"],
              ["Supplier's delivery note no.", "DOS-DN-4412"],
              ["Checked by", "Neema, Warehouse"],
            ],
            stamp: "In stock",
            tone: "ok",
          },
          scenarios: [
            {
              title: "The supplier can deliver only part",
              problem: "Dar Office Supplies brings all 50 boxes of paper but only 6 of the 10 toners. The rest comes next week.",
              fix: [
                "Record what arrived: 50 paper and 6 toner. The PO becomes partly received and shows 4 toner to come.",
                "When the rest arrives, open Receive goods again, choose the same PO and record the 4 toners. Each delivery gets its own GRN.",
                "Meanwhile you can deliver the paper and the 6 toners to the client and send the rest later.",
              ],
              tone: "warn",
            },
            {
              title: "Goods arrive damaged",
              problem: "Two cartons of paper are wet and two toners have broken seals.",
              fix: [
                "On the item, set Condition to Damaged / rejected and write a note, for example 2 cartons wet.",
                "Damaged items are recorded on the GRN but not added to stock, so you cannot deliver them by mistake.",
                "Tell the supplier the same day. Agree whether they replace the goods or bill you only for the good ones.",
                "If they replace them, make a new purchase order for the replacement items with a note that they replace the damaged ones, so they can be received into stock.",
              ],
              tone: "bad",
            },
            {
              title: "The delivery is short",
              problem: "The supplier's delivery note says 50 boxes, but the storekeeper counts 48.",
              fix: [
                "Enter what you counted: 48. Never enter what the paper says.",
                "Write the difference in the note. The PO shows 2 still to come.",
                "When the supplier's invoice arrives, the order, receipt and bill check shows if they billed for 50.",
              ],
              tone: "warn",
            },
          ],
          tip: "A purchase order can no longer be cancelled once goods have been received against it.",
          scales: "all",
        },
        {
          id: "batches",
          title: "Batches and expiry dates",
          body:
            "For goods that expire, such as soap, chemicals or medical supplies, record the batch and expiry date when you receive. Deliveries then take the oldest expiry first, and Stock warns you before goods expire.",
          do: [
            "On the receiving screen, enter the Batch / lot no. and Expiry date for each item that has them.",
            "Open Stock to see Expiring soon at the top.",
          ],
          where: ["Purchasing", "Receive goods"],
          href: "/receiving",
          who: "Warehouse",
          example: {
            kind: "Goods received",
            title: "GRN-2026-0028",
            lines: [
              ["Liquid soap, 20 litres", "12 of 12"],
              ["Batch / lot no.", "CCS-2610-B"],
              ["Expiry date", "30 Sep 2028"],
            ],
            stamp: "In stock",
            tone: "ok",
          },
          scales: "medium+",
        },
      ],
    },
    // ------------------------------------------------------------------ 9
    {
      id: "ch-deliver",
      title: "Delivering to the client",
      intro:
        "The delivery note takes the goods out of stock and puts the job on the driver's phone. The driver brings back proof: the receiver's name, signature, a photo and the location.",
      steps: [
        {
          id: "dn-create",
          title: "Create the delivery note",
          body:
            "Created from the accepted quotation, the delivery note already has what is still to deliver. You choose the store, site, driver and vehicle.",
          do: [
            "On the accepted quotation, under Deliveries to the client, press Create delivery note.",
            "Choose From store, the Delivery site / address, Contact at site and Contact phone.",
            "Choose the Driver and Vehicle and the Planned date. Check the quantities and press Update on any line you change.",
            "Press Print delivery note if the driver needs a paper copy to be stamped.",
          ],
          where: ["Deliveries"],
          href: "/deliveries",
          who: "Sales or Warehouse",
          example: {
            kind: "Delivery note",
            title: "DN-2026-0040",
            lines: [
              ["Client", "Kilimanjaro Hotels Ltd"],
              ["Delivery site / address", "Main hotel, Arusha"],
              ["From store", "Main store"],
              ["Driver", "Juma, T 123 ABC"],
              ["Items", "Paper 50, toner 10, soap 12"],
            ],
            stamp: "Draft",
            tone: "info",
          },
          scenarios: [
            {
              title: "Goods leave that belong to no quotation",
              problem: "Zanzibar Resorts asks for two free sample jerrycans of soap before they order.",
              fix: [
                "Open Deliveries and press + Delivery note. Choose the client and add the items with + Add an item.",
                "Write in Notes for the driver and client that these are free samples, then dispatch as usual, so the stock goes out properly.",
                "It then waits on Invoices under Delivered, not yet invoiced. Tell finance it was free samples, so nobody bills the client by mistake.",
              ],
              tone: "info",
            },
            {
              title: "The delivery note was made by mistake",
              problem: "Two delivery notes were created for the same order, and only one will go.",
              fix: [
                "Open the extra one while it is still being prepared and press Cancel delivery note.",
                "A dispatched delivery note cannot be cancelled: if the goods did not leave, the driver or the office records it as a failed delivery so the goods go back into stock.",
              ],
              tone: "warn",
            },
          ],
          scales: "all",
        },
        {
          id: "dn-dispatch",
          title: "Dispatch",
          body:
            "Dispatching takes the goods out of the store, oldest expiry first, and sends the delivery to the driver's phone. Only management and warehouse can dispatch.",
          do: ["Press Dispatch now.", "The delivery note shows On the way. The driver sees it with the address and the contact."],
          where: ["Deliveries"],
          href: "/deliveries",
          who: "Warehouse or Management",
          example: {
            kind: "Delivery note",
            title: "DN-2026-0040",
            lines: [
              ["Stock out of", "Main store"],
              ["Driver", "Juma"],
              ["Status", "On the way"],
            ],
            stamp: "Dispatched",
            tone: "info",
          },
          scenarios: [
            {
              title: "This store does not have enough",
              problem: "Dispatch stops with Not enough stock in this store: the toners are in the Arusha store, not in Dar.",
              fix: [
                "Open Stock transfers and press + Transfer from the Arusha store to the main store, or the other way round.",
                "Add the items and press Send now. When they arrive, press Mark as received.",
                "Or simply change From store on the delivery note to the store that has the goods.",
              ],
              tone: "warn",
            },
            {
              title: "Only part of the order is ready",
              problem: "The toners have not arrived from the supplier yet, but the hotel needs the paper now.",
              fix: [
                "On the delivery note, set the toner quantity to what you have, press Update, and dispatch.",
                "Still to deliver lists the toners the client is waiting for, with the stock you have now.",
                "When they arrive, press Make a delivery note for the rest.",
              ],
              tone: "info",
            },
          ],
          scales: "all",
        },
        {
          id: "pod",
          title: "Proof of delivery on the driver's phone",
          body:
            "At the hotel, the driver records who received the goods, their signature on the screen and a photo. It works without signal: the proof is saved on the phone and sent when the signal comes back.",
          do: [
            "Before leaving, the driver opens Deliveries while there is signal, so the list is saved on the phone.",
            "At the site, press Record delivery: type the receiver's name, let them sign and take a photo.",
            "Press Confirm delivery. The delivery note becomes Delivered and ready to invoice.",
            "In the office, the delivery note now shows the proof, and Signed delivery note gives the PDF with the receiver's name and signature, to send with the invoice.",
          ],
          where: ["Deliveries"],
          href: "/driver",
          who: "Driver",
          example: {
            kind: "Proof of delivery",
            title: "DN-2026-0040",
            lines: [
              ["Received by", "Asha Mushi"],
              ["Signature", "Signed on the phone"],
              ["Photo", "1 photo"],
              ["Where", "Arusha, on the map"],
            ],
            stamp: "Delivered",
            tone: "ok",
          },
          scenarios: [
            {
              title: "The site is closed",
              problem: "Juma arrives at the lodge on a public holiday and nobody can receive the goods.",
              fix: [
                "The driver presses Record failed delivery and writes why, for example site closed.",
                "The goods go back into stock, and the office sees the reason on the delivery note.",
                "Agree a new date with the client and make a new delivery note.",
              ],
              tone: "bad",
            },
            {
              title: "The client accepts only part of the delivery",
              problem: "Asha refuses 2 of the 12 jerrycans of soap because they leak. The driver brings them back.",
              fix: [
                "The driver records the delivery and writes in the remarks: 2 jerrycans refused, leaking.",
                "When you create the invoice from this delivery note, change the soap quantity to 10 on the draft invoice and press Update, so the client pays only for what they kept.",
                "Back at the store, the warehouse uses Adjust stock with the reason so the returned soap is counted correctly.",
                "To replace them, make a new delivery note from the quotation and change it to the 2 jerrycans.",
              ],
              tone: "warn",
            },
            {
              title: "The driver forgot to record the delivery",
              problem: "The client has the goods, but the delivery note still shows On the way.",
              fix: [
                "Management or the warehouse opens the delivery note in the office and presses Record proof of delivery, with the receiver's name and a photo of the signed paper copy.",
              ],
              tone: "warn",
            },
          ],
          scales: "medium+",
        },
      ],
    },
    // ------------------------------------------------------------------ 10
    {
      id: "ch-invoice",
      title: "Invoicing",
      intro:
        "Invoice what you delivered, the same day. The invoice is built from the delivery note, carries the client's LPO number and prints your bank and mobile-money numbers, so the client has no excuse to pay late.",
      steps: [
        {
          id: "inv-create",
          title: "Create the invoice from the delivery",
          body:
            "Every delivered delivery note that is not yet invoiced appears on Invoices, so no delivery is forgotten.",
          do: [
            "Open the delivered delivery note and press Create invoice. Or, on Invoices, press Invoice it next to it.",
            "Check the items, prices, VAT, Payment terms and the Client's order / PO no.",
            "Leave the invoice date blank to use the day it is issued.",
          ],
          where: ["Finance", "Invoices"],
          href: "/invoices",
          who: "Finance",
          example: {
            kind: "Invoice",
            title: "Draft invoice",
            lines: [
              ["From delivery note", "DN-2026-0040"],
              ["Client's order / PO no.", "KH/LPO/311"],
              ["Subtotal", "TZS 3,090,000"],
              ["VAT 18%", "TZS 556,200"],
              ["Total", "TZS 3,646,200"],
            ],
            mark: 4,
            stamp: "Draft",
            tone: "info",
          },
          scales: "all",
        },
        {
          id: "inv-issue",
          title: "Issue it, and the credit limit rule",
          body:
            "Issuing gives the invoice its number and due date and locks it. If the invoice would take the client above their credit limit, only management can issue it.",
          do: [
            "Press Issue invoice. The due date is set from the company's payment days.",
            "Press Open PDF and share it. Your bank details and mobile-money pay numbers are printed on it.",
          ],
          where: ["Finance", "Invoices", "open an invoice"],
          href: "/invoices",
          who: "Finance or Management",
          example: {
            kind: "Invoice",
            title: "INV-2026-0055",
            lines: [
              ["Total", "TZS 3,646,200"],
              ["Due", "14 Nov 2026"],
              ["Pay by", "Bank or M-Pesa Lipa Namba"],
              ["Client's LPO", "KH/LPO/311"],
            ],
            stamp: "Issued",
            tone: "info",
          },
          scenarios: [
            {
              title: "The client is over the credit limit",
              problem: "The hotel already owes TZS 8,000,000 and the limit is TZS 10,000,000. This invoice adds TZS 3,646,200.",
              fix: [
                "When finance presses Issue invoice, the app stops with Credit limit exceeded and says a manager must issue it.",
                "Management checks Money owed to us: is the hotel paying on time?",
                "If yes, management issues it. The invoice records that it was issued above the client's credit limit and who approved it.",
                "If not, call the client to pay the old invoices first, or raise the credit limit on the client's page if the business has grown.",
              ],
              tone: "warn",
            },
            {
              title: "You made a mistake on an issued invoice",
              problem: "The invoice went out with the wrong price on the toner.",
              fix: [
                "An issued invoice is locked. Management presses Cancel invoice and gives the reason.",
                "If a payment was already recorded on it, void the payment first.",
                "Create a new invoice with the right price and issue it. The cancelled one stays on record.",
              ],
              tone: "bad",
            },
          ],
          tip: "The app has no credit notes. To correct an issued invoice, cancel it with a reason and issue a correct one.",
          scales: "all",
        },
        {
          id: "inv-other",
          title: "Advance, whole-order and blank invoices",
          body:
            "Usually you invoice each delivery from its delivery note. Some orders need something else: an advance before you buy, one invoice for the whole order, or a charge that is not on any quotation.",
          do: [
            "For an advance or a whole-order invoice, open the accepted quotation and, under Invoices, press Create invoice. Adjust the lines on the draft, then press Issue invoice.",
            "Later, press Invoice the rest on the same quotation for what has not been invoiced yet.",
            "For a charge that belongs to no quotation, open Invoices, press + Invoice and then Create blank invoice. Choose the client and add the items with + Add an item.",
            "Once it is issued, management and finance see Profit on this invoice: sales before VAT, cost of goods and gross profit, with a link to the whole order's profit.",
          ],
          where: ["Finance", "Invoices"],
          href: "/invoices",
          who: "Finance or Management",
          example: {
            kind: "Invoice",
            title: "INV-2026-0061",
            lines: [
              ["Client", "Zanzibar Resorts"],
              ["For", "50% advance on QT-2026-0051"],
              ["Total", "TZS 2,950,000"],
              ["Then", "Invoice the rest after delivery"],
            ],
            mark: 1,
            stamp: "Issued",
            tone: "info",
          },
          scenarios: [
            {
              title: "The client asks for one invoice for three deliveries",
              problem: "Arusha Medical Stores received its order in three deliveries but wants one invoice at the end of the month.",
              fix: [
                "Do not invoice the delivery notes one by one.",
                "When the last delivery is made, open the accepted quotation and press Create invoice. Check that the quantities match the three delivery notes, then issue it.",
                "Attach the three signed delivery notes when you send the invoice PDF.",
              ],
              tone: "info",
            },
            {
              title: "You need to bill a transport charge",
              problem: "Dodoma Builders agreed to pay TZS 150,000 for a special delivery to a site outside town. It was not on the quotation.",
              fix: [
                "Open Invoices, press + Invoice, then Create blank invoice and choose Dodoma Builders.",
                "Press + Add an item, describe it as Transport to site, enter the price and add it.",
                "Fill in the Client's order / PO no. if they gave one, then press Issue invoice.",
              ],
              tone: "info",
            },
          ],
          tip: "Never invoice the same goods twice: an advance invoice plus an invoice from each delivery note would bill the client double. Choose one way per order.",
          scales: "all",
        },
      ],
    },
    // ------------------------------------------------------------------ 11
    {
      id: "ch-paid",
      title: "Getting paid",
      intro:
        "This is where the money comes in. Record every payment against its invoice with the transaction code, give a receipt, remind clients at the right time and check everything against your bank and M-Pesa statements.",
      steps: [
        {
          id: "pay-record",
          title: "Record the payment",
          body:
            "Every payment is recorded on the invoice it pays. For mobile money, the transaction code is what lets you check it later against the statement.",
          do: [
            "Open the invoice and press + Record a payment received.",
            "Enter the date received and the amount.",
            "Choose how: bank, cash, mobile money or cheque. For mobile money choose the service, for example M-Pesa, Mixx by Yas or Airtel Money, and type the transaction code.",
            "Press Record payment. The invoice shows Part paid or Paid.",
            "Press Receipt for a PDF receipt to send to the client.",
          ],
          where: ["Finance", "Invoices", "open an invoice"],
          href: "/invoices",
          who: "Finance",
          example: {
            kind: "Payment received",
            title: "RCT-2026-0049",
            lines: [
              ["Amount", "TZS 3,646,200"],
              ["How", "Mobile money, M-Pesa"],
              ["Transaction code", "QJK7H2LM4P"],
              ["INV-2026-0055", "Fully paid"],
            ],
            mark: 3,
            stamp: "Paid",
            tone: "ok",
          },
          scenarios: [
            {
              title: "The client pays in two parts",
              problem: "The hotel pays TZS 2,000,000 by bank today and the rest next month.",
              fix: [
                "Record TZS 2,000,000 with the bank reference. The invoice shows Part paid and the balance due.",
                "When the rest arrives, record a second payment on the same invoice for TZS 1,646,200.",
                "Each payment has its own receipt.",
              ],
              tone: "info",
            },
            {
              title: "One bank transfer pays two invoices",
              problem: "Arusha Medical Stores sends one transfer of TZS 5,000,000 for INV-2026-0050 and INV-2026-0052.",
              fix: [
                "Record two payments with the same bank reference: one on each invoice, for the amount of that invoice.",
                "A payment can never be more than what is still owed on the invoice, so the app stops you if the split is wrong.",
              ],
              tone: "info",
            },
            {
              title: "The client pays by M-Pesa with the wrong reference",
              problem: "Money arrives in your M-Pesa with the reference HOTEL instead of the invoice number. You are not sure which invoice it pays.",
              fix: [
                "Look up the client on Money owed to us or the client's statement and find the invoice with that amount.",
                "If two invoices could match, call the client and ask which one they meant.",
                "Record the payment on that invoice with the M-Pesa transaction code. The code, not the reference, is what Check payments matches.",
              ],
              tone: "warn",
            },
            {
              title: "The payment was recorded on the wrong invoice",
              problem: "Finance recorded the hotel's TZS 3,646,200 on INV-2026-0051 instead of INV-2026-0055.",
              fix: [
                "Management opens the wrong invoice and presses Void this payment, with the reason: recorded on the wrong invoice.",
                "The invoice goes back to unpaid. The voided payment stays on record, marked as voided.",
                "Open the right invoice and record the payment again with the same transaction code.",
              ],
              tone: "bad",
            },
            {
              title: "A cheque bounces",
              problem: "The bank returns the client's cheque a week after you recorded it.",
              fix: [
                "Management presses Void this payment on the invoice with the reason, e.g. cheque bounced.",
                "The invoice is unpaid again and reminders start again.",
              ],
              tone: "bad",
            },
          ],
          tip: "Only management can void a payment. A voided payment stays on record, so nothing disappears.",
          scales: "all",
        },
        {
          id: "pay-remind",
          title: "Reminders before and after the due date",
          body:
            "LeMoSp reminds you a few days before an invoice is due, and again every few days while it is overdue. Each invoice has a ready-made reminder message with your pay numbers.",
          do: [
            "When the bell reminds you, open the invoice. The Remind the client card has a ready message.",
            "Choose WhatsApp, SMS or Email, the language and the contact, then send.",
            "Press + Log a reminder or promise to pay and write what the client said.",
          ],
          where: ["Finance", "Invoices", "open an invoice"],
          href: "/invoices",
          who: "Finance or Sales",
          example: {
            kind: "Reminder",
            title: "INV-2026-0055",
            lines: [
              ["Due", "14 Nov 2026"],
              ["Reminder sent", "11 Nov 2026, WhatsApp"],
              ["What was said", "Payment is with the finance manager"],
            ],
            stamp: "Reminded",
            tone: "info",
          },
          scenarios: [
            {
              title: "The client promises to pay next week",
              problem: "Asha says: we will pay on Friday the 21st.",
              fix: [
                "Press + Log a reminder or promise to pay and enter the date in Client promised to pay by.",
                "Reminders pause until that date, so you do not annoy a client who has promised.",
                "If the money has not come by then, reminders start again by themselves.",
                "The cash-flow forecast uses the promised date instead of the due date.",
              ],
              tone: "info",
            },
          ],
          scales: "all",
        },
        {
          id: "pay-owed",
          title: "Money owed to us and statements",
          body:
            "Money owed to us shows every client by how late they are: current, 1 to 30, 31 to 60, 61 to 90 and over 90 days. A statement lists every invoice and payment with the running balance, so the client can agree what they owe.",
          do: [
            "Open Money owed to us to see who owes what and for how long.",
            "Open Statements, choose the client and the dates, then Open statement.",
            "Press PDF to send it to the client. You can also open it from the client's page with Statement of account.",
          ],
          where: ["Finance", "Money owed to us"],
          href: "/receivables",
          who: "Finance and Management",
          example: {
            kind: "Statement of account",
            title: "Kilimanjaro Hotels Ltd",
            lines: [
              ["INV-2026-0041", "TZS 2,100,000"],
              ["Payment RCT-2026-0044", "− TZS 2,100,000"],
              ["INV-2026-0055", "TZS 3,646,200"],
              ["Owed to us", "TZS 3,646,200"],
            ],
            mark: 3,
            stamp: "Sent",
            tone: "info",
          },
          scenarios: [
            {
              title: "An invoice is 60 days overdue",
              problem: "Dodoma Builders has not paid INV-2026-0019. It now shows in the 31 to 60 days column and will soon move to 61 to 90.",
              fix: [
                "Send a statement so they see the full balance in writing, and ask them to confirm it.",
                "Log every call with + Log a reminder or promise to pay, so anyone can see the history.",
                "Management can lower or set a credit limit: new invoices above it then need a manager.",
                "Before the next delivery to them, check their balance on the client's page. Consider asking for payment before delivery.",
              ],
              tone: "bad",
            },
            {
              title: "The client says they already paid",
              problem: "Dodoma Builders insists they paid in September.",
              fix: [
                "Ask for their bank slip or transaction code.",
                "Check Payments received for that month and your bank statement.",
                "If the money is there but was recorded on another client by mistake, management voids it and it is recorded on the right invoice.",
              ],
              tone: "warn",
            },
          ],
          scales: "all",
        },
        {
          id: "pay-check",
          title: "Check payments against the bank and M-Pesa statement",
          body:
            "Once a month, or once a week, compare what was recorded in the app with what really arrived. Paste the statement and every payment whose transaction code appears in it is ticked for you.",
          do: [
            "Open Check payments and choose the method, the service (for example M-Pesa) and the month.",
            "Press Paste a statement. Copy everything from the M-Pesa or bank statement and paste it, or load a CSV file.",
            "Press Find and tick. Payments whose code is found are ticked.",
            "Check the rest by hand, then press Mark ticked as checked. Checked payments can no longer be changed.",
          ],
          where: ["Finance", "Check payments"],
          href: "/reconcile",
          who: "Finance",
          example: {
            kind: "Check payments",
            title: "M-Pesa, October 2026",
            lines: [
              ["Recorded", "42 payments"],
              ["Found in the statement", "40"],
              ["Without a transaction code", "1"],
              ["Same code twice", "1"],
            ],
            mark: 3,
            stamp: "Checked",
            tone: "ok",
          },
          scenarios: [
            {
              title: "A payment in the app is not on the statement",
              problem: "A payment of TZS 450,000 was recorded, but the code is not in the M-Pesa statement.",
              fix: [
                "Check the code on the payment for a typing mistake.",
                "If the money never arrived, management voids the payment with the reason, and the invoice is unpaid again.",
              ],
              tone: "warn",
            },
          ],
          tip: "Only codes of 6 characters or more are matched, and nothing from the statement is stored in the app.",
          scales: "all",
        },
      ],
    },
    // ------------------------------------------------------------------ 12
    {
      id: "ch-pay-supplier",
      title: "Paying the supplier",
      intro:
        "The other side of the order: record the supplier's invoice, check it against what was ordered and received, and pay what is due.",
      steps: [
        {
          id: "bill",
          title: "Record the supplier's invoice",
          body:
            "The supplier's invoice is recorded from its purchase order, so the amounts are filled in. You change them to match the paper exactly.",
          do: [
            "Open the purchase order and press Record supplier's invoice.",
            "Enter the Supplier's invoice no., Invoice date and Due date.",
            "Check Amount before VAT and VAT amount against the paper invoice, then press Save bill.",
          ],
          where: ["Finance", "Supplier bills"],
          href: "/bills",
          who: "Finance",
          example: {
            kind: "Supplier bill",
            title: "BILL-2026-0020",
            lines: [
              ["Supplier", "Dar Office Supplies"],
              ["Supplier's invoice no.", "DOS-INV-9902"],
              ["Bill total", "TZS 2,448,500"],
              ["Due", "19 Nov 2026"],
            ],
            stamp: "Open",
            tone: "info",
          },
          scales: "medium+",
        },
        {
          id: "match",
          title: "Order, receipt and bill check",
          body:
            "For each purchase order, the check compares what you ordered, what arrived on the GRNs and what the supplier billed. Pay only for what arrived.",
          do: [
            "Open Order, receipt and bill check. Each purchase order shows what was ordered, received and billed.",
            "Billed more than received: talk to the supplier before you pay.",
            "Received, not billed: ask the supplier for the bill, so what you owe is complete.",
            "Billed less than received: check that the bill is complete, or that a second bill is coming.",
            "Waiting for goods: ordered, but nothing received or billed yet. A bill for goods that never arrived shows as Billed more than received.",
          ],
          where: ["Purchasing", "Order, receipt and bill check"],
          href: "/purchasing/match",
          who: "Finance and Procurement",
          example: {
            kind: "Order, receipt and bill check",
            title: "PO-2026-0031",
            lines: [
              ["Ordered", "TZS 2,075,000"],
              ["Received", "TZS 2,075,000"],
              ["Billed", "TZS 2,075,000"],
            ],
            stamp: "Matches",
            tone: "ok",
          },
          scenarios: [
            {
              title: "The supplier billed for goods that never came",
              problem: "Only 48 boxes arrived, but the bill is for 50.",
              fix: [
                "The PO shows under Billed more than received.",
                "Send the supplier the GRN and ask for a corrected invoice for 48 boxes.",
                "Pay only the amount for what arrived. Record the corrected bill when it comes.",
              ],
              tone: "bad",
            },
          ],
          scales: "medium+",
        },
        {
          id: "pay-supplier",
          title: "Pay the supplier and see what you owe",
          body:
            "Record each payment to a supplier on their bill. Money we owe shows every unpaid bill and what falls due in the next 7 days.",
          do: [
            "Open the bill and press + Record a payment to the supplier.",
            "Enter the date paid, the amount, how you paid and the reference, then press Record payment.",
            "Open Money we owe to plan the next payments.",
            "To agree balances with a supplier, open their statement on Statements and compare it with theirs.",
          ],
          where: ["Finance", "Money we owe"],
          href: "/payables",
          who: "Finance",
          example: {
            kind: "Supplier payment",
            title: "BILL-2026-0020",
            lines: [
              ["Paid", "TZS 2,448,500"],
              ["How", "Bank transfer"],
              ["Still to pay", "TZS 0"],
            ],
            stamp: "Settled",
            tone: "ok",
          },
          scenarios: [
            {
              title: "A USD bill paid at a different bank rate",
              problem: "The importer billed USD 8,000 at 2,600, but the bank sold you dollars at 2,640 on the day you paid.",
              fix: [
                "Record the payment in USD and enter the Bank rate used on that day.",
                "The rate must be within 10% of the company rate on Exchange rates; if the market moved more, finance updates the rate first.",
              ],
              tone: "info",
            },
          ],
          tip: "The money-out side of Check payments ticks supplier payments and expenses against your statement in the same way.",
          scales: "medium+",
        },
        {
          id: "bill-other",
          title: "Bills without a purchase order, and correcting a bill",
          body:
            "Some suppliers bill you for things you did not order on a purchase order, such as a transporter or a repair. Record them with + Bill so Money we owe stays complete. A wrong bill is corrected or cancelled, never deleted.",
          do: [
            "Open Supplier bills and press + Bill.",
            "Choose the supplier, then enter the Supplier's invoice no., Invoice date, Due date, Amount before VAT and VAT amount, as on their paper. Press Save bill.",
            "If the bill was typed wrong and nothing is paid yet, open it, correct the figures under Details and press Save. If it should not be there at all, press Cancel this bill.",
            "If a payment to the supplier was wrong, management opens the bill and uses Void this payment with the reason. The amount is owed again.",
          ],
          where: ["Finance", "Supplier bills"],
          href: "/bills",
          who: "Finance",
          example: {
            kind: "Supplier bill",
            title: "BILL-2026-0023",
            lines: [
              ["Supplier", "Mwanza Stationers"],
              ["Supplier's invoice no.", "MS-1187"],
              ["Amount before VAT", "TZS 400,000"],
              ["VAT amount", "TZS 72,000"],
              ["Bill total", "TZS 472,000"],
            ],
            mark: 4,
            stamp: "Saved",
            tone: "info",
          },
          scenarios: [
            {
              title: "The supplier sends a corrected invoice",
              problem: "Dar Office Supplies replaces DOS-INV-9902 (50 boxes) with a new invoice for 48 boxes after the short delivery.",
              fix: [
                "If nothing is paid on the old bill, open it and press Cancel this bill, and write in the new bill's Notes that it replaces DOS-INV-9902.",
                "Open the purchase order and press Record supplier's invoice again with the new number and amounts.",
                "Order, receipt and bill check now shows the order under Matches.",
              ],
              tone: "warn",
            },
            {
              title: "You paid the wrong supplier bill",
              problem: "Finance recorded TZS 2,448,500 on Coastal Cleaning Supplies' bill, but the money went to Dar Office Supplies.",
              fix: [
                "Management opens the wrong bill and presses Void this payment, with the reason: belongs to Dar Office Supplies.",
                "Open the right bill and press + Record a payment to the supplier with the same date and reference.",
                "If the payment was already ticked on Check payments, tick the new one too.",
              ],
              tone: "bad",
            },
          ],
          tip: "A bill with payments can no longer be changed. Void the payments first if the bill itself is wrong.",
          scales: "medium+",
        },
        {
          id: "money-out-check",
          title: "Check money out against the statement",
          body:
            "Money paid to suppliers and for expenses must also match your bank and M-Pesa statements. Checking it catches payments typed twice, or money that left the account without a record.",
          do: [
            "Open Check payments and choose Money out (suppliers and expenses).",
            "Choose the Payment method, the service and the Month, then press Show.",
            "Press Paste a statement, paste the statement (or load a CSV / text file) and press Find and tick.",
            "Tick the rest by hand after finding them on the statement, then press Mark ticked as checked.",
            "Lines left To check need an answer: a payment recorded twice, a wrong amount, or a payment that never happened.",
          ],
          where: ["Finance", "Check payments"],
          href: "/reconcile",
          who: "Finance",
          example: {
            kind: "Check payments",
            title: "Money out · Bank transfer · October 2026",
            lines: [
              ["Supplier payments", "14"],
              ["Expenses", "22"],
              ["Found in the statement", "33"],
              ["To check", "3"],
            ],
            mark: 3,
            stamp: "Investigate",
            tone: "warn",
          },
          scenarios: [
            {
              title: "Money left the bank but nothing was recorded",
              problem: "The bank statement shows TZS 850,000 paid to a garage on 9 October. There is no expense or supplier payment for it.",
              fix: [
                "Ask who paid it and for what. Here it was a truck repair paid by the driver's supervisor.",
                "Record it as an expense with + Expense, category Repairs & maintenance, with the bank reference and a photo of the garage invoice.",
                "Paste the statement again: the new line is now found and ticked.",
              ],
              tone: "warn",
            },
          ],
          tip: "Once a payment or expense is checked against the statement, its amount, date and payment details can no longer be changed.",
          scales: "all",
        },
      ],
    },
    // ------------------------------------------------------------------ 13
    {
      id: "ch-costs",
      title: "Expenses on the job",
      intro:
        "Some costs belong to one order: transport to Arusha, a commission, bank charges. Others are general: rent, airtime, office fuel. Record each in the right place so the order's profit is true.",
      steps: [
        {
          id: "order-costs",
          title: "Costs of this order",
          body:
            "On the accepted quotation, Order costs holds the costs that are not part of the goods. They are taken off the order's profit.",
          do: [
            "Open the accepted quotation and scroll to Order costs.",
            "Press + Add a cost. Choose the type, such as Local transport, Commission or Bank charges.",
            "Enter the description, amount, currency and date, then press Add cost.",
          ],
          where: ["Sales", "Quotations", "open a quotation"],
          href: "/quotations",
          who: "Management, Finance or Procurement",
          example: {
            kind: "Order costs",
            title: "QT-2026-0042",
            lines: [
              ["Local transport", "TZS 120,000"],
              ["Bank charges", "TZS 8,000"],
              ["Total extra costs", "TZS 128,000"],
            ],
            mark: 2,
            stamp: "Added",
            tone: "info",
          },
          scales: "all",
        },
        {
          id: "expenses",
          title: "Day-to-day expenses with the receipt",
          body:
            "Everyday spending that is not a supplier bill goes into Expenses, with a photo of the receipt. Everyone records their own; management and finance see them all.",
          do: [
            "Open Expenses and press + Expense.",
            "Enter the amount paid (VAT included), the date, the category, who was paid and what for, for example Fuel for delivery to Arusha.",
            "Choose how it was paid, take a photo of the receipt, and press Save expense.",
          ],
          where: ["More", "Expenses"],
          href: "/expenses",
          who: "Everyone",
          example: {
            kind: "Expense",
            title: "EXP-2026-0112",
            lines: [
              ["What for", "Fuel for delivery to Arusha"],
              ["Amount", "TZS 120,000"],
              ["Paid to", "Puma, Morogoro Road"],
              ["Receipt photo", "Attached"],
            ],
            stamp: "Saved",
            tone: "ok",
          },
          scenarios: [
            {
              title: "Which one: order cost or expense?",
              problem: "Juma paid TZS 120,000 for fuel to deliver only the hotel's order.",
              fix: [
                "Record the fuel in Expenses with the receipt, so the money paid out is complete.",
                "If you want the order's profit to show it, management also adds it as an order cost on the quotation.",
                "General costs like rent and airtime go only in Expenses; they show in Profit & loss.",
              ],
              tone: "info",
            },
          ],
          scales: "all",
        },
        {
          id: "expense-control",
          title: "Keep expenses complete and correct",
          body:
            "Missing or wrong expenses make net profit look better than it is. Management and finance see every expense of the month, by category, with a count of those without a receipt photo. Everyone else sees My expenses.",
          do: [
            "Open Expenses. Use ← Earlier and Later → to move between months, and choose a category to see only that one.",
            "By category shows where the money went this month. The tile without a receipt photo tells you whose receipts to chase.",
            "To add a missing receipt, open the expense and press Add receipt photo, or Replace receipt for a better photo.",
            "To correct a typing mistake, open the expense, change the Details and press Save.",
            "To remove an expense that should not be there, management or finance opens it, opens Void this expense, writes the reason and presses Void. It stays on record, struck through.",
            "Management can press Edit categories to rename the categories, add one with New category name and Add, or Switch off one you no longer use.",
          ],
          where: ["More", "Expenses"],
          href: "/expenses",
          who: "Management and Finance",
          example: {
            kind: "Expenses",
            title: "October 2026",
            lines: [
              ["Transport & fuel", "TZS 1,840,000"],
              ["Salaries & wages", "TZS 6,200,000"],
              ["Rent", "TZS 1,500,000"],
              ["Expenses", "TZS 10,320,000"],
              ["without a receipt photo", "4"],
            ],
            mark: 4,
            stamp: "Chase receipts",
            tone: "warn",
          },
          scenarios: [
            {
              title: "The same fuel was recorded twice",
              problem: "Juma recorded TZS 120,000 of fuel on Monday, and the office recorded the same receipt again on Tuesday.",
              fix: [
                "Open both expenses and compare the receipt photos and Paid to.",
                "Management or finance opens the second one, opens Void this expense, writes: recorded twice, same receipt as Monday, and presses Void.",
                "The month's totals and Profit & loss drop by TZS 120,000 at once.",
              ],
              tone: "warn",
            },
            {
              title: "A staff member paid for the business from their own pocket",
              problem: "Neema paid TZS 35,000 for printer paper at a shop near the office with her own money.",
              fix: [
                "Neema records it with + New expense, the receipt photo, Paid to the shop and what it was for.",
                "Finance sees it under Expenses and refunds her. Write in Notes how and when she was refunded.",
              ],
              tone: "info",
            },
          ],
          tip: "When the receipt shows VAT, enter it under of which VAT: Profit & loss counts expenses without VAT. An expense in another currency also asks for the Exchange rate.",
          scales: "all",
        },
      ],
    },
    // ------------------------------------------------------------------ 14
    {
      id: "ch-profit",
      title: "Closing the loop: the profit on the order",
      intro:
        "The order is delivered, invoiced and paid, and the supplier is paid. Now see exactly what you earned on it, and how it fits into the month.",
      steps: [
        {
          id: "order-profit",
          title: "Profit on this order",
          body:
            "On the accepted quotation, Order costs & profit shows what was invoiced, the cost of the goods, the other order costs and the gross profit. Only management and finance see it.",
          do: [
            "Open the quotation and scroll to Order costs & profit.",
            "Check Lines without a cost: if any, the profit is overstated. Set the product costs or confirm the purchase orders.",
          ],
          where: ["Sales", "Quotations", "open a quotation"],
          href: "/quotations",
          who: "Management and Finance",
          example: {
            kind: "Order costs & profit",
            title: "QT-2026-0042",
            lines: [
              ["Invoiced (before VAT)", "TZS 3,090,000"],
              ["Cost of goods", "TZS 2,507,000"],
              ["Other order costs", "TZS 128,000"],
              ["Gross profit", "TZS 455,000 (14.7%)"],
            ],
            mark: 3,
            stamp: "Profit",
            tone: "ok",
          },
          scales: "all",
        },
        {
          id: "month-profit",
          title: "Profit by order, client and salesperson",
          body:
            "Profit puts every order together for the month: by order, by client, by industry and by salesperson. Profit & loss takes away the month's expenses and shows the net profit.",
          do: [
            "Open Profit and choose the month. Tap a client or order to see the details.",
            "Open Profit & loss to compare this month, last month and the year so far.",
            "Larger companies also see Budgets vs actual and the Cash-flow forecast.",
          ],
          where: ["Finance", "Profit"],
          href: "/profit",
          who: "Management and Finance",
          example: {
            kind: "Profit",
            title: "October 2026",
            lines: [
              ["Sales invoiced (before VAT)", "TZS 48,200,000"],
              ["Gross profit", "TZS 8,150,000"],
              ["Best client", "Kilimanjaro Hotels Ltd"],
              ["Margin", "16.9%"],
            ],
            stamp: "This month",
            tone: "ok",
          },
          scenarios: [
            {
              title: "A profitable-looking order lost money",
              problem: "The profit page shows 30% on an order, but you know you paid duty and clearing on it.",
              fix: [
                "Check that the import costs were added to the purchase order and that Use landed cost as product cost was pressed before invoicing.",
                "Check Lines without a cost on the invoice and the quotation.",
                "Add any forgotten transport or commission as order costs.",
              ],
              tone: "warn",
            },
          ],
          scales: "medium+",
        },
      ],
    },
    // ------------------------------------------------------------------ 15
    {
      id: "ch-special",
      title: "Foreign currency and special orders",
      intro:
        "Not every order is a simple local one. First keep your exchange rates right, then follow three common cases: an import paid in US dollars, a rush order with no time to compare suppliers, and a tender that becomes a contract.",
      steps: [
        {
          id: "rates",
          title: "Keep the exchange rates up to date",
          body:
            "Quotations, purchase orders, invoices, bills and costs in a foreign currency take the rate from Exchange rates, and can only differ from it by up to 10%. An old rate makes margins, approval limits and credit limits wrong.",
          do: [
            "Open Exchange rates. Only management and finance can change them.",
            "Under Add or update a rate, type the Currency as a 3-letter code such as USD, EUR or KES.",
            "Under How many, enter the shillings for 1 unit, for example 2600 for USD, and press Save rate.",
            "Each rate shows when it was Updated. Update it when the bank rate moves, for example every Monday.",
            "Press Remove only for a currency you no longer use.",
          ],
          where: ["Finance", "Exchange rates"],
          href: "/rates",
          who: "Finance or Management",
          example: {
            kind: "Exchange rates",
            title: "Monday 12 Oct 2026",
            lines: [
              ["USD", "TZS 2,600 per 1 unit"],
              ["EUR", "TZS 2,830 per 1 unit"],
              ["KES", "TZS 20.10 per 1 unit"],
              ["Updated", "12 Oct 2026"],
            ],
            stamp: "Save rate",
            tone: "ok",
          },
          scenarios: [
            {
              title: "The shilling drops suddenly",
              problem: "The bank now sells dollars at 2,880, but Exchange rates still says 2,600. A new USD purchase order at 2,880 is refused: it is more than 10% away.",
              fix: [
                "Finance updates USD on Exchange rates to 2,880 and presses Save rate.",
                "Make or save the purchase order again: it now takes the new rate.",
                "Check open quotations priced from USD goods: the cost in shillings went up by about 11%. Revise those still waiting for an answer.",
              ],
              tone: "warn",
            },
            {
              title: "A supplier quotes in euros for the first time",
              problem: "A German pump maker quotes in EUR, and EUR is not on Exchange rates yet.",
              fix: [
                "Finance adds EUR under Add or update a rate with today's bank rate.",
                "Enter the supplier's prices in EUR on the supplier RFQ. Compare prices converts them to TZS.",
              ],
              tone: "info",
            },
          ],
          tip: "Foreign-currency documents need the Multiple currencies feature. Management switches it on in Features & business level.",
          scales: "medium+",
        },
        {
          id: "usd-import",
          title: "A USD import order with duty and clearing",
          body:
            "Arusha Medical Stores orders spare filters for its cleaning machines, which you import from Dubai in USD. You quote in TZS, buy in USD and pay duty and clearing in TZS.",
          do: [
            "Finance enters today's USD rate on Exchange rates first.",
            "Make the purchase order in USD to the Dubai supplier. Its exchange rate comes from Exchange rates.",
            "After the supplier confirms, add freight, insurance, import duty, clearing & forwarding and port charges under Import costs & landed cost.",
            "Press Use landed cost as product cost, so the quotation's margin and the order's profit use the real cost.",
            "Record the USD bill and each payment with the bank rate used.",
          ],
          where: ["Purchasing", "Purchase orders", "open a PO"],
          href: "/purchase-orders",
          who: "Procurement and Finance",
          example: {
            kind: "Import order",
            title: "PO-2026-0035",
            lines: [
              ["Supplier", "Gulf Filters FZE, Dubai"],
              ["Goods", "USD 8,000"],
              ["Rate", "2,600"],
              ["Duty, clearing, freight, port", "TZS 5,740,000"],
              ["Landed cost", "TZS 26,540,000"],
            ],
            mark: 4,
            stamp: "Applied",
            tone: "ok",
          },
          scenarios: [
            {
              title: "The app refuses the exchange rate",
              problem: "You type a rate of 2,900 on the PO and the app says it is more than 10% away from the company rate.",
              fix: [
                "This protects you from typing mistakes.",
                "If the rate really moved, finance updates it on Exchange rates, then you save the PO again.",
              ],
              tone: "warn",
            },
            {
              title: "The clearing agent's bill comes after the goods are sold",
              problem: "A late storage charge of TZS 300,000 arrives a month later.",
              fix: [
                "Add it to the PO's import costs and press Re-apply landed cost: future sales use the new cost.",
                "For goods already invoiced, add it as an order cost on the client's quotation, so that order's profit is correct.",
              ],
              tone: "info",
            },
          ],
          scales: "medium+",
        },
        {
          id: "rush-order",
          title: "A rush order with no time for supplier RFQs",
          body:
            "Zanzibar Resorts calls at 9:00: they need 20 boxes of paper today. There is no time to ask three suppliers. LeMoSp still keeps the order complete.",
          do: [
            "Press + New quotation, choose the client and add the paper at your usual price. Submit and send.",
            "When they accept, check Stock. If you have it, press Create delivery note and Dispatch now straight away.",
            "If you do not, press Create purchase order on the quotation and order from your usual supplier at the last known cost.",
            "Receive, deliver and invoice as usual. Nothing is skipped, only the supplier RFQ.",
          ],
          where: ["Sales", "Quotations"],
          href: "/quotations",
          who: "Sales, Procurement and Warehouse",
          example: {
            kind: "Rush order",
            title: "QT-2026-0049",
            lines: [
              ["09:00", "Client calls"],
              ["09:20", "Quotation sent and accepted"],
              ["09:40", "Delivery note dispatched"],
              ["15:00", "Delivered and invoiced"],
            ],
            stamp: "Same day",
            tone: "ok",
          },
          scenarios: [
            {
              title: "The rush order needs a big discount",
              problem: "The client wants a lower price for the rush, and the manager is travelling.",
              fix: [
                "Submit anyway. The manager gets an alert and can approve on the phone in a minute.",
                "Agree in advance which clients may get which discount, so approvals are quick.",
              ],
              tone: "warn",
            },
          ],
          scales: "all",
        },
        {
          id: "tender-contract",
          title: "A tender that becomes a contract",
          body:
            "Arusha Medical Stores tenders its cleaning supplies for 2027. You prepare the papers, submit the bid, win, and then supply all year at the agreed prices.",
          do: [
            "Record the tender with + Tender, tick the papers as they are ready, enter our bid price and press Mark as submitted.",
            "When the result is announced, press We won.",
            "Press Add the contract and its prices. Check the start and end dates and each agreed price.",
            "For each call-off order, make a quotation for the client and press Use contract prices.",
            "Accept, buy, deliver and invoice as in the rest of this playbook. You are reminded before the contract ends.",
          ],
          where: ["Sales", "Tenders"],
          href: "/tenders",
          who: "Sales and Management",
          example: {
            kind: "Tender",
            title: "TND-2026-0004",
            lines: [
              ["Our bid price", "TZS 96,500,000"],
              ["Result", "We won"],
              ["Contract", "CTR-2026-0004"],
              ["Runs", "1 Jan to 31 Dec 2027"],
            ],
            stamp: "Won",
            tone: "ok",
          },
          scenarios: [
            {
              title: "We lost the tender",
              problem: "The award went to another bidder at a lower price.",
              fix: [
                "Press We lost and record who won and the winning price.",
                "Over the year, Tenders shows how often you win and how far your prices were from the winners.",
              ],
              tone: "bad",
            },
          ],
          scales: "medium+",
        },
      ],
    },
  ],
};
