# คู่มือผู้ดูแลและนักพัฒนา UNXO

[สารบัญเอกสาร](../README.md) · [English](../en/operations.md) · [ระบบ](system-guide.md) · [การจ่ายเงิน](payments-and-conditions.md) · [API](api-reference.md)

ตรวจสอบวันที่ **27 ตุลาคม 2026** revision `3ffa828` คำสั่งด้านล่างเป็นคู่มือสำหรับผู้ปฏิบัติงาน การจัดทำเอกสารครั้งนี้ไม่ได้ deploy สัญญา reset ฐานข้อมูล หรือโอนสินทรัพย์

## 1. ติดตั้งในเครื่อง

ต้องใช้ Node **24+**, npm และ PostgreSQL **17+** มี lockfile อยู่ในโปรเจกต์ ตัวอย่าง Windows ใช้ `npm.cmd` เพื่อไม่ติด execution policy ของ `npm.ps1`

1. สร้าง `.env` จาก [.env.example](../../.env.example) เฉพาะเมื่อยังไม่มีไฟล์ แล้วตั้งค่าของตนเอง ถ้ามีแล้วให้คงค่าระบบเดิมไว้
2. กำหนด `DATABASE_URL` ให้ชี้ฐานข้อมูลที่มีอยู่ หรือใช้บริการ development จาก [compose.yaml](../../compose.yaml)
3. ติดตั้ง dependencies เปิด PostgreSQL ทำ migration แล้วเปิดแอป:

```powershell
if (-not (Test-Path -LiteralPath .env)) { Copy-Item -LiteralPath .env.example -Destination .env }
npm.cmd ci
docker compose up -d postgres
npm.cmd run db:migrate
npm.cmd run admin:create
npm.cmd run dev
```

เปิด `http://localhost:3000` Compose เปิดพอร์ต PostgreSQL เฉพาะ localhost และเก็บข้อมูลใน persistent volume ข้อมูลเข้าสู่ระบบที่ให้มาใช้สำหรับ development ในเครื่อง

ถ้าไม่มี Docker หรือ PostgreSQL service ให้เปิด `npm.cmd run db:start` ในอีก terminal คำสั่งนี้อ่าน host/port/database จาก `DATABASE_URL` เปิด native embedded PostgreSQL สร้างฐานข้อมูลในเครื่องถ้ายังไม่มี และเก็บข้อมูลที่ `.data/postgresql` ต้องเปิด terminal ค้างไว้ กด Ctrl+C จะหยุด service โดยไม่ลบข้อมูล ต้องมี dev dependency `embedded-postgres` และอนุญาต installation scripts เลือก service เพียงตัวเดียวต่อพอร์ต

แอปเปิดได้ก่อน deploy blockchain แต่การซื้อผ่าน contract จะยังไม่พร้อม ต้องมี PostgreSQL เสมอ ไม่มี fallback ไป SQLite ตอนรัน

## 2. สร้างผู้ดูแล

`npm run admin:create` ใช้ `DATABASE_URL` เดียวกับแอป ทำ migration และถามรหัสผ่าน 12–128 ตัวโดยซ่อนการพิมพ์ ระบบสร้างและแจ้ง ID ผู้ดูแลให้อัตโนมัติ ไม่มีบัญชีเริ่มต้นหรือหน้าสมัครผู้ดูแลสาธารณะ และไม่เขียนทับบัญชีเดิม ใช้ `npm run admin:list` เพื่อดู ID และสถานะผู้ดูแลเดิม

โหมดไม่โต้ตอบใช้ `LOOP_ADMIN_PASSWORD` เก็บไว้ใน environment ส่วนตัว จากนั้นไป `/admin/login` ด้วย ID ที่ระบบแจ้งและรหัสผ่าน ผู้ดูแลยังเข้าสู่ระบบได้แม้ปิด member password login

## 3. ตัวแปรตั้งค่า

