import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  CalendarDays,
  Check,
  ChevronLeft,
  Clock,
  Gift,
  Heart,
  MapPin,
  Search,
  SlidersHorizontal,
  Star,
  UserRound,
} from "lucide-react";
import type { SalonProfile, SalonService } from "../types";
import { TEMPLATE_REGISTRY } from "../data/templates";
import { resolveWebsitePackages } from "../lib/websitePackages";
import { WebsiteLocationMap } from "./WebsiteLocationMap";
import type {
  TemplateCustomerRequest,
  TemplateCustomerSection,
} from "./TemplateCustomerHub";

type DemoBooking = {
  id: string;
  serviceIds: string[];
  date: string;
  time: string;
  status: "Upcoming" | "Completed" | "Cancelled";
  total: number;
  paid: number;
  review?: { stars: number; text: string; tags: string[] };
  reason?: string;
};
type DemoAddress = {
  id: string;
  label: string;
  address: string;
  isDefault: boolean;
};
const money = (n: number) =>
  `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const dateAfter = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const TABS: Array<{
  section: TemplateCustomerSection;
  label: string;
  Icon: typeof Search;
}> = [
  { section: "home", label: "Explore", Icon: Search },
  { section: "bookings", label: "Appointments", Icon: CalendarDays },
  { section: "wallet", label: "Rewards", Icon: Gift },
  { section: "favourites", label: "Favorites", Icon: Heart },
  { section: "profile", label: "Profile", Icon: UserRound },
];

/** Preview-only interactions. No API, payment, messaging or persistent writes. */
export function TemplateCustomerDemo({
  request,
  profile: initialProfile,
  services: initialServices,
  onNavigateSection,
  desktop = false,
}: {
  request: TemplateCustomerRequest | null;
  profile: SalonProfile;
  services: SalonService[];
  onNavigateSection?: (section: TemplateCustomerSection) => void;
  desktop?: boolean;
}) {
  const internalNavigation = useRef<TemplateCustomerSection | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const imageFallback = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    if (!image.src.endsWith("/gallery-placeholder.svg"))
      image.src = "/gallery-placeholder.svg";
  };
  const [demoTemplateId, setDemoTemplateId] = useState<string | null>(null);
  const demoTemplate = TEMPLATE_REGISTRY.find((t) => t.id === demoTemplateId);
  const profile = demoTemplate
    ? ({
        ...initialProfile,
        ...demoTemplate.config,
        businessName: demoTemplate.name,
        businessType: demoTemplate.id,
        packages: undefined,
      } as SalonProfile)
    : initialProfile;
  const services = demoTemplate?.config.services || initialServices;
  const [section, setSection] = useState<TemplateCustomerSection>(
    request?.section || "home",
  );
  const [query, setQuery] = useState("");
  const defaultCity =
    profile.city && !/^your city$/i.test(profile.city.trim())
      ? profile.city
      : "Bengaluru";
  const [city, setCity] = useState(defaultCity);
  const [sort, setSort] = useState("Recommended");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filter, setFilter] = useState({
    category: "",
    gender: "",
    price: "",
    rating: "",
    distance: "",
    available: false,
  });
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>(
    services[0] ? [services[0].id] : [],
  );
  const [step, setStep] = useState(0);
  const [date, setDate] = useState(dateAfter(1));
  const [time, setTime] = useState("");
  const [detail, setDetail] = useState<string | null>(null);
  const [appointmentTab, setAppointmentTab] = useState("Upcoming");
  const [customer, setCustomer] = useState({
    name: "Aarav Sharma",
    phone: "",
    email: "",
    gender: "Prefer not to say",
    dob: "",
    language: "English",
    photo: "",
    notes: "",
  });
  const [addresses, setAddresses] = useState<DemoAddress[]>([]);
  const [addressDraft, setAddressDraft] = useState("");
  const [editingAddress, setEditingAddress] = useState<string | null>(null);
  const [savedAddress, setSavedAddress] = useState("");
  const [coupon, setCoupon] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [authMode, setAuthMode] = useState("Login");
  const [password, setPassword] = useState("");
  const [notifications, setNotifications] = useState([
    {
      id: "welcome",
      title: "Welcome to your salon experience",
      text: "Explore services, save favorites and plan your next visit.",
      unread: true,
    },
    {
      id: "reward",
      title: "Reward activity",
      text: "Your sample visit earned 50 points.",
      unread: true,
    },
  ]);
  const [notificationTab, setNotificationTab] = useState("All");
  const [preferences, setPreferences] = useState({
    reminders: true,
    rewards: true,
    offers: false,
  });
  const [action, setAction] = useState<
    "cancel" | "reschedule" | "review" | null
  >(null);
  const [reason, setReason] = useState("");
  const [review, setReview] = useState({
    stars: 5,
    text: "",
    tags: [] as string[],
  });
  const [bookings, setBookings] = useState<DemoBooking[]>(() =>
    services[0]
      ? [
          {
            id: "DEMO-UPCOMING",
            serviceIds: [services[0].id],
            date: dateAfter(3),
            time: "11:00",
            status: "Upcoming",
            total: services[0].price,
            paid: Math.round(services[0].price * 25) / 100,
          },
          {
            id: "DEMO-COMPLETED",
            serviceIds: [services[0].id],
            date: dateAfter(-7),
            time: "14:00",
            status: "Completed",
            total: services[0].price,
            paid: services[0].price,
          },
          {
            id: "DEMO-CANCELLED",
            serviceIds: [services[0].id],
            date: dateAfter(-14),
            time: "10:00",
            status: "Cancelled",
            total: services[0].price,
            paid: 0,
            reason: "Plans changed",
          },
        ]
      : [],
  );
  const [holdRemaining, setHoldRemaining] = useState(0);
  useEffect(() => {
    if (!holdRemaining || !request) return;
    const timer = setTimeout(
      () => setHoldRemaining((n) => Math.max(0, n - 1)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [holdRemaining, request]);
  useEffect(() => {
    if (!request) return;
    if (internalNavigation.current === request.section) { internalNavigation.current = null; return; }
    setDemoTemplateId(null);
    setSection(request.section);
    setError("");
    setNotice("");
    setDetail(null);
    setAction(null);
    if (request.section === "book") {
      setSelectedIds(
        request.serviceIds?.length
          ? request.serviceIds
          : services[0]
            ? [services[0].id]
            : [],
      );
      setStep(0);
      setTime("");
      setHoldRemaining(0);
    }
  }, [request]);
  useEffect(() => {
    const panel = panelRef.current?.closest("dialog");
    if (panel) panel.scrollTop = 0;
  }, [section, step, detail]);
  const selected = services.filter((s) => selectedIds.includes(s.id));
  const subtotal = selected.reduce((n, s) => n + s.price, 0);
  const discount = appliedCoupon ? Math.round(subtotal * 10) / 100 : 0;
  const total = subtotal - discount;
  const advance = Math.round(total * 25) / 100;
  const duration = selected.reduce((n, s) => n + s.durationMinutes, 0);
  const selectedBooking = bookings.find((b) => b.id === detail);
  const categories = [...new Set(services.map((s) => s.category))];
  const packages = useMemo(
    () =>
      profile.packages
        ? resolveWebsitePackages(profile.packages, services)
        : [services.slice(0, 2), services.slice(2, 5)]
            .filter((p) => p.length >= 2)
            .map((items, i) => ({
              id: `package-${i}`,
              name: i ? "Complete Care Ritual" : "Signature Duo",
              description: i
                ? "A little more time for you. A complete care experience."
                : "Two salon essentials, one effortless appointment.",
              items,
              price: items.reduce((n, s) => n + s.price, 0),
              duration: items.reduce((n, s) => n + s.durationMinutes, 0),
            })),
    [services, profile.packages],
  );
  const directory = useMemo(
    () => [
      {
        id: "current",
        name: profile.businessName,
        image: profile.coverImageUrl,
        category: profile.businessType,
        city: defaultCity,
        area: profile.areaLocality || "City centre",
        price: services[0]?.price || 0,
        distance: 1.2,
        rating: 4.8,
        reviews: 124,
        open: true,
        gender: "All genders",
        serviceNames: services.map((s) => s.name),
      },
      ...TEMPLATE_REGISTRY.filter((t) => t.id !== profile.businessType)
        .slice(0, 5)
        .map((t, i) => ({
          id: t.id,
          name: t.config.title,
          image: t.config.coverImageUrl,
          category: t.category,
          city,
          area: ["Central district", "Park avenue", "Market road"][i % 3],
          price: t.config.services[0]?.price || 0,
          distance: 2.1 + i,
          rating: 4.6 + i * 0.05,
          reviews: 38 + i * 12,
          open: i !== 3,
          gender: i === 1 ? "Women" : i === 2 ? "Men" : "All genders",
          serviceNames: t.config.services.map((s) => s.name),
        })),
    ],
    [profile, services, city],
  );
  const results = directory
    .filter(
      (s) =>
        (!query ||
          [s.name, s.category, s.area, s.city, ...s.serviceNames].some((v) =>
            v.toLowerCase().includes(query.toLowerCase()),
          )) &&
        (!filter.category ||
          s.category === filter.category ||
          (s.id === "current" && categories.includes(filter.category))) &&
        (!filter.gender || s.gender === filter.gender) &&
        (!filter.price || s.price <= Number(filter.price)) &&
        (!filter.rating || s.rating >= Number(filter.rating)) &&
        (!filter.distance || s.distance <= Number(filter.distance)) &&
        (!filter.available || s.open),
    )
    .sort((a, b) =>
      sort === "Nearby"
        ? a.distance - b.distance
        : sort === "Top rated"
          ? b.rating - a.rating
          : sort === "Price"
            ? a.price - b.price
            : sort === "Trending"
              ? b.reviews - a.reviews
              : sort === "Recommended"
                ? b.rating / b.distance - a.rating / a.distance
                : 0,
    );
  const go = (to: TemplateCustomerSection) => {
    if (onNavigateSection) internalNavigation.current = to;
    onNavigateSection?.(to);
    setSection(to);
    setDetail(null);
    setAction(null);
    setError("");
    setNotice("");
  };
  const book = (ids: string[]) => {
    setSelectedIds(ids);
    setStep(0);
    setTime("");
    setHoldRemaining(0);
    setAppliedCoupon(false);
    go("book");
  };
  const addNotification = (title: string, text: string) =>
    setNotifications((n) => [
      { id: `${Date.now()}-${n.length}`, title, text, unread: true },
      ...n,
    ]);
  const button = (
    label: React.ReactNode,
    onClick: () => void,
    secondary = false,
    disabled = false,
  ) => (
    <button
      key={typeof label === "string" ? label : undefined}
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={secondary ? "customer-button-secondary" : "customer-button"}
    >
      {label}
    </button>
  );
  const field = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    type = "text",
  ) => (
    <label className="customer-field">
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
  const heading = (title: string, subtitle?: string) => (
    <div className="mb-5">
      <h3 className="text-2xl font-bold tracking-tight">{title}</h3>
      {subtitle && <p className="text-sm opacity-60 mt-1">{subtitle}</p>}
    </div>
  );
  const toggleFavorite = (id: string) =>
    setFavorites((v) =>
      v.includes(id) ? v.filter((x) => x !== id) : [...v, id],
    );
  const salonCard = (s: (typeof directory)[number]) => (
    <article key={s.id} className="customer-card overflow-hidden p-0">
      <div className="relative">
        <img
          onError={imageFallback}
          src={s.image || "/gallery-placeholder.svg"}
          alt={s.name}
          className="w-full h-40 object-cover"
        />
        <button
          type="button"
          aria-label={`${favorites.includes(s.id) ? "Remove" : "Add"} ${s.name} favorite`}
          onClick={() => toggleFavorite(s.id)}
          className="absolute top-3 right-3 h-11 w-11 bg-white text-slate-900 rounded-full grid place-items-center shadow"
        >
          <Heart
            size={19}
            fill={favorites.includes(s.id) ? "currentColor" : "none"}
          />
        </button>
        <span
          className={`absolute bottom-3 left-3 rounded-full px-2.5 py-1 text-xs font-semibold ${s.open ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"}`}
        >
          {s.open ? "Open now" : "Closed"}
        </span>
      </div>
      <div className="p-4 space-y-2">
        <h4 className="font-bold">{s.name}</h4>
        <p className="text-xs flex items-center gap-1">
          <Star size={13} fill="currentColor" />
          {s.rating.toFixed(1)}{" "}
          <span className="opacity-60">({s.reviews} reviews)</span>
        </p>
        <p className="text-xs opacity-60">
          {s.area}, {s.city} · {s.distance.toFixed(1)} km
        </p>
        <p className="text-sm font-semibold">From {money(s.price)}</p>
        <div className="flex gap-2">
          {button(
            "View salon",
            () => {
              setRecent((r) =>
                [s.id, ...r.filter((id) => id !== s.id)].slice(0, 5),
              );
              setDemoTemplateId(s.id === "current" ? demoTemplateId : s.id);
              go("salon");
            },
            true,
          )}
          {button("Book now", () => {
            const chosen =
              s.id === "current"
                ? services
                : TEMPLATE_REGISTRY.find((t) => t.id === s.id)?.config
                    .services || [];
            setDemoTemplateId(s.id === "current" ? demoTemplateId : s.id);
            book(chosen[0] ? [chosen[0].id] : []);
          })}
        </div>
      </div>
    </article>
  );
  const summary = (b?: DemoBooking) => (
    <dl className="customer-summary">
      {[
        [
          "Services",
          (b ? services.filter((s) => b.serviceIds.includes(s.id)) : selected)
            .map((s) => s.name)
            .join(" + ") || "Select a service",
        ],
        ["Date", b?.date || date],
        ["Time", b?.time || time || "Choose a time"],
        [
          "Duration",
          `${b ? services.filter((s) => b.serviceIds.includes(s.id)).reduce((n, s) => n + s.durationMinutes, 0) : duration} min`,
        ],
        ["Subtotal", money(b?.total ?? subtotal)],
        ["Discount", money(b ? 0 : discount)],
        ["Platform fee", money(0)],
        ["Tax", money(0)],
        ["Total", money(b?.total ?? total)],
        ["25% advance", money(b ? Math.round(b.total * 25) / 100 : advance)],
        ["Amount paid", money(b?.paid || 0)],
        [
          "Remaining amount",
          money(b ? Math.max(0, b.total - b.paid) : total - advance),
        ],
      ].map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );

  return (
    <div ref={panelRef} className="customer-demo flex flex-col min-h-[65dvh]">
      <div className="px-4 py-2 text-xs border-b customer-demo-label">
        Interactive template preview · sample data · no real booking or payment
      </div>
      <div className="customer-demo-main px-4 sm:px-6 py-6 flex-1">
        {error && (
          <p
            role="alert"
            className="mb-4 rounded-xl bg-rose-50 text-rose-700 p-3 text-sm"
          >
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mb-4 rounded-xl border p-3 text-sm">
            {notice}
          </p>
        )}
        {section === "home" && (
          <>
            {heading(
              "Make time for yourself",
              "Find your next salon, treatment or favorite ritual.",
            )}
            <div className="flex gap-2 flex-wrap mb-4">
              {button(
                <>
                  <MapPin size={16} />
                  {city}
                </>,
                () => go("location"),
                true,
              )}
              {button(
                <>
                  <Gift size={16} />
                  Your rewards
                </>,
                () => go("wallet"),
                true,
              )}
            </div>
            <label className="customer-search">
              <Search size={20} />
              <input
                aria-label="Search salon, service, area or city"
                placeholder="Salon, service, area or city"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                aria-label="Search filters"
                type="button"
                onClick={() => setFiltersOpen(!filtersOpen)}
              >
                <SlidersHorizontal size={20} />
              </button>
            </label>
            {filtersOpen && (
              <div className="customer-card mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
                <label className="customer-field">
                  Category
                  <select
                    value={filter.category}
                    onChange={(e) =>
                      setFilter({ ...filter, category: e.target.value })
                    }
                  >
                    <option value="">All categories</option>
                    {[
                      ...new Set([
                        ...categories,
                        ...directory.map((s) => s.category),
                      ]),
                    ].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label className="customer-field">
                  Gender / service type
                  <select
                    value={filter.gender}
                    onChange={(e) =>
                      setFilter({ ...filter, gender: e.target.value })
                    }
                  >
                    <option value="">Any gender</option>
                    {["All genders", "Women", "Men"].map((g) => (
                      <option key={g}>{g}</option>
                    ))}
                  </select>
                </label>
                {field(
                  "Maximum price",
                  filter.price,
                  (v) => setFilter({ ...filter, price: v }),
                  "number",
                )}
                <label className="customer-field">
                  Minimum rating
                  <select
                    value={filter.rating}
                    onChange={(e) =>
                      setFilter({ ...filter, rating: e.target.value })
                    }
                  >
                    <option value="">Any rating</option>
                    <option value="4">4+</option>
                    <option value="4.7">4.7+</option>
                  </select>
                </label>
                {field(
                  "Distance (km)",
                  filter.distance,
                  (v) => setFilter({ ...filter, distance: v }),
                  "number",
                )}
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={filter.available}
                    onChange={(e) =>
                      setFilter({ ...filter, available: e.target.checked })
                    }
                  />
                  Available now
                </label>
                {button(
                  "Clear filters",
                  () =>
                    setFilter({
                      category: "",
                      gender: "",
                      price: "",
                      rating: "",
                      distance: "",
                      available: false,
                    }),
                  true,
                )}
              </div>
            )}
            <div className="flex gap-2 overflow-auto py-4 scrollbar-none">
              {[
                "Recommended",
                "Nearby",
                "Top rated",
                "Trending",
                "Featured",
                "Price",
              ].map((label) => (
                <button
                  type="button"
                  key={label}
                  aria-pressed={sort === label}
                  className={`customer-chip ${sort === label ? "selected" : ""}`}
                  onClick={() => setSort(label)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="customer-promo mb-5">
              <Gift size={26} />
              <div>
                <p className="font-bold">A little treat for your next visit</p>
                <p className="text-sm opacity-75">
                  Try PREVIEW10 for 10% off a sample booking.
                </p>
              </div>
              {button("Quick book", () =>
                book(services[0] ? [services[0].id] : []),
              )}
            </div>
            <p className="text-sm font-semibold mb-3">
              {results.length} salons · {sort.toLowerCase()} for you
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {(sort === "Featured" ? results.slice(0, 4) : results).map(
                salonCard,
              )}
            </div>
            {!results.length && (
              <div className="customer-card text-center py-10">
                <Search className="mx-auto mb-3" />
                No salons match your filters. Try another category or location.
              </div>
            )}
            {!!recent.length && (
              <section className="mt-6">
                {heading("Recently viewed")}
                <div className="grid gap-4 sm:grid-cols-2">
                  {directory
                    .filter((s) => recent.includes(s.id))
                    .map(salonCard)}
                </div>
              </section>
            )}
          </>
        )}
        {(section === "salon" ||
          section === "services" ||
          section === "packages") && (
          <>
            {heading(profile.businessName, profile.tagline)}
            <div className="flex gap-2 flex-wrap mb-5">
              {["salon", "services", "packages"].map((v) =>
                button(
                  v === "salon"
                    ? "Overview"
                    : v === "services"
                      ? "Services"
                      : "Packages",
                  () => go(v as TemplateCustomerSection),
                  section !== v,
                ),
              )}
              {button(
                <>
                  <Heart size={16} />
                  {favorites.includes("current") ? "Saved" : "Favorite"}
                </>,
                () => toggleFavorite("current"),
                true,
              )}
            </div>
            {section === "salon" && (
              <>
                <img
                  onError={imageFallback}
                  src={profile.coverImageUrl || "/gallery-placeholder.svg"}
                  alt={profile.businessName}
                  className="rounded-2xl w-full h-56 object-cover mb-4"
                />
                <p className="text-sm leading-relaxed opacity-75 mb-5">
                  {profile.about}
                </p>
                <div className="grid grid-cols-2 gap-3 mb-5">
                  <div className="customer-card">
                    <Star size={18} />
                    <strong>4.8</strong>
                    <p className="text-xs opacity-60">124 sample reviews</p>
                  </div>
                  <div className="customer-card">
                    <Clock size={18} />
                    <strong>Open today</strong>
                    <p className="text-xs opacity-60">
                      {profile.workingHoursMonFri || "10:00–20:00"}
                    </p>
                  </div>
                </div>
                <WebsiteLocationMap profile={profile} />
                <p className="text-sm my-4">
                  {profile.address}, {profile.city} ·{" "}
                  {profile.phone || "Contact details available after booking"}
                </p>
                <div className="grid grid-cols-3 gap-2 mb-5">
                  {(profile.gallery || []).slice(0, 6).map((p) => (
                    <img
                      key={p.id}
                      onError={imageFallback}
                      src={p.url}
                      alt={p.title}
                      className="rounded-xl aspect-square object-cover"
                    />
                  ))}
                </div>
                {button("Book appointment", () =>
                  book(services[0] ? [services[0].id] : []),
                )}
                <div className="customer-card mt-5">
                  <h4 className="font-bold mb-2">Verified customer reviews</h4>
                  <p className="text-sm">★★★★★ · A wonderful visit</p>
                  <p className="text-xs opacity-60">
                    Sample review · Professional team, thoughtful care and a
                    beautiful result.
                  </p>
                </div>
                <section className="mt-6">
                  {heading("Similar salons")}
                  <div className="grid sm:grid-cols-2 gap-4">
                    {directory.slice(1, 3).map(salonCard)}
                  </div>
                </section>
              </>
            )}
            {section === "services" && (
              <>
                <div className="flex gap-2 overflow-auto mb-4">
                  <button
                    className="customer-chip"
                    type="button"
                    onClick={() => setFilter({ ...filter, category: "" })}
                  >
                    All services
                  </button>
                  {categories.map((c) => (
                    <button
                      type="button"
                      className={`customer-chip ${filter.category === c ? "selected" : ""}`}
                      key={c}
                      onClick={() => setFilter({ ...filter, category: c })}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <div className="space-y-3">
                  {services
                    .filter(
                      (s) => !filter.category || s.category === filter.category,
                    )
                    .map((s) => (
                      <article
                        key={s.id}
                        className="customer-card flex gap-3 items-center"
                      >
                        <img
                          onError={imageFallback}
                          src={s.imageUrl || "/gallery-placeholder.svg"}
                          alt=""
                          className="w-16 h-16 rounded-xl object-cover"
                        />
                        <div className="flex-1 min-w-0">
                          <h4 className="font-bold text-sm">{s.name}</h4>
                          <p className="text-xs opacity-60">
                            {s.category} · {s.durationMinutes} min ·{" "}
                            {(s as any).gender || "All genders"}
                          </p>
                          <p className="text-sm font-bold mt-1">
                            {money(s.price)}
                          </p>
                        </div>
                        {button("Select", () => book([s.id]))}
                      </article>
                    ))}
                </div>
              </>
            )}
            {section === "packages" && (
              <div className="space-y-4">
                {packages.map((p) => (
                  <article key={p.id} className="customer-card">
                    <span className="customer-chip">Curated package</span>
                    <h4 className="font-bold text-xl mt-3">{p.name}</h4>
                    <p className="opacity-60 text-sm my-2">{p.description}</p>
                    <ul className="text-sm space-y-2 my-4">
                      {p.items.map((s) => (
                        <li key={s.id} className="flex gap-2">
                          <Check size={16} />
                          {s.name}
                        </li>
                      ))}
                    </ul>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-bold text-lg">{money(p.price)}</p>
                        <p className="text-xs opacity-60">
                          {p.duration} min · {p.items.length} services
                        </p>
                      </div>
                      {button("Book package", () =>
                        book(p.items.map((s) => s.id)),
                      )}
                    </div>
                  </article>
                ))}
                {!packages.length && <p>No packages available yet.</p>}
              </div>
            )}
          </>
        )}
        {section === "book" && (
          <>
            {heading(
              step === 5 ? "Your appointment is ready" : "Book your next visit",
              profile.businessName,
            )}
            <ol className="customer-steps mb-6" aria-label="Booking progress">
              {[
                "Service",
                "Date & time",
                "Your details",
                "Summary",
                "Payment",
                "Confirmed",
              ].map((label, i) => (
                <li
                  key={label}
                  aria-current={step === i ? "step" : undefined}
                  className={step >= i ? "active" : ""}
                >
                  <span>{step > i ? <Check size={12} /> : i + 1}</span>
                  {label}
                </li>
              ))}
            </ol>
            {holdRemaining > 0 && step >= 2 && step < 5 && (
              <p className="customer-chip mb-4">
                Demo slot hold · {Math.floor(holdRemaining / 60)}:
                {String(holdRemaining % 60).padStart(2, "0")}
              </p>
            )}
            {step === 0 && (
              <div className="space-y-3">
                {services.map((s) => (
                  <label
                    key={s.id}
                    className="customer-card flex gap-3 items-center cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(s.id)}
                      onChange={() =>
                        setSelectedIds((ids) =>
                          ids.includes(s.id)
                            ? ids.filter((id) => id !== s.id)
                            : [...ids, s.id],
                        )
                      }
                    />
                    <div className="flex-1">
                      <strong className="text-sm">{s.name}</strong>
                      <p className="text-xs opacity-60">
                        {s.durationMinutes} min · All genders
                      </p>
                    </div>
                    <strong>{money(s.price)}</strong>
                  </label>
                ))}
                <p className="text-sm font-semibold">
                  {selected.length} selected · {money(subtotal)} · {duration}{" "}
                  min
                </p>
              </div>
            )}
            {step === 1 && (
              <>
                <label className="customer-field">
                  Choose date
                  <input
                    type="date"
                    value={date}
                    min={dateAfter(0)}
                    onChange={(e) => {
                      setDate(e.target.value);
                      setTime("");
                    }}
                  />
                </label>
                <p className="text-sm font-semibold mt-5 mb-3">
                  Available time slots
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {[
                    "09:00",
                    "10:00",
                    "11:00",
                    "12:00",
                    "13:00",
                    "14:00",
                    "15:00",
                    "16:00",
                  ].map((t, i) => (
                    <button
                      type="button"
                      key={t}
                      disabled={i === 0 || i === 4}
                      aria-pressed={time === t}
                      className={`customer-chip py-3 ${time === t ? "selected" : ""}`}
                      onClick={() => setTime(t)}
                    >
                      {t}
                      {(i === 0 || i === 4) && (
                        <span className="block text-[10px]">Unavailable</span>
                      )}
                    </button>
                  ))}
                </div>
                <p className="text-xs opacity-60 mt-3">
                  Sample availability. A 10-minute demo hold starts when you
                  continue.
                </p>
              </>
            )}
            {step === 2 && (
              <div className="grid sm:grid-cols-2 gap-4">
                {field("Name", customer.name, (v) =>
                  setCustomer({ ...customer, name: v }),
                )}
                {field(
                  "Phone",
                  customer.phone,
                  (v) => setCustomer({ ...customer, phone: v }),
                  "tel",
                )}
                {field(
                  "Email",
                  customer.email,
                  (v) => setCustomer({ ...customer, email: v }),
                  "email",
                )}
                <label className="customer-field">
                  Saved address
                  <select
                    value={savedAddress}
                    onChange={(e) => setSavedAddress(e.target.value)}
                  >
                    <option value="">New address / visit salon</option>
                    {addresses.map((a) => (
                      <option key={a.id} value={a.address}>
                        {a.label}: {a.address}
                      </option>
                    ))}
                  </select>
                </label>
                {field("New address (optional)", savedAddress, (v) =>
                  setSavedAddress(v),
                )}
                {field("Booking notes", customer.notes, (v) =>
                  setCustomer({ ...customer, notes: v }),
                )}
              </div>
            )}
            {(step === 3 || step === 4) && (
              <div className="customer-card">
                {summary()}
                <div className="flex gap-2 items-end my-4">
                  {field("Coupon", coupon, setCoupon)}
                  {button(
                    "Apply",
                    () => {
                      if (coupon.trim().toUpperCase() === "PREVIEW10") {
                        setAppliedCoupon(true);
                        setError("");
                      } else {
                        setAppliedCoupon(false);
                        setError("Try PREVIEW10 in this preview.");
                      }
                    },
                    true,
                  )}
                </div>
                <p className="text-xs opacity-60">
                  Sample fee and tax: ₹0. Final live charges depend on the
                  salon’s checkout.
                </p>
                <p className="text-xs opacity-60 mt-2">
                  Cancellation and refund eligibility are shown in appointment
                  details.
                </p>
                {step === 4 && (
                  <div className="customer-promo mt-4">
                    <Check size={22} />
                    <div>
                      <p className="font-bold">25% advance payment</p>
                      <p className="text-sm">
                        {money(advance)} now · {money(total - advance)} at salon
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
            {step === 5 && (
              <div className="customer-card text-center">
                <span className="customer-success mx-auto">
                  <Check size={30} />
                </span>
                <h4 className="text-xl font-bold mt-4">
                  Sample booking confirmed
                </h4>
                <p className="opacity-60 text-sm mt-2">
                  {bookings[0]?.id} · {date} at {time}
                </p>
                <p className="font-semibold mt-3">
                  {money(advance)} sample advance · {money(total - advance)}{" "}
                  remaining
                </p>
                <p className="text-xs opacity-60 my-3">
                  No payment was collected.
                </p>
                <div className="flex gap-2 justify-center flex-wrap">
                  {button(
                    "View appointment",
                    () => {
                      setDetail(bookings[0]?.id);
                      setSection("bookings");
                    },
                    true,
                  )}
                  {button("Salon location", () => go("salon"), true)}
                  {button("Book another visit", () =>
                    book(services[0] ? [services[0].id] : []),
                  )}
                </div>
              </div>
            )}
            {step < 5 && (
              <div className="flex justify-between gap-3 mt-6">
                {button(
                  <>
                    <ChevronLeft size={16} />
                    Back
                  </>,
                  () => (step ? setStep(step - 1) : go("services")),
                  true,
                )}
                {button(
                  step === 4
                    ? `Simulate payment ${money(advance)}`
                    : "Continue",
                  () => {
                    setError("");
                    if (step === 0 && !selected.length) {
                      setError("Choose at least one service.");
                      return;
                    }
                    if (step === 1 && (!date || !time)) {
                      setError("Choose a date and an available time.");
                      return;
                    }
                    if (step === 1) setHoldRemaining(600);
                    if (
                      step === 2 &&
                      (!customer.name.trim() ||
                        !/^\+?[\d\s-]{10,16}$/.test(customer.phone) ||
                        (customer.email &&
                          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)))
                    ) {
                      setError("Enter your name, a valid phone and email.");
                      return;
                    }
                    if (step === 4) {
                      if (!holdRemaining) {
                        setStep(1);
                        setTime("");
                        setError(
                          "The demo hold expired. Choose your time again.",
                        );
                        return;
                      }
                      const id = `DEMO-${bookings.length + 1}`;
                      setBookings((b) => [
                        {
                          id,
                          serviceIds: selectedIds,
                          date,
                          time,
                          status: "Upcoming",
                          total,
                          paid: advance,
                        },
                        ...b,
                      ]);
                      addNotification(
                        "Appointment confirmed",
                        `${date} at ${time} · ${profile.businessName}`,
                      );
                      setAppointmentTab("Upcoming");
                    }
                    setStep(step + 1);
                  },
                )}
              </div>
            )}
          </>
        )}
        {section === "bookings" && (
          <>
            {heading(
              selectedBooking ? "Appointment details" : "My appointments",
              "Your visits, payments and reviews in one place.",
            )}
            {selectedBooking ? (
              <>
                <button
                  type="button"
                  className="customer-button-secondary mb-4"
                  onClick={() => {
                    setDetail(null);
                    setAction(null);
                  }}
                >
                  Back to appointments
                </button>
                <div className="customer-card">
                  <div className="flex justify-between gap-3 mb-4">
                    <div>
                      <h4 className="font-bold">{profile.businessName}</h4>
                      <p className="text-xs opacity-60">{selectedBooking.id}</p>
                    </div>
                    <span className="customer-chip">
                      {selectedBooking.status}
                    </span>
                  </div>
                  {summary(selectedBooking)}
                  <p className="text-sm mt-4">
                    Payment:{" "}
                    {selectedBooking.paid >= selectedBooking.total
                      ? "Paid in full"
                      : selectedBooking.paid
                        ? "Advance paid"
                        : "Not paid"}
                  </p>
                  <p className="text-xs opacity-60 mt-2">
                    {profile.address} · {profile.city}
                  </p>
                  <p className="text-xs opacity-60 mt-2">
                    Refund: sample eligibility only. Contact the salon for its
                    cancellation policy.
                  </p>
                  {selectedBooking.reason && (
                    <p className="text-sm mt-3">
                      Cancellation reason: {selectedBooking.reason}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2 mt-5">
                    {selectedBooking.status === "Upcoming" && (
                      <>
                        {button(
                          "Reschedule",
                          () => {
                            setDate(selectedBooking.date);
                            setTime("");
                            setAction("reschedule");
                          },
                          true,
                        )}
                        {button(
                          "Cancel appointment",
                          () => setAction("cancel"),
                          true,
                        )}
                      </>
                    )}
                    {selectedBooking.status === "Completed" &&
                      button(
                        selectedBooking.review
                          ? "View review"
                          : "Write a review",
                        () => setAction("review"),
                        true,
                      )}
                    {button("Rebook", () => book(selectedBooking.serviceIds))}
                  </div>
                </div>
                {action === "cancel" && (
                  <div className="customer-card mt-4">
                    {field("Cancellation reason", reason, setReason)}
                    <p className="text-xs opacity-60 my-3">
                      A refund decision is made according to the salon’s policy.
                      This preview does not issue a refund.
                    </p>
                    {button("Confirm cancellation", () => {
                      if (!reason.trim()) {
                        setError("Enter a cancellation reason.");
                        return;
                      }
                      setBookings((bs) =>
                        bs.map((b) =>
                          b.id === detail
                            ? { ...b, status: "Cancelled", reason }
                            : b,
                        ),
                      );
                      addNotification(
                        "Appointment cancelled",
                        `${selectedBooking.id} · ${reason}`,
                      );
                      setAction(null);
                      setError("");
                    })}
                  </div>
                )}
                {action === "reschedule" && (
                  <div className="customer-card mt-4">
                    {field("New date", date, setDate, "date")}
                    <label className="customer-field mt-3">
                      Available time
                      <select
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                      >
                        <option value="">Select available time</option>
                        {["10:00", "11:00", "14:00", "16:00"].map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                    </label>
                    {button("Confirm reschedule", () => {
                      if (!time || date < dateAfter(0)) {
                        setError("Choose a future date and available time.");
                        return;
                      }
                      setBookings((bs) =>
                        bs.map((b) =>
                          b.id === detail ? { ...b, date, time } : b,
                        ),
                      );
                      addNotification(
                        "Appointment rescheduled",
                        `${date} at ${time}`,
                      );
                      setAction(null);
                      setError("");
                    })}
                  </div>
                )}
                {action === "review" && (
                  <div className="customer-card mt-4">
                    {selectedBooking.review ? (
                      <>
                        <p className="font-bold">
                          {"★".repeat(selectedBooking.review.stars)} · Verified
                          sample visit
                        </p>
                        <p className="text-sm mt-2">
                          {selectedBooking.review.text}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-bold mb-2">
                          Rate your visit
                        </p>
                        <div className="flex gap-2 mb-3">
                          {[1, 2, 3, 4, 5].map((n) => (
                            <button
                              type="button"
                              key={n}
                              aria-label={`${n} star rating`}
                              onClick={() => setReview({ ...review, stars: n })}
                            >
                              <Star
                                fill={
                                  review.stars >= n ? "currentColor" : "none"
                                }
                              />
                            </button>
                          ))}
                        </div>
                        {field("Written review", review.text, (v) =>
                          setReview({ ...review, text: v }),
                        )}
                        <div className="flex gap-2 flex-wrap my-3">
                          {[
                            "Friendly team",
                            "Great result",
                            "On time",
                            "Clean space",
                          ].map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              className={`customer-chip ${review.tags.includes(tag) ? "selected" : ""}`}
                              onClick={() =>
                                setReview({
                                  ...review,
                                  tags: review.tags.includes(tag)
                                    ? review.tags.filter((t) => t !== tag)
                                    : [...review.tags, tag],
                                })
                              }
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                        {button("Submit review", () => {
                          if (!review.text.trim()) {
                            setError("Write a short review before submitting.");
                            return;
                          }
                          setBookings((bs) =>
                            bs.map((b) =>
                              b.id === detail ? { ...b, review } : b,
                            ),
                          );
                          setError("");
                        })}
                      </>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="flex gap-2 mb-5">
                  {["Upcoming", "Completed", "Cancelled"].map((t) => (
                    <button
                      type="button"
                      className={`customer-chip ${appointmentTab === t ? "selected" : ""}`}
                      key={t}
                      onClick={() => setAppointmentTab(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <div className="space-y-3">
                  {bookings
                    .filter((b) => b.status === appointmentTab)
                    .map((b) => (
                      <button
                        type="button"
                        key={b.id}
                        onClick={() => setDetail(b.id)}
                        className="customer-card w-full text-left"
                      >
                        <span className="customer-chip">{b.status}</span>
                        <h4 className="font-bold mt-3">
                          {services
                            .filter((s) => b.serviceIds.includes(s.id))
                            .map((s) => s.name)
                            .join(" + ")}
                        </h4>
                        <p className="text-sm opacity-60 mt-1">
                          {b.date} · {b.time} · {profile.businessName}
                        </p>
                        <p className="text-sm mt-2">
                          {money(b.paid)} paid ·{" "}
                          {money(Math.max(0, b.total - b.paid))} remaining
                        </p>
                        <p className="text-xs font-bold mt-3">View details →</p>
                      </button>
                    ))}
                </div>
                {!bookings.some((b) => b.status === appointmentTab) && (
                  <p className="text-sm opacity-60">
                    No {appointmentTab.toLowerCase()} appointments yet.
                  </p>
                )}
              </>
            )}
          </>
        )}
        {section === "wallet" && (
          <>
            {heading(
              "Your rewards",
              "A little thank-you for making time for yourself.",
            )}
            <div className="customer-reward-card">
              <Gift size={32} />
              <p className="text-sm opacity-75 mt-4">Current points</p>
              <p className="text-5xl font-bold mt-1">250</p>
              <p className="text-sm mt-4">
                Earn points on eligible completed appointments.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 my-4">
              <div className="customer-card">
                <strong>350</strong>
                <p className="text-xs opacity-60">Earned points</p>
              </div>
              <div className="customer-card">
                <strong>100</strong>
                <p className="text-xs opacity-60">Redeemed points</p>
              </div>
            </div>
            <h4 className="font-bold mb-3">Points history</h4>
            {[
              ["Completed visit", "+50"],
              ["Welcome reward", "+300"],
              ["Reward redeemed", "−100"],
            ].map(([text, points]) => (
              <div
                key={text}
                className="customer-card flex justify-between mb-2 text-sm"
              >
                <span>
                  {text}
                  <span className="block opacity-50 text-xs">
                    Sample reward activity
                  </span>
                </span>
                <strong>{points}</strong>
              </div>
            ))}
            {button(
              "Explore reward benefits",
              () =>
                setNotice(
                  "Sample benefit: redeem eligible points for salon offers. Live benefits appear in your rewards account.",
                ),
              true,
            )}
          </>
        )}
        {section === "notifications" && (
          <>
            {heading(
              "Notification center",
              "Booking updates, reminders and reward activity.",
            )}
            <div className="flex justify-between gap-2 mb-4">
              <div className="flex gap-2">
                {["All", "Unread"].map((t) => (
                  <button
                    type="button"
                    key={t}
                    className={`customer-chip ${notificationTab === t ? "selected" : ""}`}
                    onClick={() => setNotificationTab(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
              {button(
                "Mark all as read",
                () =>
                  setNotifications((ns) =>
                    ns.map((n) => ({ ...n, unread: false })),
                  ),
                true,
              )}
            </div>
            {notifications
              .filter((n) => notificationTab !== "Unread" || n.unread)
              .map((n) => (
                <button
                  type="button"
                  key={n.id}
                  onClick={() =>
                    setNotifications((ns) =>
                      ns.map((v) =>
                        v.id === n.id ? { ...v, unread: false } : v,
                      ),
                    )
                  }
                  className="customer-card w-full text-left flex gap-3 mb-3"
                >
                  <Bell size={19} />
                  <div>
                    <h4 className="text-sm font-bold">
                      {n.title}
                      {n.unread && (
                        <span className="inline-block w-2 h-2 rounded-full bg-current ml-2" />
                      )}
                    </h4>
                    <p className="text-sm opacity-60 mt-1">{n.text}</p>
                    <p className="text-xs opacity-50 mt-2">
                      {n.unread ? "Tap to mark as read" : "Read"}
                    </p>
                  </div>
                </button>
              ))}
          </>
        )}
        {section === "favourites" && (
          <>
            {heading(
              "Your favorites",
              "The places you’ll want to come back to.",
            )}
            <div className="grid sm:grid-cols-2 gap-4">
              {directory.filter((s) => favorites.includes(s.id)).map(salonCard)}
            </div>
            {!favorites.length && (
              <div className="customer-card text-center py-10">
                <Heart className="mx-auto mb-3" />
                <p>No favorites yet. Tap a heart on any salon.</p>
                <div className="mt-4">
                  {button("Explore salons", () => go("home"))}
                </div>
              </div>
            )}
          </>
        )}
        {section === "profile" && (
          <>
            {heading(
              "Your profile",
              signedIn
                ? `Welcome back, ${customer.name}`
                : "Make every visit yours.",
            )}
            <div className="customer-card mb-4 flex gap-4 items-center">
              <span className="customer-avatar">
                {customer.photo ? (
                  <img
                    onError={imageFallback}
                    src={customer.photo}
                    alt="Your profile"
                  />
                ) : (
                  <UserRound size={32} />
                )}
              </span>
              <div>
                <p className="font-bold">{customer.name}</p>
                <p className="text-sm opacity-60">
                  {customer.email || "Add your email"}
                </p>
                <label className="text-xs font-semibold cursor-pointer">
                  Change photo
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = () =>
                          setCustomer((c) => ({
                            ...c,
                            photo: String(reader.result),
                          }));
                        reader.readAsDataURL(file);
                      }
                    }}
                  />
                </label>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              {field("Name", customer.name, (v) =>
                setCustomer({ ...customer, name: v }),
              )}
              {field(
                "Email",
                customer.email,
                (v) => setCustomer({ ...customer, email: v }),
                "email",
              )}
              {field(
                "Phone",
                customer.phone,
                (v) => setCustomer({ ...customer, phone: v }),
                "tel",
              )}
              <label className="customer-field">
                Gender
                <select
                  value={customer.gender}
                  onChange={(e) =>
                    setCustomer({ ...customer, gender: e.target.value })
                  }
                >
                  {["Prefer not to say", "Woman", "Man", "Non-binary"].map(
                    (g) => (
                      <option key={g}>{g}</option>
                    ),
                  )}
                </select>
              </label>
              {field(
                "Date of birth",
                customer.dob,
                (v) => setCustomer({ ...customer, dob: v }),
                "date",
              )}
              <label className="customer-field">
                Language
                <select
                  value={customer.language}
                  onChange={(e) =>
                    setCustomer({ ...customer, language: e.target.value })
                  }
                >
                  {["English", "हिन्दी", "தமிழ்", "मराठी"].map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-4">
              {button("Save sample profile", () =>
                setNotice("Your preview profile is updated for this session."),
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 mt-5">
              {[
                ["bookings", "My appointments"],
                ["favourites", "Favorites"],
                ["wallet", "Rewards"],
                ["notifications", "Notifications"],
                ["location", "Saved addresses"],
                ["settings", "Settings"],
                ["auth", signedIn ? "Logout" : "Login / Sign up"],
              ].map(([to, label]) =>
                button(
                  label,
                  () => {
                    if (label === "Logout") setSignedIn(false);
                    go(to as TemplateCustomerSection);
                  },
                  true,
                ),
              )}
            </div>
          </>
        )}
        {section === "location" && (
          <>
            {heading(
              "Your location & addresses",
              "Find nearby salons and keep your visit details handy.",
            )}
            {field("City", city, setCity)}
            <div className="customer-card mt-5">
              <h4 className="font-bold mb-3">
                {editingAddress ? "Edit address" : "Add address"}
              </h4>
              {field("Address / area / PIN", addressDraft, setAddressDraft)}
              <div className="mt-3">
                {button(editingAddress ? "Save address" : "Add address", () => {
                  if (!addressDraft.trim()) {
                    setError("Enter an address.");
                    return;
                  }
                  setAddresses((list) =>
                    editingAddress
                      ? list.map((a) =>
                          a.id === editingAddress
                            ? { ...a, address: addressDraft }
                            : a,
                        )
                      : [
                          ...list,
                          {
                            id: `address-${Date.now()}`,
                            label: `Address ${list.length + 1}`,
                            address: addressDraft,
                            isDefault: !list.length,
                          },
                        ],
                  );
                  setAddressDraft("");
                  setEditingAddress(null);
                  setError("");
                })}
              </div>
            </div>
            {addresses.map((a) => (
              <div key={a.id} className="customer-card mt-3">
                <p className="text-sm font-bold">
                  {a.label}{" "}
                  {a.isDefault && (
                    <span className="customer-chip">Default</span>
                  )}
                </p>
                <p className="text-sm opacity-60 mt-1">{a.address}</p>
                <div className="flex flex-wrap gap-2 mt-3">
                  {button(
                    "Edit",
                    () => {
                      setEditingAddress(a.id);
                      setAddressDraft(a.address);
                    },
                    true,
                  )}
                  {button(
                    "Delete",
                    () => {
                      setAddresses((list) => {
                        const next = list.filter((v) => v.id !== a.id);
                        return next.some((v) => v.isDefault)
                          ? next
                          : next.map((v, i) => ({ ...v, isDefault: i === 0 }));
                      });
                    },
                    true,
                  )}
                  {!a.isDefault &&
                    button(
                      "Set default",
                      () =>
                        setAddresses((list) =>
                          list.map((v) => ({ ...v, isDefault: v.id === a.id })),
                        ),
                      true,
                    )}
                </div>
              </div>
            ))}
            <div className="mt-4">
              {button("Explore nearby salons", () => {
                setSort("Nearby");
                go("home");
              })}
            </div>
          </>
        )}
        {section === "settings" && (
          <>
            {heading("Settings", "Your account, your preferences.")}
            <div className="customer-card space-y-4">
              <label className="customer-field">
                Language
                <select
                  value={customer.language}
                  onChange={(e) =>
                    setCustomer({ ...customer, language: e.target.value })
                  }
                >
                  {["English", "हिन्दी", "தமிழ்", "मराठी"].map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </label>
              {Object.entries(preferences).map(([key, value]) => (
                <label
                  key={key}
                  className="flex justify-between text-sm capitalize"
                >
                  <span>{key} notifications</span>
                  <input
                    type="checkbox"
                    checked={value}
                    onChange={(e) =>
                      setPreferences({
                        ...preferences,
                        [key]: e.target.checked,
                      })
                    }
                  />
                </label>
              ))}
              {button("Profile settings", () => go("profile"), true)}
              {button(
                "Account / password settings",
                () => {
                  setAuthMode("Reset password");
                  go("auth");
                },
                true,
              )}
              {button(
                "Logout",
                () => {
                  setSignedIn(false);
                  go("auth");
                },
                true,
              )}
            </div>
          </>
        )}
        {section === "auth" && (
          <>
            {heading(
              authMode,
              "Try the account screens without creating an account.",
            )}
            <div className="customer-card space-y-4">
              <div className="flex gap-2">
                {["Login", "Sign up"].map((mode) =>
                  button(mode, () => setAuthMode(mode), authMode !== mode),
                )}
              </div>
              {authMode === "Sign up" &&
                field("Name", customer.name, (v) =>
                  setCustomer({ ...customer, name: v }),
                )}
              {field(
                "Email",
                customer.email,
                (v) => setCustomer({ ...customer, email: v }),
                "email",
              )}
              {authMode !== "Forgot password" &&
                field("Password", password, setPassword, "password")}
              {button(authMode, () => {
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) {
                  setError("Enter a valid email.");
                  return;
                }
                if (authMode === "Forgot password") {
                  setNotice(
                    "Sample reset requested. Try the reset password screen next.",
                  );
                  setAuthMode("Reset password");
                  return;
                }
                if (password.length < 6) {
                  setError("Use a password with at least 6 characters.");
                  return;
                }
                setSignedIn(true);
                go("profile");
                setNotice(
                  "Sample account screen opened. No account was created.",
                );
              })}
              {button(
                "Forgot password",
                () => setAuthMode("Forgot password"),
                true,
              )}
            </div>
          </>
        )}
      </div>
      <nav className={`customer-demo-nav ${desktop ? "customer-desktop-hidden" : ""}`} aria-label="Customer preview sections">
        {TABS.map(({ section: to, label, Icon }) => (
          <button
            key={to}
            type="button"
            aria-current={section === to ? "page" : undefined}
            onClick={() => go(to)}
          >
            <Icon size={19} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
