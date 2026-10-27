# UNXO — เอกสารระบบ / Project documentation

[การเปลี่ยนระบบและ API มาใช้ ID สมาชิก / Member ID update](member-id-update.md): current login, registration, read-only identity, searches and compatibility details.

ตรวจสอบจากซอร์สโค้ดวันที่ **27 ตุลาคม 2026** (Asia/Bangkok), revision `3ffa828` ก่อนเพิ่มเอกสารชุดนี้ เอกสารอธิบายสิ่งที่โปรเจกต์รองรับ ไม่ได้ยืนยันสถานะการตั้งค่าหรือการ deploy ของระบบที่เปิดใช้งานจริง

Reviewed against source on **27 October 2026** (Asia/Bangkok), revision `3ffa828` before these documentation changes. These documents describe implemented behavior, rather than certifying a live deployment or its configuration.

| เนื้อหา / Topic | ภาษาไทย | English |
| --- | --- | --- |
| ภาพรวม สถาปัตยกรรม หน้าจอ บัญชี และสิทธิ์ / System, architecture, screens, accounts and roles | [คู่มือระบบ](th/system-guide.md) | [System guide](en/system-guide.md) |
| ราคา 15 เลเวล (Level) การจ่ายเงิน ค่าคอมมิชชัน และเงื่อนไข / Prices, payments, commissions and conditions | [การจ่ายเงินและเงื่อนไข](th/payments-and-conditions.md) | [Payments and conditions](en/payments-and-conditions.md) |
| ติดตั้ง ตั้งค่า ฐานข้อมูล deploy ทดสอบ และแก้ปัญหา / Setup, configuration, database, deployment, tests and recovery | [คู่มือผู้ดูแลและนักพัฒนา](th/operations.md) | [Operations guide](en/operations.md) |
| Deploy Nuxt: Node server, PostgreSQL, systemd, Nginx/HTTPS และอัปเดตระบบ / Nuxt deployment and updates | [คู่มือ Deploy Nuxt](th/deploy-nuxt.md) | [Deploy Nuxt](en/deploy-nuxt.md) |
| Deploy/verify Smart Contract บน Amoy และเปลี่ยน distributor / Amoy contract deployment, verification and replacement | [คู่มือ Deploy Contract](th/deploy-contracts.md) | [Deploy contracts](en/deploy-contracts.md) |
| API ทุก endpoint พร้อมสิทธิ์ โหมด และตัวอย่าง / Every API endpoint, access, modes and examples | [คู่มือ API](th/api-reference.md) | [API reference](en/api-reference.md) |

คู่มือ Deploy ทั้งสองหัวข้อตรวจจากซอร์สวันที่ **28 ตุลาคม 2026** ครอบคลุมคำสั่งสำหรับ Linux/Windows และการส่ง environment จากเครื่องผู้ deploy ไปยังเซิร์ฟเวอร์ / Both deployment guides were reviewed against source on **28 October 2026** and cover Linux/Windows commands plus runtime configuration handoff from the deployment machine to the application server.

เริ่มจากคู่มือระบบ แล้วอ่านเรื่องการจ่ายเงินก่อนใช้งานธุรกรรม ผู้ติดตั้งและผู้พัฒนาอ่านคู่มือปฏิบัติการและ API เพิ่มเติม เอกสารภาษาไทยและภาษาอังกฤษมีขอบเขตเดียวกัน

Start with the system guide and read the payment conditions before using transactions. Operators and developers should also read operations and API documentation. Both languages cover the same scope.

## PDF คู่มือ Deploy ฉบับเต็ม / Complete deployment PDFs

PDF ชุดนี้มีเนื้อหาเต็มตามคู่มือ Markdown ทั้งสี่ไฟล์ จัดหน้า A4 พร้อมฟอนต์ไทยฝังในไฟล์ ข้อความที่ค้นหา/คัดลอกได้ และหมายเลขอ้างอิงไฟล์ใน repository / These PDFs contain the complete Markdown deployment guides, with A4 pages, embedded fonts, searchable/copyable text and numbered repository references.

| คู่มือ / Guide | ภาษา / Language | PDF | หน้า / Pages | HTML สำหรับอ่านหรือพิมพ์ / Read or print |
| --- | --- | --- | ---: | --- |
| Nuxt | ไทย | [UNXO-deploy-nuxt-th.pdf](pdf/UNXO-deploy-nuxt-th.pdf) | 7 | [HTML](pdf/UNXO-deploy-nuxt-th.html) |
| Nuxt | English | [UNXO-deploy-nuxt-en.pdf](pdf/UNXO-deploy-nuxt-en.pdf) | 7 | [HTML](pdf/UNXO-deploy-nuxt-en.html) |
| Smart Contract | ไทย | [UNXO-deploy-contracts-th.pdf](pdf/UNXO-deploy-contracts-th.pdf) | 6 | [HTML](pdf/UNXO-deploy-contracts-th.html) |
| Smart Contract | English | [UNXO-deploy-contracts-en.pdf](pdf/UNXO-deploy-contracts-en.pdf) | 6 | [HTML](pdf/UNXO-deploy-contracts-en.html) |

