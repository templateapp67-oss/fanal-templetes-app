# Template customer UI implementation scope

Scope: the customer's October 3 UI/UX request. OTP, messaging, database
migrations, payment-provider configuration and production deployment are deferred.

The current registry contains **27 templates including VIP Black & Gold**. The
attached audit's additional separate VIP count does not match this checkout.
Every registered template uses the shared customer toolbar and customer panel.

## Correction after PR #160

PR #160 primarily exposed customer screens in a dialog. It did not make the
requested discovery and booking sections prominent on the main template page.
The corrective change adds a visible section directly after the hero in all 27
templates: salon/service/location search, catalogue category/gender/price filters,
inline service cards with real price/duration and direct booking actions, a featured
salon card with actual configured rating data, and rewards/account shortcuts.
The section uses the selected salon's real catalogue, inherits the template theme,
respects hidden services, and never invents ratings or nearby salon data.
Preview profiles now select the category accent rather than inheriting the blank
profile's slate palette; VIP inline booking controls use the gold secondary accent.

Appointments/profile/rewards details still open the existing customer panel.
This change is not a claim that all customer, owner or internal-admin screens in
the supplied checklist have been redesigned. Live data/payment/messaging work is
still deferred as requested.

## Customer surfaces

| Requested area | Template UI |
| --- | --- |
| Home, location, salon/service search, listings | Search toolbar opens discovery inside the template. Preview has category/gender/price/rating/distance/availability filters, recommended/nearby/top-rated/trending/featured lists, recent views, favorites and quick booking. Existing live discovery is embedded and now includes gender/distance controls and service-name matches. |
| Salon profile, services, packages | Profile, gallery, location, hours, reviews, similar salons, service selection and package details. Configured packages render on the main template; starter packages appear only in preview. |
| Booking, dates, slots, customer details | Interactive preview supports multiple services, available/disabled times, a labelled demo hold, contact details, saved/new address and notes. Live booking continues to use the existing account and booking screens. |
| Summary, payment, confirmation | Preview shows subtotal, coupon discount, sample fee/tax, total, 25% advance, remaining amount, simulated payment and appointment details. No real payment occurs in preview. Live payment rules are unchanged. |
| Appointments, details, rescheduling, cancellation, reviews | Preview has Upcoming/Completed/Cancelled tabs, appointment details, cancellation reason/refund information, rescheduling, star/text/tag reviews and rebooking. Live account screens open inside the template. |
| Favorites, rewards, notifications | Save/remove/book favorites; dedicated Rewards navigation; points/activity screens; all/unread notifications and mark-read actions. Preview mutations stay in memory. |
| Profile, addresses, settings, authentication | Photo/name/email/phone/gender/DOB/language, address add/edit/delete/default, preferences, login/signup/forgot/reset screens. Preview credentials create no account and send no messages. Live authentication reuses existing screens. |

## Owner and presentation UI

- Package management in Website Editor: create, edit, delete, activate/deactivate,
  select included services, show catalogue-derived total price and duration.
- Service management: gender/service-type selector; public service cards show it.
- Shared template: scoped heading/body fonts, brand radius, and saved scent,
  soundscape and consultation information.
- Category-dependent desktop hero composition; responsive customer panel;
  accessible native dialog, focus containment, Escape close and scroll lock.
- VIP customer panel preserves the dark appearance and readable active navigation.
- Image failures use the existing local placeholder.
- Platform admin remains an internal surface; it is not added to customer UI.

Read-side package/gender mapping passes existing editor presentation data to the
public template. Package service IDs are resolved against the actual salon
catalogue. Inactive packages and packages containing retired services are hidden.

## Validation

- TypeScript check and production build: pass.
- Existing website regression suite: **506 passed**.
- Customer regression suite: **38 passed**.
- New customer UI tests: **34 passed**; includes package booking, coupon/advance,
  confirmation, favorites, notification reads, cancellation, rescheduling and reviews.
- Chromium browser: every **27/27** template shows inline customer discovery, filters/reset, Packages and Rewards without
  horizontal overflow at 390px; Escape closes the panel.
- VIP discovery/profile checked at **320, 390, 768 and 1440px**.
- Browser package booking through confirmation: pass; no browser page errors.

These checks verify UI and preview interactions. They do not establish that live
OTP delivery, slot reservations, coupons, tax, refunds or payment capture are
configured; those backend items remain outside this UI-only change.
