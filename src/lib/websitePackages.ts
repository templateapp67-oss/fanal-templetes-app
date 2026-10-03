import type { SalonPackage, SalonService } from "../types.js";

export function resolveWebsitePackages(
  packages: SalonPackage[] | undefined,
  services: SalonService[],
) {
  return (packages || [])
    .filter((p) => p.isActive)
    .flatMap((p) => {
      const ids = [...new Set(p.serviceIds)];
      const items = ids
        .map((id) => services.find((s) => s.id === id))
        .filter((s): s is SalonService => Boolean(s));
      if (!items.length || items.length !== ids.length) return [];
      return [
        {
          ...p,
          items,
          price: items.reduce((n, s) => n + s.price, 0),
          duration: items.reduce((n, s) => n + s.durationMinutes, 0),
        },
      ];
    });
}
