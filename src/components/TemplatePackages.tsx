import { PublishedSectionEmpty } from './PublishedSectionEmpty';
import React, { useState } from "react";
import { Check, Gift, Pencil, Trash2 } from "lucide-react";
import type { SalonPackage, SalonService } from "../types";

import { resolveWebsitePackages } from "../lib/websitePackages";
export { resolveWebsitePackages } from "../lib/websitePackages";

export function TemplatePackages({
  packages,
  services,
  onBook,
  onViewServices,
}: {
  packages?: SalonPackage[];
  services: SalonService[];
  onBook: (ids: string[]) => void;
  onViewServices?: () => void;
}) {
  const visible = resolveWebsitePackages(packages, services);

  return (
    <section
      id="packages-section"
      className="px-4 py-8 @min-[768px]/salon:p-12 border-b border-current/10"
    >
      <span className="text-xs uppercase tracking-widest opacity-50">
        Thoughtfully paired
      </span>
      <h2 className="text-2xl font-bold mt-2 mb-6">Packages & rituals</h2>
      {!visible.length && <PublishedSectionEmpty title="Packages are being curated" detail="No packages have been published yet. You can still choose individual services and build your own appointment." action="View all services" onAction={onViewServices} />}
      <div className="grid @min-[640px]/salon:grid-cols-2 gap-4">
        {visible.map((p) => (
          <article
            key={p.id}
            className="rounded-2xl border border-current/10 p-5 bg-current/[0.02]"
          >
            <Gift className="w-6 h-6 mb-3" />
            <h3 className="text-xl font-bold">{p.name}</h3>
            <p className="text-sm opacity-60 mt-2">{p.description}</p>
            <ul className="my-5 space-y-2 text-sm">
              {p.items.map((s) => (
                <li key={s.id} className="flex gap-2">
                  <Check size={16} />
                  {s.name}
                </li>
              ))}
            </ul>
            <div className="flex justify-between items-center gap-3">
              <div>
                <p className="text-lg font-bold">
                  ₹{p.price.toLocaleString("en-IN")}
                </p>
                <p className="text-xs opacity-60">
                  {p.duration} min · {p.items.length} services
                </p>
              </div>
              <button
                type="button"
                onClick={() => onBook(p.serviceIds)}
                className="min-h-11 rounded-xl bg-slate-900 text-white px-4 text-sm font-bold"
              >
                Book package
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function PackageManagement({
  packages = [],
  services,
  onChange,
}: {
  packages?: SalonPackage[];
  services: SalonService[];
  onChange: (packages: SalonPackage[]) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SalonPackage | null>(null);
  const [error, setError] = useState("");
  const selected = services.filter((s) => draft?.serviceIds.includes(s.id));
  return (
    <section
      className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-6"
      aria-label="Packages management"
    >
      <div className="flex justify-between gap-3 items-center">
        <div>
          <h2 className="font-bold text-base">Packages Management</h2>
          <p className="text-xs text-gray-500 mt-1">
            Bundle your services into one appointment.
          </p>
        </div>
        <button
          type="button"
          className="min-h-11 px-3 text-xs rounded-xl border font-bold"
          onClick={() => {
            setEditingId(null);
            setError("");
            setDraft({
              id: `package-${crypto.randomUUID()}`,
              name: "",
              description: "",
              serviceIds: [],
              isActive: true,
            });
          }}
        >
          Create package
        </button>
      </div>
      {packages.map((p) => (
        <div
          key={p.id}
          className="flex items-center justify-between gap-3 rounded-xl border p-3 mt-3"
        >
          <div>
            <p className="text-sm font-bold">{p.name}</p>
            <p className="text-xs text-gray-500">
              {p.serviceIds.length} services ·{" "}
              {p.isActive ? "Active" : "Inactive"}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              aria-label={`Edit ${p.name}`}
              onClick={() => {
                setEditingId(p.id);
                setDraft({ ...p });
                setError("");
              }}
              className="w-11 h-11 grid place-items-center rounded-xl border"
            >
              <Pencil size={16} />
            </button>
            <button
              type="button"
              aria-label={`Delete ${p.name}`}
              onClick={() => onChange(packages.filter((v) => v.id !== p.id))}
              className="w-11 h-11 grid place-items-center rounded-xl border"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      ))}
      {draft && (
        <div className="rounded-xl border p-4 mt-4 space-y-3">
          <label className="customer-field">
            Package name
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label className="customer-field">
            Description
            <input
              value={draft.description}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
            />
          </label>
          <fieldset>
            <legend className="text-xs font-semibold mb-2">
              Included services
            </legend>
            <div className="grid sm:grid-cols-2 gap-2 max-h-60 overflow-auto">
              {services.map((s) => (
                <label
                  key={s.id}
                  className="flex items-center gap-2 text-xs min-h-11"
                >
                  <input
                    type="checkbox"
                    checked={draft.serviceIds.includes(s.id)}
                    onChange={() =>
                      setDraft({
                        ...draft,
                        serviceIds: draft.serviceIds.includes(s.id)
                          ? draft.serviceIds.filter((id) => id !== s.id)
                          : [...draft.serviceIds, s.id],
                      })
                    }
                  />
                  {s.name} · ₹{s.price}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="text-xs font-semibold">
            ₹{selected.reduce((n, s) => n + s.price, 0).toLocaleString("en-IN")}{" "}
            · {selected.reduce((n, s) => n + s.durationMinutes, 0)} min
          </p>
          <p className="text-xs text-gray-500">
            Price and duration follow the included services.
          </p>
          <label className="flex gap-2 text-xs">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(e) =>
                setDraft({ ...draft, isActive: e.target.checked })
              }
            />
            Active on website
          </label>
          {error && (
            <p role="alert" className="text-xs text-rose-600">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              className="customer-button"
              onClick={() => {
                if (!draft.name.trim() || !draft.serviceIds.length) {
                  setError("Enter a name and choose at least one service.");
                  return;
                }
                const next = { ...draft, name: draft.name.trim() };
                onChange(
                  editingId
                    ? packages.map((p) => (p.id === editingId ? next : p))
                    : [...packages, next],
                );
                setDraft(null);
              }}
            >
              Apply package
            </button>
            <button
              type="button"
              className="customer-button-secondary"
              onClick={() => setDraft(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