สร้างใหม่จาก Markdown ด้วย `npm run docs:deploy:pdf` (`npm.cmd run docs:deploy:pdf` บน PowerShell) ใช้ Microsoft Edge แบบ headless และฟอนต์/dependencies ในโปรเจกต์ ไม่อ่าน private `.env` ไม่ต้องเปิดแอปหรือเชื่อมฐานข้อมูล เพิ่ม `-- --preview` เพื่อเก็บภาพแต่ละหน้าและภาพรวมใน `.data/deploy-doc-preview` ตัวสร้างตรวจว่าเนื้อหาและ code blocks ครบตามต้นฉบับ ไม่มีข้อความล้นหน้า และ PDF ฝังฟอนต์พร้อม Unicode mappings จำนวนหน้าอาจเปลี่ยนเมื่อแก้ source ควรตรวจและอัปเดตตารางนี้หลังสร้างใหม่

Regenerate from Markdown with `npm run docs:deploy:pdf`, using headless Microsoft Edge and local project fonts/dependencies. It does not read private `.env` or need a running application/database. Add `-- --preview` for page images and overviews in `.data/deploy-doc-preview`. The [generator](../scripts/generate-deploy-docs.mjs) checks source/code preservation, overflow, page count, embedded fonts and Unicode mappings. Page counts can change with the source; review and update the table after regenerating. Repository references require the accompanying source files; external website links remain clickable in the PDFs.

## PDF สรุปเอกสาร / PDF summaries

สรุปภาพรวมระบบ โหมดชำระเงิน ราคาครบ 15 เลเวล (Level) การแบ่งคอมมิชชัน ตัวอย่างผู้รับ เงื่อนไขสำคัญ และการดูแลระบบ จัดหน้า A4 พร้อมฟอนต์ฝังในไฟล์และข้อความที่ค้นหาได้ เป็นฉบับสรุปสำหรับอ่าน/แชร์ ใช้คู่มือด้านบนเมื่อต้องการรายละเอียดครบทุก endpoint

A4 summaries cover the system, payment modes, all fifteen prices, commission rules/examples, conditions and operations. Fonts are embedded and text remains searchable. Use the full guides above for complete implementation and endpoint details.

ฉบับสรุปใช้คำว่า **เลเวล (Level)** และระบุสมาชิกด้วย **ID** / Summaries identify members by **ID**.

| ฉบับ / Edition | PDF | จำนวนหน้า / Pages | HTML สำหรับอ่านหรือพิมพ์ / Read or print |
| --- | --- | ---: | --- |
| ภาษาไทย | [UNXO-summary-th.pdf](pdf/UNXO-summary-th.pdf) | 4 | [HTML ภาษาไทย](pdf/UNXO-summary-th.html) |
| English | [UNXO-summary-en.pdf](pdf/UNXO-summary-en.pdf) | 4 | [English HTML](pdf/UNXO-summary-en.html) |
| รวมไทยและอังกฤษ / Bilingual | [UNXO-summary-bilingual.pdf](pdf/UNXO-summary-bilingual.pdf) | 8 | [Bilingual HTML](pdf/UNXO-summary-bilingual.html) |

สร้างใหม่ด้วย `npm run docs:summary:pdf` (`npm.cmd run docs:summary:pdf` ใน PowerShell) ใช้ Microsoft Edge แบบ headless และ dependencies/font ที่ติดตั้งในโปรเจกต์ ไม่ต้องเปิดแอปหรือเชื่อมฐานข้อมูล เพิ่ม `-- --preview` เพื่อเก็บภาพตรวจหน้าใน `.data/doc-summary-preview` สูตรราคากับตัวอย่างแบ่งจ่ายอ่านจาก `shared/compensation.ts` และตัวสร้างตรวจหน้าล้น จำนวนหน้า ฟอนต์ และ Unicode mappings

Regenerate with `npm run docs:summary:pdf`, using the installed Microsoft Edge headless browser and local project dependencies/fonts. No running app or database is required. Add `-- --preview` for page images under `.data/doc-summary-preview`. Prices/examples use `shared/compensation.ts`; generation checks overflow, page counts, font embedding and Unicode mappings. Summary wording lives in [the generator](../scripts/generate-doc-summary.mjs) and should be reviewed alongside changes to the full guides. Links to the full guides target the local repository; those guides must accompany shared copies if needed.

**สภาพระบบปัจจุบัน / Current implementation:** ค่าเริ่มต้นใช้ connected wallet และ Smart Contract บน **Polygon Amoy, chain ID 80002** สคริปต์ deploy สร้าง **tUSDT สำหรับทดสอบ** ซึ่งไม่ใช่ USDT จริง โหมดเครดิตภายในเป็นส่วนรองรับระบบเดิมที่ต้องเปิดอย่างชัดเจน / Connected wallets and contract payments on **Polygon Amoy, chain ID 80002**, are the defaults. Deployment creates **test tUSDT**, which is not real USDT. Internal ledger payments require explicit legacy configuration.

เอกสารเชิงลึกเดิม / Existing technical notes:

- [Connected wallet integration and migration](connected-wallets.md)
- [Contract deployment, verification and recovery](referral-contract.md)
- [EVM helpers and embedded wallets](smart-contracts.md)
- [Existing API integration notes](api.md)

เอกสารชุดนี้อ้างอิงโค้ดและข้อจำกัดจริง ส่วนเงื่อนไขธุรกิจที่ยังไม่มีในระบบ เช่น นโยบายคืนเงินหรือค่าบริการถอนเงิน ระบุเป็นเรื่องที่ยังไม่ได้กำหนด / These guides separate code-enforced conditions from business policies that the project has not defined, such as refunds or withdrawal fees.