Nuxt runtime อ่านค่าจาก environment ชื่อ `NUXT_*` ที่ตรงกัน เปลี่ยนแล้วต้อง restart และตรวจว่า process manager ส่งค่าให้จริง ใช้ไฟล์ example เป็นแม่แบบ ไม่ใช้ `.env` ส่วนตัวเป็นเอกสาร

| ตัวแปร | ค่าเริ่มต้น / การใช้งาน |
| --- | --- |
| `DATABASE_URL` | PostgreSQL URL จำเป็น ต้องมีฐานข้อมูลอยู่แล้ว เว้นแต่ local helper สร้างให้ Hosted DB ใช้ SSL ตามผู้ให้บริการ |
| `TEST_DATABASE_URL` | ฐานข้อมูลทดสอบที่ทิ้งได้ ชื่อต้องลงท้าย `_test` ถ้าไม่กำหนด runner สร้าง instance แยก |
| `NUXT_PUBLIC_APP_URL` | Origin จริงรวม port ถ้ามี Production wallet login ต้องมี และใช้สร้างลิงก์เชิญ |
| `NUXT_PUBLIC_WALLET_MODE` | `external`; ต้องกำหนด `embedded` ชัดเจนเพื่อใช้ key ภายในแอป |
| `NUXT_PUBLIC_PASSWORD_LOGIN_ENABLED` | `false`; เปิดเมื่อต้องการ credential/linking เดิม Embedded login ต้องเปิดด้วย |
| `NUXT_EVM_RPC_URL` | RPC Amoy ที่เลือกเอง หากไม่กำหนด wallet/referral helpers ใช้ public Amoy fallback |
| `NUXT_EVM_CHAIN_ID` | ถ้าระบุสำหรับ wallet/referral/send ต้องเป็น `80002` |
| `NUXT_EVM_TOKEN_ADDRESS` | ERC-20 ที่ตั้งค่า สคริปต์ deploy บันทึก tUSDT ที่สร้างใหม่ไว้ที่นี่ หากไม่มี ยังส่ง native POL ได้ |
| `NUXT_EVM_TREASURY_ADDRESS` | ผู้รับสำหรับ generic transfer-evidence helpers ไม่ใช่ตัวแทน fee recipient ของ distributor |
| `NUXT_EVM_MIN_CONFIRMATIONS` | จำนวน confirmation สำหรับ generic evidence/send โดย Send เริ่มต้น 2 |
| `NUXT_EVM_EXPLORER_API_KEY` | Etherscan V2 key ส่วนตัวที่อ่าน Amoy ได้สำหรับประวัติกระเป๋า ถ้าไม่มี/เสียจะแสดงไม่พร้อม |
| `NUXT_REFERRAL_PAYMENT_MODE` | `contract`; `ledger` มีผลเฉพาะ embedded wallet mode |
| `NUXT_REFERRAL_CONTRACT_ADDRESS` | ที่อยู่ distributor การซื้อใหม่ต้องเป็น distribution version 2 |
| `NUXT_REFERRAL_AUTHORITY_PRIVATE_KEY` | Private key ลงนาม quote ตอนรัน ที่อยู่ต้องตรง `quoteSigner` บนเชน |
| `NUXT_REFERRAL_MIN_CONFIRMATIONS` | `2`; รับค่า policy การยืนยัน referral 1–100 |
| `NUXT_REFERRAL_MIN_GAS_BALANCE` | `0.003` POL เป็นงบแสดงขั้นต่ำงานผู้ดูแล ไม่ใช่การตรวจก่อนซื้อ |
| `REFERRAL_OWNER_ADDRESS` | Owner สาธารณะตอน deploy เจ้าของภายนอกเก็บ key ในกระเป๋าตนเอง |
| `REFERRAL_FEE_RECIPIENT_ADDRESS` | ผู้รับส่วนแพลตฟอร์มเริ่มต้นตอน deploy |
| `REFERRAL_DEPLOYER_PRIVATE_KEY` | Key ส่วนตัวใช้ deploy ต้องมี Amoy test POL แอปตอนรันไม่จำเป็นต้องใช้ |
| `ETHERSCAN_API_KEY` | Key verify source ถ้าว่างใช้ `NUXT_EVM_EXPLORER_API_KEY` แทน |
| `REFERRAL_QUOTE_SIGNER_ADDRESS` | ที่อยู่ **สาธารณะเดิมตอน deploy** ใช้ verification fallback เมื่อไม่มี deployment record |
| `LOOP_ADMIN_PASSWORD` | รหัสผ่านสร้างผู้ดูแลแบบไม่โต้ตอบ ระบบกำหนด ID ให้อัตโนมัติ |

