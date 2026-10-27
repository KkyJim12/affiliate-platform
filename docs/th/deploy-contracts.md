# คู่มือ Deploy และ Verify Smart Contract

[สารบัญเอกสาร](../README.md) · [English](../en/deploy-contracts.md) · [Deploy Nuxt](deploy-nuxt.md) · [รายละเอียด Contract](../referral-contract.md)

[PDF](../pdf/UNXO-deploy-contracts-th.pdf) · [HTML สำหรับอ่านหรือพิมพ์](../pdf/UNXO-deploy-contracts-th.html)

ตรวจสอบจากซอร์สโค้ดในโปรเจกต์วันที่ **28 ตุลาคม 2026** (Asia/Bangkok) ขั้นตอน deploy ที่มีอยู่รองรับ **Polygon Amoy testnet เท่านั้น chain ID 80002** โดยสร้าง `AmoyTestUSDT` และ `ReferralDistributor` ซึ่ง **tUSDT เป็น token ทดสอบที่ไม่มีมูลค่า ไม่ใช่ USDT จริง** การเปลี่ยน chain ID ใน environment ไม่ได้ทำให้ขั้นตอนนี้พร้อมใช้บน mainnet

## 1. สิ่งที่ต้องเตรียมและหน้าที่ของแต่ละบัญชี

รันจาก root ของโปรเจกต์บนเครื่องผู้ deploy ที่เชื่อถือได้ ใช้ Node.js **24+**, npm, source และ lockfile ของ release, Amoy RPC ที่เข้าถึงได้ และ deployment wallet ที่มี **test POL** สคริปต์ contract ไม่ต้องใช้ PostgreSQL แต่แอป Nuxt ต้องใช้ฐานข้อมูลสำหรับบัญชีสมาชิกและบันทึกการซื้อ

```bash
npm ci --include=dev
test -f .env || cp .env.example .env
```

บน Windows PowerShell ใช้ `npm.cmd` แทน `npm` และสร้างไฟล์ด้วย:

```powershell
if (-not (Test-Path -LiteralPath .env)) { Copy-Item -LiteralPath .env.example -Destination .env }
```

| บัญชี / การตั้งค่า | หน้าที่ |
| --- | --- |
| `REFERRAL_OWNER_ADDRESS` | Public address ของเจ้าของเริ่มต้นของทั้งสอง contract ได้รับ token ชุดแรกและสั่ง owner-only operations หากต้องการจัดการค่าธรรมเนียมในแอป ให้ link external wallet นี้กับบัญชี admin |
| `REFERRAL_FEE_RECIPIENT_ADDRESS` | Public address ผู้รับส่วนแบ่งแพลตฟอร์มเริ่มต้น เป็นคนละ address กับ owner ได้ |
| `REFERRAL_DEPLOYER_PRIVATE_KEY` | Key แยกสำหรับเซ็น deploy เท่านั้น wallet นี้จ่าย test POL เป็น gas แต่ไม่ได้เป็น owner โดยอัตโนมัติ |
| `NUXT_REFERRAL_AUTHORITY_PRIVATE_KEY` | Key ฝั่ง server สำหรับเซ็น quote ยืนยันสิทธิ์/สายแนะนำ public address ต้องตรงกับ `quoteSigner()` ของ distributor |
| Wallet สมาชิก | เซ็น approval/การซื้อของตัวเองและจ่าย network fees |

ใช้ authority key แยกเฉพาะงานนี้ เก็บ signing key ของ owner ไว้ใน external wallet อย่าเก็บ private key ใน `NUXT_PUBLIC_*`, commit เข้า Git หรือวางลง deployment log ตัวแปรจาก environment ที่ process รับมามีลำดับความสำคัญเหนือไฟล์ `.env` ของ Node จึงต้องตรวจค่า override เก่าใน shell/CI ก่อน review และ broadcast

## 2. ตั้งค่าสำหรับ deploy ใหม่

สำหรับ **ระบบใหม่** ให้แก้ค่าต่อไปนี้ใน `.env` ส่วนตัว:

