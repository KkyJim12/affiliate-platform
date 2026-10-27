# คู่มือ API ของ UNXO

[สารบัญเอกสาร](../README.md) · [English](../en/api-reference.md) · [ระบบ](system-guide.md) · [การจ่ายเงิน](payments-and-conditions.md) · [คู่มือปฏิบัติการ](operations.md)

ตรวจสอบวันที่ **27 ตุลาคม 2026** revision `3ffa828` ครบ **52 คู่ method/route** ใต้ `server/api` รวม endpoint รองรับระบบเก่า ตัวอย่างอธิบายการทำงานในโปรเจกต์ ไม่ใช่ API ของ payment gateway ภายนอก

## 1. ข้อตกลงร่วม

- Base path คือ `/api` อยู่ origin เดียวกับแอป Nuxt ส่ง JSON ด้วย `Content-Type: application/json`
- ใช้ browser cookie `loop_session` เป็น HttpOnly, SameSite=Strict อายุ 7 วัน และ Secure บน HTTPS ยังไม่มี API-key/bearer authentication สำหรับชุด API นี้
- POST/PUT/PATCH ต้องมี `Origin` ตรงกับ request origin ทุกตัวอักษร และปฏิเสธ cross-site fetch Wallet authentication production ยังตรวจ `NUXT_PUBLIC_APP_URL` ด้วย
- API ทุกผลลัพธ์ใช้ `Cache-Control: no-store` และ `X-Content-Type-Options: nosniff`
- Middleware ปฏิเสธ `Content-Length` ที่ประกาศเกิน 8,192 bytes ด้วย 413 เป็นการตรวจจาก header ไม่ใช่การรับประกันจำกัด streamed-body ทุกกรณี
- เจ้าของข้อมูลมาจาก session การส่ง account ID/wallet ID ไม่ทำให้เลือกเจ้าของอื่นได้ ส่วน admin network/list มีขอบเขตที่ได้รับสิทธิ์เพิ่มเติมตาม route
- ใช้ UUID `requestKey` หนึ่งค่าต่อธุรกรรมที่ตั้งใจทำหนึ่งรายการ และใช้เดิมเมื่อ retry ตัวตรวจรับตัว hexadecimal/hyphen รวม 36 ตัว รายการใหม่ใช้ key ใหม่ ห้ามอาศัยเปลี่ยน payload ของ key เดิม
- จำนวนเงิน legacy เป็น decimal string ทศนิยมไม่เกิน 6 ตำแหน่ง ช่วง 0.01–999,999,999 ส่วน Send บนเชนเป็นจำนวนบวกตามทศนิยมสินทรัพย์ Raw units/balance บนเชนเป็น string ส่วน ledger/รายงานส่ง number ในหน่วยเต็มของโทเคน

สัญลักษณ์สิทธิ์: **P** ไม่ต้อง session, **M** บัญชี active ที่ login, **A** ผู้ดูแล active สัญลักษณ์โหมด: **X** กระเป๋าภายนอก, **E** embedded, **L** embedded และเปิด ledger ชัดเจน, **C** เปิด password-login flag คำว่า “ทุกโหมด” หมายถึง endpoint ไม่ได้จำกัดด้วยโหมดนั้น รวมถึงการอ่านประวัติ

## 2. Authentication และข้อมูลสาธารณะ — 12 routes