Generic Viem transfer-evidence helpers ต้องตั้ง RPC, chain, token, treasury และ confirmation policy ให้ครบและเป็นเครือข่ายเดียวกัน การรองรับ chain ของไลบรารีไม่ได้เปลี่ยน wallet ของแอปที่ใช้เฉพาะ Amoy ห้ามเก็บ key/secret ในตัวแปร `NUXT_PUBLIC_*`

## 4. Deploy และ verify สัญญาทดสอบ

ขั้นตอน deploy, verify, ส่ง runtime configuration และเปลี่ยน distributor แบบละเอียดอยู่ใน [คู่มือ Deploy Contract](deploy-contracts.md)

ใช้เมื่อตั้งใจสร้าง deployment ทดสอบบน Amoy ขั้นตรวจแผนแยกจากการ broadcast

1. รัน `npm run contracts:prepare` เพื่อ compile เติม field ที่ขาดใน `.env` สร้าง quote key ฝั่ง server ครั้งแรกถ้าไม่มี และเขียน `.data/contracts/deployment-plan.json` โดยไม่พิมพ์ key
2. ตั้งที่อยู่ owner/ผู้รับเริ่มต้น และ deployer key แยกที่มี test POL เลือก Amoy RPC และ chain ID 80002 Owner ควรเป็นกระเป๋าที่ควบคุมภายนอกและจะใช้จัดการสัญญา
3. รัน `npm run contracts:deploy` ตรวจแผนสาธารณะโดยยังไม่ส่งธุรกรรม
4. ตรวจที่อยู่และ bytecode hashes แล้วจึงใช้ `npm run contracts:deploy -- --broadcast` จะ deploy โทเคนทดสอบกับ distributor และบันทึกที่อยู่ที่ยืนยันแล้วใน `.env`
5. Restart แอป ตรวจ admin wallet ที่ผูก owner โทเคน quote signer และ distribution version ใน contract settings
6. ตั้ง verification API key ดูตัวอย่างด้วย `npm run contracts:verify -- --dry-run` แล้วจึงรัน `npm run contracts:verify`

โทเคนทดสอบสร้างให้ initial owner 1,000,000 tUSDT แต่ละกระเป๋าเรียก `faucet()` ได้ครั้งเดียว 400,000 tUSDT และ owner mint เพิ่มได้ ขั้นตอนนี้ไม่ได้มีหน้า faucet ทั่วไปสำหรับสมาชิกให้ใช้งาน และ faucet โทเคนไม่ได้แจก POL gas

Deployment เก็บ signed bytes/progress ก่อน broadcast เพื่อให้ลองต่อได้ ต้องเก็บ `.data/contracts` และเวอร์ชัน compiler/dependencies เดิมเพื่อ verify source/bytecode/constructor ให้ตรง Dry run เขียน verification artifacts ในเครื่องโดยไม่ส่ง network ส่วน verify จริงส่ง source และตรวจสถานะ โดยไม่ส่งธุรกรรม blockchain

แก้ owner/fee ในไฟล์ deployment ภายหลังไม่เปลี่ยน owner/config บนเชน การแก้บนเชนต้องให้ owner ลงนาม โอน owner เป็นสองขั้นตอน และเปลี่ยนราคา/อัตราในสัญญาเดิมด้วย config ไม่ได้

### เปลี่ยน distributor โดยคงโทเคนเดิม

