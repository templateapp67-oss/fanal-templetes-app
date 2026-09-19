# Fix: Mobile responsiveness — Website Editor & Live Preview horizontal overflow

On phones the editor and the live-preview canvas were laid out wider than the
viewport: the page scrolled sideways, the toolbar's buttons were pushed out of
reach (and the "Live Preview" label was clipped), the preview canvas was cut off,
and the side customizer covered the canvas as a fixed 320–384px right rail.

Here is what was wrong and what changed. Nothing about the desktop layout was
intended to move — the responsive utilities restore the desktop look at `md` and
above and make the phone layout independent of it.

## Editor shell (`src/components/WebsiteEditor.tsx`)

| Was | Now |
| --- | --- |
| `max-w-5xl mx-auto px-4 sm:px-6` (content could outgrow the viewport with nothing clipping it) | `min-h-screen w-full max-w-full overflow-x-clip …` on the shell, `w-full max-w-full sm:max-w-5xl mx-auto px-4 md:px-6 … min-w-0` on the column |
| sticky save bar `px-5` with the status pill and three buttons in one unbreakable row | `w-full min-w-0 … px-4 sm:px-5`, and the action cluster is `flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end` — buttons drop to the next line instead of being squeezed |
| sections at `p-6` | `p-4 sm:p-6` (same desktop padding, more usable width on a phone) |

`overflow-x-clip` is used deliberately instead of `overflow-x-hidden`: `hidden`
would make the shell a scroll container, which breaks the `position: sticky`
save bar underneath it.

## Live Preview (`src/components/SalonWebsitePreview.tsx`)

* **Root shell** — `w-full max-w-full overflow-x-clip`, so a child that is too
  wide can never scroll the whole page sideways.
* **Owner toolbar** — was `sticky top-20` at every size; on a phone it is several
  rows tall and swallowed most of the viewport. It is now `relative md:sticky
  md:top-20`, full width with `min-w-0`, and every control cluster wraps
  (`flex-wrap`): the LIVE + subdomain badge, **Copy Link**, **Open Site**,
  **Inline Edit Mode** / **Client Preview**, the **Desktop / Tablet / Mobile**
  device toggles, the AI prompt row, the AI preset chips and the 14-template
  ribbon.
* **Action buttons** — `Side Customizer` and `Test Booking (₹)` are full-width
  wrapping buttons on phones with `whitespace-nowrap` labels; the
  "Side Customizer" label is `hidden md:inline` (the icon alone opens the
  customizer as a bottom sheet), and the status group got `min-w-0` so a long
  subdomain truncates instead of pushing the row out.
* **Preview canvas** — `w-full max-w-full min-w-0 overflow-x-hidden` plus the
  existing inline `width: 100%` / device `maxWidth`, so Desktop, Tablet and
  Mobile device modes all stay inside the viewport (the device frames are now
  *centred clips* rather than cut-off rectangles).
* **Inline-edit banner** — stacks (`flex-col … sm:flex-row`) instead of forcing
  the copy and the "Switch to Client Preview" button onto one line.
* **On-canvas toast** — `max-w-[calc(100vw-1.5rem)] right-3 sm:right-5` so a long
  notification cannot run off the screen.

## Side customizer (`src/components/SidePanelCustomizer.tsx`)

The panel was `fixed right-0 w-80 sm:w-96` — 320 px of a 360 px phone, with the
canvas behind it.

* **Below `md`**: a full-width bottom sheet — `inset-x-0 bottom-0 max-h-[85dvh]
  w-full rounded-t-2xl border-t`, so the controls are reachable one-handed and the
  canvas is never pushed sideways.
* **`md` and up**: the original right rail (`md:right-0 md:top-20 md:bottom-0
  md:w-96 md:border-l`).
* Its seven tab labels are `hidden … min-[380px]:inline` (icons only on the
  narrowest phones), and the close button points down on phones / right on
  desktop.

## Dialogs (all of them now fit in `95vw`)

| Dialog | Was | Now |
| --- | --- | --- |
| Profile Settings (`UserProfileSettingsModal.tsx`) | `max-w-xl w-full`, backdrop `p-4` with no scroll | `max-w-[min(36rem,95vw)] max-h-[90dvh] mx-auto`, backdrop `overflow-y-auto p-3 sm:p-4` |
| Save notification (`WebsiteSavedModal.tsx`) | `w-[calc(100%-2rem)] max-w-lg` | `w-[calc(100%-1.5rem)] max-w-[min(32rem,95vw)]`, `sm:rounded-3xl` |
| AI bio (`AIBioModal.tsx`) | `w-[92%] … md:w-[600px] max-w-[600px]` | `w-full max-w-[min(600px,95vw)] mx-auto max-h-[90dvh] p-4 sm:p-6` |
| Contact details (`PartnerProfileModal.tsx`) | already `w-[min(94vw,560px)]` | unchanged — this was already width-safe |
| Global save/error toast (`App.tsx`) | `left-1/2 -translate-x-1/2` at natural width — a long session-expired message pushed the page sideways | `fixed inset-x-0 bottom-6 flex justify-center px-4` with `min-w-0 break-words` on the message |

## Tests

`tests/dom/websiteEditorResponsive.test.ts` (5 tests) mounts the **real**
components in jsdom and pins the contract:

* the editor shell and the preview shell stretch, cap at the viewport and clip
  horizontal overflow; the content column keeps `px-4 md:px-6`;
* the save-bar actions row wraps;
* the owner toolbar is sticky only from `md` up, its control clusters wrap, and
  the canvas carries `w-full max-w-full min-w-0 overflow-x-hidden`;
* the customizer is a bottom sheet below `md` (and a rail above it) and is no
  longer a fixed `w-80`;
* every dialog caps at `95vw` with `mx-auto` and a `dvh` height limit, and the
  global toast is pinned inside a padded gutter with wrapping copy;
* no element in the rendered trees, and no class token in those three source
  files, declares a fixed width wider than a phone.

Run it with:

```bash
node --import ./scripts/testEnv.mjs --import tsx --test --test-force-exit tests/dom/websiteEditorResponsive.test.ts
```

`npm run lint` (tsc) and `npm run build` are clean, and the generated stylesheet
contains every responsive utility used here (`overflow-x-clip`,
`max-w-[min(…,95vw)]`, `max-h-[85dvh]`, `min-[380px]:inline`).