| Method | Endpoint | สิทธิ์ / โหมด | ข้อมูลเข้าและผลลัพธ์ |
| --- | --- | --- | --- |
| GET | `/api/auth/session` | P / ทุกโหมด | `{user: Account หรือ null}` |
| POST | `/api/auth/wallet/challenge` | P เมื่อ login, M เมื่อ link / X | `{address,purpose?,sponsorCode?}` → `{id,message}`; purpose เริ่มต้น `login` หรือ `link`; อายุ 5 นาที |
| POST | `/api/auth/wallet/verify` | ลายเซ็น; M เมื่อ link / X | `{id,signature}` → `{user}` และ session cookie; กระเป๋าสมาชิกใหม่สร้างบัญชีเมื่อเปิดสมัคร |
| POST | `/api/auth/register` | P / E+C | `{password,sponsorCode?}` → `{user}`, HTTP 201/session; ระบบสร้าง `memberId` และกระเป๋าเข้ารหัส |
| POST | `/api/auth/login` | P / C | `{memberId,password}` → `{user}` และ session; external ที่ผูกแล้วต้องใช้ wallet login |
| PATCH | `/api/auth/profile` | M / ทุกโหมด | Route เดิมที่ตรวจสิทธิ์ คืน 409 เพราะ ID ที่ระบบกำหนดแก้ไม่ได้ |
| POST | `/api/auth/logout` | P / ทุกโหมด | ไม่บังคับ body → `{success:true}`; ยกเลิก session ปัจจุบันที่ส่งมา |
| POST | `/api/admin/login` | P พร้อมข้อมูลผู้ดูแล active / ทุกโหมด | `{memberId,password}` → `{user}` และ session; ไม่ขึ้นกับ member password-login flag |
| GET | `/api/platform-settings` | P / ทุกโหมด | `{registrationOpen,fundingOpen,supportEmail,feeRecipientAddress}` |
| GET | `/api/referrals/tree` | P / ทุกโหมด | Query `id`, `path?`, `levels?` → ผังสายผู้แนะนำสาธารณะ |
| GET | `/api/platform/transactions` | P / ทุกโหมด | ธุรกรรม distributor ปัจจุบันที่บันทึกไว้ มีตัวกรองด้านล่าง |
| GET | `/api/platform/analytics` | P / ทุกโหมด | บัญชีรวม การซื้อ/แบ่งจ่ายที่ confirmed และกิจกรรม 30 วัน |

`Account` มี `id` เป็น UUID ภายใน, `memberId` เป็น numeric string, `referralCode` ซึ่งเป็น null ก่อนเปิด, `sponsorCode`, `createdAt`, `role` ผังสาธารณะไม่เปิด UUID ภายใน ผู้ดูแลใช้ wallet challenge มาแทน admin credential login ไม่ได้

## 3. สมาชิก กระเป๋า และธุรกรรม connected — 18 routes

| Method | Endpoint | สิทธิ์ / โหมด | ข้อมูลเข้าและผลลัพธ์ |
| --- | --- | --- | --- |
| GET | `/api/dashboard` | M / ทุกโหมด | แยกคอมมิชชัน pending funding เดิม จำนวนโอนภายใน และยอดเครือข่าย |
| GET | `/api/referrals` | M / ทุกโหมด | `{members,network,truncated}`; ลูกตรงและเครือข่ายไม่เกิน 15 ชั้น ส่ง network สูงสุด 500 คน |
| GET | `/api/referrals/program` | M / ทุกโหมด | Activation/code/sponsor เลเวล (Level) ปัจจุบัน/ถัดไป ราคา และสรุปการซื้อ ledger ล่าสุด |
| POST | `/api/referrals/sponsor` | M / ทุกโหมด | `{code}` → `{user,wallet,program}`; ผูก sponsor ที่ active/activated ครั้งเดียว ปฏิเสธ pending purchase วงจร และตนเอง |
| GET | `/api/referrals/chain/status` | M / ทุกโหมด | `ReferralChainStatus`; พยายามตรวจรายการซื้อค้างของเจ้าของ |
| GET | `/api/referrals/chain/purchases` | M / ทุกโหมด | Array `ChainPurchaseStatus` ล่าสุด 20 รายการ |
| POST | `/api/referrals/chain/prepare` | M / X | `{level,requestKey}` → `{id,status,calls}`; บันทึก authorization และส่ง unsigned approval/purchase calls |
| POST | `/api/referrals/chain/confirm` | M / X | `{id,transactionHash}` → `ChainPurchaseStatus`; ตรวจธุรกรรม purchase ที่ส่งมา |
| GET | `/api/wallet` | M / ทุกโหมด | `WalletSummary` ledger เดิมและรายการล่าสุดไม่เกิน 200 ไม่ใช่ยอดโทเคน EVM ปัจจุบัน |
| GET | `/api/wallet/evm` | M / ทุกโหมด | `{wallet}` หรือ `{wallet:null}`; รายละเอียดที่อยู่/เครือข่ายตามโหมด External public key เป็น null |
| GET | `/api/wallet/evm/balance` | M / ทุกโหมด | `{address,chainId,blockNumber,native,token}` ของตนเอง; token อาจ null อ่าน Amoy ที่บล็อกเดียว |
| GET | `/api/wallet/evm/transactions` | M / ทุกโหมด | `{address,chainId,transactions,limit}`; ประวัติ indexed native/ERC-20 สูงสุด 50 |
| GET | `/api/wallet/evm/sends` | M / ทุกโหมด | `{sends}`; รายการ embedded ที่ส่งล่าสุด 20 พร้อม reconcile ไม่ใช่ external-operation list |
| POST | `/api/wallet/connected/send` | M / X | `{asset,recipient,amount,requestKey}` → `ExternalOperation` มี unsigned send call |
| POST | `/api/wallet/connected/confirm` | M / X | `{id,transactionHash}` → `ExternalOperation`; ยืนยัน send/fee intent ของตน |
| GET | `/api/wallet/connected/operations` | M / ทุกโหมด | External send/fee ล่าสุด 20 พร้อมตรวจ receipt |
| GET | `/api/explorer/network` | M / ทุกโหมด | Query `root?` → สาขาส่วนตัวที่มีสิทธิ์ |
| GET | `/api/explorer/transactions` | M / ทุกโหมด | กรอง/แบ่งหน้ารายการ ledger เดิมของตน |

