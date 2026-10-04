# CUSTOMER APP (`/app`, `src/customer/`) — Gap Audit, Code-Verified

Date: 2026-10-04 · Branch: `arena/01a10531-fanal-templetes-app` · Base: `124aa2c`
Method: static read of `src/customer/**`, `src/lib/customer/**`, `server/customer*.ts`,
`server/websiteContent.ts`, `server/siteLookup.ts`, `src/lib/websitePackages.ts`,
`supabase/migrations/*.sql`.

Legend: ✅ present · ⚠️ partial / conditional · ❌ absent · 🔴 bug (code exists but cannot work)

---

## 0. Verdict on the submitted audit

| # | Aapka claim | Verified status | Evidence |
|---|---|---|---|
| 1 | Gender filter ❌ "pure customer code me 0 baar" | **GALAT** — filter UI + client-side logic maujood hai, par **kaam nahi karta** (🔴) | `src/customer/screens/Discover.tsx:431` (`<select>` Any/All genders/Women/Men/Kids), `:321` (filter), `src/lib/customer/types.ts:67` (`serviceGenders`) |
| 2 | Rating filter ⚠️ verify nahi | **✅ FULL** — server-side, dono data paths me | `server/customerRoutes.ts:520,573`; `server/customerSalonDirectory.ts:82`; UI `Discover.tsx:403-417` (any / ★4+ / ★4.5+) |
| 3 | Packages ⚠️ "`packages: []` hardcoded" | **GALAT (stale)** — hardcode hat chuka, par **3 alag reasons se tab khali rehta hai** (🔴) | `server/customerSalonDirectory.ts:72` ab `resolveWebsitePackages(...)` call karta hai |
| 4 | Remaining amount ❌ "clearly nahi dikhta" | **GALAT** — computed + rendered dono jagah | `src/lib/customer/mappers.ts:399` (`balanceDue`), `src/customer/screens/Bookings.tsx:374-376` (`₹X paid` / `₹Y due`), `src/components/BookingDetailPage.tsx:121-124` |
| 5 | Recently viewed ✅ | **GALAT** — sirf **recent searches** hai, recently-viewed salons nahi | `src/lib/customer/deviceStore.ts:177-221`, `Discover.tsx:81` (`readSearchHistory`) |
| 6 | Card se direct Book Now ⚠️ | **✅** — card CTA `onBook(salon.id)` → booking flow | `Discover.tsx:227`, profile CTA `:643,:910` |
| 7 | Area search ⚠️ | **⚠️ mode-dependent** — normalized path me `area` term me match hota hai, legacy `profiles` path me **nahi** | `customerSalonDirectory.ts:80` (`[s.name,s.city,s.area,...]`) vs `customerRoutes.ts:534` (`salon_name,tagline,city,business_type` only) |
| 8 | Forgot/Reset password ❌ | **✅ CONFIRMED absent** — customer `Auth.tsx` me sirf `login`/`signup`; recovery `src/onboarding/lib/auth.ts` + `src/lib/partnerPortalAuth.ts` me already implemented hai (reuse ho sakta hai) | `src/customer/screens/Auth.tsx:28-32,78-109` |
| 9 | Tax/GST, platform fee, discount, coupon in summary ❌ | **✅ CONFIRMED absent** — summary me sirf subtotal + deposit | `Book.tsx:745-751`; `server/customerRoutes.ts:1608-1659` (`BookingIntent` me koi fee/tax/discount field nahi) |
| 10 | Refund info ❌ | **✅ CONFIRMED** — `refund` word 0 baar `src/customer/**` me; cancel sirf reason leta hai | `customerRoutes.ts:2331-2420` |
| 11 | Payment history screen ❌ | **✅ CONFIRMED** — koi `payments` table nahi (sirf `customer_qr_payments`), koi `/api/customer/me/payments` endpoint nahi; deposit sirf `bookings.advance_paid_amount` + `payment_id` par rehta hai | `supabase/migrations/00001_init.sql:186-210`; `src/lib/customer/api.ts` (endpoint list) |
| 12 | Slot hold timer ❌ | **✅ CONFIRMED** — availability live derive hoti hai (`stylists.schedule` − `bookings`), koi hold/lock nahi | `src/lib/customer/schema.ts:220-228` |
| 13 | Similar salons ❌ / Featured ❌ / Quick booking ❌ | **✅ CONFIRMED** — teeno ke liye 0 code | grep: `similar`, `featured` → no hits in `src/customer/**` |
| 14 | Review tags ❌ | **✅ CONFIRMED** — review payload sirf `{id, rating, text}` | `src/lib/customer/api.ts:626-637` |
| 15 | Saved addresses (multiple) ❌ | **✅ CONFIRMED** — ek free-text `homeAddress` (≤300 chars) + profile ka ek address; koi address book nahi | `Book.tsx:127,771`; `customerRoutes.ts:2097,2271` |
| 16 | Profile gender ❌ | **✅ CONFIRMED** — `profiles` me gender column nahi; website-save RPC public profile se `gender` key **strip** karta hai (PII policy) | `supabase/migrations/20261031000000_fix_website_save_and_public_site.sql:778` |
| 17 | Language DB me save nahi ⚠️ | **✅ CONFIRMED** — device-local, code ka apna comment yahi kehta hai | `src/customer/screens/Settings.tsx:10,187`; `deviceStore.ts:79-88`; `schema.ts:548-549` |
| 18 | Notification preferences ⚠️ | **❌ ABSENT** — schema me column hi nahi, Settings me toggle nahi | `src/customer/screens/Settings.tsx:6` |
| 19 | Booking reminder / customer re-engagement ❌ | **✅ CONFIRMED** — `reminder` 0 hits; notifications sirf event-driven inserts (booking create/cancel/reschedule), koi scheduler/cron nahi | `customerRoutes.ts:1431,2211`; `supabase/functions/notifications/index.ts` (sirf list + mark-read) |
| 20 | Reschedule = propose only ⚠️ | **✅ CONFIRMED** — `status='reschedule_proposed'` + `proposed_date/proposed_time_slot`; salon approval zaroori | `customerRoutes.ts:2376-2402`; `bookings` columns `00001_init.sql:203-205` |
| 21 | Rewards QR / pass / referral / staff select / data panel ✅ | **✅ CONFIRMED (extras)** | `Pass.tsx`, `Rewards.tsx`, `Activity.tsx:330` (schema map panel) |

