import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "docs", "pdf");
const previews = path.join(root, ".data", "deploy-doc-preview");
const preview = process.argv.includes("--preview");
assert(process.argv.slice(2).every(arg => arg === "--preview"), "Usage: npm run docs:deploy:pdf -- [--preview]");

const escape = value => String(value).replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
const editions = ["th", "en"].flatMap(lang => ["nuxt", "contracts"].map(topic => ({
  lang, topic, name: `UNXO-deploy-${topic}-${lang}`, source: `docs/${lang}/deploy-${topic}.md`,
})));
const pdfForSource = new Map(editions.map(edition => [edition.source, `${edition.name}.pdf`]));

// This renderer intentionally supports the Markdown used by the deployment guides:
// headings, paragraphs, fenced code, bullet lists, tables, links, bold and inline code.
// Unsupported block syntax fails instead of silently dropping source content.
function markdown(source, filename) {
  const references = new Map();
  const code = [];
  const targets = new Set();
  const inline = value => {
    const tokens = /`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g;
    let result = "", cursor = 0;
    for (const match of value.matchAll(tokens)) {
      result += escape(value.slice(cursor, match.index));
      if (match[1] !== undefined) result += `<code>${escape(match[1])}</code>`;
      else if (match[2] !== undefined) {
        const target = match[3];
        assert(!/^(?:javascript|data):/i.test(target), `Unsupported link in ${filename}`);
        if (/^https?:\/\//.test(target)) result += `<a href="${escape(target)}">${inline(match[2])}</a>`;
        else {
          const absolute = path.resolve(root, path.dirname(filename), target.split("#")[0]);
          assert(absolute.startsWith(root), `Link outside the repository in ${filename}`);
          const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
          targets.add(absolute);
          if (!references.has(relative)) references.set(relative, references.size + 1);
          const href = pdfForSource.get(relative) || path.relative(output, absolute).replaceAll(path.sep, "/");
          result += `<a class="repository-link" href="${escape(href)}" data-repository="${escape(relative)}">${inline(match[2])}</a><sup class="reference">${references.get(relative)}</sup>`;
        }
      } else result += `<strong>${inline(match[4])}</strong>`;
      cursor = match.index + match[0].length;
    }
    return result + escape(value.slice(cursor));
  };

  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const blocks = [];
  const startsBlock = line => /^(?:#{1,3} |```|\| |- )/.test(line);
  const cells = line => line.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());
  let title;
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    // The PDF download link in the source points back to this generated artifact.
    if (/^\[PDF\]/.test(line)) { i++; continue; }
    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const content = [];
      i++;
      while (i < lines.length && lines[i] !== "```") content.push(lines[i++]);
      assert(i < lines.length, `Unclosed code block in ${filename}`);
      i++;
      code.push(content.join("\n"));
      blocks.push(`<pre data-language="${escape(language)}"><code>${escape(content.join("\n"))}</code></pre>`);
    } else if (/^#{1,3} /.test(line)) {
      const heading = line.match(/^(#{1,3}) (.+)$/);
      const level = heading[1].length;
      if (level === 1) { assert(!title, `Multiple titles in ${filename}`); title = heading[2]; }
      blocks.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
    } else if (line.startsWith("|")) {
      const headers = cells(line);
      assert(cells(lines[i + 1] || "").every(cell => /^:?-{3,}:?$/.test(cell)), `Invalid table in ${filename}`);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        const row = cells(lines[i++]);
        assert.equal(row.length, headers.length, `Table column mismatch in ${filename}`);
        rows.push(`<tr>${row.map(cell => `<td>${inline(cell)}</td>`).join("")}</tr>`);
      }
      blocks.push(`<table><thead><tr>${headers.map(cell => `<th>${inline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`);
    } else if (line.startsWith("- ")) {
      const items = [];
      while (i < lines.length && lines[i].startsWith("- ")) items.push(`<li>${inline(lines[i++].slice(2))}</li>`);
      blocks.push(`<ul>${items.join("")}</ul>`);
    } else {
      assert(!/^(?:>|\d+\. |<|~~~|\* )/.test(line), `Unsupported Markdown block in ${filename}: ${line}`);
      const paragraph = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) paragraph.push(lines[i++]);
      blocks.push(`<p>${inline(paragraph.join(" "))}</p>`);
    }
  }
  assert(title && blocks.length > 20 && code.length > 0, `Incomplete guide: ${filename}`);
  const lang = filename.includes("/th/") ? "th" : "en";
  const referenceHeading = `<h2>${lang === "th" ? "เอกสารและซอร์สอ้างอิงในโปรเจกต์" : "Repository references"}</h2>`;
  const referenceNote = `<p class="reference-note">${lang === "th"
    ? "เลขอ้างอิงในเนื้อหาชี้ไปยังไฟล์ใน repository ตามรายการด้านล่าง ควรแนบ source เมื่อแชร์เอกสารที่ต้องใช้ไฟล์เหล่านี้ร่วมด้วย ลิงก์เว็บไซต์ภายนอกยังเปิดได้จาก PDF"
    : "Numbered references identify repository files listed below. Include the source repository when sharing documents that require those files. External website links remain clickable in the PDF."}</p>`;
  const entries = [...references].map(([target, number]) => `<p class="reference-entry"><span>${number}.</span> <code>${escape(target)}</code></p>`).join("");
  blocks.push(`<section class="repository-references">${referenceHeading}${referenceNote}<div class="reference-grid">${entries}</div></section>`);
  return { title, blocks, code, targets };
}

const font = async relative => (await readFile(path.join(root, "node_modules", "@fontsource-variable", relative))).toString("base64");
const [thai, latin, heading] = await Promise.all([
  font("noto-sans-thai/files/noto-sans-thai-thai-wght-normal.woff2"),
  font("noto-sans-thai/files/noto-sans-thai-latin-wght-normal.woff2"),
  font("manrope/files/manrope-latin-wght-normal.woff2"),
]);
const css = `
@font-face{font-family:Guide;src:url(data:font/woff2;base64,${thai}) format('woff2');font-weight:100 900;font-style:normal;unicode-range:U+0E00-0E7F;font-display:block}
@font-face{font-family:Guide;src:url(data:font/woff2;base64,${latin}) format('woff2');font-weight:100 900;font-style:normal;font-display:block}
@font-face{font-family:Manrope;src:url(data:font/woff2;base64,${heading}) format('woff2');font-weight:200 800;font-style:normal;font-display:block}
@page{size:A4;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0}
body{background:#e9e6df;color:#25312c;font-family:Guide,sans-serif;font-size:9pt;line-height:1.65;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{width:210mm;height:297mm;margin:0 auto 16px;position:relative;background:#fffefa;break-after:page}
.sheet:last-child{break-after:auto}.sheet::before{content:'';position:absolute;top:0;left:0;right:0;height:2.5mm;background:#ac843b}
.masthead{position:absolute;left:16mm;right:16mm;top:11mm;height:13mm;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #d9d3c6;padding-bottom:3mm}
.brand{font-family:Manrope,Guide,sans-serif;font-size:18pt;font-weight:800;letter-spacing:2px}.brand span{color:#a77b2f}
.edition{text-align:right;font-size:7pt;line-height:1.6;color:#747568}.edition b{font-family:Manrope,Guide,sans-serif;font-size:7.5pt;letter-spacing:.7px;color:#5d665b}
.page-body{position:absolute;left:16mm;right:16mm;top:31mm;bottom:23mm;display:flow-root}
.page-body>:first-child{margin-top:0}.page-body>:last-child{margin-bottom:0}
h1{font-family:Manrope,Guide,sans-serif;font-size:26pt;line-height:1.28;letter-spacing:-.6px;margin:0 0 5mm;font-weight:800;color:#243e33}
[lang=th] h1{font-family:Guide,sans-serif;font-size:24pt;line-height:1.5;letter-spacing:0}
h2{font-size:13pt;line-height:1.5;font-weight:750;margin:6mm 0 2.5mm;color:#795b29;border-bottom:1px solid #e5dfd2;padding-bottom:1.5mm}
h3{font-size:11pt;line-height:1.5;margin:4mm 0 2mm}p{margin:0 0 3mm}strong{font-weight:750}
a{color:#7d5b22;text-decoration:none;border-bottom:1px solid #d8c7a7}.repository-reference{color:#7d5b22}.reference{font-size:6pt;color:#8b7149;margin-left:1px}
code{font-family:Consolas,'Liberation Mono',monospace;font-size:.89em;overflow-wrap:anywhere;hyphens:none;color:#283e33}
pre{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;hyphens:none;margin:2mm 0 4mm;padding:3mm 3.5mm;background:#f0f3ee;border:1px solid #d9e1d6;border-left:3px solid #96aa8c;border-radius:3px;font-size:8pt;line-height:1.5;tab-size:4}
pre code{font-size:inherit;color:#26382c;white-space:inherit}
table{border-collapse:collapse;table-layout:fixed;width:100%;margin:2mm 0 4mm;font-size:8pt;line-height:1.6}
th{text-align:left;vertical-align:top;font-weight:750;background:#ede9df;padding:2.2mm 2.5mm;border-bottom:1px solid #cbc3b2;color:#5c583f}
td{vertical-align:top;padding:2.3mm 2.5mm;border-bottom:1px solid #dfdfd4;overflow-wrap:anywhere}th:first-child,td:first-child{width:35%}
tbody tr:nth-child(even){background:#f7f7f0}ul{margin:1.5mm 0 3mm;padding-left:5mm}li{padding-left:1mm;margin:0 0 2mm}li:last-child{margin-bottom:0}
.footer{position:absolute;left:16mm;right:16mm;bottom:9mm;height:8mm;border-top:1px solid #d9d3c6;padding-top:2mm;display:flex;justify-content:space-between;align-items:flex-start;gap:4mm;font-size:6.5pt;color:#74796d}
.footer .source{font-family:Consolas,monospace;font-size:6.5pt}.repository-references h2{font-size:10pt;margin:4mm 0 2mm}.reference-note{font-size:7.5pt;color:#687265}.reference-grid{display:grid;grid-template-columns:1fr 1fr;gap:1.5mm 4mm}.reference-entry{font-size:7.5pt;margin:0;overflow-wrap:anywhere}.reference-entry span{display:inline-block;min-width:5mm;color:#8b7149}
#source-blocks{display:none}@media print{html,body{background:white}.sheet{margin:0}}
`;

await mkdir(output, { recursive: true });
if (preview) await mkdir(previews, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1300 }, deviceScaleFactor: 1 });
  await page.emulateMedia({ media: "print", reducedMotion: "reduce" });
  for (const edition of editions) {
    const source = await readFile(path.join(root, edition.source), "utf8");
    const rendered = markdown(source, edition.source);
    await Promise.all([...rendered.targets].map(target => access(target)));
    await page.setContent(`<!doctype html><html lang="${edition.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(rendered.title)} | UNXO</title><style>${css}</style></head><body><div id="source-blocks">${rendered.blocks.join("")}</div></body></html>`);
    await page.evaluate(async () => {
      await Promise.all([
        document.fonts.load("400 12px Guide", "ระบบ UNXO"),
        document.fonts.load("750 12px Guide", "ระบบ UNXO"),
        document.fonts.load("800 12px Manrope", "UNXO"),
      ]);
      await document.fonts.ready;
    });
    const layout = await page.evaluate(edition => {
      const staging = document.querySelector("#source-blocks");
      const normalize = text => text.replace(/\s+/gu, " ").trim();
      const expected = normalize(staging.textContent);
      const blocks = [...staging.children];
      let body;
      function newPage() {
        const sheet = document.createElement("section");
        sheet.className = "sheet";
        const masthead = document.createElement("header");
        masthead.className = "masthead";
        masthead.innerHTML = `<div class="brand">UNX<span>O</span></div><div class="edition"><b>${edition.topic === "nuxt" ? "NUXT APPLICATION" : "SMART CONTRACTS"}</b><br>${edition.lang === "th" ? "คู่มือ Deploy ฉบับเต็ม · ภาษาไทย" : "Complete deployment guide · English"}</div>`;
        body = document.createElement("main");
        body.className = "page-body";
        const footer = document.createElement("footer");
        footer.className = "footer";
        const source = document.createElement("span");
        source.className = "source";
        source.textContent = edition.source;
        const number = document.createElement("span");
        number.className = "page-number";
        footer.append(source, number);
        sheet.append(masthead, body, footer);
        document.body.append(sheet);
      }
      function fits() { return body.scrollHeight <= body.clientHeight + 1; }
      newPage();
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        body.append(block);
        // Check headings together with the following block to prevent orphan headings.
        const next = /^H[123]$/.test(block.tagName) ? blocks[i + 1]?.cloneNode(true) : null;
        if (next) body.append(next);
        const fit = fits();
        next?.remove();
        if (!fit) {
          block.remove();
          if (!body.childElementCount) throw new Error(`Block is taller than an A4 content area: ${block.tagName} ${block.textContent.slice(0, 80)}`);
          newPage();
          body.append(block);
          if (next) body.append(next);
          if (!fits()) throw new Error(`Block or heading group is taller than an A4 page: ${block.textContent.slice(0, 80)}`);
          next?.remove();
        }
      }
      staging.remove();
      const sheets = [...document.querySelectorAll(".sheet")];
      for (const [index, sheet] of sheets.entries()) sheet.querySelector(".page-number").textContent = `${edition.lang === "th" ? "หน้า" : "Page"} ${index + 1} / ${sheets.length}`;
      const actual = normalize([...document.querySelectorAll(".page-body")].map(main => main.textContent).join(""));
      return {
        pages: sheets.length, complete: expected === actual,
        code: [...document.querySelectorAll("pre code")].map(node => node.textContent),
        fonts: document.fonts.check("400 12px Guide", "ระบบ UNXO"),
        issues: [...document.querySelectorAll(".page-body, .page-body *")].filter(node => node.scrollWidth > node.clientWidth + 1 || node.classList.contains("page-body") && node.scrollHeight > node.clientHeight + 1).map(node => `${node.tagName}: ${node.textContent.slice(0, 70)}`),
      };
    }, edition);
    assert(layout.complete, `${edition.name}: source content was lost or reordered`);
    assert.deepEqual(layout.code, rendered.code, `${edition.name}: code blocks changed`);
    assert(layout.fonts, `${edition.name}: fonts did not load`);
    assert.deepEqual(layout.issues, [], `${edition.name}: content overflow`);
    assert(layout.pages >= 3, `${edition.name}: unexpectedly short guide`);

    const htmlPath = path.join(output, `${edition.name}.html`);
    await writeFile(htmlPath, await page.content(), "utf8");
    // Keep repository hyperlinks in HTML. In shared PDFs, retain their numbered
    // references rather than embedding this machine's local filesystem URLs.
    await page.evaluate(() => {
      for (const link of document.querySelectorAll("a.repository-link")) {
        const span = document.createElement("span");
        span.className = "repository-reference";
        span.innerHTML = link.innerHTML;
        link.replaceWith(span);
      }
    });
    const pdfPath = path.join(output, `${edition.name}.pdf`);
    const pdf = await page.pdf({ path: pdfPath, format: "A4", preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false, tagged: true, outline: true });
    assert(pdf.subarray(0, 5).equals(Buffer.from("%PDF-")), "Invalid PDF header");
    const data = pdf.toString("latin1");
    const count = (data.match(/\/Type\s*\/Page\b/g) || []).length;
    assert.equal(count, layout.pages, `${edition.name}: printed page count mismatch`);
    assert(data.includes("/FontFile2") || data.includes("/FontFile3"), "PDF fonts must be embedded");
    assert(data.includes("/ToUnicode"), "PDF needs searchable Unicode text");
    assert(!data.includes("file:///"), "PDF must not link to this machine's filesystem");
    if (preview) {
      for (let i = 0; i < count; i++) await page.locator(".sheet").nth(i).screenshot({ path: path.join(previews, `${edition.name}-${i + 1}.png`) });
      await page.addStyleTag({ content: "body{display:grid;grid-template-columns:repeat(3,calc(210mm * .34));gap:15px;padding:15px;width:max-content}.sheet{zoom:.34;margin:0}" });
      await page.screenshot({ path: path.join(previews, `${edition.name}-overview.png`), fullPage: true });
    }
    console.log(`${path.relative(root, pdfPath)}: ${count} pages, ${pdf.length.toLocaleString("en-US")} bytes; source, code, layout, embedded-font and Unicode checks passed.`);
  }
} finally { await browser.close(); }