`GET /api/wallet/evm/balance` คืน 404 ถ้าไม่มีกระเป๋า และ 503 ถ้า RPC/config/token อ่านไม่สำเร็จ สินทรัพย์มี `symbol`, `decimals`, `balanceUnits`, `balance` โดย units/balance เป็น string ผู้เรียกส่ง owner address มาเลือกเองไม่ได้

Indexed history มี hash/from/to, direction (`sent`,`received`,`self`), kind (`native`,`erc20`), action (`transfer`,`contractCall`,`contractCreation`), status, จำนวนทศนิยม symbol/token address เวลา ISO ตำแหน่ง block/transaction และ explorer URL ถ้าไม่มี explorer credentials หรือ provider ล้มเหลวคืน 503 ต่างจากผลรายการว่างที่อ่านสำเร็จ ไม่รวม internal native transfer/NFT

## 4. การเขียน embedded และ legacy — 9 routes

| Method | Endpoint | สิทธิ์ / โหมด | Body และผลลัพธ์ |
| --- | --- | --- | --- |
| POST | `/api/wallet/evm` | M / E | `{password}` → `{wallet}`; สร้างถ้ายังไม่มี เรียกซ้ำไม่สร้างทับ |
| POST | `/api/wallet/evm/reveal` | M / E | `{password}` → `{privateKey}` หลังตรวจรหัสและถอด keystore |
| POST | `/api/wallet/evm/send/quote` | M / E | `{recipient,asset,amount}` → `{quote}` มี ID review hash งบ gas อายุ 5 นาที |
| POST | `/api/wallet/evm/send` | M / E | `{id,quoteHash,requestKey,password}` → `{send}`; pending คืน 202 มิฉะนั้น 200 |
| POST | `/api/referrals/chain/purchase` | M / E และ contract payment | `{password,level,requestKey}` → `ChainPurchaseStatus`; pending คืน 202 มิฉะนั้น 200 |
| POST | `/api/wallet/deposit` | M / E และเปิด funding | `{amount,requestKey}` → `WalletSummary`; สร้างคำขอ pending โดยไม่เพิ่มเครดิต |
| POST | `/api/wallet/transfer` | M / E | `{amount,recipient,password,requestKey}` → `WalletSummary`; `recipient` คือ ID สมาชิกที่ active |
| POST | `/api/referrals/activate` | M / L | `{password,requestKey}` → `{user,wallet,program}`; ซื้อ level 1 ด้วยเครดิตครั้งเดียว |
| POST | `/api/referrals/upgrade` | M / L | `{password,requestKey,level}` → `{user,wallet,program}`; เฉพาะเลเวล (Level) ถัดไป 2–15 |