**Score: 21 me se 17 claims sahi, 4 galat (1, 3, 4, 5).**

---

## 1. 🔴 Naye bugs jo audit ne nahi pakde

### 1.1 Gender filter hamesha "All genders" dega — filter dead hai

Chain:

1. `server/siteLookup.ts:mapServiceRow()` service row map karta hai par **`gender` field set hi nahi karta** (na DB column, na return object me).
2. `services` table me **gender column hi nahi** (kisi bhi migration me `add column ... gender` nahi; sirf `profiles` ke PII-strip context me word aata hai).
3. `server/websiteContent.ts:mergeServicePresentation()` gender sirf `salons.data.editor_services` JSON se la sakta hai — yaani **owner ne website editor me manually set kiya ho tabhi**.
4. `server/customerSalonDirectory.ts:68`: `serviceGenders: [...new Set(menu.map(s => s.gender || 'All genders'))]` → step 1-3 ki wajah se practically hamesha `['All genders']`.
5. `Discover.tsx:321` client-side filter: `(salon.serviceGenders || ['All genders']).includes(filters.gender)` → **"Women"/"Men"/"Kids" select karte hi poori list khaali** (kyunki fallback array me sirf 'All genders' hai).
6. Legacy `profiles` path me `toCustomerSalon()` (`src/lib/customer/mappers.ts`) `serviceGenders` set hi nahi karta → `undefined` → wahi fallback → wahi khaali list.

Net effect: feature UI me dikhta hai, select karte hi 0 results. Audit ka "❌ nahi mila" isliye galat tha, par user experience ke hisaab se "❌ kaam nahi karta" sahi hai.

Extra: `EMPTY_DISCOVERY_FILTERS` (`Discover.tsx:280`) me `gender`/`maxDistance` keys nahi hain — clear button inhe hata deta hai (kaam chalta hai, par type-level inconsistency).

### 1.2 Packages tab khali rehne ke 3 alag root causes (hardcode nahi)

`server/customerSalonDirectory.ts:72`:

```ts
packages: resolveWebsitePackages(
  profile.packages?.map(p => ({ ...p, serviceIds: p.serviceIds.map(id => catalogId(row.id, 'service', id)) })),
  menu
).map(...)
```

`src/lib/websitePackages.ts` ek package **tabhi rakhta hai jab uske saare `serviceIds` `menu` me mil jaayein** (`items.length !== ids.length → return []`), aur price/duration items se recompute karta hai.

Failure modes:

| Cause | Detail |
|---|---|
| **A. ID-space mismatch (primary)** | `menu` ke ids `services.id` = **DB UUID** hain (`mapServiceRow` row.id use karta hai). Editor ke package `serviceIds` mostly **editor-local keys** hain; `catalogId()` unhe md5-derived UUID bana deta hai (`normalizedBookingCreate.ts:catalogId`) jo DB UUID se match nahi karta → har package drop. Compare: `server/siteLookup.ts:475` profile path me same `catalogId` mapping karta hai — yaani mismatch system-wide hai, sirf yahan visible hota hai. |
| **B. Legacy mode** | `readNormalizedSalonDirectory()` null return kare (no `salons` rows) → `customerRoutes.ts:626-672` `profiles`-based fallback chalta hai → usme **`packages` field set hi nahi hota** (`toCustomerSalon` me nahi) → tab hamesha "No packages published". |
| **C. Silent drop** | Ek bhi service inactive/rename/delete → poora package gayab, koi log/error nahi. Owner ko kabhi pata nahi chalega. |

Note: `resolveWebsitePackages` package ka `price` **items ke sum se override** karta hai — owner ne editor me package price set kiya ho to wo ignore hota hai (business-rule decision, bug nahi, par document karna chahiye).

### 1.3 `src/lib/customer/schema.ts` ka documentation panel ab galat hai

`schema.ts:6-16,538` kehta hai "`salons` table nahi hai, salon = owner profile row", "no `customer_qr_payments` table". Reality:

- `salons` table `supabase/migrations/20261002_owner_workspace_provisioning.sql:175` me banti hai, aur `20261031000000_fix_website_save_and_public_site.sql:56-92` me `area, city, latitude, is_listed, is_verified, online_booking_enabled…` columns add hote hain.
- `customer_qr_payments` table `20260908_complete_rewards_qr_referrals_backend.sql:438` me banti hai (code use nahi karta — QR ab bhi `loyalty_point_transactions` ledger se chalta hai).

Ye panel customer app ke **Activity → Data** tab me render hota hai (`Activity.tsx:330`) aur `/api/customer/...` mapping report me bhi aata hai (`customerRoutes.ts:193,360`). Yaani customer ko app ke andar **jhootha schema status** dikh raha hai. Isse "dual data path" confusion bhi samajh aata hai:

```
/api/customer/salons        → readNormalizedSalonDirectory()  [salons + services + staff + salon_hours]
                              ↓ null (tables/rows absent)
                            → legacy profiles path            [profiles + services(owner_id) + stylists + clients]
```

Dono paths ke feature sets alag hain — packages, serviceGenders, area, publishedServices/Staff/Reviews **sirf normalized path** me hain. Audit ke kai "⚠️ verify nahi" isi dual-path ki wajah se the.

---

## 2. Confirmed gaps — root cause + kya chahiye + effort