```dotenv
NUXT_EVM_RPC_URL=https://rpc-amoy.polygon.technology/
NUXT_EVM_CHAIN_ID=80002
REFERRAL_OWNER_ADDRESS=
REFERRAL_FEE_RECIPIENT_ADDRESS=
REFERRAL_DEPLOYER_PRIVATE_KEY=
NUXT_REFERRAL_AUTHORITY_PRIVATE_KEY=
NUXT_EVM_TOKEN_ADDRESS=
NUXT_REFERRAL_CONTRACT_ADDRESS=
NUXT_REFERRAL_PAYMENT_MODE=contract
NUXT_REFERRAL_MIN_CONFIRMATIONS=2
```

เติม owner และ fee recipient เป็น EVM address ที่ถูกต้องและไม่ใช่ zero address แล้วใส่ deployment key อย่างปลอดภัย เว้น authority ว่างเฉพาะตอน **เตรียมครั้งแรก** เพื่อให้สคริปต์สร้างให้ หากเป็นระบบเดิมต้องเก็บ authority และ deployment records เดิมไว้ หากมี token/distributor แล้ว ให้ใช้หัวข้อกู้คืนหรือเปลี่ยน distributor แทนการล้าง address เพื่อข้ามระบบป้องกัน deploy ซ้ำ

เตรียม deploy:

```bash
npm run contracts:prepare
```

คำสั่งนี้ compile ทั้งสอง contract เติมค่า deployment defaults ที่ขาด สร้าง authority key ครั้งเดียวหากยังไม่มี แล้วบันทึกใน `.env` โดยไม่แสดง key จากนั้นเขียน public addresses และ bytecode hashes ลง `.data/contracts/deployment-plan.json` ยังไม่ส่งธุรกรรมบน chain โดยจะแสดง public address ของ authority ให้เก็บไว้เทียบกับ `quoteSigner()`

Compiler ใช้แพ็กเกจ `solc` ภายในโปรเจกต์ที่ pin เป็น **0.8.37** และ OpenZeppelin Contracts **5.6.1** โดยใช้ optimizer **200 runs**, `viaIR: true` และ EVM **Cancun** เก็บ source, lockfile และ artifacts ของ release เดิมไว้สำหรับ verify ภายหลัง ขั้นตอน compile ใช้สคริปต์ของโปรเจกต์ ไม่ได้ใช้คำสั่ง `hardhat deploy`

## 3. ตรวจแผนก่อน broadcast

```bash
npm run contracts:deploy
```

คำสั่งนี้ compile ใหม่และเขียน/แสดง public plan โดยไม่ broadcast ตรวจรายการต่อไปนี้:

- Network เป็น Amoy/80002 และ RPC เชื่อมไป chain นี้จริง
- Owner, fee recipient เริ่มต้น และ authority เป็นบัญชีที่ต้องการ ส่วน deployer มี test POL
- รายการ `missing` ในแผนเป็น array ว่าง และ bytecode hashes ตรงกับ release ที่ต้องการ deploy
- กำลังสร้างระบบใหม่จริง ไม่ใช่พยายามกู้คืนหรือเปลี่ยน distributor ที่มีอยู่แล้ว

ก่อน deploy release ที่เปลี่ยน contract ให้ทดสอบส่วนที่เกี่ยวข้องในเครื่อง:

```bash
npm run test:distributor
npm run test:verification
```

ชุดทดสอบนี้ใช้ fixtures/simulation ในเครื่อง ไม่ได้ยืนยันว่า RPC หรือ explorer จริงพร้อมใช้งาน และไม่ broadcast ไป public Amoy

## 4. Deploy ทั้งสอง contract

เมื่อตรวจแผนและ address ที่จะใช้แล้ว ให้ broadcast:

```bash
npm run contracts:deploy -- --broadcast
```

สคริปต์จะตรวจ chain ID 80002, deploy token ก่อนแล้วตามด้วย distributor และรอ **สอง confirmations ต่อ deployment** ค่านี้กำหนดไว้ในสคริปต์ แยกจากจำนวน confirmations ของการซื้อในแอป โดย constructor arguments คือ:

```text
AmoyTestUSDT(initialOwner)
ReferralDistributor(tokenAddress, initialOwner, initialFeeRecipient, initialQuoteSigner)
```