บาง route ตรวจ mode ภายใน utility ไม่ใช่ใน handler โดยตรง การมี session ไม่ยกเลิกการตรวจรหัสผ่านของ embedded write ที่อ่อนไหว หน้าจอซ่อน embedded private key หลัง 30 วินาที และเมื่อปิด เปลี่ยนหน้า ซ่อน tab หรือเปลี่ยนบัญชี External mode ปิดฟีเจอร์เปิดเผย key นี้

## 5. การจัดการของผู้ดูแล — 13 routes

Admin login ถูกนับในข้อ 2 แล้ว ทุก route ด้านล่างต้องมี **A**

| Method | Endpoint | โหมด / เงื่อนไขเพิ่ม | ข้อมูลเข้าและผลลัพธ์ |
| --- | --- | --- | --- |
| GET | `/api/admin/overview` | ทุกโหมด | จำนวนบัญชี ledger/funding เดิม การเติบโต 7 วัน UTC payment และ audit ล่าสุด |
| GET | `/api/admin/users` | ทุกโหมด | Query `page,search,status` → `{items,total,page,pageSize}` |
| PATCH | `/api/admin/users/:id` | ทุกโหมด | `{status}` (`active`/`suspended`) → `{ok:true}`; แก้ ID ไม่ได้และป้องกันบัญชี admin |
| GET | `/api/admin/settings` | ทุกโหมด | `PlatformSettings` |
| PUT | `/api/admin/settings` | ทุกโหมด | `{registrationOpen,fundingOpen,supportEmail,feeRecipientAddress?}` → settings; contract mode ห้ามเปลี่ยน chain recipient ทางนี้ |
| GET | `/api/admin/referrals/status` | ทุกโหมด | `{chain,canManageFee,feeUpdate,totals}`; reconcile chain; totals อาจรวม distributor เก่าที่บันทึกไว้ |
| POST | `/api/admin/referrals/prepare-fee` | X และ linked wallet เป็น owner ปัจจุบัน | `{address,requestKey}` → unsigned fee `ExternalOperation`; ให้กระเป๋าลงนามแล้วใช้ connected confirm |
| POST | `/api/admin/referrals/fee` | E และ embedded wallet เป็น owner | `{password,address,requestKey,maxGasFee}` → `{status,transactionHash}`; pending คืน 202; งบ gas เป็น decimal POL |
| GET | `/api/admin/referral-accounting` | ทุกโหมด อ่าน ledger เดิม | `{credited,payables}` รวมตาม legacy fee address ไม่ใช่หลักฐาน settle บนเชน |
| GET | `/api/admin/payments` | ทุกโหมด อ่าน funding เดิม | Query `page,search,status` → คำขอเติมและ review แบบแบ่งหน้า |
| POST | `/api/admin/payments/:id` | ทุกโหมด ตรวจ funding เดิม | `{decision,reference?,note?,verified?}` → `{ok:true}`; approve/reject ตามกติกาตรวจรับ |
| GET | `/api/admin/explorer/network` | ทุกโหมด | Query `root?` หรือ `memberId?` ตรงตัว → สาขาส่วนตัวของบัญชีใดก็ได้ |
| GET | `/api/admin/explorer/transactions` | ทุกโหมด | ค้นหา/กรอง/แบ่งหน้า ledger ข้ามบัญชี |

API ตรวจรับ funding ยังใช้ได้สำหรับผู้ดูแลที่มีสิทธิ์ แม้หน้าตรวจ payment ส่งต่อไป dashboard Approve ต้อง `verified:true` และ reference ไม่ซ้ำยาว 6–160 ตัว Reject ต้อง note 3–500 ตัว Retry รายละเอียดเดิมไม่เพิ่มรายการซ้ำ `supportEmail` เว้นว่างได้ มิฉะนั้นต้องผ่านรูปแบบอีเมลและไม่เกิน 254 ตัว Fee address ต้องเป็น EVM ไม่ใช่ศูนย์ และ chain fee preparation ห้ามใช้ที่อยู่ distributor เอง

