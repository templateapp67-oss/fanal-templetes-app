# Customer UI coverage across all 28 templates

The registry contains the 27 original template IDs plus `vip_black_gold`.
`luxury_hair_salon` retains the Maison Éclat hair atelier, hair catalogue and
`haute_luxe` layout. VIP has a separate identity, signature catalogue and
`black_gold_signature` layout. Both appear in explorer, preview and editor routes.

All 28 use `SalonWebsitePreview` and its shared `TemplateCustomerHome`,
customer toolbar and customer panel. New customer UI should be implemented in
these shared components so every template receives it. VIP's source hero uses
owner data and the same customer actions; the remaining sections stay shared.
The standalone source marketing/admin simulator is not mounted.

## Shared customer surfaces

| Surface | UI behavior |
| --- | --- |
| Home and search | Visible discovery below the hero, salon/service/location search, category/gender/price filters, service cards with configured price and duration, direct service booking, featured salon, rewards/account shortcuts. |
| Salon, services and packages | Profile, gallery, location, hours, reviews, service catalogue, package details and selection. Published sites use configured content; starter packages are preview-only. |
| Booking | Interactive preview service/date/time/details/summary/advance/confirmation flow, disabled slots, demo hold, coupon, 25% advance and remaining amount. Preview payment is simulated. Live sites embed existing customer booking screens. |
| Appointments | Upcoming/completed/cancelled, details, reschedule, cancellation reason/refund information, completed-appointment reviews and rebooking. |
| Favorites and rewards | Save/remove/book favorites; dedicated Rewards navigation with points and activity. |
| Notifications | All/unread lists and mark-read actions. |
| Profile, addresses and settings | Personal details, language, address add/edit/delete/default and preferences. |
| Authentication | Login/signup/forgot/reset screens. Preview sends no messages and creates no accounts; live screens reuse existing authentication. |

Discovery preview shows example nearby/trending/recommended lists. Published
inline discovery uses the owner's catalogue and actual rating data; it does not
invent nearby businesses or ratings. Preview mutations remain in memory.
OTP, messaging, payment-provider setup and database changes are deferred.

## Owner configuration

Package CRUD and activation, included services, price and duration; service gender
selection; saved theme and profile settings continue through the shared editor.
Changing template preserves customized owner details and cover photos; template
default covers change to the newly selected design. VIP settings target only the
new VIP ID. Template selection does not create or duplicate a business.

## Regression coverage

`npm run test:website` includes the registry and routing checks, all 28 published
renderer hydration checks, and all 13 customer sections for every template.
These checks fail if a template loses the shared toolbar or visible customer home.
`tests/e2e/templateCustomerUi.mjs` discovers all 28 IDs and verifies each preview's
visible discovery, filters, selected-service booking, packages, rewards and mobile
width. VIP additionally runs at 320/390/768/1440px and through package confirmation.
TypeScript and the production build are also checked before updating the PR.


## Attached audit reconciliation

See `TEMPLATE_AUDIT_RECONCILIATION.md` for every finding in sections A–F of the
uploaded audit, including inaccurate field assumptions and deferred backend work.
All 28 layouts now have explicit hero/catalogue/gallery composition recipes.
Publishing settings expose custom domain, footer branding and messaging preference;
25% advance remains the platform rule. Live checkout itemizes advance/balance,
existing charges and refund guidance without creating client-only discounts.

## Responsive published-site repair

At 1024px and above the shared customer hub renders inside the salon canvas,
between its website header and hero, with a sidebar and full-width main panel.
Appointments, packages, favorites, profile, rewards and services no longer open
a modal on desktop. Below 1024px they retain the native dialog and scroll lock.
Resize switches layouts without leaving a stale modal or body scroll lock.

The `customer` query parameter preserves the salon's `site` URL and the current
customer section/path. `customerServices` preserves selected service IDs through
booking/auth navigation and history. Back/forward and direct links restore the
section. Returning to the website clears both parameters.

Live services/packages reuse the site's already-loaded published catalogue,
preventing an extra account/API response from making the menu appear empty.
Missing services, packages, testimonials, gallery and both video placements have
explicit empty states. A saved public owner profile can introduce the studio
when no staff profiles exist; this does not fabricate a bookable staff record.
Explicitly empty published arrays remain authoritative. Sanitized legacy draft
presentation only fills missing fields and cannot overwrite published content.

The Gelexy public API snapshot retrieved on October 4, 2026 contains five services
and the owner's profile, but no staff/package/gallery/testimonial/video lists.
Those genuinely missing lists require owner content; demo content is never
published as the studio's own work. No production records were written.

`tests/e2e/templateResponsiveCustomer.mjs` verifies all six desktop shortcuts and
mobile drawers across all 28 templates, deep links, history, the exact breakpoint,
and optionally the real Gelexy API snapshot via `LIVE_SITE_FIXTURE`. The published
DOM matrix also covers incomplete sites for all 28 templates.