เมื่อยืนยันแล้ว สคริปต์เขียน `NUXT_EVM_TOKEN_ADDRESS`, `NUXT_REFERRAL_CONTRACT_ADDRESS` และ `NUXT_REFERRAL_PAYMENT_MODE=contract` ลง `.env` ของเครื่องผู้ deploy ไม่ได้อัปเดต secrets ของแอปบนเครื่องปลายทางให้อัตโนมัติ

สำรองไฟล์ต่อไปนี้เป็นการส่วนตัวแยกตาม release:

| ไฟล์ | หน้าที่ |
| --- | --- |
| `.data/contracts/AmoyTestUSDT.json`, `ReferralDistributor.json` | ABI, bytecode, compiler version และ source metadata |
| `.data/contracts/deployment-plan.json` | Public deployment plan |
| `.data/contracts/deployment-progress.json` | Constructor addresses เดิม, signed deployment bytes, transaction hashes และ deployed addresses |
| `.env` | การตั้งค่าส่วนตัวและ authority key ที่ตรงกับ contract |

ระบบบันทึก progress **ก่อน** broadcast หาก timeout หรือ deploy สำเร็จเพียงบางส่วน ให้คง source, constructor values, deployer, configuration และ progress file เดิม แล้วรัน broadcast คำสั่งเดิมอีกครั้ง ระบบจะทำต่อจากธุรกรรมที่บันทึกไว้ ตรวจ receipt บน chain ก่อนเปลี่ยนอะไร และอย่าใช้ deployer นี้ส่งธุรกรรมอื่นระหว่างกู้คืน deployment ที่ค้าง ห้ามลบ progress เพียงเพื่อเริ่ม retry ใหม่

`.data` และ `.env` ถูก ignore จาก Git จึงต้องมี backup แยก Progress มี signed transactions ให้เก็บเป็นข้อมูลปฏิบัติการส่วนตัว แม้ deployment plan จะแสดงเฉพาะข้อมูล deployment ที่เปิดเผยได้

## 5. Verify source บน explorer

ตั้ง private `ETHERSCAN_API_KEY` ที่เข้าถึง API ของ Amoy ได้ หากว่าง สคริปต์จะใช้ `NUXT_EVM_EXPLORER_API_KEY` แทน เริ่มจากเตรียม inputs แบบ offline:

```bash
npm run contracts:verify -- --dry-run
```

Dry run ต้องมี configured addresses และ build records ที่ตรงกัน โดยตรวจ source hashes, bytecode และ constructors แล้วเขียน Standard JSON inputs, encoded constructor arguments และ public settings ลง `.data/contracts/verification/` ขั้นตอนนี้ไม่ต้องมี explorer key และไม่ส่ง network requests

ส่ง source เพื่อ verify:

```bash
npm run contracts:verify
```

คำสั่งนี้ตรวจ Amoy RPC และ deployed code ส่ง source ผ่าน Etherscan V2 ข้าม contract ที่ verify แล้ว และเก็บ request IDs/status ลง `.data/contracts/verification/status.json` ไม่ส่งธุรกรรมบน blockchain และไม่ต้องใช้ deployer key หาก explorer ยัง index ไม่เสร็จหรือ verification ยัง pending ให้รันคำสั่งเดิมเพื่อทำต่อ เมื่อเสร็จ contract ทั้งสองควรมี verified code ที่ `https://amoy.polygonscan.com/address/CONTRACT_ADDRESS#code` โดยแทนด้วย deployed address ของแต่ละตัว

Deployment record ที่บันทึกไว้เป็นแหล่ง constructor arguments **เดิม** แม้ภายหลังเปลี่ยน owner/fee/signer หากไม่มี record ที่ตรงกัน จะ fallback ไปใช้ `REFERRAL_OWNER_ADDRESS`, `REFERRAL_FEE_RECIPIENT_ADDRESS` และ public `REFERRAL_QUOTE_SIGNER_ADDRESS` ที่เป็นค่าตอน deploy (หรือ address ที่ derive จาก authority key) ค่าปัจจุบันบน chain อาจไม่ใช่ค่าเดิม หาก hash ไม่ตรงให้คืน source และ dependencies ของตอน deploy การ compile source ที่แก้แล้วไม่ทำให้ตรงกับ contract เก่า