| # | Gap | Root cause (code-level) | Kya chahiye | Effort |
|---|---|---|---|---|
| G1 | Forgot / reset password | `Auth.tsx` me sirf `signUp`/`signInWithPassword`; Supabase `resetPasswordForEmail` call hi nahi | `Auth.tsx` me "Forgot password" mode + `supabase.auth.resetPasswordForEmail(email, { redirectTo })` + `/app` par `updateUser` handler. Pattern already exists: `src/onboarding/lib/auth.ts`, `src/lib/partnerPortalAuth.ts` | **S (2-3h)** — no DB change |
| G2 | Booking summary: discount / coupon / tax / platform fee | `BookingIntent` (`customerRoutes.ts:1476-1660`) me sirf `subtotal` + `deposit`; offers sirf `loyalty_rewards` redeem (`:3478-3493`) se judte hain, booking se nahi; koi tax/fee config nahi | (a) `profiles`/`salon_booking_settings` me `tax_percent`, `platform_fee` columns, (b) offer/coupon apply endpoint jo `bookings.metadata.pricing` me breakdown likhe, (c) `Book.tsx:745-751` me rows, (d) server-side recompute (client par bharosa nahi — `computeAdvanceDeposit` pattern follow karein) | **L (2-3 din)** — migration + backend + UI |
| G3 | Refund info + cancellation policy | `refund` 0 mentions; cancel handler (`:2331-2375`) sirf status/reason likhta hai; deposit `bookings.advance_paid_amount` me hai par koi refund ledger nahi | `cancellation_policy` (salon-level) + refund ledger rows (`bookings.metadata.refund` ya naya table) + `Bookings.tsx` detail me "refundable ₹X / non-refundable" line | **M-L** |
| G4 | Payment history | Koi `payments` table nahi; deposit ka record sirf booking row par (`payment_status`, `payment_id`, `advance_paid_amount`) | Option A (cheap): `/api/customer/me/payments` jo bookings se derive kare (jo `balanceDue` already karta hai). Option B (proper): `customer_payments` table + Razorpay verify/webhook se insert (`razorpayWebhook.ts` me hook point hai) | **M (A: 0.5d, B: 1.5d)** |
| G5 | Packages kaam nahi karte | §1.2 (A/B/C) | (1) `resolveWebsitePackages` ko tolerant banao — unmatched ids par drop ki jagah partial package + `warnings`, (2) editor serviceIds ↔ `services.id` mapping ek hi jagah normalize karo (`siteLookup.ts:475` wala `catalogId` call yahan bhi), (3) legacy path me bhi `packages` bharo (`profiles.data`/offers se), (4) drop hone par server log | **M (1 din)** |
| G6 | Gender filter / service gender / profile gender | §1.1 + `profiles` me gender column nahi (RPC public profile se strip karta hai) | (1) `services` me `gender` column **ya** editor JSON ko authoritative maan kar `mapServiceRow` me gender passthrough, (2) filter ko **server-side** bhejo (`searchSalons` query param — abhi client-side hai, `limit:60` page par hi lagta hai), (3) fallback `['All genders']` ki jagah "unknown → match any", (4) profile gender: `profiles` me column + `saveMyProfile` whitelist (`customerRoutes.ts:1121-1135`) | **M** |
| G7 | Multiple saved addresses | `bookings.home_address` ek text column; profile ka ek address; koi address entity nahi | `customer_addresses` table (user_id, label, line1, landmark, area, city, pincode, is_default) + `/api/customer/me/addresses` CRUD + `Book.tsx:771` par picker | **M (1 din)** |
| G8 | Slot hold timer | Availability derived hai (`schema.ts:220-228`), koi reservation row nahi | Soft-hold: `bookings` me `status='held'` + `hold_expires_at`, ya `staff_slots` table; availability query me hold minus karo; checkout me TTL release. Double-booking abhi bhi create-time par DB check se rukta hai (verify: `bookingCreate.ts` slot validation) | **L** |
| G9 | Booking reminder + re-engagement (customer) | Notifications sirf synchronous event inserts; koi scheduler nahi; owner-side AI re-engagement alag cheez hai (`server/geminiReengagement.ts`) | `supabase/functions/notifications` me cron (`schedule` config) → upcoming bookings (T-24h/T-2h) scan → `in_app_notifications` insert. Re-engagement: last-visit > N days wale customers ke liye offer notification | **M** |
| G10 | Similar salons / Featured / Quick booking / offer banner carousel | Feature code hi nahi | Similar: same `city` + shared `categories` + rating sort (existing discovery query reuse, 1 extra call). Featured: `salons.is_featured`/`profiles` flag + rail. Quick booking: card par "next free slot" chip (availability endpoint already hai). Banner: `promotionalBanner` editor payload **already** aata hai (`websiteContent.ts:53-56`) — customer side render nahi hota | **S-M each; banner = S** |
| G11 | Review tags | Review payload `{id, rating, text}` only; storage `bookings.metadata.review_*` | `review_tags text[]` metadata me + UI chips (Hygiene / Value / Staff / Ambience) + `listSalonReviews` me aggregate | **S (0.5d)** |
| G12 | Language account me save | `profiles`/`clients` me column nahi (`schema.ts:548`) | `profiles.language` column (ya `preferences jsonb`) + `saveMyProfile` whitelist + `Settings.tsx:119` ko device-store se DB par shift | **S (0.5d)** |
| G13 | Notification preferences | Column hi nahi (`Settings.tsx:6`) | `profiles.notification_prefs jsonb` + notification insert ke waqt respect karo (`customerRoutes.ts:1431,2211`) | **S-M** |
| G14 | Area search legacy path me nahi | `customerRoutes.ts:534` `.or()` me `area` missing (column `profiles.area` **exists** — `20261020000000_ensure_dob_column_on_profiles.sql:15`) | `.or()` me `area.ilike.%term%` add + `address_line2` bhi; 1-line-ish fix | **XS (30m)** |
| G15 | Recently viewed (audit ne ✅ maana tha) | Sirf search history device par | `deviceStore.ts` me `recentlyViewedSalons` (id + timestamp, cap 12) + Discover rail | **S (0.5d)** |
| G16 | In-app schema/data panel galat bolta hai | `schema.ts` stale (§1.3) | `CUSTOMER_SCHEMA_MAP`/`CUSTOMER_SCHEMA_GAPS` ko normalized reality (`salons`, `staff`, `salon_hours`, `customer_qr_payments`) par update; `tests/customerDataLayer.test.ts:77` (18 entities) bhi update hoga | **S (0.5d)** |

