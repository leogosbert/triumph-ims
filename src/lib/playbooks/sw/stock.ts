/** Kiswahili for the "Buy smart and control your stock" playbook (src/lib/playbooks/stock.ts). English is the key. */
export const SW_STOCK: Record<string, string> = {
  "Buy smart and control your stock": "Nunua kwa busara na udhibiti stoku yako",
  "Buy the right goods at the right price, know exactly what is on your shelves, and never tie up cash in stock that does not move.":
    "Nunua bidhaa sahihi kwa bei sahihi, jua hasa kilicho kwenye rafu zako, na usifungie pesa kwenye stoku isiyotoka.",
  "Owners, procurement officers, store keepers and finance staff.": "Wamiliki, maafisa manunuzi, watunza stoo na wafanyakazi wa fedha.",

  // Chapter: foundations
  "Products, units and stores": "Bidhaa, vipimo na maghala",
  "Good stock control starts with clean records: every product once, with the right unit, a reorder level, and every store you keep goods in. Get these right and everything after is simple.":
    "Udhibiti mzuri wa stoku huanza na kumbukumbu safi: kila bidhaa mara moja tu, ikiwa na kipimo sahihi, kiwango cha kuagiza tena, na kila ghala unalohifadhi bidhaa. Pata haya sawasawa na kila kitu kinachofuata kinakuwa rahisi.",
  "Add each product once, with the right unit": "Ongeza kila bidhaa mara moja, ikiwa na kipimo sahihi",
  "A product is anything you buy and sell. Its unit is how you count it on the shelf and on documents, so choose the unit you sell in.":
    "Bidhaa ni chochote unachonunua na kuuza. Kipimo chake ndivyo unavyoihesabu kwenye rafu na kwenye hati, kwa hiyo chagua kipimo unachouzia.",
  "Open Products and press + New product.": "Fungua Bidhaa na ubonyeze + Bidhaa mpya.",
  "Enter the Product name, Category, Brand and Manufacturer part no. Leave SKU blank to number it automatically.":
    "Weka Jina la bidhaa, Kundi la bidhaa, Chapa na Namba ya sehemu ya mtengenezaji. Acha SKU wazi ili ipewe namba yenyewe.",
  "Choose the Unit: pcs, set, drum, pail, litre, kg, bag, m, roll, box or carton. Write the Pack size if it helps, for example \"box of 5 reams\".":
    "Chagua Kipimo: pcs (vipande), set, drum (pipa), pail (ndoo), litre, kg, bag (mfuko), m, roll, box (boksi) au carton (katoni). Andika Ukubwa wa kifungashio kama inasaidia, kwa mfano \"boksi la rimu 5\".",
  "Enter the Selling price (TZS), the Reorder level and, if you like, the Maximum stock level.":
    "Weka Bei ya kuuza (TZS), Kiwango cha kuagiza tena na, ukipenda, Kiwango cha juu cha stoo.",
  "For goods that expire, enter the Shelf life (months). For chemicals, tick Hazardous and SDS on file.":
    "Kwa bidhaa zinazoisha muda, weka Muda wa kukaa (miezi). Kwa kemikali, weka alama kwenye Hatari na SDS ipo kwenye faili.",
  "Press Add product. Then, under Purchasing, choose the Main supplier and enter the Last cost, and press Save purchasing details.":
    "Bonyeza Ongeza bidhaa. Kisha, chini ya Ununuzi, chagua Msambazaji mkuu na uweke Gharama ya mwisho, na ubonyeze Hifadhi taarifa za ununuzi.",
  "Products": "Bidhaa",
  "Management or Procurement": "Uongozi au Manunuzi",
  "Many products at once? Use Import from spreadsheet: download the template, fill it in Excel and upload it.":
    "Bidhaa nyingi kwa mara moja? Tumia Ingiza kutoka lahajedwali: pakua kiolezo, kijaze kwenye Excel na ukipakie.",
  "Product": "Bidhaa",
  "A4 paper, box of 5 reams": "Karatasi A4, boksi la rimu 5",
  "Added": "Imeongezwa",
  "Unit": "Kipimo",
  "box": "boksi",
  "Selling price (TZS)": "Bei ya kuuza (TZS)",
  "Last cost": "Gharama ya mwisho",
  "Reorder level": "Kiwango cha kuagiza tena",
  "Maximum stock level": "Kiwango cha juu cha stoo",
  "You buy in cartons but sell in pieces": "Unanunua kwa katoni lakini unauza kwa vipande",
  "You buy gloves in cartons of 10 boxes, but clients order single boxes. A product has one unit in LeMoSp.":
    "Unanunua glovu kwa katoni zenye boksi 10, lakini wateja huagiza boksi moja moja. Katika LeMoSp bidhaa ina kipimo kimoja.",
  "Create the product in the unit you sell: box.": "Unda bidhaa kwa kipimo unachouzia: boksi.",
  "Write the Pack size as \"carton of 10 boxes\" so buyers know.": "Andika Ukubwa wa kifungashio kama \"katoni ya boksi 10\" ili wanunuzi wajue.",
  "On the purchase order, order in boxes: 30 cartons are 300 boxes, and the price per box is the carton price divided by 10.":
    "Kwenye oda ya ununuzi, agiza kwa boksi: katoni 30 ni boksi 300, na bei ya boksi ni bei ya katoni ikigawanywa kwa 10.",
  "When the goods arrive, receive 300 boxes. Stock, quotations and invoices then all count the same way.":
    "Bidhaa zikifika, pokea boksi 300. Hivyo stoku, nukuu za bei na ankara zote zinahesabu kwa njia moja.",
  "The same product was added twice": "Bidhaa moja imeongezwa mara mbili",
  "\"HP 85A toner\" and \"Toner HP85A\" are both in Products, and stock is split between them.":
    "\"HP 85A toner\" na \"Toner HP85A\" zote ziko kwenye Bidhaa, na stoku imegawanyika kati yao.",
  "Choose the one to keep.": "Chagua utakayoibakiza.",
  "On Adjust stock, remove the stock from the duplicate with the reason \"Duplicate product, moved to HP 85A toner\", and add the same quantity to the one you keep with the same reason.":
    "Kwenye Rekebisha stoku, ondoa stoku kutoka kwenye nakala kwa sababu \"Bidhaa iliyorudiwa, imehamishiwa HP 85A toner\", na uongeze kiasi hicho hicho kwenye unayoibakiza kwa sababu ile ile.",
  "Open the duplicate and press Archive product. Its history is kept.":
    "Fungua nakala na ubonyeze Hifadhi bidhaa kwenye kumbukumbu. Historia yake inabaki.",
  "Add every store where you keep goods": "Ongeza kila ghala unalohifadhi bidhaa",
  "Each store or warehouse has its own stock. The app then knows exactly what is where, and deliveries and transfers take goods from the right place.":
    "Kila stoo au ghala lina stoku yake. Hivyo programu inajua hasa kipi kiko wapi, na uwasilishaji na uhamisho huchukua bidhaa kutoka mahali sahihi.",
  "Open Stores.": "Fungua Maghala.",
  "Under Add a store, enter the Name, a short Code and the Address.": "Chini ya Ongeza ghala, weka Jina, Msimbo mfupi na Anwani.",
  "Press Add store.": "Bonyeza Ongeza ghala.",
  "Close a store you no longer use. Its history is kept.": "Funga ghala usilolitumia tena. Historia yake inabaki.",
  "Stores": "Maghala",
  "More": "Zaidi",
  "Store": "Ghala",
  "Name": "Jina",
  "Mwanza store": "Ghala la Mwanza",
  "Code": "Msimbo",
  "Address": "Anwani",
  "Nyakato Industrial Area, Mwanza": "Eneo la Viwanda Nyakato, Mwanza",
  "Status": "Hali",
  "In use": "Inatumika",
  "Load your opening stock": "Pakia stoku yako ya mwanzo",
  "Before you start, the app needs to know what is on your shelves today. Count first, then load the count once. From then on, every movement is recorded.":
    "Kabla ya kuanza, programu inahitaji kujua kilicho kwenye rafu zako leo. Hesabu kwanza, kisha pakia hesabu hiyo mara moja. Kuanzia hapo, kila mwenendo unarekodiwa.",
  "Count everything in each store. Write the batch and expiry date for goods that expire.":
    "Hesabu kila kitu katika kila ghala. Andika kundi na tarehe ya kwisha muda kwa bidhaa zinazoisha muda.",
  "Open Stock and press Load opening stock.": "Fungua Stoku na ubonyeze Pakia stoku ya mwanzo.",
  "Press Download the template and fill in one row per product, store and batch.":
    "Bonyeza Pakua kiolezo na ujaze mstari mmoja kwa kila bidhaa, ghala na kundi.",
  "Upload the spreadsheet (.xlsx). If any row has a problem, nothing is loaded and you are told which rows to fix.":
    "Pakia lahajedwali (.xlsx). Mstari wowote ukiwa na tatizo, hakuna kinachopakiwa na unaambiwa mistari ipi urekebishe.",
  "When all rows are ready, press Load opening stock. Each row is recorded as an \"Opening stock\" adjustment.":
    "Mistari yote ikiwa tayari, bonyeza Pakia stoku ya mwanzo. Kila mstari unarekodiwa kama marekebisho ya \"Stoku ya mwanzo\".",
  "Stock": "Stoku",
  "Management or Warehouse": "Uongozi au Ghala",
  "Count on a quiet day, for example a Saturday afternoon, and do not dispatch anything until the count is loaded.":
    "Hesabu siku tulivu, kwa mfano Jumamosi mchana, na usitoe kitu chochote hadi hesabu ipakiwe.",
  "Opening stock": "Stoku ya mwanzo",
  "Loaded": "Imepakiwa",
  "120 box": "boksi 120",
  "Toner HP 85A": "Tona HP 85A",
  "18 pcs": "vipande 18",
  "Nitrile gloves, box of 100": "Glovu za nitrile, boksi la 100",
  "260 box": "boksi 260",
  "Rows ready": "Mistari iliyo tayari",

  // Chapter: buying
  "Buy at the right price": "Nunua kwa bei sahihi",
  "Every shilling saved when buying is a shilling of profit. Ask for the goods in writing, compare suppliers, approve big orders and count every cost of an import.":
    "Kila shilingi inayookolewa wakati wa kununua ni shilingi ya faida. Omba bidhaa kwa maandishi, linganisha wasambazaji, idhinisha oda kubwa na uhesabu kila gharama ya uagizaji.",
  "Ask for goods with a purchase request": "Omba bidhaa kwa ombi la ununuzi",
  "Staff who need goods ask in the app instead of by phone. Management approves or rejects with a note, and procurement turns the approved request into an order. Nothing is bought without a trace.":
    "Wafanyakazi wanaohitaji bidhaa wanaomba ndani ya programu badala ya kwa simu. Uongozi unaidhinisha au kukataa kwa dokezo, na manunuzi wanageuza ombi lililoidhinishwa kuwa oda. Hakuna kinachonunuliwa bila kumbukumbu.",
  "Open Purchase requests and press + Request.": "Fungua Maombi ya ununuzi na ubonyeze + Ombi.",
  "Fill in What is it for?, Needed by and Deliver to store, then press Next: add items.":
    "Jaza Ni kwa ajili ya nini?, Inahitajika kabla ya na Ilete stoo ipi, kisha bonyeza Ifuatayo: ongeza bidhaa.",
  "Add each item with its quantity and press Send for approval.": "Ongeza kila bidhaa na kiasi chake na ubonyeze Tuma kwa idhini.",
  "Management opens it and presses Approve, or Reject with a note.": "Uongozi unalifungua na kubonyeza Idhinisha, au Kataa pamoja na dokezo.",
  "Procurement opens the approved request, chooses the supplier under Order it and presses Create draft PO.":
    "Manunuzi wanafungua ombi lililoidhinishwa, wanachagua msambazaji chini ya Iagize na kubonyeza Unda rasimu ya PO.",
  "Purchasing": "Ununuzi",
  "Purchase requests": "Maombi ya ununuzi",
  "Anyone asks; Management approves; Procurement orders": "Yeyote anaomba; Uongozi unaidhinisha; Manunuzi wanaagiza",
  "A request from management is approved as soon as it is sent.": "Ombi kutoka kwa uongozi linaidhinishwa mara linapotumwa.",
  "Purchase request": "Ombi la ununuzi",
  "Approved": "Imeidhinishwa",
  "What is it for?": "Ni kwa ajili ya nini?",
  "Gloves for the Mwanza site job": "Glovu kwa ajili ya kazi ya eneo la Mwanza",
  "200 box": "boksi 200",
  "Needed by": "Inahitajika kabla ya",
  "28 Oct 2026": "28 Okt 2026",
  "Asked by": "Imeombwa na",
  "Juma, Warehouse": "Juma, Ghala",
  "Ask several suppliers for prices and compare": "Omba bei kwa wasambazaji kadhaa na ulinganishe",
  "Asking two or three suppliers usually saves 5 to 15 percent. The comparison shows the cheapest price for each item and each supplier's total, including freight.":
    "Kuuliza wasambazaji wawili au watatu kwa kawaida huokoa asilimia 5 hadi 15. Ulinganisho unaonyesha bei nafuu zaidi kwa kila bidhaa na jumla ya kila msambazaji, pamoja na usafirishaji.",
  "Open Supplier RFQs and press + New. Or, from an accepted quotation, press Request supplier quotes so the items are copied across.":
    "Fungua RFQ za wasambazaji na ubonyeze + Mpya. Au, kutoka kwenye nukuu ya bei iliyokubaliwa, bonyeza Omba bei kwa wasambazaji ili bidhaa zinakiliwe.",
  "Fill in What you need, Delivery to and Suppliers should reply by, then press Create and add items.":
    "Jaza Unachohitaji, Uwasilishaji kwa na Wasambazaji wajibu kabla ya, kisha bonyeza Unda na ongeza bidhaa.",
  "Add the items. Under Choose a supplier to ask, add each supplier and press Add supplier.":
    "Ongeza bidhaa. Chini ya Chagua msambazaji wa kuuliza, ongeza kila msambazaji na ubonyeze Ongeza msambazaji.",
  "Press Open RFQ PDF and send it to each supplier.": "Bonyeza Fungua PDF ya RFQ na umtumie kila msambazaji.",
  "When a supplier replies, press Enter prices. Type the prices exactly as quoted, in their currency, with the lead time, payment terms and validity. Press Save prices.":
    "Msambazaji akijibu, bonyeza Weka bei. Andika bei kama walivyonukuu, kwa sarafu yao, pamoja na muda wa kusubiri, masharti ya malipo na muda wa uhalali. Bonyeza Hifadhi bei.",
  "Look at Compare prices: green is the cheapest. Press Award & create PO under the supplier you choose.":
    "Angalia Linganisha bei: kijani ndiyo nafuu zaidi. Bonyeza Toa zabuni na unda PO chini ya msambazaji unayemchagua.",
  "Supplier RFQs": "RFQ za wasambazaji",
  "Procurement": "Manunuzi",
  "Compare prices": "Linganisha bei",
  "Best value": "Thamani bora",
  "Dar Office Supplies": "Dar Office Supplies",
  "TZS 9,600,000 · 3 days": "TZS 9,600,000 · siku 3",
  "Mwanza Stationers": "Mwanza Stationers",
  "TZS 10,250,000 · 7 days": "TZS 10,250,000 · siku 7",
  "Kariakoo Paper House": "Kariakoo Paper House",
  "TZS 9,450,000 · 21 days": "TZS 9,450,000 · siku 21",
  "Chosen": "Aliyechaguliwa",
  "The same item from two suppliers at different prices": "Bidhaa moja kutoka kwa wasambazaji wawili kwa bei tofauti",
  "Dar Office Supplies sells A4 paper at TZS 48,000 a box and delivers in 3 days. Kariakoo Paper House sells it at TZS 47,250 but takes 21 days and often delivers late.":
    "Dar Office Supplies wanauza karatasi A4 kwa TZS 48,000 kwa boksi na wanaleta ndani ya siku 3. Kariakoo Paper House wanaiuza kwa TZS 47,250 lakini wanachukua siku 21 na mara nyingi huchelewa.",
  "Look at the whole cost, not the price alone: 200 boxes save TZS 150,000 with Kariakoo, but three weeks without paper can lose an order worth much more.":
    "Angalia gharama nzima, si bei peke yake: boksi 200 zinaokoa TZS 150,000 kwa Kariakoo, lakini wiki tatu bila karatasi zinaweza kukupotezea oda yenye thamani kubwa zaidi.",
  "Open Business insights and look at Supplier delivery on time to see how late each supplier really is.":
    "Fungua Maarifa ya biashara na uangalie Wasambazaji kuleta kwa wakati kuona kila msambazaji huchelewa kiasi gani hasa.",
  "Buy regular stock from the cheaper supplier when you have time, and urgent orders from the faster one.":
    "Nunua stoku ya kawaida kwa msambazaji nafuu ukiwa na muda, na oda za haraka kwa yule wa haraka.",
  "On the product, set the Main supplier to the one you use most and press Save purchasing details.":
    "Kwenye bidhaa, weka Msambazaji mkuu kuwa yule unayemtumia zaidi na ubonyeze Hifadhi taarifa za ununuzi.",
  "Tell the faster supplier the price you were offered. Many will match it for a regular order.":
    "Mwambie msambazaji wa haraka bei uliyopewa. Wengi watakubali bei hiyo kwa oda za kawaida.",
  "One supplier is cheaper for some items, another for the rest": "Msambazaji mmoja ni nafuu kwa baadhi ya bidhaa, mwingine kwa zilizobaki",
  "Dar Office Supplies is cheapest for paper; Mwanza Stationers is cheapest for toner. Award & create PO makes one order for one supplier.":
    "Dar Office Supplies ni nafuu zaidi kwa karatasi; Mwanza Stationers ni nafuu zaidi kwa tona. Toa zabuni na unda PO inaandaa oda moja kwa msambazaji mmoja.",
  "Press Award & create PO under Dar Office Supplies, then remove the toner lines from that draft PO.":
    "Bonyeza Toa zabuni na unda PO chini ya Dar Office Supplies, kisha ondoa mistari ya tona kwenye rasimu hiyo ya PO.",
  "Open Purchase orders, press + New purchase order, choose Mwanza Stationers and add the toner at their price.":
    "Fungua Oda za ununuzi, bonyeza + Oda mpya ya ununuzi, chagua Mwanza Stationers na uongeze tona kwa bei yao.",
  "Submit both orders as usual.": "Wasilisha oda zote mbili kama kawaida.",
  "Send a purchase order, approved when it is big": "Tuma oda ya ununuzi, iliyoidhinishwa ikiwa kubwa",
  "A purchase order is your written promise to buy, with quantities, prices and terms. Orders above your approval amount wait for management, so big spending is always seen.":
    "Oda ya ununuzi ni ahadi yako ya maandishi ya kununua, pamoja na viasi, bei na masharti. Oda zilizo juu ya kiwango chako cha idhini zinasubiri uongozi, ili matumizi makubwa yaonekane kila mara.",
  "Open Purchase orders and press + New purchase order, or start from a supplier RFQ, What to reorder or a purchase request.":
    "Fungua Oda za ununuzi na ubonyeze + Oda mpya ya ununuzi, au anza kutoka RFQ ya msambazaji, Cha kuagiza tena au ombi la ununuzi.",
  "Check the items, prices, Deliver to, Payment terms and Required by.":
    "Hakiki bidhaa, bei, Wasilisha kwa, Masharti ya malipo na Inahitajika kabla ya.",
  "Press Submit purchase order. Above the approval amount it shows Waiting for management approval.":
    "Bonyeza Wasilisha oda ya ununuzi. Ikiwa juu ya kiwango cha idhini inaonyesha Inasubiri idhini ya menejimenti.",
  "Management opens it and presses Approve, or Send back for changes with a note.":
    "Uongozi unaifungua na kubonyeza Idhinisha, au Rudisha kwa marekebisho pamoja na dokezo.",
  "Press Open PDF, send it to the supplier, then press I have sent it to the supplier.":
    "Bonyeza Fungua PDF, mtumie msambazaji, kisha bonyeza Nimemtumia msambazaji.",
  "When the supplier confirms, enter Their order / confirmation no. and the Confirmed delivery date, and press Supplier confirmed.":
    "Msambazaji akithibitisha, weka Namba yao ya oda / uthibitisho na Tarehe ya uwasilishaji iliyothibitishwa, na ubonyeze Msambazaji amethibitisha.",
  "Purchase orders": "Oda za ununuzi",
  "Procurement; Management approves": "Manunuzi; Uongozi unaidhinisha",
  "Management sets Approval needed above in Company details & branding, under Purchase orders. Confirming the order also updates each product's last cost from this PO.":
    "Uongozi unaweka kiwango cha idhini (Approval needed above) kwenye Maelezo ya kampuni na utambulisho, chini ya Oda za ununuzi. Kuthibitisha oda pia kunasasisha gharama ya mwisho ya kila bidhaa kutoka kwenye PO hii.",
  "Purchase order": "Oda ya ununuzi",
  "Supplier": "Msambazaji",
  "200 × TZS 48,000": "200 × TZS 48,000",
  "Total": "Jumla",
  "Approval needed above": "Idhini inahitajika juu ya",
  "Management sends an order back": "Uongozi unarudisha oda",
  "The manager presses Send back for changes on PO-2026-0057 with the note \"Order 150, not 200. Cash is tight this month.\"":
    "Meneja anabonyeza Rudisha kwa marekebisho kwenye PO-2026-0057 kwa dokezo \"Agiza 150, si 200. Pesa ni chache mwezi huu.\"",
  "Open the order. The note shows at the top under Sent back by management.":
    "Fungua oda. Dokezo linaonekana juu chini ya Imerudishwa na uongozi.",
  "Change the quantity to 150 and press Update.": "Badilisha kiasi kuwa 150 na ubonyeze Sasisha.",
  "Press Submit purchase order again.": "Bonyeza Wasilisha oda ya ununuzi tena.",
  "Approve big orders in steps": "Idhinisha oda kubwa kwa hatua",
  "Large companies want more than one pair of eyes on big orders, for example finance checks the budget first, then management approves. Each step is asked in order.":
    "Kampuni kubwa zinataka zaidi ya mtu mmoja kuangalia oda kubwa, kwa mfano fedha wanakagua bajeti kwanza, kisha uongozi unaidhinisha. Kila hatua inaulizwa kwa mpangilio.",
  "Management opens Approval steps and fills one row per step: who approves, from which amount, and a name such as Budget check.":
    "Uongozi unafungua Hatua za kuidhinisha na kujaza mstari mmoja kwa kila hatua: nani anaidhinisha, kuanzia kiasi gani, na jina kama Ukaguzi wa bajeti.",
  "When a purchase order is submitted, every step whose amount it reaches is asked in order.":
    "Oda ya ununuzi ikiwasilishwa, kila hatua ambayo kiasi chake kimefikiwa inaulizwa kwa mpangilio.",
  "Each person opens the order and presses Approve, or Send back for changes with a note.":
    "Kila mtu anafungua oda na kubonyeza Idhinisha, au Rudisha kwa marekebisho pamoja na dokezo.",
  "Waiting for you, at the top of Approval steps, lists the orders you can approve now.":
    "Zinakusubiri wewe, juu ya Hatua za kuidhinisha, inaorodhesha oda unazoweza kuidhinisha sasa.",
  "Approval steps": "Hatua za kuidhinisha",
  "Nobody approves their own order, and one person cannot approve two steps of the same order.":
    "Hakuna anayeidhinisha oda yake mwenyewe, na mtu mmoja hawezi kuidhinisha hatua mbili za oda moja.",
  "2 steps": "Hatua 2",
  "Budget check (Finance)": "Ukaguzi wa bajeti (Fedha)",
  "from TZS 5,000,000": "kuanzia TZS 5,000,000",
  "Management": "Uongozi",
  "from TZS 20,000,000": "kuanzia TZS 20,000,000",
  "This order": "Oda hii",
  "Count every cost of an import: landed cost": "Hesabu kila gharama ya uagizaji: gharama hadi ghalani",
  "The supplier's price is not what the goods cost you. Freight, insurance, duty, clearing, port charges and transport can add 20 to 40 percent. Landed cost shares these over the items so your margins are real.":
    "Bei ya msambazaji si gharama halisi ya bidhaa kwako. Usafirishaji, bima, ushuru, uondoaji bandarini, ada za bandari na usafiri vinaweza kuongeza asilimia 20 hadi 40. Gharama hadi ghalani inagawa haya kwenye bidhaa ili faida zako ziwe halisi.",
  "Open the purchase order and go to Import costs & landed cost.":
    "Fungua oda ya ununuzi na uende kwenye Gharama za uagizaji na gharama halisi (landed cost).",
  "Press + Add a cost. Choose the Type: Freight, Insurance, Import duty, Clearing & forwarding, Port charges, Local transport, Bank charges, Commission or Other.":
    "Bonyeza + Ongeza gharama. Chagua Aina: Usafirishaji, Bima, Ushuru wa forodha, Uondoaji na usafirishaji (clearing & forwarding), Ada za bandari, Usafiri wa ndani, Makato ya benki, Kamisheni au Nyingine.",
  "Enter the Description, Amount, Currency and Exchange rate, then press Add cost. Repeat for each cost.":
    "Weka Maelezo, Kiasi, Sarafu na Kiwango cha ubadilishaji, kisha bonyeza Ongeza gharama. Rudia kwa kila gharama.",
  "The table shows the Landed / unit for each item: costs are shared over the items by value.":
    "Jedwali linaonyesha Gharama halisi / kipimo kwa kila bidhaa: gharama zinagawanywa kwenye bidhaa kulingana na thamani.",
  "Once the supplier has confirmed the order, press Use landed cost as product cost. Quotation margins and profit then use the real cost.":
    "Msambazaji akishathibitisha oda, bonyeza Tumia gharama hadi ghalani kama gharama ya bidhaa. Hivyo faida kwenye nukuu za bei na faida ya jumla zinatumia gharama halisi.",
  "When a late cost arrives, add it and press Re-apply landed cost.":
    "Gharama ikichelewa kufika, iongeze na ubonyeze Tumia upya gharama halisi ya kufikisha.",
  "open a PO": "fungua PO",
  "Procurement or Finance": "Manunuzi au Fedha",
  "Do not enter the same cost twice: if the freight is already on the purchase order, do not add it again as a cost. Do not add VAT you will claim back from TRA.":
    "Usiweke gharama moja mara mbili: kama usafirishaji tayari uko kwenye oda ya ununuzi, usiuongeze tena kama gharama. Usiongeze VAT utakayoidai tena kutoka TRA.",
  "Landed cost": "Gharama hadi ghalani",
  "Applied": "Imetumika",
  "Goods: 100 drums × USD 180": "Bidhaa: mapipa 100 × USD 180",
  "Freight USD 2,400": "Usafirishaji USD 2,400",
  "Duty, clearing, port, transport": "Ushuru, uondoaji, bandari, usafiri",
  "Total landed": "Jumla ya gharama hadi ghalani",
  "Landed / unit": "Gharama halisi / kipimo",
  "An import in USD with duty and clearing": "Uagizaji kwa USD pamoja na ushuru na uondoaji",
  "You import 100 drums of hydraulic oil from Dubai at USD 180 each (USD 18,000) at 2,600 TZS per USD. Freight is USD 2,400; duty TZS 4,680,000; clearing TZS 1,800,000; port charges TZS 900,000; transport to your store TZS 580,000.":
    "Unaagiza mapipa 100 ya mafuta ya hydraulic kutoka Dubai kwa USD 180 kila moja (USD 18,000) kwa TZS 2,600 kwa USD. Usafirishaji ni USD 2,400; ushuru TZS 4,680,000; uondoaji TZS 1,800,000; ada za bandari TZS 900,000; usafiri hadi ghala lako TZS 580,000.",
  "Make sure the USD rate is right on Exchange rates, and create the purchase order in USD with the Exchange rate of the day.":
    "Hakikisha kiwango cha USD ni sahihi kwenye Viwango vya ubadilishaji, na uunde oda ya ununuzi kwa USD na Kiwango cha ubadilishaji cha siku hiyo.",
  "When the supplier confirms, press Supplier confirmed.": "Msambazaji akithibitisha, bonyeza Msambazaji amethibitisha.",
  "Under Import costs & landed cost, add the freight as USD 2,400 at 2,600 (TZS 6,240,000), then the duty, clearing, port charges and transport in TZS, each with its invoice number in the Description.":
    "Chini ya Gharama za uagizaji na gharama halisi (landed cost), ongeza usafirishaji kama USD 2,400 kwa 2,600 (TZS 6,240,000), kisha ushuru, uondoaji, ada za bandari na usafiri kwa TZS, kila moja na namba ya ankara yake kwenye Maelezo.",
  "Read the result: goods TZS 46,800,000 plus costs TZS 14,200,000 make TZS 61,000,000, or TZS 610,000 a drum, not the TZS 468,000 the supplier's price suggests.":
    "Soma matokeo: bidhaa TZS 46,800,000 pamoja na gharama TZS 14,200,000 ni TZS 61,000,000, au TZS 610,000 kwa pipa, si TZS 468,000 kama bei ya msambazaji inavyoonyesha.",
  "Press Use landed cost as product cost. A quotation at TZS 650,000 a drum now shows a margin of about 6%, not 28%, and asks for approval if it is below your minimum margin.":
    "Bonyeza Tumia gharama hadi ghalani kama gharama ya bidhaa. Nukuu ya bei ya TZS 650,000 kwa pipa sasa inaonyesha faida ya takriban 6%, si 28%, na inaomba idhini kama iko chini ya faida yako ya chini.",

  // Chapter: receiving
  "Receive goods and pay only for what arrived": "Pokea bidhaa na ulipe kwa kilichofika tu",
  "The moment goods arrive is when mistakes are cheapest to catch. Count against the delivery note, record batches and expiry dates, and check the supplier's bill against what really came in.":
    "Wakati bidhaa zinapofika ndio wakati rahisi zaidi wa kugundua makosa. Hesabu dhidi ya hati ya uwasilishaji, rekodi makundi na tarehe za kwisha muda, na uhakiki bili ya msambazaji dhidi ya kilichoingia kweli.",
  "Receive the goods against the purchase order": "Pokea bidhaa dhidi ya oda ya ununuzi",
  "Recording what arrived puts it into stock in the right store and creates a goods received note (GRN). Partial deliveries are fine: the order remembers what is still to come.":
    "Kurekodi kilichofika kunakiingiza kwenye stoku katika ghala sahihi na kuunda hati ya bidhaa zilizopokelewa (GRN). Uwasilishaji wa sehemu ni sawa: oda inakumbuka kilichobaki kuja.",
  "Open Receive goods. It lists purchase orders waiting for delivery.": "Fungua Pokea bidhaa. Inaorodhesha oda za ununuzi zinazosubiri kuletwa.",
  "Choose the purchase order.": "Chagua oda ya ununuzi.",
  "Choose Into store, the Received on date and the Supplier's delivery note no.":
    "Chagua Kwenda ghala, tarehe ya Ilipokelewa tarehe na Namba ya hati ya uwasilishaji ya msambazaji.",
  "For each item, count and enter the Quantity received. Leave 0 for items that did not come.":
    "Kwa kila bidhaa, hesabu na uweke Kiasi kilichopokelewa. Acha 0 kwa bidhaa ambazo hazikuja.",
  "If some are damaged, choose Damaged / rejected under Condition and write a note, for example \"2 cartons wet\". Damaged items are recorded but not added to stock.":
    "Kama baadhi zimeharibika, chagua Imeharibika / imekataliwa chini ya Hali na uandike dokezo, kwa mfano \"katoni 2 zimelowa\". Bidhaa zilizoharibika zinarekodiwa lakini haziongezwi kwenye stoku.",
  "Press Record goods received.": "Bonyeza Rekodi bidhaa zilizopokelewa.",
  "Receive goods": "Pokea bidhaa",
  "Warehouse": "Ghala",
  "Never receive from the delivery note alone. Count, then type.": "Usipokee kwa kufuata hati ya uwasilishaji peke yake. Hesabu, kisha andika.",
  "Goods received note": "Hati ya bidhaa zilizopokelewa",
  "Received": "Imepokelewa",
  "Supplier's delivery note no.": "Namba ya hati ya uwasilishaji ya msambazaji",
  "150 of 150": "150 kati ya 150",
  "Into store": "Kwenda ghala",
  "Main store": "Stoo kuu",
  "The supplier sends 40 instead of 50": "Msambazaji analeta 40 badala ya 50",
  "PO-2026-0062 is for 50 cartons of nitrile gloves. The truck brings 40, and the delivery note says 50.":
    "PO-2026-0062 ni ya katoni 50 za glovu za nitrile. Lori linaleta 40, na hati ya uwasilishaji inasema 50.",
  "Count what is on the truck, not what is on the paper. Write \"40 received, not 50\" on the supplier's delivery note and have the driver sign it.":
    "Hesabu kilicho kwenye lori, si kilicho kwenye karatasi. Andika \"zimepokelewa 40, si 50\" kwenye hati ya uwasilishaji ya msambazaji na umwombe dereva asaini.",
  "On Receive goods, enter 40 under Quantity received and press Record goods received.":
    "Kwenye Pokea bidhaa, weka 40 chini ya Kiasi kilichopokelewa na ubonyeze Rekodi bidhaa zilizopokelewa.",
  "The order shows Partly received, with 10 to come.": "Oda inaonyesha Imepokelewa kiasi, na 10 bado kuja.",
  "Call the supplier: will the 10 come, and when? If they do, receive them on the same order later.":
    "Mpigie msambazaji: je, 10 zitakuja, na lini? Zikija, zipokee kwenye oda ile ile baadaye.",
  "If the supplier bills 50, the Order, receipt and bill check shows it under Billed more than received. Pay for 40 only and ask for a corrected bill.":
    "Msambazaji akitoza 50, Ukaguzi wa oda, mapokezi na ankara unaionyesha chini ya Ametoza zaidi ya kilichopokelewa. Lipa kwa 40 tu na uombe bili iliyosahihishwa.",
  "Some goods arrive damaged": "Baadhi ya bidhaa zinafika zimeharibika",
  "Of 100 pails of paint, 4 arrive dented and leaking.": "Kati ya ndoo 100 za rangi, 4 zinafika zimebonyea na zinavuja.",
  "Receive 96 as Good and 4 as Damaged / rejected, with a note and a photo sent to the supplier.":
    "Pokea 96 kama Nzuri na 4 kama Imeharibika / imekataliwa, pamoja na dokezo na picha iliyotumwa kwa msambazaji.",
  "The 4 are recorded on the GRN but not added to stock.": "Hizo 4 zinarekodiwa kwenye GRN lakini haziongezwi kwenye stoku.",
  "Agree with the supplier: a replacement or a lower bill. Pay only for the good ones.":
    "Kubaliana na msambazaji: kubadilishiwa au bili ndogo zaidi. Lipa kwa zilizo nzuri tu.",
  "Record batches and expiry dates": "Rekodi makundi na tarehe za kwisha muda",
  "For medicines, chemicals, lubricants, food and anything with a date, the batch and expiry follow the goods through the app. Deliveries and transfers take the oldest expiry first, so old stock goes out before new.":
    "Kwa dawa, kemikali, vilainishi, chakula na chochote chenye tarehe, kundi na tarehe ya kwisha muda vinafuata bidhaa ndani ya programu. Uwasilishaji na uhamisho huchukua zinazoisha muda mapema kwanza, ili stoku ya zamani itoke kabla ya mpya.",
  "When receiving, type the Batch / lot no. and the Expiry date for each item that has them.":
    "Unapopokea, andika Namba ya kundi / loti na Tarehe ya kwisha muda kwa kila bidhaa yenye vitu hivyo.",
  "On Stock, Expiring soon lists batches expiring within 60 days.":
    "Kwenye Stoku, Inakwisha muda karibuni inaorodhesha makundi yanayoisha muda ndani ya siku 60.",
  "Warehouse and management are alerted 60, 30 and 7 days before a batch expires, and again when it has expired.":
    "Ghala na uongozi wanaarifiwa siku 60, 30 na 7 kabla kundi halijaisha muda, na tena likishaisha muda.",
  "Open a product on Stock to see each batch By store and batch.": "Fungua bidhaa kwenye Stoku kuona kila kundi Kwa ghala na kundi.",
  "Ask suppliers for the longest dates they have. On the purchase order, write \"minimum 12 months shelf life on delivery\" in Notes to the supplier.":
    "Waombe wasambazaji tarehe ndefu zaidi walizonazo. Kwenye oda ya ununuzi, andika \"muda wa kukaa usiopungua miezi 12 wakati wa kuleta\" kwenye Madokezo kwa msambazaji.",
  "Batch": "Kundi",
  "Surgical gloves, box of 100": "Glovu za upasuaji, boksi la 100",
  "Expiring soon": "Inakwisha muda karibuni",
  "Expiry date": "Tarehe ya kwisha muda",
  "15 Nov 2026": "15 Nov 2026",
  "In stock": "Ipo stoku",
  "80 box": "boksi 80",
  "Goods expiring next month": "Bidhaa zinazoisha muda mwezi ujao",
  "80 boxes of surgical gloves, batch LT-24-0915, expire on 15 November. At your usual pace you sell 30 a month. They cost TZS 18,500 a box: TZS 1,480,000 at risk.":
    "Boksi 80 za glovu za upasuaji, kundi LT-24-0915, zinaisha muda tarehe 15 Novemba. Kwa kasi yako ya kawaida unauza 30 kwa mwezi. Zinagharimu TZS 18,500 kwa boksi: TZS 1,480,000 ziko hatarini.",
  "Open Stock and look at Expiring soon to see every batch at risk, not only this one.":
    "Fungua Stoku na uangalie Inakwisha muda karibuni kuona kila kundi lililo hatarini, si hili peke yake.",
  "Every delivery note takes this batch first, because it has the oldest expiry.":
    "Kila hati ya uwasilishaji inachukua kundi hili kwanza, kwa sababu ndilo linaloisha muda mapema zaidi.",
  "Call clients who buy gloves, such as Arusha Medical Stores and Dodoma District Hospital, and offer the batch at a better price for a quick order. Make the quotation as usual.":
    "Wapigie wateja wanaonunua glovu, kama Arusha Medical Stores na Hospitali ya Wilaya ya Dodoma, na uwapatie kundi hilo kwa bei nzuri kwa oda ya haraka. Andaa nukuu ya bei kama kawaida.",
  "If another store sells more gloves, move the batch there with a stock transfer.":
    "Kama ghala jingine linauza glovu zaidi, hamishia kundi hilo huko kwa uhamisho wa stoku.",
  "Stop reordering gloves until this batch is sold.": "Acha kuagiza glovu tena hadi kundi hili liuzwe.",
  "Whatever is left after the expiry date: on Adjust stock, remove it with the batch number and the reason \"Expired, batch LT-24-0915\". Never deliver expired goods.":
    "Chochote kitakachobaki baada ya tarehe ya kwisha muda: kwenye Rekebisha stoku, kiondoe pamoja na namba ya kundi na sababu \"Imeisha muda, kundi LT-24-0915\". Usiwahi kuwasilisha bidhaa zilizoisha muda.",
  "Record the supplier's bill": "Rekodi bili ya msambazaji",
  "The supplier's invoice is what you owe. Recording it shows what is due to each supplier and when, and you are alerted before each payment is due.":
    "Ankara ya msambazaji ndiyo unachodaiwa. Kuirekodi kunaonyesha unachodaiwa na kila msambazaji na lini, na unaarifiwa kabla ya kila malipo kufika tarehe yake.",
  "Open the purchase order and press Record supplier's invoice. The amounts are filled in from the purchase order: change them to match the invoice.":
    "Fungua oda ya ununuzi na ubonyeze Rekodi ankara ya msambazaji. Viasi vinajazwa kutoka kwenye oda ya ununuzi: vibadilishe vilingane na ankara.",
  "Enter the Supplier's invoice no., Invoice date and Due date, then press Save bill.":
    "Weka Namba ya ankara ya msambazaji, Tarehe ya ankara na Tarehe ya mwisho, kisha bonyeza Hifadhi bili.",
  "When you pay, open the bill, press + Record a payment to the supplier, enter the amount, the Date paid and how, and press Record payment.":
    "Unapolipa, fungua bili, bonyeza + Rekodi malipo kwa msambazaji, weka kiasi, Tarehe ya kulipa na jinsi ulivyolipa, na ubonyeze Rekodi malipo.",
  "Money we owe shows what is due to each supplier, and when.": "Madeni ya wasambazaji inaonyesha unachodaiwa na kila msambazaji, na lini.",
  "Finance": "Fedha",
  "Supplier bills": "Bili za wasambazaji",
  "Supplier bill": "Bili ya msambazaji",
  "Unpaid": "Haijalipwa",
  "Supplier's invoice no.": "Namba ya ankara ya msambazaji",
  "Bill total": "Jumla ya bili",
  "Due date": "Tarehe ya mwisho",
  "14 Nov 2026": "14 Nov 2026",
  "Check order, receipt and bill before you pay": "Hakiki oda, mapokezi na bili kabla ya kulipa",
  "For each purchase order, the check compares what was ordered, what arrived and what the supplier billed. Pay only for what arrived.":
    "Kwa kila oda ya ununuzi, ukaguzi unalinganisha kilichoagizwa, kilichofika na alichotoza msambazaji. Lipa kwa kilichofika tu.",
  "Open Order, receipt and bill check.": "Fungua Ukaguzi wa oda, mapokezi na ankara.",
  "Under Billed more than received, check each order with the supplier before paying.":
    "Chini ya Ametoza zaidi ya kilichopokelewa, hakiki kila oda na msambazaji kabla ya kulipa.",
  "Under Received, not billed, ask the supplier for the bill so what you owe is complete.":
    "Chini ya Imepokelewa, haijatozwa, mwombe msambazaji bili ili unachodaiwa kiwe kamili.",
  "Matches are orders where the bill and the goods received agree.": "Inalingana ni oda ambazo bili na bidhaa zilizopokelewa zinakubaliana.",
  "Order, receipt and bill check": "Ukaguzi wa oda, mapokezi na ankara",
  "Finance and Procurement": "Fedha na Manunuzi",
  "Make this check a rule: no supplier payment until the order is under Matches, or the difference is agreed in writing.":
    "Fanya ukaguzi huu kuwa kanuni: hakuna malipo kwa msambazaji hadi oda iwe chini ya Inalingana, au tofauti ikubaliwe kwa maandishi.",
  "Billed more than received": "Ametoza zaidi ya kilichopokelewa",
  "ordered": "imeagizwa",
  "50 cartons": "katoni 50",
  "received": "imepokelewa",
  "40 cartons": "katoni 40",
  "billed": "imetozwa",
  "50 cartons, TZS 5,900,000": "katoni 50, TZS 5,900,000",
  "Pay": "Lipa",
  "40 cartons, TZS 4,720,000": "katoni 40, TZS 4,720,000",

  // Chapter: control
  "Keep the stock figures true": "Weka takwimu za stoku zikiwa za kweli",
  "Stock in the app is only useful if it matches the shelves. Count regularly, explain every difference, and move goods between stores in the app, not just on the truck.":
    "Stoku ndani ya programu inafaa tu ikilingana na rafu. Hesabu mara kwa mara, eleza kila tofauti, na hamisha bidhaa kati ya maghala ndani ya programu, si kwenye lori tu.",
  "See what you have, where": "Ona ulicho nacho, na kiko wapi",
  "Stock shows each store as a card. Inside, every item has a gauge against its reorder level: red means reorder now, amber is getting low, green is fine.":
    "Stoku inaonyesha kila ghala kama kadi. Ndani, kila bidhaa ina kipimo dhidi ya kiwango chake cha kuagiza tena: nyekundu ni agiza sasa, njano inapungua, kijani iko sawa.",
  "Open Stock. Tap a store to see its items, or search for a product or SKU.":
    "Fungua Stoku. Bonyeza ghala kuona bidhaa zake, au tafuta bidhaa au SKU.",
  "Reorder at the top lists what is at or below its reorder level. Expiring soon lists batches expiring within 60 days.":
    "Agiza tena juu inaorodhesha kilicho kwenye au chini ya kiwango chake cha kuagiza tena. Inakwisha muda karibuni inaorodhesha makundi yanayoisha muda ndani ya siku 60.",
  "Tap a product to see its stock By store and batch and every Movement: goods received, deliveries, transfers and adjustments.":
    "Bonyeza bidhaa kuona stoku yake Kwa ghala na kundi na kila Mwenendo: bidhaa zilizopokelewa, uwasilishaji, uhamisho na marekebisho.",
  "For a list to print or download, open Reports and choose Stock on hand or Stock movements.":
    "Kwa orodha ya kuchapisha au kupakua, fungua Ripoti na uchague Stoku iliyopo au Mienendo ya stoku.",
  "Everyone except drivers": "Kila mtu isipokuwa madereva",
  "Reorder": "Agiza tena",
  "112 box · green": "boksi 112 · kijani",
  "9 pcs · amber": "vipande 9 · njano",
  "35 box · red": "boksi 35 · nyekundu",
  "Count the stock and correct the differences": "Hesabu stoku na usahihishe tofauti",
  "Shelves and records drift apart: breakages, mistakes, theft. A regular count finds the difference early, while you can still find out why. Every adjustment is recorded with the name of the person and the reason.":
    "Rafu na kumbukumbu hutofautiana kadiri muda unavyopita: kuvunjika, makosa, wizi. Hesabu ya mara kwa mara inagundua tofauti mapema, wakati bado unaweza kujua kwa nini. Kila marekebisho yanarekodiwa pamoja na jina la mtu na sababu.",
  "Open Reports, choose Stock on hand, filter by store and press Show report. Press Print and use it as your count sheet.":
    "Fungua Ripoti, chagua Stoku iliyopo, chuja kwa ghala na ubonyeze Onyesha ripoti. Bonyeza Chapisha na uitumie kama karatasi ya kuhesabia.",
  "Count without looking at the app figure. Write what you find.": "Hesabu bila kuangalia kiasi kilicho kwenye programu. Andika unachokikuta.",
  "For each difference, first look for a reason: open the product on Stock and read its Movements.":
    "Kwa kila tofauti, kwanza tafuta sababu: fungua bidhaa kwenye Stoku na usome Mienendo yake.",
  "Open Stock and press Adjust stock. Choose the Product, the Store, Add to stock (+) or Remove from stock (−), the Quantity and the Batch no. if it has batches.":
    "Fungua Stoku na ubonyeze Rekebisha stoku. Chagua Bidhaa, Ghala, Ongeza kwenye stoku (+) au Ondoa kwenye stoku (−), Kiasi na Namba ya kundi kama ina makundi.",
  "Write a clear Reason, for example \"Count 30 Sep: 7 missing\", and press Save adjustment.":
    "Andika Sababu iliyo wazi, kwa mfano \"Hesabu 30 Sep: 7 hazipo\", na ubonyeze Hifadhi marekebisho.",
  "Warehouse and Management": "Ghala na Uongozi",
  "Count fast-moving and expensive items every month, everything else at least twice a year.":
    "Hesabu bidhaa zinazotoka haraka na za bei ghali kila mwezi, nyingine zote angalau mara mbili kwa mwaka.",
  "Stock adjustment": "Marekebisho ya stoku",
  "Recorded": "Imerekodiwa",
  "In the app": "Kwenye programu",
  "Counted": "Iliyohesabiwa",
  "113 box": "boksi 113",
  "Remove from stock (−)": "Ondoa kwenye stoku (−)",
  "Reason": "Sababu",
  "Count 30 Sep: 7 missing": "Hesabu 30 Sep: 7 hazipo",
  "The count shows 7 boxes missing": "Hesabu inaonyesha boksi 7 hazipo",
  "The app says 120 boxes of A4 paper in the main store; the count finds 113. At TZS 48,000 a box, TZS 336,000 is missing.":
    "Programu inasema boksi 120 za karatasi A4 ziko kwenye stoo kuu; hesabu inakuta 113. Kwa TZS 48,000 kwa boksi, TZS 336,000 hazipo.",
  "Count again with a second person before you change anything.": "Hesabu tena pamoja na mtu wa pili kabla ya kubadilisha chochote.",
  "Open the product on Stock and read the Movements since the last count. Look for a delivery made without a delivery note, a transfer still on the way, or goods received into the wrong store.":
    "Fungua bidhaa kwenye Stoku na usome Mienendo tangu hesabu iliyopita. Tafuta uwasilishaji uliofanyika bila hati ya uwasilishaji, uhamisho ambao bado uko njiani, au bidhaa zilizopokelewa kwenye ghala lisilo sahihi.",
  "Check the other stores: if 7 boxes sit in the Mwanza store by mistake, move them with a stock transfer instead of adjusting.":
    "Angalia maghala mengine: kama boksi 7 ziko kwenye ghala la Mwanza kwa makosa, zihamishe kwa uhamisho wa stoku badala ya kurekebisha.",
  "Check delivery notes that are not dispatched yet: goods may have left the store before the note was dispatched in the app.":
    "Angalia hati za uwasilishaji ambazo bado hazijatolewa: huenda bidhaa ziliondoka stoo kabla hati haijatolewa ndani ya programu.",
  "If you cannot find them, press Adjust stock, choose Remove from stock (−), enter 7 with the reason \"Count 30 Sep: 7 missing, not found\" and press Save adjustment.":
    "Usipozipata, bonyeza Rekebisha stoku, chagua Ondoa kwenye stoku (−), weka 7 kwa sababu \"Hesabu 30 Sep: 7 hazipo, hazijapatikana\" na ubonyeze Hifadhi marekebisho.",
  "Management can see in the Activity log who changed what and when. If it keeps happening, count this product every week and limit who can take goods out.":
    "Uongozi unaweza kuona kwenye Kumbukumbu ya shughuli nani alibadilisha nini na lini. Ikiendelea kutokea, hesabu bidhaa hii kila wiki na upunguze watu wanaoweza kutoa bidhaa.",
  "Goods are damaged in the store": "Bidhaa zimeharibika stoo",
  "A leaking roof spoils 12 bags of cement in the Dodoma store.": "Paa linalovuja linaharibu mifuko 12 ya saruji kwenye ghala la Dodoma.",
  "Take photos for your records or your insurer.": "Piga picha kwa ajili ya kumbukumbu zako au kampuni yako ya bima.",
  "On Adjust stock, choose the Dodoma store, Remove from stock (−), 12, with the reason \"Damaged by roof leak, photos taken\".":
    "Kwenye Rekebisha stoku, chagua ghala la Dodoma, Ondoa kwenye stoku (−), 12, kwa sababu \"Imeharibiwa na paa linalovuja, picha zimepigwa\".",
  "Press Save adjustment. The stock goes down, and the reason stays on record.":
    "Bonyeza Hifadhi marekebisho. Stoku inapungua, na sababu inabaki kwenye kumbukumbu.",
  "Move stock between stores": "Hamisha stoku kati ya maghala",
  "When goods move from one store to another, record it in the app the same day. Batches and expiry dates go with the goods, and while they are on the road they show as on the way.":
    "Bidhaa zinapohama kutoka ghala moja kwenda jingine, rekodi ndani ya programu siku hiyo hiyo. Makundi na tarehe za kwisha muda vinaenda pamoja na bidhaa, na zikiwa barabarani zinaonekana kuwa njiani.",
  "Open Stock transfers and press + Transfer.": "Fungua Uhamisho wa stoku na ubonyeze + Uhamisho.",
  "Choose the From store and To store, write Why and the Vehicle or driver, then press Next: add items.":
    "Chagua Kutoka ghala na Kwenda stoo, andika Kwa nini na Gari au dereva, kisha bonyeza Ifuatayo: ongeza bidhaa.",
  "Add each item and quantity. The page shows how much the first store has.":
    "Ongeza kila bidhaa na kiasi. Ukurasa unaonyesha ghala la kwanza lina kiasi gani.",
  "Press Send now. The stock leaves the first store, oldest expiry first.":
    "Bonyeza Tuma sasa. Stoku inatoka kwenye ghala la kwanza, zinazoisha muda mapema kwanza.",
  "When the goods arrive, the receiving store opens the transfer, writes a Note on arrival and presses Mark as received.":
    "Bidhaa zikifika, ghala linalopokea linafungua uhamisho, linaandika Maelezo ya kufika na kubonyeza Weka kama imepokelewa.",
  "To stop a transfer on the way, press Cancel and return the stock.": "Kusimamisha uhamisho ulio njiani, bonyeza Ghairi na rudisha stoo.",
  "Stock transfers": "Uhamisho wa stoku",
  "Only management and warehouse staff can send and receive transfers.": "Ni uongozi na wafanyakazi wa ghala tu wanaoweza kutuma na kupokea uhamisho.",
  "Stock transfer": "Uhamisho wa stoo",
  "Sent": "Imetumwa",
  "From store": "Kutoka ghala",
  "Dar es Salaam": "Dar es Salaam",
  "To store": "Kwenda stoo",
  "40 box": "boksi 40",
  "Vehicle or driver": "Gari au dereva",
  "Fewer goods arrive than were sent": "Bidhaa zinazofika ni chache kuliko zilizotumwa",
  "Dar es Salaam sent 40 boxes to Mwanza. Mwanza counts 38.": "Dar es Salaam imetuma boksi 40 kwenda Mwanza. Mwanza inahesabu 38.",
  "Write it in the Note on arrival, for example \"38 arrived, 2 missing\", and press Mark as received.":
    "Andika kwenye Maelezo ya kufika, kwa mfano \"zimefika 38, 2 hazipo\", na ubonyeze Weka kama imepokelewa.",
  "Ask the driver and the sending store at once, while memories are fresh.": "Muulize dereva na ghala lililotuma mara moja, wakati bado wanakumbuka.",
  "If the 2 boxes are not found, the Mwanza store removes them on Adjust stock with the reason \"Transfer TR-2026-0015: 2 missing on arrival\".":
    "Boksi 2 zisipopatikana, ghala la Mwanza linaziondoa kwenye Rekebisha stoku kwa sababu \"Uhamisho TR-2026-0015: 2 hazikufika\".",
  "Keep your vehicles on the road": "Weka magari yako barabarani",
  "If you deliver with your own trucks, a truck off the road means stock that cannot reach clients. The app reminds you of insurance, inspection and services, and keeps a log of fuel and repairs.":
    "Kama unawasilisha kwa malori yako mwenyewe, lori lililo nje ya barabara linamaanisha stoku isiyoweza kuwafikia wateja. Programu inakukumbusha bima, ukaguzi na huduma, na inaweka kumbukumbu ya mafuta na matengenezo.",
  "Open Vehicles and press + Vehicle. Enter the plate, the usual driver and the insurance, inspection and service dates, then press Add vehicle.":
    "Fungua Magari na ubonyeze + Gari. Weka namba ya usajili, dereva wa kawaida na tarehe za bima, ukaguzi na huduma, kisha bonyeza Ongeza gari.",
  "Open a vehicle and use Add to the log for fuel, a service or a repair, with the Kilometres reading and the Amount paid. Press Save in the log.":
    "Fungua gari na utumie Ongeza kwenye kumbukumbu kwa mafuta, huduma au matengenezo, pamoja na Kipimo cha kilomita na Kiasi kilicholipwa. Bonyeza Hifadhi kwenye kumbukumbu.",
  "You are reminded before the insurance, the inspection or a service is due.":
    "Unakumbushwa kabla ya bima, ukaguzi au huduma kufika tarehe yake.",
  "When making a delivery note, choose the vehicle from the list of plates. Its page then shows the Deliveries with this vehicle.":
    "Unapoandaa hati ya uwasilishaji, chagua gari kutoka kwenye orodha ya namba za usajili. Ukurasa wake kisha unaonyesha Usafirishaji kwa gari hili.",
  "Deliveries": "Uwasilishaji",
  "Vehicles": "Magari",
  "Management and Warehouse": "Uongozi na Ghala",
  "Vehicle": "Gari",
  "All in order": "Yote yako sawa",
  "Insurance": "Bima",
  "due 30 Nov 2026": "inatakiwa 30 Nov 2026",
  "Next service": "Huduma ijayo",
  "at 128,000 km": "kwenye km 128,000",
  "Fuel and repairs this month": "Mafuta na matengenezo mwezi huu",

  // Chapter: planning
  "Never run out, never overstock": "Usiishiwe kamwe, usijaze stoku kupita kiasi",
  "Running out loses sales and clients. Overstocking ties up cash that could pay suppliers and salaries. Reorder levels, purchase planning and the slow-moving list keep you between the two.":
    "Kuishiwa kunapoteza mauzo na wateja. Kujaza stoku kupita kiasi kunafungia pesa ambazo zingeweza kulipa wasambazaji na mishahara. Viwango vya kuagiza tena, mipango ya ununuzi na orodha ya stoku isiyotoka vinakuweka katikati ya hayo mawili.",
  "Order what is running low": "Agiza kinachokaribia kuisha",
  "What to reorder lists every product at or below its reorder level, grouped by the supplier you last bought it from, with a suggested quantity. The suggestion fills up to the maximum stock level (or twice the reorder level), less what is already ordered or requested.":
    "Cha kuagiza tena inaorodhesha kila bidhaa iliyo kwenye au chini ya kiwango chake cha kuagiza tena, ikiwa imepangwa kwa msambazaji uliyemnunulia mara ya mwisho, pamoja na kiasi kinachopendekezwa. Pendekezo linajaza hadi kiwango cha juu cha stoo (au mara mbili ya kiwango cha kuagiza tena), ukiondoa kilichokwisha agizwa au kuombwa.",
  "Set a Reorder level and a Maximum stock level on each product you keep in stock.":
    "Weka Kiwango cha kuagiza tena na Kiwango cha juu cha stoo kwa kila bidhaa unayoiweka stoku.",
  "Open What to reorder.": "Fungua Cha kuagiza tena.",
  "Change the quantities if needed and untick what you do not want.": "Badilisha viasi ikihitajika na uondoe alama kwa usichokitaka.",
  "Press Create draft PO to order from that supplier, or Make a purchase request to ask for approval first.":
    "Bonyeza Unda rasimu ya PO kuagiza kwa msambazaji huyo, au Andaa ombi la ununuzi kuomba idhini kwanza.",
  "What to reorder": "Cha kuagiza tena",
  "Procurement or Warehouse": "Manunuzi au Ghala",
  "A good reorder level is what you sell during the supplier's lead time, plus a little extra. If you sell 4 boxes a day and the supplier takes 10 days, reorder at about 50.":
    "Kiwango kizuri cha kuagiza tena ni unachouza katika muda wa kusubiri wa msambazaji, pamoja na ziada kidogo. Ukiuza boksi 4 kwa siku na msambazaji anachukua siku 10, agiza tena ukifika takriban 50.",
  "Draft PO": "Rasimu ya PO",
  "35 in stock · reorder at 60": "35 ipo stoku · agiza tena kwenye 60",
  "on order": "imeagizwa",
  "Quantity": "Kiasi",
  "Plan purchases from what really sells": "Panga manunuzi kutokana na kinachouzika kweli",
  "Purchase planning looks at what you dispatched, works out sales per day and how many days your stock lasts, and tells you what to order now, given the supplier's lead time plus a week of safety stock.":
    "Mipango ya ununuzi inaangalia ulichotoa, inakokotoa mauzo kwa siku na stoku yako inadumu siku ngapi, na inakuambia cha kuagiza sasa, kwa kuzingatia muda wa kusubiri wa msambazaji pamoja na wiki moja ya stoku ya akiba.",
  "Set each supplier's Lead time (days) on the supplier page. Without it, two weeks is used.":
    "Weka Muda wa kusubiri (siku) wa kila msambazaji kwenye ukurasa wa msambazaji. Bila hiyo, wiki mbili zinatumika.",
  "Open Purchase planning. It is based on the last 90 days, or the period you choose.":
    "Fungua Mipango ya ununuzi. Inategemea siku 90 zilizopita, au kipindi unachochagua.",
  "Products marked Order now will run out before a new order can arrive.":
    "Bidhaa zilizowekwa Agiza sasa zitaisha kabla oda mpya haijafika.",
  "Check the quantities: they cover a month after the goods arrive. Press Create draft PO or Make a purchase request.":
    "Hakiki viasi: vinatosha mwezi mmoja baada ya bidhaa kufika. Bonyeza Unda rasimu ya PO au Andaa ombi la ununuzi.",
  "Or press Set as reorder levels to use the suggestions as the products' minimum and maximum levels.":
    "Au bonyeza Weka kama viwango vya kuagiza tena kutumia mapendekezo kama viwango vya chini na vya juu vya bidhaa.",
  "Purchase planning": "Mipango ya ununuzi",
  "Procurement and Management": "Manunuzi na Uongozi",
  "Planning starts once goods go out on delivery notes. The more you dispatch through the app, the better the suggestions.":
    "Mipango huanza bidhaa zinapoanza kutoka kwa hati za uwasilishaji. Kadiri unavyotoa zaidi kupitia programu, ndivyo mapendekezo yanavyokuwa bora.",
  "Order now": "Agiza sasa",
  "Sales per day": "Mauzo kwa siku",
  "1.5 pcs": "vipande 1.5",
  "in stock": "ipo stoku",
  "9 pcs": "vipande 9",
  "days of stock": "siku za stoku",
  "6 days": "siku 6",
  "lead time": "muda wa kusubiri",
  "14 days": "siku 14",
  "66 pcs": "vipande 66",
  "A best-seller is about to run out": "Bidhaa inayouzika zaidi inakaribia kuisha",
  "Toner HP 85A sells 1.5 a day. You have 9 left, about 6 days, and the supplier needs 14 days. Kilimanjaro Hotels alone orders 10 a month.":
    "Tona HP 85A inauzika 1.5 kwa siku. Zimebaki 9, takriban siku 6, na msambazaji anahitaji siku 14. Kilimanjaro Hotels peke yao huagiza 10 kwa mwezi.",
  "Order today: on Purchase planning or What to reorder, press Create draft PO and submit it.":
    "Agiza leo: kwenye Mipango ya ununuzi au Cha kuagiza tena, bonyeza Unda rasimu ya PO na uiwasilishe.",
  "Ask the supplier for part of the order by express, even at a higher price, to cover the 8 days you will be without stock.":
    "Mwombe msambazaji sehemu ya oda kwa usafiri wa haraka, hata kwa bei kubwa zaidi, kufidia siku 8 utakazokuwa bila stoku.",
  "Look at other stores on Stock. If Mwanza has 12, move 6 to Dar es Salaam with a stock transfer.":
    "Angalia maghala mengine kwenye Stoku. Kama Mwanza ina 12, hamisha 6 kwenda Dar es Salaam kwa uhamisho wa stoku.",
  "Tell your big clients the date the new stock arrives, so they wait for you instead of buying elsewhere.":
    "Waambie wateja wako wakubwa tarehe stoku mpya itakapofika, ili wakusubiri badala ya kununua kwingine.",
  "When orders come in that you cannot fill yet, Still to deliver shows them, so nothing is forgotten when the stock arrives.":
    "Oda zinapokuja ambazo bado huwezi kuzitimiza, Bado kupeleka inazionyesha, ili hakuna kinachosahaulika stoku ikifika.",
  "After the order, press Set as reorder levels so this product is ordered in time from now on.":
    "Baada ya oda, bonyeza Weka kama viwango vya kuagiza tena ili bidhaa hii iagizwe kwa wakati kuanzia sasa.",
  "Free the cash stuck in slow-moving stock": "Toa pesa zilizokwama kwenye stoku isiyotoka",
  "Slow-moving stock lists products in stock with nothing dispatched in 90 days, with their value at last cost. That is money sitting on a shelf, losing value and taking space.":
    "Stoo isiyotoka inaorodhesha bidhaa zilizo stoku ambazo hakuna kilichotolewa kwa siku 90, pamoja na thamani yake kwa gharama ya mwisho. Hizo ni pesa zilizokaa kwenye rafu, zikipoteza thamani na kuchukua nafasi.",
  "Open Business insights and go to Slow-moving stock.": "Fungua Maarifa ya biashara na uende kwenye Stoo isiyotoka.",
  "Sort out the list with the team: what can be sold, moved, returned or written off?":
    "Pitieni orodha pamoja na timu: kipi kinaweza kuuzwa, kuhamishwa, kurudishwa au kufutwa?",
  "Look at Often bought together on the same page to see what to offer alongside each product.":
    "Angalia Hununuliwa pamoja mara nyingi kwenye ukurasa huo huo kuona cha kupendekeza pamoja na kila bidhaa.",
  "Lower the Reorder level and Maximum stock level of slow products, or set them to 0, so they are not reordered by habit.":
    "Punguza Kiwango cha kuagiza tena na Kiwango cha juu cha stoo kwa bidhaa zisizotoka, au viweke 0, ili zisiagizwe tena kwa mazoea.",
  "Reports": "Ripoti",
  "Business insights": "Maarifa ya biashara",
  "Turn stock into a monthly habit: one meeting, one list, three decisions.":
    "Fanya stoku kuwa tabia ya kila mwezi: kikao kimoja, orodha moja, maamuzi matatu.",
  "Slow-moving stock": "Stoo isiyotoka",
  "In stock, but nothing dispatched in 90 days": "Iko stoku, lakini hakuna kilichotolewa kwa siku 90",
  "Act": "Chukua hatua",
  "Gear oil 85W-140, drum": "Mafuta ya gia 85W-140, pipa",
  "Safety boots, size 46": "Buti za usalama, saizi 46",
  "Fax rolls": "Karatasi za faksi",
  "Total at last cost": "Jumla kwa gharama ya mwisho",
  "Too much money tied up in stock": "Pesa nyingi mno zimefungwa kwenye stoku",
  "You have TZS 85,000,000 in stock, and a supplier needs TZS 20,000,000 next month. TZS 10,810,000 of the stock has not moved in 90 days.":
    "Una TZS 85,000,000 kwenye stoku, na msambazaji anahitaji TZS 20,000,000 mwezi ujao. TZS 10,810,000 za stoku hazijatoka kwa siku 90.",
  "Open Business insights and list the slow-moving products with their value.":
    "Fungua Maarifa ya biashara na uorodheshe bidhaa zisizotoka pamoja na thamani yake.",
  "Offer them to clients who bought them before, at a fair discount. Even selling at cost turns shelves back into cash.":
    "Wapatie wateja waliowahi kuzinunua, kwa punguzo la haki. Hata kuuza kwa bei ya gharama kunageuza rafu kuwa pesa tena.",
  "Move slow items to the store where they sell, with a stock transfer.": "Hamisha bidhaa zisizotoka kwenda ghala ambako zinauzika, kwa uhamisho wa stoku.",
  "Ask the supplier if they take back unopened goods for credit. If they do, remove the goods on Adjust stock with the reason \"Returned to supplier\" and agree the credit in writing; the app has no supplier returns.":
    "Muulize msambazaji kama anapokea tena bidhaa ambazo hazijafunguliwa kwa salio. Akikubali, ondoa bidhaa kwenye Rekebisha stoku kwa sababu \"Imerudishwa kwa msambazaji\" na mkubaliane salio kwa maandishi; programu haina sehemu ya kurudisha bidhaa kwa msambazaji.",
  "On Purchase planning, press Set as reorder levels so future orders follow what really sells.":
    "Kwenye Mipango ya ununuzi, bonyeza Weka kama viwango vya kuagiza tena ili oda za baadaye zifuate kinachouzika kweli.",
  "Before any big purchase order, ask: how many days of stock will this give us? More than 60 days of a normal item is usually too much.":
    "Kabla ya oda yoyote kubwa ya ununuzi, uliza: hii itatupa stoku ya siku ngapi? Zaidi ya siku 60 kwa bidhaa ya kawaida mara nyingi ni nyingi mno.",
};