## 6. เชื่อมกับ Nuxt และตรวจความพร้อม

ส่งค่าต่อไปนี้ไปยัง private runtime environment ของแอป แล้ว restart Node service:

```text
NUXT_EVM_RPC_URL
NUXT_EVM_CHAIN_ID=80002
NUXT_EVM_TOKEN_ADDRESS
NUXT_REFERRAL_CONTRACT_ADDRESS
NUXT_REFERRAL_AUTHORITY_PRIVATE_KEY
NUXT_REFERRAL_PAYMENT_MODE=contract
NUXT_REFERRAL_MIN_CONFIRMATIONS=2
```

ส่ง authority key ผ่านระบบจัดการ secrets ส่วนตัวที่ใช้งานอยู่ แอปไม่ต้องใช้ `REFERRAL_DEPLOYER_PRIVATE_KEY` หรือ `ETHERSCAN_API_KEY` สำหรับการซื้อ ส่วน key สำหรับ explorer history เป็นตัวเลือก ตรวจว่าอัปเดตตัวแปรที่ hosting inject ให้ด้วย ไม่ใช่แก้เฉพาะ env file

ใช้ Read Contract ของ explorer หรือ RPC reader ตรวจเทียบ:

| ค่าที่อ่านจาก contract | ผลที่ควรได้ |
| --- | --- |
| Distributor `distributionVersion()` | `2` |
| Distributor `paymentToken()` | ตรงกับ `NUXT_EVM_TOKEN_ADDRESS` |
| Distributor `owner()` | Owner ที่ตั้งใจใช้ เริ่มต้นคือ `REFERRAL_OWNER_ADDRESS` |
| Distributor `feeRecipient()` | ผู้รับที่ตั้งใจใช้ เริ่มต้นคือ `REFERRAL_FEE_RECIPIENT_ADDRESS` |
| Distributor `quoteSigner()` | Public authority address ที่แสดงตอน prepare |
| Distributor `paused()` | `false` เมื่อต้องการเปิดให้ซื้อ |
| Token `decimals()` / `symbol()` | `6` / `tUSDT` |

เข้าสู่ระบบที่ `/admin/login` ก่อน link owner wallet แล้วตรวจสถานะ contract และสิทธิ์ owner ในหน้าตั้งค่า admin สิทธิ์ admin กับ on-chain ownership เป็นคนละสิทธิ์ การ link wallet ไม่ได้โอน ownership

Token จะ mint **1,000,000 tUSDT** ให้ initial owner แต่ละ wallet เรียก `faucet()` ได้ครั้งเดียวเพื่อรับ **400,000 tUSDT** หรือรับ token จาก owner ซึ่งสามารถ mint เพิ่มได้ Faucet เป็นการเรียก contract ไม่ใช่ npm script และยังไม่มีหน้า faucet ทั่วไปให้สมาชิกใน workflow นี้ ทุก wallet ที่ส่งธุรกรรมยังต้องมี **test POL** สำหรับ gas

ใช้ wallet สมาชิกทดสอบบน Amoy ซื้อเลเวล 1 ราคา **10 tUSDT** อนุมัติ token ตามราคาจริงและเซ็นซื้อใน connected wallet รอ confirmations ที่ตั้งไว้ แล้วตรวจ activation ของเลเวล, transaction hash และประวัติแบ่งจ่าย/บัญชี Server ไม่ตรวจยอด POL ล่วงหน้าสำหรับการซื้อ จึงต้องเติมให้ wallet ก่อน การจ่ายแบบ contract ไม่ fallback ไปใช้เครดิต ledger ภายใน

## 7. เปลี่ยนเฉพาะ distributor

Contract ชุดนี้ **ไม่รองรับ upgrade ใน address เดิม** การแก้ Solidity ไม่ได้เปลี่ยน deployed code คำสั่ง replacement จะใช้ token เดิมพร้อมยอดคงเหลือเดิม แล้ว deploy distributor ใหม่ โดยไม่ได้ย้ายประวัติธุรกรรมบน chain