## 6. Query และโครงสร้างผลลัพธ์

### ผังสาธารณะ

```text
GET /api/referrals/tree?id=1&path=0/2&levels=3
```

`id` เป็น numeric string จำนวนเต็มบวกที่เป็น safe integer ยาวไม่เกิน 16 หลัก `path` ว่างได้หรือเป็นเลขลำดับลูกคั่น `/` เลขเกิน 1 ได้เพราะลูกตรงทุกคนอยู่ใต้ sponsor จริง แต่ละช่วงเป็น `0` หรือจำนวนเต็มบวกไม่เกิน 9 หลัก รวมไม่เกิน 15 ช่วง `levels` รับจำนวนเต็ม 1–15 เริ่มต้น 3 และจำกัดตามความลึกที่เหลือ

คืน `{root,path,maxDepth:15,visibleDepth,members,levels}` สมาชิกมี `{id,path,parentId}` ใช้ ID สาธารณะตัวเลข ส่วนจำนวนรายชั้นเป็น `{depth,filled}` ไม่มี binary capacities ข้อมูลกระเป๋าส่วนตัว หรือสถานะบัญชี ไม่พบ ID คืน 404 Query ผิดคืน 400 ข้อมูล binary placements ไม่ใช่สายที่ endpoint ปัจจุบันใช้

### กิจกรรมและ analytics สาธารณะ

พารามิเตอร์ `/api/platform/transactions`:

| พารามิเตอร์ | ค่าที่รับ |
| --- | --- |
| `search` | Hash/address ไม่แยกตัวพิมพ์ trim ไม่เกิน 100 ตัว |
| `kind` | `all`, `purchase`, `fee_update` |
| `status` | `all`, `pending`, `confirmed`, `failed` |
| `period` | `all`, `7`, `30`, `90` วัน |
| `page` | เริ่มจาก 1 จำกัด 1–100000 |

ผลลัพธ์ `{configured,contractAddress,chainId,items,total,page,pageSize:12,summary}` Summary อิงตัวกรองที่เลือก Volume นับเฉพาะ purchase confirmed รวม purchase/fee-update hashes ของ distributor ปัจจุบันที่บันทึกไว้และตัด hash ซ้ำ ไม่รวม unsigned quote, ledger ส่วนตัว, Send ที่ไม่เกี่ยว หรือ direct call นอกแพลตฟอร์มที่ยังไม่ถูก index

`/api/platform/analytics` คืน `{configured,contractAddress,chainId,updatedAt,accounts,activeMembers,buyers,purchases,transactions,volume,distributions,daily,levels}` สถิติสัญญาใช้ confirmed ของ distributor ปัจจุบัน Active members ไม่นับ suspended/admin `daily` เป็น 30 วันตาม Asia/Bangkok และ `levels` ครบ 1–15 เป็นตัวเลขโทเคนทดสอบ

### Private explorer และรายการแบ่งหน้า

Private network ใช้ query `root` เป็น UUID ภายใน สมาชิกดู root ตนเองหรือลูกใน 15 ชั้นเดิมได้ ไม่มีสิทธิ์/ไม่พบใช้ 404 เดียวกัน ผู้ดูแลใช้ `memberId` ตัวเลขได้ คืน `{root,members,truncated,remainingDepth}` สูงสุด 500 คน

Ledger explorer รับ `search`, `type`, `status`, `period`, `page` ประเภทคือ `all`, `deposit`, `withdrawal`, `transfer_in`, `transfer_out`, `commission`, `referral_purchase` สถานะ `all`, `pending`, `completed`, `rejected` ช่วง `all`, `7`, `30`, `90` ส่งหน้าละ 12 พร้อม `{items,total,page,pageSize,summary}` สรุป credit/debit/pending การมีตัวกรอง `withdrawal` ไม่ได้หมายความว่ามี endpoint สร้างคำขอถอน