จัดการรายการค้างให้จบ แล้วสำรอง PostgreSQL environment ส่วนตัว และ contract artifacts ตรวจแผนด้วย:

```text
npm run contracts:deploy -- --replace-distributor
```

เมื่อตรวจ `.data/contracts/replacement-plan.json` แล้ว รูปแบบส่งจริงที่ต้องระบุสัญญาเก่าคือ:

```text
npm run contracts:deploy -- --replace-distributor --previous-contract <CURRENT_DISTRIBUTOR_ADDRESS> --broadcast
```

คำสั่งนี้ deploy distributor ใหม่กับโทเคนเดิมและเก็บประวัติ deployment ไว้ Restart และ verify ที่อยู่ใหม่ สัญญาไม่ upgradeable การแก้ Solidity ไม่เปลี่ยนสัญญาที่ deploy ไปแล้ว Pending เก่ายังตรวจตามกติกาเดิมได้ แต่เปลี่ยน config ทั้งที่รายการไม่จบจะทำให้กู้สถานะซับซ้อน ดู[รายละเอียดสัญญา](../referral-contract.md)และ[การย้ายไปกระเป๋าภายนอก](../connected-wallets.md)

## 5. แบบข้อมูลและความถูกต้อง

| ตาราง | หน้าที่ |
| --- | --- |
| `users`, `user_access` | ตัวตน ID สมาชิกตัวเลข sponsor เดิม ค่าภายในสำหรับข้อมูลเดิม บทบาท และสถานะระงับ |
| `sessions`, `rate_limits`, `wallet_challenges` | Session hash จำกัดความถี่ และ challenge เข้าสู่ระบบ/ผูกกระเป๋าครั้งเดียว |
| `connected_wallets`, `evm_wallets` | ที่อยู่ภายนอกที่ผูก กับ embedded keystore เข้ารหัสด้วยรหัสผ่าน |
| `wallets`, `wallet_transactions` | Available/reserved และรายการ ledger |
| `payment_reviews`, `admin_audit`, `platform_settings` | ตรวจรับชำระเติมเครดิตเดิม audit และสวิตช์ระบบ |
| `referral_activations`, `referral_purchases`, `referral_allocations` | Activation การซื้อเดิม เครดิตคอมมิชชัน และค้างจ่าย |
| `referral_chain_purchases`, `referral_chain_allocations` | Quote การซื้อ สถานะ receipt และการแบ่งจ่ายบนเชนที่ตรวจแล้ว |
| `referral_chain_fee_updates`, `referral_chain_transactions` | Embedded fee updates และ outbox signed transactions |
| `evm_sends`, `external_wallet_operations` | Embedded send quotes/รายการส่ง และ connected send/fee intents |
| `referral_code_aliases`, `referral_id_counter` | รหัสเชิญเดิมและลำดับรหัสตัวเลข |
| `referral_placements` | ข้อมูล binary ที่เก็บไว้ ผังและการจ่ายปัจจุบันอิง `users.sponsor_id` |
| `schema_migrations` | ชื่อ migration, SHA-256 checksum และเวลา จัดการโดย migration runner |

เงินภายในใช้ BIGINT หน่วยหนึ่งในล้าน ตรวจว่าไม่ติดลบและอยู่ใน safe integer ชื่อบัญชีและที่อยู่กระเป๋ามีข้อกำหนด unique แบบไม่แยกตัวพิมพ์ Request key เลเวล (Level) ที่ซื้อ hash ธุรกรรม และ reference ตรวจรับเงินมี unique constraints ตามส่วนงาน โอน ledger ล็อกกระเป๋าตามลำดับ เปลี่ยนสายผู้แนะนำใช้ advisory transaction lock และงานเชนใช้การควบคุมแยกตามบัญชี ข้อมูลและบัญชีที่เกี่ยวข้อง commit พร้อมกัน

