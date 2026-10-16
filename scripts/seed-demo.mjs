// Fills an empty workbench with demo data through the API, so every business
// rule (QC auto-select, price changes, case links) runs as it would for a user.
// Usage: node scripts/seed-demo.mjs [http://127.0.0.1:5174]   (API must run with AUTH_MODE=dev)

const BASE = process.argv[2] ?? "http://127.0.0.1:5174";
let cookie = "";
let csrf = "";

async function login() {
  const response = await fetch(`${BASE}/api/auth/login`, { redirect: "manual" });
  cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const me = await (await fetch(`${BASE}/api/auth/me`, { headers: { cookie } })).json();
  if (!me.csrfToken) throw new Error(`Sign-in failed: ${JSON.stringify(me)}`);
  csrf = me.csrfToken;
  console.log(`Signed in as ${me.email}`);
}

async function api(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${text}\nBody: ${JSON.stringify(body)}`);
  return text ? JSON.parse(text) : undefined;
}

function pdfBase64(lines) {
  const escape = (line) => line.replace(/[()\\]/g, "\\$&");
  const content = lines
    .map((line, index) => `BT /F1 ${index === 0 ? 20 : 12} Tf 72 ${720 - index * 26} Td (${escape(line)}) Tj ET`)
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(out));
    out += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out).toString("base64");
}

const upload = (fileName, purpose, lines) =>
  api("POST", "/api/files", { fileName, mimeType: "application/pdf", contentBase64: pdfBase64(lines), purpose });

const active = { recordState: "Active" };

async function main() {
  await login();
  const existing = await api("GET", "/api/bootstrap");
  if (existing.suppliers.length > 0 || existing.items.length > 0) {
    throw new Error("The database already has suppliers or items. Seed only an empty database.");
  }

  // ---- Models
  const bta = await api("POST", "/api/models", { ...active, name: "BTA", productFamily: "Solar Module", status: "Active", notes: "Bifacial 610W module, 36 pcs per pallet" });
  const btc = await api("POST", "/api/models", { ...active, name: "BTC", productFamily: "Solar Module", status: "Active", notes: "Monofacial 450W module, 31 pcs per pallet" });

  // ---- Items
  const itemDefs = [
    ["PCP-BTA-01", "Paper corner protector 50x50x1200", "Paper Corner Protector", [bta.id]],
    ["LPP-BTA-01", "Long paper protector 2380mm", "Long Paper Protector", [bta.id]],
    ["SPP-BTA-01", "Short paper protector 1134mm", "Short Paper Protector", [bta.id]],
    ["UC-BTA-01", "Upper cover, 5-ply corrugated", "Upper Cover", [bta.id]],
    ["PLT-BTA-01", "Wood pallet 2400x1150, ISPM-15", "Pallet", [bta.id]],
    ["PCP-BTC-01", "Paper corner protector 50x50x1000", "Paper Corner Protector", [btc.id]],
    ["UC-BTC-01", "Upper cover, 3-ply corrugated", "Upper Cover", [btc.id]],
    ["PP-BTC-01", "Paper plate 1760x1100", "Paper Plate", [btc.id]],
    ["PLT-BTC-01", "Wood pallet 1800x1150, ISPM-15", "Pallet", [btc.id]],
    ["STR-001", "PET strapping 16mm, 1000m roll", "Strapping", [bta.id, btc.id]],
    ["SF-001", "Stretch film 500mm x 23um", "Stretch Film", [bta.id, btc.id]],
  ];
  const item = {};
  for (const [itemCode, itemName, type, usedForModels] of itemDefs) {
    item[itemCode] = await api("POST", "/api/items", { ...active, itemCode, itemName, type, usedForModels, uom: type === "Stretch Film" || type === "Strapping" ? "pcs" : "pcs", status: "Active" });
  }

  // ---- Suppliers (W-9 / payment info uploaded as files)
  async function supplier(body, docs) {
    const w9 = docs.w9 ? await upload(`W9-${body.name.split(" ")[0]}.pdf`, "Supplier W9", ["Form W-9 (demo)", body.name, "Taxpayer ID: on file"]) : undefined;
    const pay = docs.pay ? await upload(`Payment-${body.name.split(" ")[0]}.pdf`, "Supplier Payment Info", ["Payment information (demo)", body.name, "ACH remittance details on file"]) : undefined;
    return api("POST", "/api/suppliers", {
      ...active,
      country: "United States",
      type: "Manufacturer",
      status: "Active",
      ...body,
      hasW9: Boolean(w9),
      w9FileId: w9?.id,
      hasPaymentInfo: Boolean(pay),
      paymentInfoFileId: pay?.id,
    });
  }
  const midwest = await supplier({ name: "Midwest Paper Packaging Co.", erpVendorId: "V10023", region: "Ohio", capableItems: ["Paper Corner Protector", "Long Paper Protector", "Short Paper Protector", "Upper Cover", "Paper Plate"], primaryContact: "Laura Chen", email: "laura.chen@midwestpaper.example", phone: "614-555-0142", paymentTerms: "Net 45", supplierSince: "2023-03-01", status: "Approved", notes: "Incumbent for paper packaging on all models." }, { w9: true, pay: true });
  const lonestar = await supplier({ name: "Lone Star Pallet Inc.", erpVendorId: "V10031", region: "Texas", capableItems: ["Pallet"], primaryContact: "Mike Alvarez", email: "mike@lonestarpallet.example", phone: "512-555-0187", paymentTerms: "Net 30", supplierSince: "2022-08-15", status: "Approved", notes: "Heat-treated pallets, ISPM-15 certified." }, { w9: true, pay: true });
  const pacific = await supplier({ name: "Pacific Strapping & Film", erpVendorId: "V10047", type: "Distributor", region: "California", capableItems: ["Strapping", "Stretch Film"], primaryContact: "Kevin Park", email: "kpark@pacificsf.example", phone: "909-555-0110", paymentTerms: "Net 30", supplierSince: "2024-01-10", status: "Approved" }, { w9: true, pay: true });
  const greatlakes = await supplier({ name: "Great Lakes Corrugated", erpVendorId: "V10058", region: "Michigan", capableItems: ["Paper Corner Protector", "Long Paper Protector", "Short Paper Protector", "Upper Cover", "Paper Plate"], primaryContact: "Sarah Johnson", email: "sjohnson@glcorrugated.example", phone: "616-555-0133", paymentTerms: "Net 60", status: "Sample Stage", notes: "New supplier introduced in the 2026 BTA case. Payment info pending." }, { w9: true, pay: false });
  const southern = await supplier({ name: "Southern Box & Pallet", region: "Georgia", capableItems: ["Pallet", "Upper Cover"], primaryContact: "Derek Mills", email: "dmills@southernbox.example", phone: "770-555-0199", paymentTerms: "Net 15", status: "Sample Stage", notes: "Low pallet price; upper cover samples failed twice." }, { w9: false, pay: false });

  // ---- Packaging sets (drawing packages)
  const btaV1File = await upload("BTA-Packaging-Rev1.pdf", "Drawing", ["BTA packaging drawing package", "Revision 1.0 - effective 2025-10-01", "Corner protector 50x50x1200, pallet 2400x1150"]);
  const btcV1File = await upload("BTC-Packaging-Rev1.pdf", "Drawing", ["BTC packaging drawing package", "Revision 1.0 - effective 2026-02-01"]);
  const drawingSet = (modelId, name, effectiveDate, file, replaceActive = false) =>
    api("POST", "/api/drawing-sets", { ...active, modelId, name, revision: "auto", status: "Active", effectiveDate, maintainedBy: "Process Engineering", packageFileId: file.id, packageFileName: file.fileName, drawingItems: [], replaceActive });
  await drawingSet(bta.id, "BTA packaging set", "2025-10-01", btaV1File);
  await drawingSet(btc.id, "BTC packaging set", "2026-02-01", btcV1File);

  async function activeSet(modelId) {
    const sets = await api("GET", "/api/drawing-sets");
    return sets.find((set) => set.modelId === modelId && set.status === "Active" && set.recordState !== "Void");
  }

  async function quote(set, sup, code, fields) {
    const drawingItem = set.drawingItems.find((candidate) => candidate.itemId === item[code].id);
    if (!drawingItem) throw new Error(`${code} is not in ${set.name}`);
    return api("POST", "/api/quotes", {
      supplierId: sup.id,
      quoteType: fields.projectId ? "Case-linked" : "Standalone",
      quoteReason: "New Quote",
      modelId: set.modelId,
      itemId: item[code].id,
      drawingSetId: set.id,
      drawingItemId: drawingItem.id,
      currency: "USD",
      uom: "pcs",
      extraCostType: "None",
      extraCostAmount: 0,
      status: "Received",
      notes: "",
      ...fields,
    });
  }

  async function inspect(set, q, fields) {
    const drawingItem = set.drawingItems.find((candidate) => candidate.itemId === q.itemId);
    return api("POST", "/api/inspections", {
      supplierId: q.supplierId,
      projectId: q.projectId,
      relatedQuoteId: q.id,
      modelId: q.modelId,
      drawingSetId: set.id,
      itemId: q.itemId,
      drawingItemId: drawingItem.id,
      sampleRound: 1,
      inspector: "J. Rivera (QC)",
      result: "Pass",
      disposition: "Accepted",
      problemPhotos: 0,
      photoFileIds: [],
      notes: "",
      ...fields,
    });
  }

  // A quote that goes through a passed sample, the normal way to become Selected.
  async function qualified(set, sup, code, price, dates, extra = {}) {
    const q = await quote(set, sup, code, { quoteDate: dates.quote, effectiveFrom: dates.effective, unitPrice: price, status: "Sample Requested", ...extra });
    await inspect(set, q, { sampleReceivedDate: dates.sample, inspectionDate: dates.inspected, signedDate: dates.inspected, notes: dates.notes ?? "Dimensions and burst strength within drawing tolerance." });
    return q;
  }

  // ---- BTA, revision 1.0 era (late 2025): incumbents qualified by sample
  let btaSet = await activeSet(bta.id);
  const d2025 = { quote: "2025-10-06", sample: "2025-10-20", inspected: "2025-10-23", effective: "2025-11-01" };
  const mwPcp = await qualified(btaSet, midwest, "PCP-BTA-01", 0.42, d2025, { moq: "5,000 pcs", leadTime: "10 days" });
  const mwLpp = await qualified(btaSet, midwest, "LPP-BTA-01", 0.86, d2025, { moq: "3,000 pcs", leadTime: "10 days" });
  const mwSpp = await qualified(btaSet, midwest, "SPP-BTA-01", 0.58, d2025, { moq: "3,000 pcs", leadTime: "10 days" });
  const mwUc = await qualified(btaSet, midwest, "UC-BTA-01", 2.4, d2025, { moq: "1,000 pcs", leadTime: "14 days" });
  const lsPlt = await qualified(btaSet, lonestar, "PLT-BTA-01", 15.2, d2025, { moq: "200 pcs", leadTime: "3 weeks", extraCostType: "Freight", extraCostAmount: 180 });
  const pcStr = await qualified(btaSet, pacific, "STR-001", 38.5, d2025, { moq: "20 rolls", leadTime: "7 days", uom: "roll" });
  const pcSf = await qualified(btaSet, pacific, "SF-001", 21.0, d2025, { moq: "30 rolls", leadTime: "7 days", uom: "roll" });

  // Requotes on effective prices: each one closes the old price and creates a price change.
  await quote(btaSet, midwest, "PCP-BTA-01", { quoteReason: "Requote", quoteDate: "2026-02-10", effectiveFrom: "2026-03-01", unitPrice: 0.45, moq: "5,000 pcs", leadTime: "10 days", status: "Selected", notes: "Kraft paper cost increase." });
  await quote(btaSet, lonestar, "PLT-BTA-01", { quoteReason: "Requote", quoteDate: "2026-03-12", effectiveFrom: "2026-04-01", unitPrice: 14.6, moq: "200 pcs", leadTime: "3 weeks", extraCostType: "Freight", extraCostAmount: 180, status: "Selected", notes: "Annual volume agreement." });

  // ---- BTA revision 2.0 supersedes 1.0
  const btaV2File = await upload("BTA-Packaging-Rev2.pdf", "Drawing", ["BTA packaging drawing package", "Revision 2.0 - effective 2026-04-15", "Upper cover changed to 5-ply; corner protector unchanged"]);
  await drawingSet(bta.id, "BTA packaging set", "2026-04-15", btaV2File, true);
  btaSet = await activeSet(bta.id);

  // ---- Case A: new supplier development for BTA
  const caseA = await api("POST", "/api/projects", {
    name: "BTA 2026 packaging - second source",
    modelIds: [bta.id],
    drawingSetId: btaSet.id,
    type: "New Supplier Development",
    caseReason: "New Supplier Intro",
    status: "Comparison",
    supplierIds: [midwest.id, lonestar.id, pacific.id, greatlakes.id, southern.id],
    itemIds: btaSet.drawingItems.map((drawingItem) => drawingItem.itemId),
    owner: "Purchasing - T. Zhou",
    openDate: "2026-05-04",
    targetCloseDate: "2026-11-30",
  });
  const inCase = { projectId: caseA.id };
  const d2026 = { quote: "2026-05-12", sample: "2026-05-26", inspected: "2026-05-28", effective: "2026-06-01" };
  const glPcp = await qualified(btaSet, greatlakes, "PCP-BTA-01", 0.44, d2026, { ...inCase, moq: "2,000 pcs", leadTime: "8 business days" });
  const glLpp = await qualified(btaSet, greatlakes, "LPP-BTA-01", 0.83, d2026, { ...inCase, moq: "2,000 pcs", leadTime: "8 business days" });
  await quote(btaSet, greatlakes, "SPP-BTA-01", { ...inCase, quoteDate: "2026-05-12", effectiveFrom: "2026-06-01", unitPrice: 0.55, moq: "2,000 pcs", leadTime: "8 business days", status: "Sample Requested", notes: "Sample promised for late October." });
  await quote(btaSet, greatlakes, "UC-BTA-01", { ...inCase, quoteDate: "2026-05-12", effectiveFrom: "2026-06-01", unitPrice: 2.35, moq: "1,000 pcs", leadTime: "12 days", extraCostType: "Tooling", extraCostAmount: 650, status: "Received" });
  const soPlt = await qualified(btaSet, southern, "PLT-BTA-01", 14.2, { ...d2026, inspected: "2026-05-29", notes: "Moisture content 17%, within limit." }, { ...inCase, moq: "300 pcs", leadTime: "4 weeks" });
  const soUc = await quote(btaSet, southern, "UC-BTA-01", { ...inCase, quoteDate: "2026-05-14", effectiveFrom: "2026-06-01", unitPrice: 2.2, moq: "1,500 pcs", leadTime: "3 weeks", status: "Sample Requested" });
  await inspect(btaSet, soUc, { sampleRound: 1, sampleReceivedDate: "2026-06-02", inspectionDate: "2026-06-05", result: "Fail", disposition: "Re-sample Required", problemPhotos: 2, notes: "Edge crush test 18% below spec; flap score line cracked." });
  await inspect(btaSet, soUc, { sampleRound: 2, sampleReceivedDate: "2026-06-22", inspectionDate: "2026-06-26", signedDate: "2026-06-26", result: "Fail", disposition: "No Further Action", problemPhotos: 3, notes: "Second round still below edge crush spec. Closed." });

  // Midwest raises the corner protector price again in July.
  await quote(btaSet, midwest, "PCP-BTA-01", { quoteReason: "Requote", quoteDate: "2026-06-15", effectiveFrom: "2026-07-01", unitPrice: 0.47, moq: "5,000 pcs", leadTime: "10 days", status: "Selected", notes: "Second kraft paper increase; asked for 90-day hold." });

  // Source roles inside Case A (each needs a Selected quote linked to the case).
  const bootstrap = await api("GET", "/api/bootstrap");
  const linkedToCase = new Set(bootstrap.quoteCaseLinks.filter((link) => link.projectId === caseA.id && link.recordState !== "Void").map((link) => link.quoteId));
  const selectedQuote = (sup, code) =>
    bootstrap.quotes
      .filter((q) => linkedToCase.has(q.id) && q.supplierId === sup.id && q.itemId === item[code].id && q.status === "Selected" && q.recordState !== "Void")
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  const role = (sup, code, roleName, effectiveFrom, projectId = caseA.id, modelId = bta.id) => {
    const q = selectedQuote(sup, code);
    if (!q) throw new Error(`No Selected quote linked to the case for ${sup.name} / ${code}`);
    return api("POST", "/api/source-assignments", { projectId, modelId, itemId: item[code].id, supplierId: sup.id, sourceQuoteId: q.id, role: roleName, effectiveFrom, notes: "" });
  };
  await role(midwest, "PCP-BTA-01", "Primary", "2026-05-04");
  await role(greatlakes, "PCP-BTA-01", "Secondary", "2026-06-01");
  await role(midwest, "LPP-BTA-01", "Primary", "2026-05-04");
  await role(greatlakes, "LPP-BTA-01", "Backup", "2026-06-01");
  await role(midwest, "SPP-BTA-01", "Primary", "2026-05-04");
  await role(midwest, "UC-BTA-01", "Primary", "2026-05-04");
  await role(lonestar, "PLT-BTA-01", "Primary", "2026-05-04");
  await role(southern, "PLT-BTA-01", "Backup", "2026-06-01");
  await role(pacific, "STR-001", "Primary", "2026-05-04");
  await role(pacific, "SF-001", "Primary", "2026-05-04");

  // ---- BTC: incumbents qualified in February, standalone roles
  const btcSet = await activeSet(btc.id);
  const dBtc = { quote: "2026-02-03", sample: "2026-02-16", inspected: "2026-02-18", effective: "2026-03-01" };
  await qualified(btcSet, midwest, "PCP-BTC-01", 0.39, dBtc, { moq: "5,000 pcs", leadTime: "10 days" });
  await qualified(btcSet, midwest, "UC-BTC-01", 1.95, dBtc, { moq: "1,000 pcs", leadTime: "14 days" });
  await qualified(btcSet, midwest, "PP-BTC-01", 0.72, dBtc, { moq: "2,000 pcs", leadTime: "14 days" });
  await qualified(btcSet, lonestar, "PLT-BTC-01", 13.9, dBtc, { moq: "200 pcs", leadTime: "3 weeks", extraCostType: "Freight", extraCostAmount: 160 });
  const boot2 = await api("GET", "/api/bootstrap");
  const btcSelected = (sup, code) => boot2.quotes.find((q) => q.supplierId === sup.id && q.itemId === item[code].id && q.modelId === btc.id && q.status === "Selected");
  for (const [sup, code] of [[midwest, "PCP-BTC-01"], [midwest, "UC-BTC-01"], [midwest, "PP-BTC-01"], [lonestar, "PLT-BTC-01"]]) {
    await api("POST", "/api/source-assignments", { modelId: btc.id, itemId: item[code].id, supplierId: sup.id, sourceQuoteId: btcSelected(sup, code).id, role: "Primary", effectiveFrom: "2026-03-01", notes: "" });
  }

  // ---- Case B: BTC Q3 requote (left open for the live demo)
  const caseB = await api("POST", "/api/projects", {
    name: "BTC Q3 2026 requote",
    modelIds: [btc.id],
    drawingSetId: btcSet.id,
    type: "Requote",
    caseReason: "Requote",
    status: "Quoting",
    supplierIds: [midwest.id, greatlakes.id],
    itemIds: btcSet.drawingItems.map((drawingItem) => drawingItem.itemId),
    owner: "Purchasing - T. Zhou",
    openDate: "2026-08-03",
    targetCloseDate: "2026-10-31",
  });
  await quote(btcSet, midwest, "UC-BTC-01", { projectId: caseB.id, quoteReason: "Requote", quoteDate: "2026-08-12", effectiveFrom: "2026-11-01", unitPrice: 2.08, moq: "1,000 pcs", leadTime: "14 days", status: "Received", notes: "Requested +6.7% for board price." });
  await quote(btcSet, greatlakes, "UC-BTC-01", { projectId: caseB.id, quoteDate: "2026-08-14", effectiveFrom: "2026-11-01", unitPrice: 1.99, moq: "1,000 pcs", leadTime: "12 days", status: "Received" });
  await quote(btcSet, greatlakes, "PP-BTC-01", { projectId: caseB.id, quoteDate: "2026-08-14", effectiveFrom: "2026-11-01", unitPrice: 0.69, moq: "2,000 pcs", leadTime: "12 days", status: "Received" });

  // ---- Incoming defects (last 90 days drive the quality score and risk watch)
  await api("POST", "/api/incoming-defects", { supplierId: southern.id, modelId: bta.id, itemId: item["PLT-BTA-01"].id, poNumber: "PO-4500012871", poQty: 200, receivedQty: 188, defectType: "Damage", defectDate: "2026-09-12", defectQty: 12, defectAction: "Request Replacement", replacementQty: 12, replacementReceipts: [{ receivedDate: "2026-09-26", receivedQty: 8, result: "Accepted" }], materialReturned: false, notes: "Broken deck boards on 12 pallets. 4 replacements still due." });
  await api("POST", "/api/incoming-defects", { supplierId: greatlakes.id, modelId: bta.id, itemId: item["LPP-BTA-01"].id, poNumber: "PO-4500012790", poQty: 2000, receivedQty: 2000, defectType: "Dimension", defectDate: "2026-08-25", defectQty: 6, defectAction: "Request Credit", materialReturned: true, returnDate: "2026-08-29", notes: "6 pcs cut 8mm short. Credited." });
  await api("POST", "/api/incoming-defects", { supplierId: midwest.id, modelId: bta.id, itemId: item["PCP-BTA-01"].id, poNumber: "PO-4500012655", poQty: 5000, receivedQty: 4997, defectType: "Labeling", defectDate: "2026-07-30", defectQty: 3, defectAction: "Request Replacement", replacementQty: 3, replacementReceipts: [{ receivedDate: "2026-08-06", receivedQty: 3, result: "Accepted" }], materialReturned: false, notes: "Wrong lot label on 3 bundles." });
  await api("POST", "/api/incoming-defects", { supplierId: lonestar.id, modelId: btc.id, itemId: item["PLT-BTC-01"].id, poNumber: "PO-4500012311", poQty: 200, receivedQty: 196, defectType: "Damage", defectDate: "2026-05-20", defectQty: 4, defectAction: "Request Replacement", replacementQty: 4, replacementReceipts: [{ receivedDate: "2026-05-28", receivedQty: 4, result: "Accepted" }], notes: "Forklift damage in transit." });

  // Approve the first automatic price change so both statuses show.
  const changes = (await api("GET", "/api/price-changes")).filter((change) => change.recordState !== "Void").sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  if (changes[0]) await api("PATCH", `/api/price-changes/${changes[0].id}`, { status: "Approved", recordState: "Active" });

  const final = await api("GET", "/api/bootstrap");
  console.log("Seeded:", Object.fromEntries(["models", "items", "drawingSets", "suppliers", "projects", "quotes", "inspections", "sourceAssignments", "incomingDefects", "priceChanges", "files"].map((key) => [key, final[key].length])));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