---

## 3. Suggested sequence

**Tier 1 — quick wins, no migration (≈1 din):** G1 forgot/reset password · G14 area search · G11 review tags · G15 recently viewed · G10-promo banner · G16 schema doc fix (customer ko galat info dikhna band).

**Tier 2 — discovery correctness (≈1-2 din):** G5 packages (ID mismatch + legacy path + no-silent-drop) · G6 gender (server-side filter + real data source) · G10 similar/featured/quick booking.

**Tier 3 — billing & money (≈3-4 din, migrations):** G2 discount/coupon/tax/platform-fee · G3 refund info + policy · G4 payment history (derive-first, table baad me).

**Tier 4 — account & retention (≈2-3 din):** G7 saved addresses · G12 language persist · G13 notification prefs · G9 reminders/re-engagement cron.

**Tier 5 — hardest:** G8 slot hold timer (data model change + concurrency).

---

## 4. Do baatein jo fix se pehle decide karni hain

1. **Kaunsa data path authoritative hai?** Normalized (`salons/services/staff`) ya legacy (`profiles/stylists`)? Aaj dono chalte hain aur features asymmetric hain — har naya feature do baar likhna padta hai. Recommend: normalized ko primary maano, legacy ko explicitly "degraded mode" label karo (response me `mode` field already jaata hai — `Discover.tsx:321`).
2. **Pricing ka source of truth:** discount/coupon/tax/fee booking row me `metadata.pricing` jsonb me jaaye ya naye columns me? `metadata` route sasta hai aur existing pattern follow karta hai (`metadata.services[]`, `metadata.review_*`), par reporting/SQL mushkil. Money-related cheez ke liye columns better hain.

---

## 5. FIX BATCH 1 — teeno 🔴 bugs fixed (2026-10-04)

Scope: user ne "pehle 3 🔴 bugs fix karo" chuna. Data-path ka faisla (§4.1) code
padh kar liya gaya — neeche §5.4 me.

### 5.1 Bug 1 — Gender filter (dead feature → working, server-side)

| Pehle | Ab |
|---|---|
| `serviceGenders: [...new Set(menu.map(s => s.gender \|\| 'All genders'))]` — `gender` kabhi set hi nahi hota tha, isliye har salon `['All genders']` | `src/lib/serviceGender.ts` — ek vocabulary (`SERVICE_GENDERS`), ek normalizer, ek matching rule |
| `mapServiceRow` gender passthrough nahi karta tha | `server/siteLookup.ts` ab `normalizeServiceGender(row.gender)` carry karta hai |
| Editor ka free-text gender (`"Unisex"`, `"Ladies"`) reject ho kar silently "All genders" ban jaata tha | `mergeServicePresentation` ab aliases normalize karta hai; unknown value audience ko widen nahi karti |
| Filter client-side tha — sirf us 60-row page par lagta tha jo screen ne maanga | `?gender=` ab **server-side** hai, dono data paths me (`customerSalonDirectory.ts` + `customerRoutes.ts`) |
| "Women" select karte hi list **khaali** (fallback `['All genders']`) | Rule: salon match karta hai jab koi service us gender ki ho, ya unisex ho, **ya salon ne koi tag publish hi na kiya ho** — filter narrow karta hai, wipe nahi |

`EMPTY_DISCOVERY_FILTERS` me `gender`/`maxDistance` keys bhi add kiye — "clear (N)"
counter aur selects ab saath reset hote hain.

### 5.2 Bug 2 — Packages tab (hamesha khali → resolved + explained)

Naya module `server/catalogPackages.ts` (`buildCatalogPackages`) dono read paths
ke liye ek hi resolver hai:

- **Editor-local ids bridge hote hain** — `catalogId(salon,'service',editorId)` wahi
  md5 derivation hai jo save RPC ka `public.nexora_catalog_uuid` karta hai, isliye
  `serviceIds: ['cut','spa']` ab live `services.id` rows se milte hain.