Migration ปัจจุบันเรียง `0001` ถึง `0012` Server ทำ pending migrations ก่อนเปิดให้บริการ `npm run db:status` อ่านประวัติ ส่วน `npm run db:migrate` รัน SQL ที่ยังไม่ใช้ ทั้ง batch และ history commit ใน transaction เดียว ป้องกันรันแข่งด้วย advisory lock Checksum ปรับ line ending Windows ให้ตรงกัน หากแก้/ลบ migration ที่ใช้แล้วจะตรวจไม่ผ่านและหยุดเริ่มระบบ ต้องเพิ่มไฟล์เลขใหม่ ไม่มี rollback migration แยกรายตัว

### สำรอง Reset และนำเข้า SQLite เดิม

สำรอง PostgreSQL environment ส่วนตัว และ deployment/verification records Embedded wallet ต้องมีทั้ง keystore และรหัสผ่านเดิม หากขาดอย่างใดอย่างหนึ่งกู้ key ไม่ได้ External wallet ใช้การกู้ของกระเป๋าภายนอก แต่ฐานข้อมูลยังจำเป็นต่อความสัมพันธ์บัญชี sponsor และประวัติซื้อ Restore ฐานข้อมูลไม่ได้ย้อนธุรกรรมบนเชน

`npm run db:reset` **ลบข้อมูล** โดยแสดง host/database/schema แล้วให้พิมพ์ `RESET <database-name>` หรือใช้ `-- --confirm <database-name>` อย่างชัดเจน จะ drop/recreate schema ที่ connection เลือกและทำ migrations ใน transaction ต้องหยุดแอปและสำรองก่อนตั้งใจใช้ คำสั่งลบบัญชี session ledger ลิงก์กระเป๋า และ embedded keys แต่ไม่ reset blockchain ต้องสร้างผู้ดูแลใหม่ภายหลัง

หากเป็น SQLite รุ่นเดิมที่ importer รองรับ ให้หยุดเขียนและเก็บต้นฉบับ ตั้งปลายทาง PostgreSQL ว่าง **ก่อนสร้างสมาชิกหรือผู้ดูแล** แล้วใช้:

```text
npm run db:import:sqlite -- --source .data/loop.sqlite
```

Importer เปิด SQLite read-only คัดลอกตารางบัญชี/ledger/access/review/settings/activation/history เดิมที่รองรับ และเชื่อม sponsor ใน destination transaction เดียว หากปลายทางมี business records หรือค่าการเปิดบริการไม่ใช่ค่าเริ่มต้นจะปฏิเสธ ไม่คัดลอก SQLite schema history และไม่ใช่ตัว migrate ทุกตาราง EVM/keystore รุ่นใหม่ แอปปัจจุบันไม่ใช้ `LOOP_DATABASE_PATH` และไม่ fallback SQLite

## 6. ให้บริการด้วย Node server

ขั้นตอนตั้งค่า environment, systemd, Nginx/HTTPS, ตรวจหลัง deploy และกู้คืน release อยู่ใน [คู่มือ Deploy Nuxt](deploy-nuxt.md)

Build และเปิด Node server โดยเชื่อม PostgreSQL ได้และมี environment ที่ต้องการ:

```powershell
npm.cmd run build
node --env-file-if-exists=.env .output/server/index.mjs
```

หาก process manager ส่ง environment ให้แล้ว ไม่จำเป็นต้องโหลด `.env` แต่ Node ปกติไม่โหลดไฟล์นี้ให้อัตโนมัติ ใช้ HTTPS และ origin ให้ตรงที่ตั้งค่า รักษา Node process และการเชื่อม RPC เพื่อให้ worker ทุก 15 วินาทีทำงานได้ Deploy แบบ static `generate` อย่างเดียวให้บริการบัญชี/ชำระเงินหรือ worker ไม่ได้

API ใช้ `no-store` Proxy ที่แชร์ต้องเคารพค่านี้ เก็บการเข้าถึง DB และค่า RPC/explorer/authority ส่วนตัวไว้ฝั่ง server บทบาท session ไม่แทนสิทธิ์ owner และสวิตช์สมัคร/เติมเครดิตไม่ใช่ pause สัญญา