รายการ admin users/payments ใช้ `page`, `search`, `status` หน้าละ 12 Search trim ไม่เกิน 64 ตัว User status ใช้ `all`, `active`, `suspended` ส่วน payment ใช้ `all`, `pending`, `completed`, `rejected`

### Models หลัก

```typescript
type ChainPurchaseStatus = {
  id: string; level: number;
  status: 'awaiting_signature' | 'pending' | 'confirmed' | 'failed';
  transactionHash: string | null; explorerUrl: string | null;
};

type ReferralChainStatus = {
  mode: 'contract' | 'ledger'; configured: boolean; ready: boolean;
  chainId: number; contractAddress: string | null; tokenAddress: string | null;
  tokenSymbol: string | null; feeRecipient: string | null; owner: string | null;
  balance: string | null; gasBalance: string | null; gasBudget: string | null;
  currentLevel: number | null; pending: ChainPurchaseStatus | null; error?: string;
};
```

การอ่าน purchase status ปกติไม่ตรวจยอด POL หรือ gas estimate ค่า gas จึง null ส่วน embedded admin status ขอรายละเอียด gas ได้ `ready` ไม่ได้รับประกันว่าเงินพอหรือธุรกรรมถัดไปสำเร็จ

`ExternalOperation` มี `id`, `kind` (`send`/`fee`), `status`, `transactionHash`, `call`, `recipient` และอาจมี `amount`, `symbol`, `gasBudget` Unsigned call มี sender target calldata value chain ID และอาจมี nonce ผล prepare ยังไม่ใช่การ broadcast หรือ settle

`WalletSummary` มี `id`, `currency`, `available`, `reserved`, `earned`, `transactions` ส่วน `ReferralProgram` มี `price`, `code`, `activatedAt`, `transactionId`, `currentLevel`, `maxLevel`, `nextLevel`, `nextPrice`, `feeConfigured`, `latestPurchase`, `sponsor` โดย latestPurchase เป็นข้อมูล ledger เดิม ถ้าซื้อบนเชนใช้ chain purchases/status

## 7. ตัวอย่าง request และลำดับใช้งาน

ตัวอย่างใช้ placeholder สำหรับ address ลายเซ็น และ hash ต้องแทนด้วยค่าของบัญชีจริง ไม่ใช่ข้อมูลใช้จ่ายที่รันได้ทันที

ขอ login challenge ลงนาม `message` ที่ส่งกลับทุกตัวอักษรในกระเป๋า แล้ว verify:

```json
{"address":"<connected EVM address>","purpose":"login","sponsorCode":"1"}
```

```json
{"id":"<challenge ID>","signature":"<wallet signature>"}
```

เมื่อมี session แล้ว เตรียมซื้อเลเวล (Level) ถัดไป:

```json
{"level":1,"requestKey":"e46f9527-450d-4b22-a087-ecb482c5aac1"}
```

ส่ง calls ตามลำดับจากกระเป๋าที่ผูก: reset allowance ถ้ามี, approve เท่าราคา, purchase หลังส่ง **purchase** แล้วจึงส่ง hash ไป `/api/referrals/chain/confirm`:

```json
{"id":"<prepared purchase ID>","transactionHash":"<purchase transaction hash>"}
```

อ่าน chain status จนผ่านการตรวจ การรับทราบของกระเป๋าหรือ hash ของ approve อย่างเดียวยังไม่เปิดรหัส Purchase recovery ค้นหา signed ID บนเชนได้ แต่ยังไม่มี replacement discovery สำหรับ external transfer ทั่วไป

ส่งสินทรัพย์ผ่าน `/api/wallet/connected/send`:

```json
{"asset":"token","recipient":"<recipient EVM address>","amount":"10.25","requestKey":"de826b7a-e238-4134-b43d-06820be97bf7"}
```

ให้กระเป๋าลงนาม/broadcast `call` แล้วส่ง `{id,transactionHash}` ไป `/api/wallet/connected/confirm` หากใช้ connected send/fee key เดิมจะได้ operation เดิมของชนิดนั้น ห้ามใช้กับรายละเอียดการจ่ายที่เปลี่ยนไป Native ใช้ `asset:"native"` ต้องมี POL ทั้งยอดส่งและ gas