- **Partial package survive karta hai** — pehle ek bhi id miss hone par poora
  package silently drop; ab live subset + note ("shown with 1 of 2 services").
- **Kuch bhi drop ho to reason aata hai** — `packageNotes` response me jaata hai aur
  Packages tab me amber notice ban kar dikhta hai. "No packages published" aur
  "aapka package ek renamed service ko point karta hai" ab alag cheezein hain.
- **Legacy path ab packages emit karta hai** — `answerSalonDetail` +
  `legacySalonCatalogueFacts` `profiles.data.editor_profile.packages` ko live
  `services` rows ke against resolve karte hain. Pehle is path par field hi nahi tha.
- **Price rule unchanged + documented** — package price = live services ka sum
  (editor ka typed number nahi), kyunki booking API wahi charge karta hai.
- Naya `SalonPackages` component included services + duration + description dikhata
  hai (pehle sirf `name · price` tha).

### 5.3 Bug 3 — Schema map / Data panel (jhooth bolta tha → reality)

`src/lib/customer/schema.ts` customer app ke **Activity → Data** panel aur
`/api/customer/connection` ko feed karta hai:

- `PHYSICAL_TABLES` me `salons`, `staff`, `salon_hours` add — ye migrations me
  maujood hain (`20261002_owner_workspace_provisioning.sql:175`,
  `20261031000000_fix_website_save_and_public_site.sql:56-92`) aur customer API
  inhe padhta hai. Pehle panel inhe "does not exist" bataata tha.
- `salons` entity ab `kind:'derived'` + `tables:['salons','services','staff','salon_hours','bookings','profiles']`,
  note me dono paths aur `normalizedCatalogue` flag documented.
- `salon_services` note: ek physical table, do key spaces (`owner_id` legacy vs
  `salon_id`+`price_paise` normalized), aur saaf likha hai ki **`services.gender`
  column exist hi nahi karta**.
- `salon_staff`: `stylists` (legacy) + `staff` (normalized), dono named.
- `staff_slots`: legacy `stylists.schedule` vs normalized
  `nexora_customer_booking_options` RPC — aur ye bhi ki koi slot reserve nahi hota
  (G8 slot-hold gap ka honest disclosure).
- `customer_qr_payments` gap: table **EXISTS** (`20260908_…:438`) par koi code path
  use nahi karta — pehle likha tha "no QR table".
- `RLS_REALITY.publicRead` add: `salons/services/staff/salon_hours` par
  anon/authenticated public-read policies hain (storefront ke liye), jabki private
  customer data ab bhi API-scoped hai. `customerScoped` ab bhi khaali — is batch me
  koi RLS change nahi hua.

### 5.4 Data-path ka faisla (mera recommendation, §4.1 ka jawab)

**Normalized (`salons/services/staff/salon_hours`) primary hai; legacy
(`profiles/stylists/clients`) explicitly-labelled degraded fallback.** Reasons:

1. Booking ka authoritative contract already normalized hai — `server.ts`/`api/index.ts`
   me `normalizedBookings: true` hardcoded hai, aur availability
   `nexora_customer_booking_options` RPC se aati hai.
2. Feature asymmetry sirf normalized side hai: packages, gender tags, `area`,
   `publishedServices/Staff/Reviews`, `salon_hours`.
3. Legacy path delete karna unsafe hai — jinke `salons` rows nahi hain unka
   catalogue hi gayab ho jaata.

Isliye delete nahi kiya, par **honest** banaya: har discovery response ab
`catalogueMode: 'normalized-salons' | 'legacy-profiles'` carry karta hai, aur
`schema.ts` ka gap entry saaf kehta hai ki parity chahiye ya backfill.

### 5.5 Fix karte waqt mile 3 ADDITIONAL asli bugs

| # | Bug | Impact | Fix |
|---|---|---|---|
| A | `toCustomerSalon` legacy `profiles.area` ko map hi nahi karta tha (normalized path baad me spread karta tha) | Legacy deployments par salon card/search me locality gayab — audit ka "area verify nahi" isi ka symptom tha | `mappers.ts` me `area: str(row.area \|\| row.area_locality)` + `DISCOVERY_COLUMNS` me `area`, aur `matchesTerm` me area/address |
| B | Salon detail handler: normalized catalogue me salon na mile to `ok(res, …, null)` — "not published" — return kar deta tha, legacy fallback par jaane ke bajaye | Jiske `salons` table hai par ek salon migrate nahi hua, uska **own page khaali**, jabki discovery me dikhta hai | `if (normalized && normalized[0])` — miss par ab legacy path fall-through hota hai |
| C | `return void answerSalonDetail(...)` — `void` operator promise ko **await nahi karta** | Handler response likhne se pehle resolve; Express me floating promise → `try/catch` bhaag chuka hota hai, isliye error par `sendSafeError` kabhi nahi chalta (unhandled rejection / hang risk) | `return answerSalonDetail(...)` (dono call sites) — regression test ne pakda |

