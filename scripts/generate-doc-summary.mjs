import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { baseReferralPrice, levelPrice, maxReferralLevel, purchaseShares, shareRecipientDepth, ledgerScale } from "../shared/compensation.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "docs", "pdf");
const previews = path.join(root, ".data", "doc-summary-preview");
const preview = process.argv.includes("--preview");
const reviewedOn = "2026-10-27";
const index = await readFile(path.join(root, "docs", "README.md"), "utf8");
const revision = index.match(/revision `([a-f0-9]+)`/)?.[1];
assert(revision, "The documentation index must identify its reviewed source revision.");
const escape = value => String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const number = value => value.toLocaleString("en-US", { maximumFractionDigits: 2 });
const list = items => `<ul>${items.map(item => `<li>${item}</li>`).join("")}</ul>`;
const table = (headers, rows, cls = "") => `<table class="${cls}"><thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
const box = (title, text, cls = "") => `<div class="box ${cls}"><h3>${title}</h3><p>${text}</p></div>`;

// Use the executable compensation rules for every numeric price and example.
const prices = Array.from({ length: maxReferralLevel }, (_, i) => ({ level: i + 1, price: levelPrice(i + 1) }));
let cumulative = 0;
for (const row of prices) { cumulative += row.price; row.cumulative = cumulative; }
const example = eligible => {
  const totals = new Map();
  for (const share of purchaseShares(1)) {
    const depth = shareRecipientDepth(share, eligible);
    totals.set(depth, (totals.get(depth) || 0) + share.units);
  }
  assert.equal([...totals.values()].reduce((sum, value) => sum + value, 0), baseReferralPrice * ledgerScale);
  return depth => ((totals.get(depth) || 0) / ledgerScale).toFixed(2);
};
const onlyOne = example([true]);
const five = example(Array(5).fill(true));
const gap = example([true, false, true, true, true]);
const none = example([]);
const amounts = purchaseShares(1);
const rates = [amounts[0], amounts[1], amounts[2], { units: amounts.slice(3, 18).reduce((sum, share) => sum + share.units, 0) }, amounts[18]]
  .map(share => share.units / (baseReferralPrice * ledgerScale) * 100);
assert.deepEqual(rates, [10, 20, 50, 15, 5]);
assert.equal(cumulative, 327670);

const content = {
  en: {
    lang: "en", name: "English", date: "27 October 2026", summary: "PROJECT SUMMARY", footer: "System · payments · conditions", page: "Page",
    titles: ["The system at a glance", "Payments & fifteen levels", "How commissions are paid", "Operations & key conditions"],
    leads: [
      "A concise guide to UNXO's member workspace, referral network, wallets and administrator tools.",
      "Buy levels sequentially at their full price. The default flow uses a connected wallet and a smart contract.",
      "Every qualifying purchase allocates 100% of its token price across nineteen shares in one transaction.",
      "The controls, legacy behavior and operational limits to understand before running or using the platform."
    ],
    testTitle: "CURRENT DEPLOYMENT WORKFLOW: TESTNET",
    test: "Polygon Amoy · chain ID 80002. The supplied deployment creates valueless tUSDT, not real USDT or dollars. Test POL pays network gas.",
    stats: [["15", "paid levels"], ["52", "API routes"], ["TH / EN", "interface languages"]],
    capabilitiesTitle: "What the project includes",
    capabilityHeaders: ["Area", "Implemented behavior"],
    capabilities: [
      ["Member workspace", "Overview, referrals, wallet, explorer, FAQ, rank examples and analytics."],
      ["Accounts", "Wallet-message sign-in and identification by unique numeric member ID."],
      ["Referral network", "Actual sponsor ancestry, public ID search, fifteen generations and CSV/SVG exports."],
      ["EVM wallet", "Linked address, POL/token reads, signed sends and indexed transaction history."],
      ["Administrator", "Credential login, member status management, suspend/reactivate, settings and audit."],
      ["Presentation", "Thai/English, light/dark themes, mobile layouts, keyboard controls and reduced motion."]
    ],
    architectureTitle: "How the components work together",
    architecture: ["Nuxt / Vue UI", "Nitro API", "PostgreSQL"],
    architectureText: "The API attests eligibility; the wallet signs. ReferralDistributor v3 pays recipients on Amoy. A worker verifies receipts before recording activation and earnings.",
    rolesTitle: "Separate authorities",
    roles: "Members sign transfers; admins manage accounts. Contract owners alone change on-chain settings or pause. Quote authorities attest eligibility and cannot sign a buyer's transfer.",
    dataTitle: "Three balances with different meanings",
    balances: "Token holdings, confirmed commission history and legacy credits are separate. Linking does not move assets or convert credits.",
    modesHeaders: ["Mode", "Payment source / signer"],
    modes: [["External · default", "Configured ERC-20 at the linked address; wallet approval."], ["Embedded + contract", "Configured ERC-20; password unlocks the encrypted server keystore."], ["Embedded + ledger", "Explicit legacy mode; spends existing internal credits."]],
    priceTitle: "Price schedule", priceHeaders: ["Level", "Price", "Cumulative"],
    priceFormula: "Price(L) = 10 × 2<sup>L−1</sup> · Total through level 15: <strong>327,670</strong>",
    priceNote: "All amounts are configured token units; the supplied deployment uses test tUSDT. Gas is additional. A new account begins at level 0; buying level 1 activates its invite code.",
    flowTitle: "Default purchase flow",
    steps: [
      ["Prepare", "Check next level, token balance, ancestry, authority and distributor v3."],
      ["Approve", "Wallet approves the exact price; reset a nonzero insufficient allowance first."],
      ["Purchase", "Wallet signs; the contract collects and distributes all nineteen shares atomically."],
      ["Confirm", "Canonical receipt + all events + two confirmations by default activate the level in the app."]
    ],
    status: "<strong>Tracking:</strong> awaiting_signature → pending → confirmed / failed. External purchase quotes last ten minutes. Reuse the operation's request key on retries; a timeout does not prove failure.",
    commissionLabels: ["Direct 1", "Direct 2", "Direct 3", "Bonuses", "Platform"],
    allocationHeaders: ["Allocation", "Rate", "At a 10-token purchase"],
    allocationRows: [["Direct · depths 1 / 2 / 3", "10% / 20% / 50%", "1.00 / 2.00 / 5.00"], ["Bonus · depths 1–15", "1% each · 15% total", "0.10 each · 1.50 total"], ["Base platform share", "5%", "0.50"]],
    overlap: "Direct and bonus shares overlap: with fifteen eligible uplines, depths 1/2/3 receive 51%/21%/11%; depths 4–15 receive 1% each.",
    eligibilityTitle: "Who can receive an upline payment?",
    eligibility: "Purchased matching level + active account + wallet for the selected mode. Eligibility is snapshotted in the quote.",
    redirectTitle: "Missing or locked recipients",
    redirects: [
      "Missing/ineligible <strong>direct</strong> shares go to the platform; ancestors do not move into those gaps.",
      "Every missing or locked unilevel depth pays the platform. No shares combine into another member?s payout.",
      "With no eligible ancestor, the platform receives the full price. Its actual receipt can exceed the base 5%."
    ],
    examplesTitle: "Examples · price 10", examplesHeaders: ["Eligible uplines", "Result in token units"],
    examples: [
      ["Only depth 1", `Upline: <strong>${onlyOne(1)}</strong>; platform: <strong>${onlyOne(0)}</strong>.`],
      ["Depths 1–5", `Depths 1/2/3/4/5: ${[1,2,3,4,5].map(five).join(" / ")}; platform: ${five(0)}.`],
      ["Depth 2 gap; 1,3,4,5 eligible", `Depths 1/3/4/5: ${[1,3,4,5].map(gap).join(" / ")}; platform: ${gap(0)}.`],
      ["None", `Platform: <strong>${none(0)}</strong>.`]
    ],
    commissionNote: "Payouts arise from purchases, not invitations alone. Matrix/rank projections are illustrations: paid matrices recycle and queue wallet-funded upgrades; returns are not guaranteed. On-chain commissions are already transferred to recipient wallets; legacy credits are not credited again.",
    controlsTitle: "Accounts, permissions and controls",
    controls: [
      "Member wallet sign-in uses a single-use five-minute message. Sessions last seven days; passwords are disabled for members by default. Admins use /admin/login.",
      "A sponsor must be active and activated. Attach once; no self-link or cycle. Each placement has two branches; extra invitations spill over below existing members.",
      "Closing registration blocks new accounts. Closing funding blocks legacy deposit requests only. Contract pause requires the owner. Suspension does not freeze an external wallet."
    ],
    legacyTitle: "Legacy settlement stays separate",
    legacy: "A funding request is pending and adds no credit. An admin verifies receipt and records a unique reference before atomic approval/credit. Internal transfers require the sender's password. Legacy platform payables are records awaiting settlement, not completed on-chain payouts.",
    operationsTitle: "Run, maintain and recover",
    operations: "Node 24+ and PostgreSQL 17+. Install dependencies, configure .env and DATABASE_URL, migrate, create an admin, then run Nuxt. Production requires the Node server; static hosting cannot run the APIs.",
    recovery: "The worker reconciles every 15 seconds. Purchase replacements can be found by signed ID; ordinary send replacement discovery is absent. Preserve IDs/hashes and investigate pending receipts before another payment. Back up PostgreSQL, private configuration and contract artifacts.",
    apiTitle: "API documentation coverage",
    apiGroups: [["12", "auth / public"], ["18", "member / wallet"], ["9", "embedded / legacy"], ["13", "admin management"]],
    limitsTitle: "Gas and policies to keep clear",
    limits: "Approvals, purchases and sends need POL gas, including reverted attempts. A failed purchase reverts its token payouts, while separate approvals/gas can remain. No fiat checkout/cash-out, refund workflow, credit-to-token redemption, MFA, password recovery or linked-wallet replacement is implemented. Refund entitlements, withdrawal fees and commercial guarantees are not defined by the code.",
    readingTitle: "Full documentation", reading: "The complete guides are in the repository, alongside this summary:",
    readingLabels: ["System guide", "Payments and conditions", "Operations and recovery", "All 52 API routes"],
    scope: "Source review: 27 October 2026 · revision " + revision + ". This summarizes implemented behavior; it does not certify a live deployment."
  },
  th: {
    lang: "th", name: "ภาษาไทย", date: "27 ตุลาคม 2026", summary: "สรุปเอกสารโครงการ", footer: "ระบบ · การจ่ายเงิน · เงื่อนไข", page: "หน้า",
    titles: ["ภาพรวมระบบ UNXO", "การชำระเงินและเลเวล (Level)", "การแบ่งจ่ายค่าคอมมิชชัน", "การดูแลระบบและเงื่อนไขสำคัญ"],
    leads: [
      "สรุปพื้นที่สมาชิก เครือข่ายผู้แนะนำ กระเป๋าเงิน และเครื่องมือผู้ดูแลของโปรเจกต์ UNXO",
      "ซื้อเลเวล (Level) ตามลำดับ โดยจ่ายเต็มราคาของแต่ละเลเวล (Level) ค่าเริ่มต้นใช้กระเป๋าภายนอกและ Smart Contract",
      "การซื้อที่เข้าเงื่อนไขจะแบ่งเงินครบ 100% เป็น 19 ส่วน และโอนพร้อมกันในธุรกรรมเดียว",
      "สิทธิ์ควบคุม พฤติกรรมระบบเดิม และข้อจำกัดที่ควรเข้าใจก่อนติดตั้งหรือทำธุรกรรม"
    ],
    testTitle: "รูปแบบ DEPLOY ปัจจุบันเป็น TESTNET",
    test: "Polygon Amoy · chain ID 80002 สคริปต์สร้าง tUSDT ทดสอบที่ไม่มีมูลค่าเงินจริง ไม่ใช่ USDT จริงหรือดอลลาร์ ใช้ test POL จ่าย gas",
    stats: [["15", "เลเวล (Level) ที่ซื้อได้"], ["52", "เส้นทาง API"], ["TH / EN", "ภาษาหน้าจอ"]],
    capabilitiesTitle: "ความสามารถในโปรเจกต์",
    capabilityHeaders: ["ส่วนงาน", "สิ่งที่รองรับ"],
    capabilities: [
      ["พื้นที่สมาชิก", "ภาพรวม ผู้แนะนำ กระเป๋า Explorer, FAQ ตัวอย่าง rank และ analytics"],
      ["บัญชีผู้ใช้", "ลงชื่อเข้าด้วยลายเซ็นกระเป๋า และระบุสมาชิกด้วย ID ตัวเลขที่ไม่ซ้ำ"],
      ["เครือข่าย", "สาย sponsor จริง ค้นหา ID สาธารณะ สูงสุด 15 รุ่น และส่งออก CSV/SVG"],
      ["กระเป๋า EVM", "ที่อยู่ที่ผูก ยอด POL/โทเคน ส่งสินทรัพย์ด้วยลายเซ็น และประวัติจาก indexer"],
      ["ผู้ดูแล", "Login ด้วยข้อมูลบัญชี จัดการสถานะสมาชิก ระงับ/คืนสถานะ ตั้งค่า และ audit"],
      ["หน้าจอ", "ไทย/อังกฤษ ธีมสว่าง/มืด มือถือ แป้นพิมพ์ และ reduced motion"]
    ],
    architectureTitle: "องค์ประกอบทำงานร่วมกันอย่างไร",
    architecture: ["Nuxt / Vue UI", "Nitro API", "PostgreSQL"],
    architectureText: "API รับรองสายผู้แนะนำและสิทธิ์ กระเป๋าภายนอกลงนามซื้อ ส่วน ReferralDistributor v3 โอนเงินบน Amoy จากนั้น worker ตรวจ receipt ก่อนบันทึกเลเวล (Level) และรายได้ในแอป",
    rolesTitle: "แยกอำนาจแต่ละบทบาท",
    roles: "สมาชิกควบคุมธุรกรรมกระเป๋า ผู้ดูแลจัดการบัญชีในแอป เฉพาะ owner สัญญาจึงเปลี่ยนผู้รับ ผู้ลงนาม หรือ pause บนเชนได้ Quote authority ลงนามโอนแทนผู้ซื้อไม่ได้",
    dataTitle: "ยอดเงิน 3 แบบมีความหมายต่างกัน",
    balances: "สินทรัพย์บนเชน ประวัติคอมมิชชันที่ยืนยันแล้ว และเครดิตภายในเดิมเป็นคนละส่วน การผูกกระเป๋าไม่ย้ายสินทรัพย์เก่าหรือแปลงเครดิตให้",
    modesHeaders: ["โหมด", "แหล่งเงิน / ผู้ลงนาม"],
    modes: [["External · ค่าเริ่มต้น", "ERC-20 ที่ตั้งค่าในที่อยู่ที่ผูก ให้กระเป๋าอนุมัติ"], ["Embedded + contract", "ERC-20 โดยรหัสผ่านปลดล็อก keystore เข้ารหัสฝั่ง server"], ["Embedded + ledger", "ต้องเปิดโหมดเดิมชัดเจน ใช้เครดิตภายในที่มีอยู่"]],
    priceTitle: "ตารางราคา", priceHeaders: ["เลเวล (Level)", "ราคา", "สะสม"],
    priceFormula: "ราคา(L) = 10 × 2<sup>L−1</sup> · ซื้อครบ 15 เลเวล (Level): <strong>327,670</strong>",
    priceNote: "จำนวนเงินเป็นหน่วยโทเคนที่ตั้งค่า Deployment ที่ให้มาใช้ tUSDT ทดสอบ ยังไม่รวม gas บัญชีใหม่เริ่มเลเวล (Level) 0 ซื้อเลเวล (Level) 1 แล้วจึงเปิดใช้รหัสแนะนำ",
    flowTitle: "ลำดับซื้อแบบค่าเริ่มต้น",
    steps: [
      ["เตรียม", "ตรวจเลเวล (Level) ถัดไป ยอดโทเคน สายผู้แนะนำ authority และ distributor v3"],
      ["อนุมัติ", "Approve เท่าราคาซื้อ ถ้า allowance เดิมไม่เป็นศูนย์แต่ไม่พอ ให้ reset ก่อน"],
      ["ซื้อ", "กระเป๋าลงนาม สัญญารับเงินและโอนทั้ง 19 ส่วนแบบ atomic"],
      ["ยืนยัน", "ตรวจ canonical receipt และ events ครบ พร้อม confirmation เริ่มต้น 2 ครั้ง จึงรับรองเลเวล (Level) ในแอป"]
    ],
    status: "<strong>สถานะ:</strong> awaiting_signature → pending → confirmed / failed Quote ภายนอกอายุ 10 นาที Retry ใช้ request key เดิม การ timeout ไม่ใช่หลักฐานว่าจ่ายล้มเหลว",
    commissionLabels: ["ตรงชั้น 1", "ตรงชั้น 2", "ตรงชั้น 3", "โบนัส", "แพลตฟอร์ม"],
    allocationHeaders: ["ส่วนแบ่ง", "อัตรา", "เมื่อซื้อ 10 โทเคน"],
    allocationRows: [["จ่ายตรง · ชั้น 1 / 2 / 3", "10% / 20% / 50%", "1.00 / 2.00 / 5.00"], ["โบนัส · ชั้น 1–15", "ชั้นละ 1% · รวม 15%", "ชั้นละ 0.10 · รวม 1.50"], ["ส่วนแพลตฟอร์มพื้นฐาน", "5%", "0.50"]],
    overlap: "รับจ่ายตรงและโบนัสร่วมกันได้ ถ้ามีผู้มีสิทธิ์ครบ 15 ชั้น ชั้น 1/2/3 รับรวม 51%/21%/11% ส่วนชั้น 4–15 รับชั้นละ 1%",
    eligibilityTitle: "ใครมีสิทธิ์รับส่วนของผู้แนะนำ",
    eligibility: "ต้องเปิดรหัสแนะนำแล้ว บัญชี active และมีกระเป๋าตามโหมดที่ใช้งาน Server บันทึกสิทธิ์ตอนเตรียม quote ไม่บังคับซื้อ rank เท่าผู้ซื้อ มีลูกตรงสองคน หรือผ่านคุณสมบัติรายเดือน",
    redirectTitle: "ผู้รับที่ขาดสิทธิ์และผู้แนะนำชั้นสูงสุด",
    redirects: [
      "ส่วน<strong>จ่ายตรง</strong>ที่ไม่มีผู้มีสิทธิ์ไปแพลตฟอร์ม ไม่เลื่อนคนอื่นขึ้นมาแทนช่องนั้น",
      "ช่องโบนัสที่ไม่มีสิทธิ์ก่อนถึงผู้มีสิทธิ์ที่ไกลที่สุดไปแพลตฟอร์ม แต่โบนัส<strong>ส่วนท้าย</strong>ที่เหลือรวมให้ผู้มีสิทธิ์ที่ไกลที่สุดคนนั้น",
      "ถ้าไม่มีผู้มีสิทธิ์เลย แพลตฟอร์มรับทั้งหมด ยอดที่แพลตฟอร์มรับจริงจึงอาจมากกว่าส่วนพื้นฐาน 5%"
    ],
    examplesTitle: "ตัวอย่าง · ซื้อราคา 10", examplesHeaders: ["ผู้มีสิทธิ์", "ผลในหน่วยโทเคน"],
    examples: [
      ["เฉพาะชั้น 1", `ผู้แนะนำ <strong>${onlyOne(1)}</strong>; แพลตฟอร์ม <strong>${onlyOne(0)}</strong>`],
      ["ชั้น 1–5", `ชั้น 1/2/3/4/5: ${[1,2,3,4,5].map(five).join(" / ")}; แพลตฟอร์ม ${five(0)}`],
      ["มี 1,3,4,5 แต่ชั้น 2 ไม่มีสิทธิ์", `ชั้น 1/3/4/5: ${[1,3,4,5].map(gap).join(" / ")}; แพลตฟอร์ม ${gap(0)}`],
      ["ไม่มีเลย", `แพลตฟอร์ม <strong>${none(0)}</strong>`]
    ],
    commissionNote: "คอมมิชชันเกิดจากการซื้อ ไม่ใช่แค่เชิญสมัคร ตัวเลข matrix/rank เป็นภาพประกอบ ไม่มีระบบ recycle หรือรับประกันรายได้ โทเคนคอมมิชชันอยู่ในกระเป๋าผู้รับแล้ว ไม่เพิ่มเครดิต ledger ซ้ำ",
    controlsTitle: "บัญชี สิทธิ์ และสวิตช์ควบคุม",
    controls: [
      "Member wallet login ใช้ข้อความครั้งเดียวอายุ 5 นาที Session 7 วัน ปิด member password login โดยเริ่มต้น ผู้ดูแลใช้ /admin/login",
      "Sponsor ต้อง active และเปิดสิทธิ์ ผูกได้ครั้งเดียว ห้ามตนเอง/วงจร ลูกตรงทุกคนอยู่ใต้ sponsor จริง รวมคนที่ 3 เป็นต้นไป",
      "ปิดสมัครหยุดบัญชีใหม่ ปิด funding หยุดเฉพาะขอเติมเครดิตเดิม Pause สัญญาใช้ owner การระงับบัญชีไม่อายัดกระเป๋าภายนอก"
    ],
    legacyTitle: "การตรวจรับเงินเดิมแยกจาก on-chain",
    legacy: "คำขอเติมเป็น pending และยังไม่เพิ่มเครดิต ผู้ดูแลตรวจรับจริงพร้อม reference ไม่ซ้ำก่อนอนุมัติ/เพิ่มเครดิตแบบ atomic โอนภายในต้องมีรหัสผู้ส่ง ส่วน platform payable เดิมคือบัญชีค้างจ่าย ไม่ใช่โทเคนที่จ่ายบนเชนแล้ว",
    operationsTitle: "เปิดระบบ ดูแล และกู้สถานะ",
    operations: "ใช้ Node 24+ และ PostgreSQL 17+ ติดตั้ง dependencies ตั้ง .env/DATABASE_URL ทำ migration สร้างผู้ดูแล แล้วเปิด Nuxt Production ต้องใช้ Node server; static hosting รัน API ไม่ได้",
    recovery: "Worker ตรวจทุก 15 วินาที ค้นหา purchase ที่ถูกแทนจาก signed ID ได้ แต่ Send ทั่วไปยังไม่มี replacement discovery เก็บ ID/hash และตรวจ pending ก่อนจ่ายใหม่ สำรอง PostgreSQL config ส่วนตัว และ contract artifacts",
    apiTitle: "ขอบเขตคู่มือ API",
    apiGroups: [["12", "auth / สาธารณะ"], ["18", "สมาชิก / กระเป๋า"], ["9", "embedded / เดิม"], ["13", "ผู้ดูแล"]],
    limitsTitle: "ค่า gas และนโยบายที่ต้องแยกให้ชัด",
    limits: "Approve ซื้อ และส่งต้องมี POL gas รวมกรณี revert หาก purchase ล้มเหลวจะย้อนการจ่ายโทเคนทั้งหมด แต่ approve/gas แยกอาจคงอยู่ ยังไม่มีชำระ/ถอนเงินสด คืนเงิน แปลงเครดิตเป็นโทเคน MFA กู้รหัสผ่าน หรือเปลี่ยนกระเป๋าที่ผูก โค้ดไม่ได้กำหนดสิทธิ์คืนเงิน ค่าถอน หรือการรับประกันเชิงพาณิชย์",
    readingTitle: "เอกสารฉบับเต็ม", reading: "อ่านรายละเอียดใน repository ซึ่งเก็บคู่มือไว้ควบคู่กับไฟล์สรุปนี้:",
    readingLabels: ["คู่มือระบบ", "การจ่ายเงินและเงื่อนไข", "ติดตั้ง ดูแล และกู้สถานะ", "API ทั้ง 52 เส้นทาง"],
    scope: "ตรวจโค้ด 27 ตุลาคม 2026 · revision " + revision + " สรุปสิ่งที่รองรับในโปรเจกต์ ไม่ได้ตรวจรับรอง deployment ที่เปิดอยู่"
  }
};

const fontData = async relative => (await readFile(path.join(root, "node_modules", "@fontsource-variable", relative))).toString("base64");
const [thai, latin, heading] = await Promise.all([
  fontData("noto-sans-thai/files/noto-sans-thai-thai-wght-normal.woff2"),
  fontData("noto-sans-thai/files/noto-sans-thai-latin-wght-normal.woff2"),
  fontData("manrope/files/manrope-latin-wght-normal.woff2")
]);
const css = `
@font-face{font-family:Summary;src:url(data:font/woff2;base64,${thai}) format('woff2');font-style:normal;font-weight:100 900;unicode-range:U+0E00-0E7F; font-display:block}
@font-face{font-family:Summary;src:url(data:font/woff2;base64,${latin}) format('woff2');font-style:normal;font-weight:100 900;font-display:block}
@font-face{font-family:Manrope;src:url(data:font/woff2;base64,${heading}) format('woff2');font-style:normal;font-weight:200 800;font-display:block}
@page{size:A4;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#e8e5df;color:#20241f}
body{font-family:Summary,sans-serif;font-size:9pt;line-height:1.6;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{width:210mm;height:297mm;padding:13mm 16mm 18mm;background:#fffdf8;position:relative;break-after:page;overflow:visible;margin:0 auto 14px}
.sheet:last-child{break-after:auto}.sheet::before{content:'';position:absolute;inset:0 0 auto;height:3mm;background:#b38a3d}
.sheet[lang=th]{font-size:8.7pt;line-height:1.68}.page-content{display:flow-root}
.masthead{display:flex;align-items:center;justify-content:space-between;padding-bottom:5mm;border-bottom:1px solid #dbd6ca;margin-bottom:6mm}
.brand{font-family:Manrope,Summary,sans-serif;font-size:19pt;letter-spacing:3px;font-weight:800}.brand i{color:#b38a3d;font-style:normal}
.edition{text-align:right;color:#686b61;font-size:7.3pt}.eyebrow{font-size:7.2pt;letter-spacing:1.7px;color:#8c6629;font-weight:700;margin:0 0 2mm}
h1{font-size:26pt;font-weight:750;line-height:1.22;letter-spacing:-.7px;margin:0 0 3mm;font-family:Manrope,Summary,sans-serif}
[lang=th] h1{font-family:Summary,sans-serif;font-size:24pt;line-height:1.5;letter-spacing:-.4px}h2{font-size:12pt;line-height:1.4;margin:5mm 0 2.5mm;font-weight:750}
h3{font-size:9pt;margin:0 0 1.4mm;font-weight:750}p{margin:0 0 2.4mm}.lead{font-size:10pt;line-height:1.65;color:#5c6258;margin:0 0 4mm;max-width:166mm}
.callout{background:#f4eddf;border-left:3px solid #b38a3d;padding:3mm 4mm;border-radius:0 5px 5px 0;margin:3mm 0}
.callout h3{font-size:7.5pt;letter-spacing:.6px;color:#825c21}.callout p:last-child,.box p:last-child{margin-bottom:0}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:3mm;margin:4mm 0}.stat{border:1px solid #dfd8c8;padding:3mm 4mm;border-radius:6px}.stat strong{font-family:Manrope,Summary,sans-serif;font-size:21pt;line-height:1.3;display:block}.stat span{color:#6c6f64;font-size:8pt}
table{border-collapse:collapse;width:100%;font-size:8.2pt;line-height:1.55;margin:2mm 0 3mm}th{text-align:left;background:#f0ede5;color:#595c51;font-weight:700;font-size:7.5pt;padding:2.1mm 2.7mm;border-bottom:1px solid #cfc7b6}td{vertical-align:top;padding:2.1mm 2.7mm;border-bottom:1px solid #e5e0d6}tr:last-child td{border-bottom:0}.capabilities td:first-child{width:32mm;font-weight:700}.modes td:first-child{width:39mm;font-weight:700}
.flow{display:flex;align-items:center;gap:2.8mm;margin:3mm 0}.flow b{flex:1;padding:2.6mm 1mm;background:#202d29;color:#fff;text-align:center;border-radius:5px;font-family:Manrope,Summary,sans-serif;font-size:8.3pt}.flow span{color:#a17c35;font-size:15pt}.muted{color:#666c62}
.columns{display:grid;grid-template-columns:1fr 1fr;gap:5mm}.box{border:1px solid #dfd8c8;border-radius:6px;padding:3.4mm;margin-top:3mm}.box.gold{background:#faf5e9}.small{font-size:8pt;line-height:1.6}.price-grid{display:grid;grid-template-columns:1fr 1fr;gap:5mm}.prices td,.prices th{padding:1.2mm 2.7mm}.prices td:first-child{color:#8b6b31;font-weight:700}.prices td:not(:first-child),.prices th:not(:first-child){text-align:right;font-variant-numeric:tabular-nums}
.formula{font-family:Manrope,Summary,sans-serif;font-size:9.4pt;border-bottom:1px solid #ded6c5;padding-bottom:2mm}.steps{display:grid;grid-template-columns:1fr 1fr;gap:3mm 5mm;margin:3mm 0}.step{display:flex;gap:2.5mm}.step .n{font-family:Manrope,Summary,sans-serif;font-size:9pt;min-width:6mm;height:6mm;border-radius:50%;background:#b38a3d;color:white;text-align:center;line-height:6mm;font-weight:800}.step h3{margin:0;font-size:8.8pt}.step p{font-size:8pt;line-height:1.6;margin:1mm 0 0}
.allocation{display:flex;height:10mm;margin:4mm 0 2mm;border-radius:5px;overflow:hidden}.allocation span{display:flex;align-items:center;justify-content:center;color:white;font-family:Manrope,Summary,sans-serif;font-weight:750;font-size:9pt;white-space:nowrap}.seg-0{background:#263d32}.seg-1{background:#50745b}.seg-2{background:#7b966f}.seg-3{background:#b28a3d}.seg-4{background:#71664e}.legend{display:flex;flex-wrap:wrap;gap:2mm 4mm;font-size:7pt;color:#5b6258}.legend span{display:inline-flex;align-items:center;gap:1.4mm}.legend i{display:inline-block;width:2.4mm;height:2.4mm;border-radius:1px}
ul{padding:0 0 0 4mm;margin:2mm 0}li{padding-left:1mm;margin:0 0 2mm}.examples td:first-child{width:45mm;font-weight:650}.api-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:2mm}.api-stats .stat{padding:2mm}.api-stats .stat strong{font-size:15pt}.api-stats .stat span{font-size:6.8pt;line-height:1.4;display:block}.reading{display:grid;grid-template-columns:1fr 1fr;gap:1.8mm 5mm;margin-top:2mm}.reading a{font-size:8pt;color:#75561e;text-decoration:none}.reading code{display:block;color:#696d62;font-size:6.7pt;font-family:Summary,sans-serif}.source-note{font-size:7pt;color:#74786e;margin-top:3.5mm}.footer{position:absolute;left:16mm;right:16mm;bottom:9mm;border-top:1px solid #d9d3c5;padding-top:2mm;display:flex;justify-content:space-between;font-size:7pt;color:#71766b}.footer b{font-family:Manrope,Summary,sans-serif;letter-spacing:1px;color:#665128}
@media print{html,body{background:white}.sheet{margin:0}}`;

function sheet(c, page, body, total = 4) {
  return `<section class="sheet" lang="${c.lang}"><div class="page-content"><header class="masthead"><div class="brand">UNX<i>O</i></div><div class="edition">${c.summary}<br>${c.name} · ${c.date}</div></header><p class="eyebrow">${String(page).padStart(2,"0")} / ${c.summary}</p><h1>${c.titles[page-1]}</h1><p class="lead">${c.leads[page-1]}</p>${body}</div><footer class="footer"><span><b>UNXO</b> &nbsp; ${c.footer}</span><span>${c.page} ${page} / ${total}</span></footer></section>`;
}

function pages(c) {
  const priceTables = [prices.slice(0, 8), prices.slice(8)].map(rows => table(c.priceHeaders, rows.map(row => [row.level, number(row.price), number(row.cumulative)]), "prices")).join("");
  const pages = [
    sheet(c, 1, `<aside class="callout"><h3>${c.testTitle}</h3><p>${c.test}</p></aside><div class="stats">${c.stats.map(([value,label]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`).join("")}</div><h2>${c.capabilitiesTitle}</h2>${table(c.capabilityHeaders,c.capabilities,"capabilities")}<h2>${c.architectureTitle}</h2><div class="flow">${c.architecture.map((item,i) => `${i ? '<span>→</span>' : ''}<b>${item}</b>`).join("")}</div><p class="small muted">${c.architectureText}</p><div class="columns">${box(c.rolesTitle,c.roles)}${box(c.dataTitle,c.balances,"gold")}</div><p class="source-note">${c.scope}</p>`),
    sheet(c, 2, `${table(c.modesHeaders,c.modes,"modes")}<h2>${c.priceTitle}</h2><p class="formula">${c.priceFormula}</p><div class="price-grid">${priceTables}</div><p class="small muted">${c.priceNote}</p><h2>${c.flowTitle}</h2><div class="steps">${c.steps.map(([title,text],i) => `<div class="step"><span class="n">${i+1}</span><div><h3>${title}</h3><p>${text}</p></div></div>`).join("")}</div><aside class="callout"><p class="small">${c.status}</p></aside>`),
    sheet(c, 3, `<div class="allocation">${rates.map((rate,i) => `<span class="seg-${i}" style="width:${rate}%">${rate}%</span>`).join("")}</div><div class="legend">${c.commissionLabels.map((label,i) => `<span><i class="seg-${i}"></i>${label}</span>`).join("")}</div>${table(c.allocationHeaders,c.allocationRows)}<p class="small muted">${c.overlap}</p>${box(c.eligibilityTitle,c.eligibility,"gold")}<h2>${c.redirectTitle}</h2>${list(c.redirects)}<h2>${c.examplesTitle}</h2>${table(c.examplesHeaders,c.examples,"examples")}<aside class="callout"><p class="small">${c.commissionNote}</p></aside>`),
    sheet(c, 4, `<div class="columns"><div><h2>${c.controlsTitle}</h2>${list(c.controls)}${box(c.legacyTitle,c.legacy,"gold")}</div><div><h2>${c.operationsTitle}</h2><p>${c.operations}</p><p>${c.recovery}</p><h2>${c.apiTitle}</h2><div class="api-stats">${c.apiGroups.map(([value,label]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`).join("")}</div></div></div><aside class="callout"><h3>${c.limitsTitle}</h3><p class="small">${c.limits}</p></aside><h2>${c.readingTitle}</h2><p class="small muted">${c.reading}</p><div class="reading">${["system-guide.md","payments-and-conditions.md","operations.md","api-reference.md"].map((file,i) => `<a href="../${c.lang}/${file}">${c.readingLabels[i]}<code>docs/${c.lang}/${file}</code></a>`).join("")}</div><p class="source-note">${c.scope}</p>`)
  ];
  return pages;
}

function html(title, sections, lang = "en") {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="UNXO system, payments and conditions summary. Reviewed ${reviewedOn}, revision ${escape(revision)}."><base href="${pathToFileURL(output + path.sep).href}"><title>${escape(title)}</title><style>${css}</style></head><body>${sections.join("")}</body></html>`;
}

await mkdir(output, { recursive: true });
if (preview) await mkdir(previews, { recursive: true });
const editions = [
  { name: "UNXO-summary-th", title: "UNXO — สรุประบบ การจ่ายเงิน และเงื่อนไข", lang: "th", sections: pages(content.th), pages: 4 },
  { name: "UNXO-summary-en", title: "UNXO — System, Payments and Conditions Summary", lang: "en", sections: pages(content.en), pages: 4 },
];
editions.push({ name: "UNXO-summary-bilingual", title: "UNXO — สรุปเอกสาร / Bilingual Project Summary", lang: "th", sections: [...editions[0].sections, ...editions[1].sections], pages: 8 });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1300 }, deviceScaleFactor: 1 });
  await page.emulateMedia({ media: "print", reducedMotion: "reduce" });
  for (const edition of editions) {
    const htmlPath = path.join(output, `${edition.name}.html`);
    await writeFile(htmlPath, html(edition.title, edition.sections, edition.lang), "utf8");
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
    await page.evaluate(async () => { await document.fonts.ready; });
    const checks = await page.evaluate(() => [...document.querySelectorAll(".sheet")].map((sheet,i) => {
      const content = sheet.querySelector(".page-content").getBoundingClientRect();
      const footer = sheet.querySelector(".footer").getBoundingClientRect();
      return { page: i+1, clearance: footer.top - content.bottom, overflowX: sheet.scrollWidth - sheet.clientWidth,
        fontsLoaded: document.fonts.check("400 12px Summary", "ระบบ UNXO"), text: sheet.innerText.length };
    }));
    const summaryText = await page.locator("body").innerText();
    assert(!/usernames?/i.test(summaryText), "Summary must identify members by ID only.");
    assert(!summaryText.includes("\u0e23\u0e30\u0e14\u0e31\u0e1a"), "Thai summary must use the approved Level terminology.");
    assert.equal(checks.length, edition.pages);
    for (const check of checks) {
      assert(check.clearance >= 12, `${edition.name} page ${check.page} overlaps footer (clearance ${check.clearance.toFixed(1)}px)`);
      assert(check.overflowX <= 1, `${edition.name} page ${check.page} overflows horizontally`);
      assert(check.fontsLoaded && check.text > 500, `${edition.name}: missing fonts or summary content`);
    }
    const pdfPath = path.join(output, `${edition.name}.pdf`);
    const pdf = await page.pdf({ path: pdfPath, format: "A4", preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false, tagged: true, outline: true });
    assert(pdf.subarray(0,5).equals(Buffer.from("%PDF-")), "Invalid PDF header");
    const pdfText = pdf.toString("latin1");
    const count = (pdfText.match(/\/Type\s*\/Page\b/g) || []).length;
    assert.equal(count, edition.pages, `${edition.name}: unexpected printed page count`);
    assert(pdfText.includes("/FontFile2") || pdfText.includes("/FontFile3"), "PDF fonts must be embedded");
    assert(pdfText.includes("/ToUnicode"), "PDF must retain searchable text mappings");
    if (preview && edition.lang === "th" && edition.pages === 4) {
      for (let i = 0; i < edition.pages; i++) await page.locator(".sheet").nth(i).screenshot({ path: path.join(previews, `thai-${i+1}.png`) });
    }
    if (preview && edition.lang === "en") await page.locator(".sheet").first().screenshot({ path: path.join(previews, "english-1.png") });
    console.log(`${path.relative(root,pdfPath)}: ${count} pages, ${number(pdf.length)} bytes; layout, embedded fonts and Unicode checks passed.`);
  }
} finally { await browser.close(); }