## 7. รายการคำสั่ง

| คำสั่ง (`npm run ...`) | หน้าที่ |
| --- | --- |
| `dev`, `build`, `preview`, `generate` | เปิด development, build server, ดู build และสร้าง static |
| `postinstall` | เตรียม Nuxt/type หลังติดตั้ง โดยปกติรันอัตโนมัติ |
| `typecheck` | ตรวจ Nuxt/Vue/TypeScript |
| `docs:summary:pdf` | สร้างสรุป PDF/HTML A4 ไทย อังกฤษ และสองภาษา ใช้ฟอนต์ในโปรเจกต์กับ Microsoft Edge ที่ติดตั้ง เพิ่ม `-- --preview` เพื่อเก็บภาพหน้ากระดาษ |
| `docs:deploy:pdf` | สร้าง PDF/HTML คู่มือ deploy Nuxt และ contract ฉบับเต็ม ไทย/อังกฤษจาก Markdown; เพิ่ม `-- --preview` เพื่อเก็บภาพหน้า |
| `admin:create` | สร้างผู้ดูแลใหม่ |
| `admin:list` | แสดง ID และสถานะของผู้ดูแลเดิม |
| `db:start`, `db:migrate`, `db:status` | เปิด PostgreSQL native ในเครื่อง ทำ migration และดูประวัติ |
| `db:reset`, `db:import:sqlite` | Reset schema อย่างตั้งใจ หรือนำเข้ารุ่น SQLite ที่รองรับครั้งเดียว |
| `contracts:compile`, `contracts:prepare` | Compile Solidity และเตรียม config ส่วนตัว/แผนสาธารณะ |
| `contracts:deploy`, `contracts:verify` | แผน/broadcast deployment และ source verification/dry run |
| `test:contracts` | Unit checks ของ EVM helpers กระเป๋า ยอดคงเหลือ และประวัติ indexer |
| `test:compensation` | สูตรราคาและแบ่งจ่าย |
| `test:verification` | ข้อมูลและสถานะ verify source |
| `test:distributor` | สัญญา การตรวจ receipt และ workflow deploy |
| `test:wallet-auth` | Challenge และลายเซ็นกระเป๋า |
| `test:sends` | Quote การลงนาม และหลักฐาน Send |
| `test:db` | PostgreSQL แยกสำหรับ constraints migration concurrency และ import |
| `test:ui` | Browser กับ production build และ PostgreSQL แยก |
| `test:onchain` | PostgreSQL และ Amoy-simulated EVM/browser แยก |
| `test:connected` | Workflow local chain/browser สำหรับ connected wallet |

คำสั่งที่ใช้จริงอ้างอิง [package.json](../../package.json) ไฟล์ทดสอบที่ไม่มี npm script เฉพาะรันด้วย Node test runner ได้ตามงาน เช่น `node --test tests/auth-mode.test.mjs tests/referral-tree.test.mjs`

เมื่อแก้โค้ดจ่ายเงิน เลือก suite contract/compensation/auth/send ที่เกี่ยวข้อง ตรวจ DB, typecheck และ build โดย build ก่อน browser suites การตั้งค่า browser ใช้ Microsoft Edge ที่ติดตั้งไว้ พอร์ต 3100 และ desktop/mobile emulation ส่วน chain/browser harness ใช้ EVM และ DB ในเครื่องที่ทิ้งได้ ไม่ส่งธุรกรรมจริงบน Amoy Runner DB/UI สร้าง PostgreSQL แยกโดยไม่อ่าน `DATABASE_URL` ของแอป เว้นแต่กำหนด `TEST_DATABASE_URL` ที่ทิ้งได้อย่างชัดเจน การทดสอบไม่ใช่ security audit อิสระ

ถ้าแก้เอกสารอย่างเดียว ให้ตรวจลิงก์ รายการ API และตัวเลขการจ่ายกับโค้ด ไม่จำเป็นต้องรันฐานข้อมูลหรือ broadcast เอกสารนี้ไม่ได้อ้างว่ารันทุก suite ระหว่างเขียน