Area search ke liye `42703` (column does not exist) par ek retry bhi add hua:
locality terms ke bina dobara query, taaki purane projects par search fail na ho.

### 5.6 Verification

```
tsc --noEmit                                  clean
tests/customerGenderPackagesFix.test.ts       19/19 pass  (naya, teeno bugs + A/B/C lock karta hai)
tests/customer*.test.ts                      115/115 pass
customer+website+salonSync+savePipeline       280/280 pass
booking/normalized/publicSite/ownerWorkspace  452/453 pass  (1 pre-existing, neeche)
tests/dom (salonCard, customerAvailability,
  templateCustomerExperience, responsive)      69/69 pass
live server smoke: /api/customer/salons,
  /salons/:handle, /connection, /app           200, honest mock-mode
```

Poore suite me 51 failures hain, **sab pre-existing**: `git stash` karke base
commit par wahi files chalayi gayi — `bookingCreateResilience`, `partnerProfile`,
`part1SharedBackend`, `headerNav` wahan bhi fail hote hain (growth-partner /
partner-portal / referral area, is batch se chhua hua nahi).

### 5.7 Files

```
new   src/lib/serviceGender.ts            gender vocabulary + matching rule (client-safe)
new   server/catalogPackages.ts           tolerant package resolver (server-only, node:crypto)
new   tests/customerGenderPackagesFix.test.ts
mod   server/customerSalonDirectory.ts    normalized path: gender, packages, notes, data fallback
mod   server/customerRoutes.ts            legacy path: gender filter, area search, detail fall-through,
                                          answerSalonDetail, catalogueMode
mod   server/siteLookup.ts                mapServiceRow gender passthrough
mod   server/websiteContent.ts            mergeServicePresentation gender normalization
mod   src/lib/customer/mappers.ts         area, gender, serviceGenders, packages/packageNotes
mod   src/lib/customer/types.ts           CustomerSalon/CustomerService fields
mod   src/lib/customer/api.ts             SalonSearchQuery.gender
mod   src/lib/customer/schema.ts          dual-path reality (Data panel + connection report)
mod   src/customer/screens/Discover.tsx   server-side gender, withinDistance, SalonPackages UI
```

**Koi DB migration nahi, koi RLS change nahi, koi naya table nahi.** Teeno bugs
pure code-level the — isliye ye batch bina deployment risk ke merge ho sakta hai.

### 5.8 Ab bhi khula (next batches)

Tier 1 ke baaki: G1 forgot/reset password · G11 review tags · G15 recently viewed ·
G10 promo banner/featured/similar/quick booking. Phir Tier 3 billing (G2/G3/G4)
jisme migration lagegi. G14 (area search) is batch me ho gaya.

---

## 6. FIX BATCH 2 — G1: forgot / reset password (2026-10-04)

**Gap:** Customer app me password bhoolne ka koi raasta hi nahi tha — na "Forgot
password?" link, na reset request, na new-password form. `Auth.tsx` sirf account
bana sakta tha aur sign in kar sakta tha. Password bhoola = bookings, rewards aur
pass permanently lock. Audit ka #1 gap.

**Fix:** Supabase Auth ka apna recovery flow — wahi jo partner portal
(`src/lib/partnerPortalAuth.ts`) aur onboarding app (`src/onboarding/lib/auth.ts`)
pehle se use karte hain. **Koi naya table nahi, koi custom email nahi, koi
password is app me store nahi hota, koi migration nahi.**

Flow:

1. `/app/auth` par **Forgot password?** → screen `recover` mode me jaata hai
   (sirf email field; password box deliberately nahi dikhta).
2. `sendCustomerPasswordReset()` → `supabase.auth.resetPasswordForEmail(email,
   { redirectTo: <origin>/app/auth })`.
