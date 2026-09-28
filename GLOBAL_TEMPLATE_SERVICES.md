# Global template services, SEO and social configuration

## Implemented

The existing **27 templates / 9 categories** share `SalonWebsitePreview`, canonical owner state and the same save pipeline. No category-specific editor, duplicate autosave or extra website table was introduced.

- Explicit template switches and **Add missing starter content + 5 template services** fill an empty/missing menu only. Nonempty menus, prices and owner edits are preserved. Hydration/reload alone never seeds services, so intentional deletions survive.
- Template switches during cloud loading wait for hydration before deciding whether the menu is empty.
- Hair, spa and beauty starters use the requested five service names. Barber, nails, Ayurvedic, skin, tattoo and kids starters use their existing template-specific catalogues.
- All starters have five services, 100–150-character descriptions, positive durations, INR prices and high-resolution Unsplash image URLs.
- Cards use a category image when no service image exists; failed images fall back to the category image, then a bundled placeholder.
- Cards show name, category, description, duration (unless intentionally hidden), payable INR price and an optional struck-through regular price. Long owner descriptions are shortened for display without changing saved content.
- Online booking uses the payable amount. When online booking is explicitly disabled, cards offer a WhatsApp enquiry with the service and payable price; without a configured WhatsApp number, they link to contact details. Demo preview actions remain simulated.
- Regular/sale-price inputs are available in Website Editor and inline service editing. Clearing the sale restores the regular price. Invalid discounts display an error and do not enter saved state.
- Shared social header icons and initial published HTML SEO metadata remain category-independent. Read-only preview props now synchronize when the editor changes.

## Global contract and canonical mapping

`src/lib/globalSiteConfig.ts` exposes `GlobalSiteConfig`, `globalSiteConfig`, `applyGlobalSiteConfig` and `importRichService`.

```json
{
  "seo": {
    "title": "My Studio — Jaipur",
    "description": "Personalised hair and beauty care in Jaipur.",
    "keywords": ["hair", "beauty", "Jaipur"]
  },
  "social_links": {
    "instagram": "@my.studio",
    "facebook": "https://facebook.com/my.studio",
    "tiktok": "@my.studio"
  },
  "services": [{
    "id": "scalp-spa",
    "name": "Scalp Detox Spa",
    "category": "Hair Care",
    "description": "Refresh your scalp with a gentle cleanse, relaxing massage and conditioning mask, tailored to your hair and comfort.",
    "price": 1800,
    "sale_price": 1500,
    "duration": "60 mins",
    "image_url": "https://images.unsplash.com/photo-1562322140-8baeececf3df?auto=format&fit=crop&w=1400&q=85"
  }]
}
```

The adapter maps this contract onto the established internal model rather than creating parallel columns:

| External field | Canonical editor state |
| --- | --- |
| `seo.title` / `seo.description` | `profile.seoTitle` / `profile.seoDescription` |
| `seo.keywords` | `profile.seoKeywords` comma-separated text; normalized for badges and metadata |
| Instagram / Facebook | `profile.instagramHandle` / `profile.facebookPage` |
| TikTok | `profile.tiktokHandle`, with legacy aliases synchronized on import/clear |
| `duration` | `durationMinutes` |
| `image_url` | `imageUrl` |
| Regular `price`, discounted `sale_price` | `originalPrice` = regular; **`price` = payable** |

`applyGlobalSiteConfig(profile, services, input)` returns canonical `{ profile, services }` for the existing state setters/save pipeline. Missing sections preserve state; explicit empty strings/arrays clear them. This is an adapter contract, not a new HTTP endpoint or a claim that raw nested input can bypass the canonical save RPC.

### Pricing invariant

For regular ₹1,800 / sale ₹1,500:

- Owner JSON: `price: 1500`, `originalPrice: 1800`.
- Normalized `services.price_paise`: `150000`.
- Public card: ₹1,800 struck through, ₹1,500 payable.
- Booking totals and server payment checks continue using the existing authoritative payable price.

Public JSON supplies presentation metadata only. It cannot replace the normalized service charge. A free sale (`sale_price: 0`) is supported; `null`/omitted sale means no discount.

## Persistence and deployment

All edits remain in the existing shared state:

`WebsiteEditor → App.persistSalonState → saveOwnerEditorState → save_owner_editor_state`

The existing approximately **1.2-second debounced autosave**, local draft recovery and **Save & Update Website** include service images, durations, both prices and SEO/social fields. Existing authentication, profile-completeness and hydration guards still apply.

**No additional SQL is required for this upgrade if `20261028000000_complete_website_editor_persistence.sql` is already applied** (as confirmed). That migration already stores full service JSON in the private owner snapshot and public presentation snapshot, and mirrors the payable price into normalized services.

Deploy both the frontend and server/API changes, plus the previously implemented metadata middleware. Local changes have **not** been deployed to Supabase or your hosting environment. The separate brand-assets bucket migration from the OG-image feature is unrelated to these service changes.

## Validation

- **86 targeted tests passed**, including all-template rendering, starter behavior, controlled inputs, immediate read-only preview updates, nested contract round-trips, real PostgreSQL/PGlite save/reload/update/clear, normalized booking regressions and existing autosave/auth-refresh tests.
- `npm run typecheck` passed.
- `npm run build` passed; existing bundle-size warning remains.
- `git diff --check` passed.

DOM tests verify component behavior, not pixel-perfect browser screenshots. Hosted Unsplash availability and live-domain deployment still require production smoke testing; the bundled image fallback handles image-loading failures.

### Production smoke check

1. Switch between hair, spa and beauty with an empty menu; confirm the five expected services.
2. Edit one service, switch templates and confirm its data is retained.
3. Set regular ₹1,800 and sale ₹1,500; wait for autosave, reload, and verify both the public card and booking amount.
4. Remove the sale, save and reload; verify ₹1,800 is payable and the strike-through disappears.
5. Delete all services and reload without switching templates; confirm the menu stays empty.
6. View initial HTML on the published `*.nexora.in` URL and verify title, description and keywords; verify the three social links in the header.
