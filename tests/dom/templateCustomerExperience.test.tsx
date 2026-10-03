import "./jsdomSetup";
import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { TemplateCustomerHome } from "../../src/components/TemplateCustomerHome";
import { TemplateCustomerDemo } from "../../src/components/TemplateCustomerDemo";
import { TemplateCustomerToolbar } from "../../src/components/TemplateCustomerHub";
import { resolveWebsitePackages } from "../../src/components/TemplatePackages";
import { TEMPLATE_REGISTRY } from "../../src/data/templates";
import type { SalonProfile } from "../../src/types";

const template = TEMPLATE_REGISTRY[0];
const services = template.config.services;
const profile = {
  ...template.config,
  businessName: "My Salon",
  businessType: template.id,
  city: "Bengaluru",
  subdomain: "my-salon",
  gallery: [],
} as unknown as SalonProfile;
async function setup(section: any = "home") {
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  await act(async () =>
    root.render(
      <TemplateCustomerDemo
        request={{ section }}
        profile={profile}
        services={services}
      />,
    ),
  );
  const click = async (text: string) => {
    const element = Array.from(node.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === text,
    );
    assert.ok(element, `button ${text} exists`);
    await act(async () => element.click());
  };
  const fill = async (label: string, value: string) => {
    const element = Array.from(node.querySelectorAll("label"))
      .find((l) => l.textContent?.trim().startsWith(label))
      ?.querySelector("input");
    assert.ok(element, `input ${label} exists`);
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const dispose = async () => {
    await act(async () => root.unmount());
    node.remove();
  };
  return { node, root, click, fill, dispose };
}

for (const t of TEMPLATE_REGISTRY) {
  test(`${t.id}: customer toolbar and package/rewards screens render with its own services`, () => {
    const p = { ...profile, businessType: t.id, businessName: t.name };
    const homepage = renderToStaticMarkup(<TemplateCustomerHome profile={p} services={t.config.services} dark={false} onOpen={() => {}} onBook={() => {}} />);
    for (const label of ["Quick booking", "Featured studio", "Your rewards", "Customer account shortcuts", "Search this salon", "All categories"])
      assert.ok(homepage.includes(label), `${t.id}: ${label} is visible on the page`);
    assert.ok(!homepage.includes("<dialog"));
    const toolbar = renderToStaticMarkup(
      <TemplateCustomerToolbar profile={p} onOpen={() => {}} />,
    );
    for (const label of [
      "Search salons",
      "Favorites",
      "Notifications",
      "My appointments",
      "Rewards",
      "Packages",
    ])
      assert.ok(toolbar.includes(label));
    const packages = renderToStaticMarkup(
      <TemplateCustomerDemo
        request={{ section: "packages" }}
        profile={p}
        services={t.config.services}
      />,
    );
    assert.match(packages, /sample data/);
    assert.match(packages, /Rewards/);
    assert.match(packages, /Book package/);
  });
}

test("package booking preview includes all services, coupon, 25% advance and confirmation without APIs", async () => {
  const app = await setup("packages");
  let calls = 0;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("Preview must never fetch");
  };
  try {
    assert.match(app.node.textContent || "", /Signature Duo/);
    const firstBook = Array.from(app.node.querySelectorAll("button")).find(
      (b) => b.textContent === "Book package",
    )!;
    await act(async () => firstBook.click());
    assert.equal(app.node.querySelectorAll("input:checked").length, 2);
    await app.click("Continue");
    assert.ok(
      app.node.querySelectorAll("button:disabled").length >= 2,
      "unavailable slots disabled",
    );
    await app.click("10:00");
    await app.click("Continue");
    await app.fill("Phone", "9876543210");
    await app.click("Continue");
    assert.match(app.node.textContent || "", /Platform fee/);
    assert.match(app.node.textContent || "", /Remaining amount/);
    await app.fill("Coupon", "PREVIEW10");
    await app.click("Apply");
    assert.equal(app.node.querySelector("[role=alert]"), null);
    await app.click("Continue");
    const paymentButton = Array.from(app.node.querySelectorAll("button")).find(
      (b) => b.textContent?.startsWith("Simulate payment"),
    )!;
    await act(async () => paymentButton.click());
    assert.match(app.node.textContent || "", /Sample booking confirmed/);
    assert.match(app.node.textContent || "", /No payment was collected/);
    await app.click("View appointment");
    assert.match(app.node.textContent || "", /Advance paid/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = oldFetch;
    await app.dispose();
  }
});

test("favorites can be added and removed, notification read actions update the UI", async () => {
  const app = await setup();
  try {
    const heart = app.node.querySelector<HTMLButtonElement>(
      '[aria-label="Add My Salon favorite"]',
    )!;
    await act(async () => heart.click());
    await app.click("Favorites");
    assert.match(app.node.textContent || "", /My Salon/);
    const remove = app.node.querySelector<HTMLButtonElement>(
      '[aria-label="Remove My Salon favorite"]',
    )!;
    await act(async () => remove.click());
    assert.match(app.node.textContent || "", /No favorites yet/);
    await act(async () =>
      app.root.render(
        <TemplateCustomerDemo
          request={{ section: "notifications" }}
          profile={profile}
          services={services}
        />,
      ),
    );
    await app.click("Mark all as read");
    await app.click("Unread");
    assert.doesNotMatch(
      app.node.textContent || "",
      /Welcome to your salon experience/,
    );
  } finally {
    await app.dispose();
  }
});

test("appointment cancellation requires a reason and updates its status", async () => {
  const app = await setup("bookings");
  try {
    const appointment = Array.from(app.node.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("View details"),
    )!;
    await act(async () => appointment.click());
    await app.click("Cancel appointment");
    await app.click("Confirm cancellation");
    assert.match(
      app.node.querySelector("[role=alert]")?.textContent || "",
      /reason/,
    );
    await app.fill("Cancellation reason", "Plans changed");
    await app.click("Confirm cancellation");
    assert.match(app.node.textContent || "", /Cancelled/);
    assert.match(app.node.textContent || "", /Plans changed/);
  } finally {
    await app.dispose();
  }
});

test("published package totals use existing services and omit retired/inactive packages", () => {
  const packages = [
    {
      id: "pair",
      name: "Pair",
      description: "",
      serviceIds: [services[0].id, services[1].id],
      isActive: true,
    },
    {
      id: "old",
      name: "Old",
      description: "",
      serviceIds: ["missing"],
      isActive: true,
    },
    {
      id: "off",
      name: "Off",
      description: "",
      serviceIds: [services[0].id],
      isActive: false,
    },
  ];
  const resolved = resolveWebsitePackages(packages, services);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].price, services[0].price + services[1].price);
  assert.equal(
    resolved[0].duration,
    services[0].durationMinutes + services[1].durationMinutes,
  );
});