จัดการ purchases, approvals, transfers และ fee updates ที่ค้างให้เสร็จก่อนเปลี่ยน configuration กำหนดช่วง maintenance และหยุดรับการเขียนผ่านแอประหว่างสลับ สำรอง PostgreSQL, private environment และ **`.data/contracts` เดิม** ก่อน prepare/compile source ที่เปลี่ยนแล้ว เพราะคำสั่งเหล่านี้เขียนทับ build artifacts เก็บ build records เดิมของ token ที่จะใช้ต่อไว้ด้วย

โดยยังคง token และ distributor ปัจจุบันใน configuration ให้ตรวจแผน:

```bash
npm run contracts:deploy -- --replace-distributor
```

ตรวจ `.data/contracts/replacement-plan.json` จากนั้นแทน `CURRENT_DISTRIBUTOR_ADDRESS` ในคำสั่งต่อไปนี้ด้วย distributor address ปัจจุบันที่ตรงทุกตัว แล้วจึง broadcast:

```text
npm run contracts:deploy -- --replace-distributor --previous-contract CURRENT_DISTRIBUTOR_ADDRESS --broadcast
```

สคริปต์ตรวจ token ของ distributor เดิม deploy เฉพาะ distributor ใหม่ เก็บ deployment progress เดิมไว้ และบันทึก replacement ลง `.data/contracts/replacement-ADDRESS.json` กับ `.data/contracts/latest-replacement.json` จากนั้นอัปเดต `.env` ในเครื่องให้ใช้ distributor ใหม่ ต้องส่งค่านี้ไปยัง Nuxt runtime environment และ restart ด้วย

ทำ source verification และรายการตรวจความพร้อมซ้ำ บัญชีและข้อมูล paid-level accounting เดิมในฐานข้อมูลยังอยู่ ไม่ต้อง reset ฐานข้อมูล การซื้อก่อนหน้ายังคงเป็นธุรกรรมของ contract เก่า อย่าล้าง configured address เพื่อบังคับ deploy ทั้งสอง contract ใหม่ หากต้องการเพียง replacement

## 8. การกู้คืนและเปลี่ยน configuration

| ปัญหา | วิธีดำเนินการ |
| --- | --- |
| Chain ผิด / RPC ใช้ไม่ได้ | ใช้ Amoy RPC และ chain ID 80002 เก็บ progress เดิมไว้ระหว่างตรวจสอบ |
| Gas ไม่พอ / deploy timeout | เติม test POL ให้ deployer เดิม ตรวจ hashes/receipts ที่บันทึกไว้ แล้วรันคำสั่งเดิมเพื่อทำต่อ |
| ระบบปฏิเสธ deploy ซ้ำ | ตรวจ configuration และ progress ปัจจุบัน ใช้ replacement เฉพาะเมื่อตั้งใจเปลี่ยนจริง |
| Quote signer ไม่ตรง | คืน authority ให้ตรง `quoteSigner()` การสร้าง key ใหม่ใน `.env` ไม่ได้เปลี่ยน contract |
| เปลี่ยน fee/owner แค่ใน `.env` | ค่าเหล่านี้เป็น constructor inputs การแก้ contract ที่ deploy แล้วต้องให้ owner ปัจจุบันเซ็น ส่วน transfer ownership ใช้สองขั้นตอน |
| Source verification ไม่ตรง | คืน deployed source, lockfile, compiler และ constructor records เดิม |
| ซื้อแล้วยัง pending | เก็บ ID/hash เดิมและรอ receipt reconciliation อย่าเปลี่ยน contract/payment mode ระหว่างมีธุรกรรมค้าง |

หากหมุนเวียน quote signer ต้องประสานการเปลี่ยนบน chain โดย owner กับ authority key ของแอป แล้ว restart และตรวจซ้ำ การเปลี่ยน fee/signer ทำให้ quotes เดิมใช้ต่อไม่ได้ การ restore ฐานข้อมูลหรือ rollback แอปไม่สามารถย้อน blockchain transfers หรือ contract deployment ได้

ซอร์สอ้างอิง: [deployment](../../scripts/deploy-referral.mjs), [preparation](../../scripts/lib/referral-deployment.mjs), [compiler](../../scripts/lib/compile-contracts.mjs), [verification](../../scripts/verify-referral.mjs), [distributor](../../contracts/ReferralDistributor.sol), [test token](../../contracts/AmoyTestUSDT.sol)
