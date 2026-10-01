# Website save: which field failed, and what is repaired automatically

## The problem

Saving the website could fail with one toast for everything:

> Save failed: Some website content (such as an empty gallery image, invalid URL, or service detail) could not be validated. Please check your entries and save again.

`save_owner_editor_state` answers every content problem with SQLSTATE `22023` and a one-line message. The save pipeline collapsed all of them into that sentence, the editor had no idea which input was wrong, and because the save is **one database transaction**, a single rejected field meant *nothing* was published — no services, no gallery, no photos. The public page (`/?site=<slug>`) only ever renders what was saved, so it stayed empty.

## What was actually failing (reproduced against the real SQL)

`tests/websiteSaveParity.test.ts` runs the real function from migrations `20261028` and `20261031` in PGlite. These were all rejected with the generic toast:

| Owner did… | Database said (22023 unless noted) |
|---|---|
| Added a team member with the **Add Staff** modal. It silently pre-selected two hard-coded demo service *names* ("Luxury Spa Pedicure", "Gel Polish Overlay") even while its optional section was collapsed | `Assigned service is not available in this salon` — on **every** later save |
| Deleted a service a team member was assigned to | `Assigned service is not available in this salon` (latest migration) |
| Left a team member's name blank while typing | `Staff name is required` (latest migration) |
| Picked closing time ≤ opening time in the Add Staff schedule (12-hour `06:00 PM` values) | `Invalid staff schedule time range` |
| Pasted a link with a trailing space/newline, or a service image / owner photo with padding | `Invalid gallery image`, `Invalid service image URL`, `Invalid profile image URL` (older migration) |
| Left a gallery row without an image, or an item lost its `url` / `id` | `Invalid gallery image`, `Duplicate gallery IDs` (older migration) |
| Pasted `www.example.com/a.jpg` as a team portrait | `Invalid staff image URL` |
| Used a `youtube.com/watch?v=…` link without `https://` or a `music.youtube.com` link | `Use a valid YouTube link` |
| Left `null` in an image field (testimonial photo, cover, service image) | `Invalid … image` (older migration) |
| Had an account whose saved state has no SEO keywords of its own. It **inherits the blank profile's 606-character default keyword list** — 106 over the limit — although the owner never wrote it | `Website text exceeds allowed length` (latest migration) — on every save, for a field nobody typed |
| Typed an owner bio over 2,000 characters, half a colour (`#0F`), a 3-letter favicon letter, a rating of 4.5, a 1.5-minute duration… | `Website text exceeds allowed length`, `Invalid brand color`, `Invalid favicon letter`, `22P02 invalid input syntax for type integer` |

## What happens now

`src/lib/websiteContentNormalize.ts` → `prepareWebsiteStateForSave(state)` is the single entry point. The editor's pre-flight check, the direct RPC save, the `/api/website/save` fallback and the server route all call it, so they cannot disagree.

**Repaired automatically (never blocks the save)**

- Image links are **trimmed**; `cdn.example.com/photo.jpg` gets `https://`; `null` becomes empty.
- An **empty gallery / lookbook slot gets the default image** (`/gallery-placeholder.svg`) instead of rejecting — or silently dropping — the row. The editor shows "Using the default image" and keeps the link box empty.
- Missing or repeated internal IDs (gallery, lookbook, testimonials, videos) are reassigned.
- YouTube links the database cannot read are rewritten to the canonical watch URL.
- Team assignments are matched to real services (by ID, or by **name**); assignments to services that no longer exist are dropped.
- A working day with invalid hours is saved as a **day off**; rows with an unknown day are ignored.
- An **SEO keyword list over 500 characters** keeps its first whole keywords that fit and drops the rest (never cuts a keyword in half). New websites now start with a list that fits (18 of the 22 default keywords, 474 characters). A single keyword that is itself over the limit is *not* cut — it stays a named, blocking error.
- A team member **without a name** is left out of the payload (the row stays in the editor, flagged) — the same tolerance migration `20260930070627` intended.

A manual save tells the owner what was repaired ("2 gallery slots have no photo yet, so the default image is shown there.").

**Blocked, with the exact field named** (`validateWebsiteContent`, `src/lib/websiteValidation.ts`)

Every rule mirrors the database. Each problem has a `path` (`services[2].price`, `profile.gallery[0].url`, `stylists[1].avatarUrl`…), a human `label` (`Service 3 (“Hair Spa”) › Price`) and a `message` that says how to fix it.

| Area | Checked |
|---|---|
| Services | name, price (≥ 0), regular ≥ sale price, whole-minute duration, image link, unique ID |
| Gallery / lookbook | link validity (empty is fine → default image), ≤ 100 images |
| Testimonials | client name, review, whole-number rating 1–5, photo link |
| Videos | valid YouTube link, title ≤ 200, description ≤ 2,000, placement, ≤ 14 shorts / ≤ 14 showcases |
| Owner & brand | owner portrait / cover / logo / favicon / share image links, hex colours, favicon letter ≤ 2, website address format |
| Long text | owner bio 2,000 · about 4,000 · SEO title 120 · description 320 · keywords 500 characters |
| Team | portrait link (name-less rows are warnings, not errors) |
| Social links | *warnings only* — an Instagram / Facebook / TikTok value that cannot be turned into a link is flagged because it will not appear on the site |

## What the owner sees

