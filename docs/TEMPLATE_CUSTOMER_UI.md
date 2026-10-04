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