## 8. ตรวจปัญหาและกู้สถานะ

| อาการ | สิ่งที่ตรวจและดำเนินการ |
| --- | --- |
| เปิดแอปไม่ได้/DB ติดต่อไม่ได้ | ตรวจ PostgreSQL ว่ารัน มีฐานข้อมูล URL/SSL/network ถูกต้อง แล้วดู migration status |
| Checksum/history migration ไม่ตรง | คืนไฟล์/ประวัติที่ใช้จริง แล้วเพิ่ม forward migration แทนแก้ SQL ที่ใช้แล้ว |
| Wallet login ปฏิเสธ host | ตั้ง scheme/host/port ให้ตรง `NUXT_PUBLIC_APP_URL` และ restart |
| สมาชิกใหม่สมัครไม่ได้ | ตรวจ `registrationOpen`, activation/status ของ invite, wallet uniqueness และ mode |
| ไม่มี/ใช้ member password login ไม่ได้ | ค่าเริ่มต้นปิดไว้ บัญชี external ที่ผูกแล้วใช้กระเป๋า ผู้ดูแลใช้ `/admin/login` |
| สัญญาไม่พร้อม | ตรวจ RPC/80002, code ที่ deploy, version 2, token, authority signer และ environment ของ server |
| ซื้อเลเวล (Level) ต่อไม่ได้ | ตรวจเลเวล (Level) ถัดไป โทเคนพอ pause รายการค้าง อายุ quote และ config nonce |
| Purchase pending | เก็บ ID/hash ตรวจ receipt canonical, confirmations, POL และ RPC ให้ worker ตรวจต่อก่อนลองใหม่ |
| Send pending หลัง replace | เก็บ hash เดิม/ใหม่ ตรวจผู้ส่ง nonce และ receipt ยังไม่มี auto-discovery สำหรับ Send อย่าส่งซ้ำทันที |
| อ่านยอดไม่ได้ | ตรวจที่อยู่ที่ผูก chain RPC และ token metadata อย่าใช้เครดิตเดิมแทนยอดเชน |
| History ไม่พร้อม/ว่าง | ตรวจ explorer key ส่วนตัวและสิทธิ์ Amoy สถานะไม่พร้อมต่างจากผลว่างที่อ่านสำเร็จ |
| เติมเครดิตยัง pending | คำขอไม่เพิ่มเครดิตเอง ต้องตรวจ review ผู้ดูแลและ settlement reference |
| เปลี่ยน fee ไม่ได้ | ต้องมี admin session และกระเป๋าที่เป็น owner ปัจจุบัน ตรวจ Amoy/POL และ quote ที่ nonce เปลี่ยน |
| คอมมิชชันไม่เท่ายอดกระเป๋า | Earnings เป็นประวัติรับ ส่วนยอดโทเคนคือสินทรัพย์ปัจจุบันหลังโอนออก เครดิตเดิมเป็นอีกส่วน |
| ไม่เห็นเงิน embedded หลังผูก | การผูกไม่ย้ายเงิน ตรวจที่อยู่ embedded เดิมและกู้ด้วย keystore/password เดิม |

หากบัญชียังไม่ลงตัว ให้เทียบ purchase/operation เดิม receipt block hash token events และ confirmation policy ใช้การตรวจและกระทบยอดโดยผู้ดูแล ไม่ mark ว่าจ่ายสำเร็จโดยไม่มีหลักฐาน หากต้องหยุดรายการระหว่างตรวจ ให้ใช้การควบคุมงาน/owner pause ที่ตรงขอบเขต

## 9. แหล่งอ้างอิง

[Configuration](../../.env.example), [Nuxt runtime](../../nuxt.config.ts), [database adapter](../../server/lib/postgres.ts), [migration runner](../../server/lib/migrations.ts), [migrations](../../database/migrations), [scripts](../../scripts), [test configuration](../../playwright.config.ts), [worker](../../server/plugins/referral-reconciliation.ts)