- Nothing is red while typing. After a save is **attempted and blocked** (manual Save, or an auto-save that is blocked), each failing input turns red (amber for warnings), shows its message underneath, and a summary panel at the top of the editor lists every problem with a jump-to-field button. Gallery rows with a problem open themselves. Fixing a field clears its marker live.
- The toast names the first problem and counts the rest: `Service 1 (“Hair Spa”) › Price: Enter a price of 0 or more, using numbers only. (+2 more)`.
- If the database still rejects something the client could not see, `describeWebsiteSaveFailure` (`src/lib/websiteSaveErrors.ts`) maps the database message to the section ("Team › Assigned services: …"), and the server route returns the same structured `issues`.
- **Add Staff** now lists the salon's own services (IDs), selects none by default, and marks impossible working hours on their row before submitting.

## Found by running the real app in a browser

The production build was run in headless Chrome against the **real** `save_owner_editor_state` / `get_owner_editor_state` SQL (PGlite) behind a Supabase-compatible stand-in, with real typing and clicks, and compared with the untouched commit. That surfaced four problems the unit tests could not:

1. **Opening the editor erased the owner's services and team.** After sign-in React commits brand-new empty `services` / `stylists` arrays. The hydration merge compared them with the pre-read arrays *by reference*, so it believed the owner had edited them during the read and **discarded the saved services and team**; the next auto-save then sent `services: []` and the database deactivated everything. Reproduced on the untouched commit (services `[Beard trim, Haircut]` → `[]`, team `[Asha]` → `[]`, editor showing 0 service rows) for any owner whose first save was valid. It stayed hidden for accounts carrying the 606-character keyword default only because their saves were rejected before they could overwrite anything. `mergeHydratedSalonState` now compares **content** (`src/lib/hydrationMerge.ts`).
2. **The 606-character default keyword list** (above).
3. **Loaded data with only the required fields crashed the editor** ("Something went wrong"): `service.description.length` in the preview and `stylist.specialties.filter/join` in the team editor. JSON drops `undefined`, so a service saved without a description comes back without the field. Both are now null-safe (hidden until now for the same reason as 1).
4. **An address already used by another salon** (`Subdomain already in use`, 23505) was only a toast. It is now mapped to the website-address field: the input turns red with "This website address is already used by another salon. Choose a different one — your other changes are kept."

The same browser run also exercised Open Site (see below): a new tab opens at the live URL with no save and no error during a failed save, a blocked save, a save in flight and a database rejection.

## Open Site is navigation, not a save

**Open Site** used to publish first and refused to open the website when that publish failed (*"Publish did not complete, so the live site was not opened…"*). One bad field, or a background auto-save that could not finish, therefore locked the owner out of a website that was already live. The two jobs are now separate:

| Button | What it does |
| --- | --- |
| **Open Site** | A plain `<a target="_blank" rel="noopener noreferrer">` to the address that is live **now**, e.g. `https://fanal-templetes-app.vercel.app/?site=vijay-kumar`. It never saves, never waits for a save and never shows a publish error — unsaved edits, a failed auto-save or a save in progress change nothing about it. |
| **Save & Update Website** | The only thing that validates the draft and publishes it. When something blocks it, the exact fields are marked in red and listed in the panel at the top (see above). |

- *Live now* (`src/lib/liveSite.ts`) is the address the cloud last **accepted** (a successful cloud save) or **returned** (when the workspace loads) — tracked in `App.tsx` as `publishedAddress`, and cleared when the account changes. A new address typed in the editor but not saved yet therefore never becomes the link target (it would open a page that does not exist); until the cloud has confirmed an address, Open Site falls back to the address shown in the editor. The owner dashboard and owner preview use the same address for their own Open Site / Copy Link.
- **"You have unsaved changes"** appears beside the link, never in front of it, for the two situations that do not fix themselves: the last save failed, or the typed address is not live yet. It says what the live site still shows and offers **Save now**. While a save is merely scheduled or running nothing extra is shown — the status pill already says *Saving…*, and a banner would flicker on every keystroke.

Covered by `tests/websiteLiveSite.test.ts` (which address opens, when the notice appears) and `tests/dom/websiteOpenSite.test.ts` (real clicks on the real editor: no save, no cancelled click, link unchanged while a save runs, exact field marked when a save is blocked).

## Keeping it honest

`tests/websiteSaveParity.test.ts` holds the invariant that prevents the generic toast from coming back:

> the client reports **no blocking issue** ⇒ the real database function **accepts the payload**

for ~40 scenarios and every template starter kit, at both migration levels. When a migration adds a rule, add a scenario there first, then mirror the rule in `validateWebsiteContent` (or repair it in `normalizeWebsiteContent`) and map its message in `websiteSaveErrors.ts`.

Also pinned by tests:

- **Every default the app creates must pass the database.** `tests/websiteSaveParity.test.ts` saves the profile a brand-new account starts with, exactly as created, at both migration levels (the 606-character keyword list would have failed it), and the old 606-character list itself is a repaired scenario.
- **A taken address** is saved for real and must come back as the website-address field (`tests/websiteSaveParity.test.ts`, `tests/websiteSaveFieldErrors.test.ts`).
- **Loading must never discard what was saved**: `tests/hydrationResume.test.ts` (empty lists React re-creates after sign-in are not edits, a list the owner really changed still wins).
- **Sparse saved data must render** — services without a description, team members with only an id and a name: `tests/dom/websiteSparseContent.test.ts`.

## Note on the public page

The public site shows exactly what was saved, by design (see `tests/dom/websiteRegression.test.ts`: empty menus never fall back to template services, a blank cover never falls back to a template hero). The template gallery shows *sample* content. After the first successful save the salon's own services, team, gallery and photos appear; slots left empty show the default image.