ตัวอย่างผู้ดูแลอนุมัติคำขอเติม legacy ที่มีอยู่:

```json
{"decision":"approved","reference":"<unique verified receipt reference>","verified":true,"note":"Receipt checked by operator"}
```

เป็นการบันทึกการตรวจของผู้ดูแลและเพิ่ม ledger แบบ atomic ไม่ได้เชื่อมธนาคารหรือตรวจ token deposit ให้อัตโนมัติ

## 8. Rate limits และ errors

จำกัดตาม scope และ IP โดยรวม account ID เมื่อ scope ระบุบัญชี ในหน้าต่าง 15 นาที ถ้าเกินคืน 429 พร้อม `Retry-After: 900`

| Scope/การทำงาน | จำนวนครั้ง / 15 นาที |
| --- | ---: |
| สมัคร legacy / member login / admin login | 10 / 30 / 15 |
| Wallet challenge / verify | 50 / 40 |
| เปลี่ยน profile / ผูก sponsor | 30 / 15 |
| Chain prepare / confirm / embedded purchase | 40 / 100 / 30 |
| Legacy activation / upgrade | 12 / 30 |
| Balance / indexed history | 60 / 30 |
| สร้าง embedded wallet / เปิด key | 5 / 5 |
| External send prepare / operation confirm | 40 / 100 |
| Embedded send quote / submit | 40 / 20 |
| ขอเติม legacy / โอนภายใน | 30 / 15 |
| Admin เปลี่ยน user / payment review / settings | 60 / 60 / 30 |
| External fee prepare / embedded fee submit | 30 / 20 |

ไม่ใช่ทุก read endpoint จะเรียก rate limit แยกราย route HTTP สำเร็จหมายถึง handler สำเร็จ ไม่จำเป็นว่าธุรกรรม blockchain confirmed ต้องอ่านสถานะผลลัพธ์

| HTTP status | ความหมายทั่วไป |
| --- | --- |
| 200 / 201 / 202 | สำเร็จ / สร้างบัญชี legacy แล้ว / embedded transaction ยัง pending |
| 400 | Body/query/address/amount ไม่ถูกต้อง หรือรายละเอียดธุรกรรมใช้ไม่ได้ |
| 401 | Session ไม่มี/หมดอายุ credentials/signature/password ไม่ถูกต้อง |
| 403 | Role/origin/mode ผิด ระงับบัญชี หรือปิดการทำงานนั้น |
| 404 | ไม่พบรายการของตน กระเป๋า สมาชิก หรือสาขาส่วนตัวที่เข้าถึงได้ |
| 409 | สถานะขัดแย้ง มีงานค้าง เลเวล (Level) ไม่ตรง quote เก่า หรือใช้ intent/reference ซ้ำ |
| 413 | Content-Length ที่ประกาศเกินกำหนด |
| 429 | เกินอัตราการเรียก |
| 503 | ขาด config blockchain/explorer หรือ provider ไม่พร้อม |
| 500 | ปัญหาภายใน เช่น สถานะกระเป๋าที่เก็บไว้ใช้ไม่ได้ |

Nuxt/H3 อาจส่ง `statusMessage` และ UI แปลจากข้อความคงที่ ไม่ควรถือว่ารายละเอียดส่วนตัวของ provider หรือ signing secret เป็น field ที่ใช้ได้ ตรวจรายการที่ยังสรุปไม่ได้ด้วย ID/hash เดิมแทนการสร้างการจ่ายใหม่

## 9. แหล่งอ้างอิง

[Route handlers ทั้งหมด](../../server/api), [Auth และ Origin](../../server/utils/auth.ts), [API headers](../../server/middleware/api-headers.ts), [Mode checks](../../server/utils/wallet-mode.ts), [Shared types](../../shared), [External transaction flow](../../server/utils/external-wallet.ts), [กติกาจ่ายเงิน](payments-and-conditions.md)
