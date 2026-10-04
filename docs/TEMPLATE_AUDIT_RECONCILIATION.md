# Reconciliation of the complete uploaded template audit

Source: `1_TEMPLATES_missing_and_gaps(1).md`, sections A–F. Scope remains UI/UX
across all 28 templates; OTP/messages/payment backend changes are deferred by the
owner. This document records actual implementation rather than marking every
production backend feature complete.

## A — Structure

There are 27 original IDs plus `vip_black_gold`, 28 selectable templates. Luxury
Hair Salon and VIP are separate. Every design uses the shared website engine,
customer discovery and customer panel. VIP mounts an owner-configured source hero;
the separate showcase/admin simulator is not part of customer sites. The unused
empty renderer map has been removed. `templateLayouts.ts` defines explicit hero
composition, catalogue grid and gallery proportions for every layout; sections
and behavior remain shared, rather than maintaining 28 duplicated apps.

## B — Customer features

| Audit item | Current implementation / limit |
| --- | --- |
| Gallery, description, address/map, hours, contact, services, offers, home service | Shared public sections and configured owner content. OpenStreetMap handles maps/directions. |
| Average rating | A shared validated aggregate is used by normal/VIP heroes and discovery. Explicit zero reviews suppresses a fallback. Owner testimonials are labelled as salon testimonials, not platform-verified customer reviews. |
| Packages | Shared public catalogue and owner CRUD, services, price/duration and activation. Starter packages occur only in preview. |
| Favorites, rewards, appointments, reschedule/cancel, addresses, notifications, login/signup | Accessible within the template customer panel. Preview is an interactive in-memory demo; published sites embed the existing customer screens. |
| Search, nearby, distance, similar salons | Inline owner-catalogue search and filters; discovery opens the customer panel. Preview collections are samples. Real multi-salon discovery depends on the existing customer data service. |
| Refund | Preview cancellation explains refund state. Live checkout now shows cancellation/refund guidance; no automatic refund provider has been added. |

## C — Editor settings

| Audit setting | Resolution |
| --- | --- |
| headingFont/bodyFont | Scoped heading/body variables apply across all 28, including VIP. Published hydration checks exercise custom fonts. |
| VIP sections/headings/banner/colors | VIP runs inside the common section engine and editor setter, with shared settings. Its hero also uses configured background with readable foreground text. |
| scentProfile/soundscape/consultationStyle | Shared about-section experience cards. Tested for all 28 published renderers. |
| hidePhone | Audit misidentifies this as an owner field. It belongs to `Stylist`; public team cards expose no staff phone numbers. No owner phone is removed based on an unrelated staff flag. |
| whatsappNotificationsEnabled | Owner preference is saved through Publishing & booking controls. It governs messaging preference; it should not hide customer WhatsApp contact links. Message delivery remains deferred. |
| requireDeposit/depositPercentage | The platform and existing DB contract require fixed 25% advance. Publishing UI explains the rule; no editable percentage contradicts it. |
| borderRadius | Shared cards plus VIP hero frame/photo/buttons use the saved radius. |
| customDomain/whiteLabelEnabled | Publishing controls save domain text and toggle Nexora footer branding. Domain DNS/hosting provisioning is a separate operation. |
| latitude/longitude | Existing shared map consumes profile coordinates; reference count is not evidence of missing functionality. Map tests reject Google Maps destinations. |

## D — Booking gaps

| Finding | Resolution / remaining work |
| --- | --- |
| Mock OTP | Deferred as instructed. No claim of production OTP verification. |
| Fee/tax/coupon | Preview already supports a sample breakdown/coupon. Live summary now itemizes its existing authoritative total, with no separate fee/tax charges and zero discount. Coupon input is disabled with an explicit explanation until server redemption exists; no client-only discount changes payment amounts. |
| Remaining amount | Explicit live subtotal/total/25% advance/balance breakdown, using the shared whole-rupee deposit calculation. |
| Slot hold | Preview has a labelled demo timer. Live UI no longer claims a priority slot hold; server-backed reservation/expiry is still deferred. |
| Refund information | Checkout explains that cancellation does not automatically issue a refund and prompts checking the salon policy/eligibility. Automated refunds remain backend work. |

## E–F — Template and priority coverage

The same customer UI and fixes apply to all 28. Service gender is configured in
the owner editor and used by public catalogue filters. Fonts, VIP connection,
login/bookings and packages priorities are implemented. Unused-field assumptions
are reconciled above. Production OTP, reservation locks, monetary coupon/fee/tax
rules and automatic refunds are intentionally not represented as completed UI work.

Regression checks cover all 28 published hydrations, owner settings, each customer
section and 28 unique layout recipes. Chromium exercises desktop composition/grid,
mobile discovery and booking for each design, plus VIP at four viewport sizes.

`tests/e2e/templateLayouts.mjs` additionally verifies every desktop gallery tile
uses its recipe, its image fills the tile, and mobile tiles return to 4:3.
