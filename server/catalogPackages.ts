import type { SalonPackage, SalonService } from '../src/types.js';
import { catalogId } from './normalizedBookingCreate.js';

// ============================================================================
// Salon packages for the Customer App — the tolerant resolver.
//
// WHY THIS FILE EXISTS
// --------------------
// The salon page has a Packages tab. It rendered "No packages published by this
// salon yet." for essentially every salon, for three separate reasons:
//
//   1. `src/lib/websitePackages.ts#resolveWebsitePackages` drops a package when
//      ANY of its `serviceIds` fails to match a live service row — silently,
//      with no log. One renamed or deactivated service made a whole package
//      disappear from the customer app.
//   2. Editor package `serviceIds` are editor-local ids. The published
//      `services.id` is `nexora_catalog_uuid(salon, 'service', editorId)` — the
//      same md5 derivation as `catalogId()`. The public-site read path applied
//      that mapping (server/siteLookup.ts:475) and the customer directory
//      applied it too, but nothing ever *reported* a miss, so an id-space
//      mismatch was indistinguishable from "the owner published no packages".
//   3. The legacy `profiles`-backed discovery path never emitted `packages` at
//      all, so on any deployment without normalized `salons` rows the tab was
//      empty by construction.
//
// This module is the single place that turns "what the owner saved" into "what
// the customer may book", for BOTH read paths, and it returns notes for
// anything it dropped or shortened instead of hiding it.
//
// PRICE RULE (identical to `resolveWebsitePackages`, deliberately): a package's
// payable price is the sum of its live service prices, never the number typed in
// the editor. `services.price` / `services.price_paise` is what the booking API
// charges, so a package quoting anything else would be a dispute at the counter.
//
// Server-side only: it imports `catalogId`, which uses node:crypto. The browser
// bundle must never reach this file — screens consume the resolved packages that
// `/api/customer/salons*` already returns.
// ============================================================================

export interface CatalogPackage {
  id: string;
  name: string;
  description: string;
  /** Live `services.id` values — exactly what a booking is created from. */
  serviceIds: string[];
  /** Names matching `serviceIds`, so a card can list what is included. */
  items: Array<{ id: string; name: string; price: number; durationMinutes: number }>;
  price: number;
  durationMinutes: number;
  /** Ids the owner picked that no longer resolve to a live, bookable service. */
  unresolvedIds: string[];
}

export interface CatalogPackagesResult {
  packages: CatalogPackage[];
  /** Human-readable notes for anything dropped or shortened. Never silent. */
  notes: string[];
}

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const asNumber = (value: unknown): number => (Number.isFinite(Number(value)) ? Number(value) : 0);

/**
 * Resolve an owner's saved packages against the salon's live service menu.
 *
 * @param packages the owner's packages — any id space (editor-local or uuid)
 * @param services the published menu, mapped to `{ id, name, price, durationMinutes }`
 * @param salonId  used to derive catalogue uuids from editor-local ids
 *
 * A package survives when at least one of its services is live. With some ids
 * unresolved it is kept with the live subset plus a note, because a slightly
 * shorter package the customer can actually book beats a silently missing one.
 * With nothing resolved it is dropped plus a note — creating a booking from it
 * would fail at the API, and an empty card would be worse than an explanation.
 */
export function buildCatalogPackages(
  packages: SalonPackage[] | undefined | null,
  services: SalonService[] | undefined | null,
  salonId: string,
): CatalogPackagesResult {
  const notes: string[] = [];
  const menu = (Array.isArray(services) ? services : []).filter(Boolean);
  const byId = new Map<string, SalonService>();
  for (const service of menu) {
    const id = asText(service.id);
    if (id) byId.set(id, service);
  }

  const saved = (Array.isArray(packages) ? packages : []).filter(
    (pkg) => pkg && asText(pkg.name) && Array.isArray(pkg.serviceIds) && pkg.isActive !== false,
  );

  const out: CatalogPackage[] = [];
  for (const pkg of saved.slice(0, 100)) {
    const name = asText(pkg.name);
    // Both id spaces are accepted: a real catalogue uuid passes through
    // `catalogId` untouched; an editor-local id is derived exactly the way the
    // save RPC derived the row it created (`public.nexora_catalog_uuid`).
    const requested = [
      ...new Set(
        pkg.serviceIds
          .map((id) => asText(id))
          .filter(Boolean)
          .map((id) => catalogId(salonId, 'service', id)),
      ),
    ];
    if (!requested.length) {
      notes.push(`“${name}” has no services selected, so it is not shown to customers.`);
      continue;
    }
    const items = requested.map((id) => byId.get(id)).filter((service): service is SalonService => Boolean(service));
    const unresolvedIds = requested.filter((id) => !byId.has(id));
    if (!items.length) {
      notes.push(
        `“${name}” points at ${requested.length} service${requested.length === 1 ? '' : 's'} that ${
          requested.length === 1 ? 'is' : 'are'
        } not in this salon's live menu, so it is not shown. Re-saving the package in the website editor re-links it.`,
      );
      continue;
    }
    if (unresolvedIds.length) {
      notes.push(
        `“${name}” is shown with ${items.length} of ${requested.length} services — the rest are no longer on the live menu, and the price is the sum of what remains.`,
      );
    }
    out.push({
      id: asText(pkg.id) || catalogId(salonId, 'package', name),
      name,
      description: asText(pkg.description),
      serviceIds: items.map((service) => asText(service.id)),
      items: items.map((service) => ({
        id: asText(service.id),
        name: asText(service.name),
        price: asNumber(service.price),
        durationMinutes: asNumber(service.durationMinutes),
      })),
      price: items.reduce((total, service) => total + asNumber(service.price), 0),
      durationMinutes: items.reduce((total, service) => total + asNumber(service.durationMinutes), 0),
      unresolvedIds,
    });
  }

  return { packages: out, notes };
}

/**
 * Editor packages arrive inside `salons.data.editor_profile.packages` (published)
 * or inside the owner draft (`owner_editor_state`). The customer app reads the
 * published copy only — a draft must never change what a stranger can book — so
 * this helper takes the profile the caller already resolved and returns the
 * packages plus notes, with the same rules on both read paths.
 */
export function catalogPackagesForSalon(
  profile: { packages?: SalonPackage[] } | null | undefined,
  services: SalonService[] | undefined | null,
  salonId: string,
): CatalogPackagesResult {
  return buildCatalogPackages(profile?.packages, services, salonId);
}