3. Link `/app/auth` par land karta hai. Public client me `detectSessionInUrl`
   default true hai (`src/lib/supabaseClient.ts:284-298`), isliye token wahi
   exchange hota hai aur `PASSWORD_RECOVERY` fire hota hai.
4. `CustomerApp.tsx` ka naya `onAuthStateChange` listener recovery session set
   karta hai, `authMode = 'reset'`, aur auth route par navigate karta hai.
5. `reset` mode: new password + confirm → `completeCustomerPasswordReset()` →
   `supabase.auth.updateUser({ password })`.
6. Recovery session ek **real** session hai, isliye password accept hote hi
   `getSession()` → `onAuthenticated(...)` → customer seedha andar, aur
   `pendingAfterAuth` wahi screen resume karta hai jahan wo ja raha tha. Doosra
   email nahi, purana password dobara nahi maanga jaata.

**Security / UX rules (partner portal wale hi teen):**

- **Enumeration-safe:** har syntactically valid address par same
  `RESET_SENT_MESSAGE`. Is form se pata nahi chalta ki email registered hai ya
  nahi — na provider ke jawab se, na screen ki copy se.
- **Raw provider strings customer tak nahi jaate.** `describeResetError()` GoTrue
  ke messages ko translate karta hai: rate limit, invalid email, expired/missing
  recovery session, weak password, aur "redirect_to not allowed" (deployment
  misconfigured). Jo pehchana na jaye wo generic copy banta hai, echo nahi.
- **Strength check UX only hai** — Auth `updateUser` par khud dobara validate
  karta hai. Minimum 6 characters, yaani signup rule ke saath identical, taaki
  ek hi screen ke do forms aapas me disagree na karein.
- **Mock deployment** (Supabase keys absent) me saaf copy milti hai, transport
  error nahi — signup/sign-in ke stance ke saath consistent.
- **Autofill-safe:** `reset` mode bhi `FormData(event.currentTarget)` se padhta
  hai, wahi contract jo baaki auth forms ke liye
  `tests/dom/passwordAutofillFix.test.ts` pin karta hai. Password manager DOM
  bhar de to bhi visible value hi validate hoti hai.

**Files:**

```
new   src/lib/customer/authRecovery.ts    flow helpers: redirectTo, send, validate,
                                          complete, describeResetError
mod   src/customer/screens/Auth.tsx       CustomerAuthMode = login|signup|recover|reset,
                                          mode-aware fields/copy/buttons
mod   src/customer/CustomerApp.tsx        PASSWORD_RECOVERY listener, authMode widen
new   tests/customerAuthRecoveryFix.test.ts   27 unit tests
new   tests/dom/customerAuthRecovery.test.ts  21 DOM tests (real clicks + events)
```

Do jaan-boojh kar liye gaye faisle:

- `authRecovery.ts` **`src/lib/router.ts` se import nahi karta** — router.ts React
  hooks import karta hai, aur ek non-React module usse jodna coupling (aur bundle)
  dono bigaadta. Isliye `CUSTOMER_AUTH_PATH = '/app/auth'` literal hai, aur ek test
  assert karta hai ki wo `customerPath('auth')` ke barabar hi rahe — drift pakda
  jayega.
- Existing DOM ids aur input names **untouched** hain (`auth-toggle-mode-btn`,
  `auth-browse-guest-btn`, `customer-email`, `customer-password`,
  `customer-full-name`, `customer-phone`), kyunki purane DOM tests un par depend
  karte hain. Naye ids: `auth-forgot-password-btn`, `auth-back-to-login-btn`,
  inputs `customer-new-password`, `customer-new-password-confirm`.

**Verification:** `tsc --noEmit` clean · 27/27 unit · 21/21 DOM · regressions:
`tests/customer*.test.ts` 142/142 (115 purane + 27 naye),
`tests/dom/passwordAutofillFix.test.ts` 32/32, `tests/customerScreens.test.ts` 8/8.

**Ek asli bug jo test ne pakda:** `describeResetError` pehle sirf `refresh_token`
match karta tha, lekin GoTrue "Refresh Token Not Found" (space ke saath) bhi
bhejta hai. Regex `refresh[ _]?token` hua — warna ek expired link customer ko
"expired" kehne ke bajaye generic error dikhata, aur wo dobara link maangne ke
bajaye retry karta rehta.

### 6.1 Ab bhi khula

Tier 1 ke baaki: G11 review tags · G15 recently viewed · G10 promo banner /
featured / similar / quick booking. Phir Tier 3 billing (G2/G3/G4), jisme
migration lagegi.