test('reschedule updates the appointment and completed visits accept a rated review', async () => {
  const app = await setup('bookings');
  try {
    const appointment = Array.from(app.node.querySelectorAll('button')).find(b=>b.textContent?.includes('View details'))!;
    await act(async () => appointment.click());
    await app.click('Reschedule');
    const select = app.node.querySelector('select')!;
    await act(async () => { select.value = '14:00'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await app.click('Confirm reschedule');
    assert.match(app.node.textContent || '', /14:00/);
    await app.click('Back to appointments'); await app.click('Completed');
    const completed = Array.from(app.node.querySelectorAll('button')).find(b=>b.textContent?.includes('View details'))!;
    await act(async () => completed.click()); await app.click('Write a review');
    await app.fill('Written review', 'Thoughtful care and a great result');
    await app.click('Great result'); await app.click('Submit review');
    assert.match(app.node.textContent || '', /Verified sample visit/);
    assert.match(app.node.textContent || '', /Thoughtful care/);
  } finally { await app.dispose(); }
});


test("inline homepage filters services and books the selected catalogue item", async () => {
  const node = document.createElement("div"); document.body.append(node);
  const root = createRoot(node);
  const catalogue = [
    { id: "hair", name: "Haircut", category: "Hair", gender: "Men" as const, price: 400, durationMinutes: 30, description: "", icon: "" },
    { id: "spa", name: "Facial", category: "Skin", gender: "Women" as const, price: 1500, durationMinutes: 60, description: "", icon: "" },
  ];
  let booked: string | undefined;
  let opened: string | undefined;
  await act(async () => root.render(<TemplateCustomerHome profile={profile} services={catalogue} dark={false} onBook={service => { booked = service?.id; }} onOpen={section => { opened = section; }} />));
  const select = node.querySelector<HTMLSelectElement>('[aria-label="Service type"]')!;
  await act(async () => { select.value = "Women"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  assert.ok(node.querySelector('[aria-label="Book Facial"]'));
  assert.equal(node.querySelector('[aria-label="Book Haircut"]'), null);
  await act(async () => (node.querySelector('[aria-label="Book Facial"]') as HTMLButtonElement).click());
  assert.equal(booked, "spa");
  const price = node.querySelector<HTMLSelectElement>('[aria-label="Price range"]')!;
  await act(async () => { price.value = "500"; price.dispatchEvent(new Event("change", { bubbles: true })); });
  assert.match(node.textContent || "", /No matching services/);
  await act(async () => Array.from(node.querySelectorAll("button")).find(button => button.textContent === "Clear filters")!.click());
  assert.ok(node.querySelector('[aria-label="Book Haircut"]'));
  await act(async () => Array.from(node.querySelectorAll("button")).find(button => button.textContent?.includes("Your rewards"))!.click());
  assert.equal(opened, "wallet");
  await act(async () => root.unmount()); node.remove();
});

test("inline homepage empty catalogue has no invented rating or Infinity price", () => {
  const html = renderToStaticMarkup(<TemplateCustomerHome profile={profile} services={[]} dark={true} onOpen={() => {}} onBook={() => {}} />);
  assert.ok(!html.includes("Infinity"));
  assert.ok(!html.includes("4.9 ·"));
  assert.match(html, /No matching services/);
  assert.match(html, /Reviews coming soon/);
});
