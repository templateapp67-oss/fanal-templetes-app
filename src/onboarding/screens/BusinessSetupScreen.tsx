import React, { useMemo, useRef, useState } from 'react';
import { Field, FormAlert, GatewayShell, SubmitButton } from './Shell';
import { createSingleFlight, toSafeReferralError } from '../lib/flow';
import type { OnboardingSupabaseClient } from '../lib/auth';

export function websiteSlug(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

export const BusinessSetupScreen: React.FC<{
  client: OnboardingSupabaseClient;
  email: string;
  onProvisioned: (site: { salonId: string; slug: string }) => void;
  onLogout: () => void;
}> = ({ client, email, onProvisioned, onLogout }) => {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const flight = useRef(createSingleFlight());
  const preview = useMemo(() => websiteSlug(slug), [slug]);

  const submit = () => {
    const cleanName = name.trim();
    const cleanSlug = websiteSlug(slug);
    if (cleanName.length < 2) {
      setError('Enter your salon or business name.');
      return;
    }
    if (cleanSlug.length < 2) {
      setError('Choose a website address with at least 2 characters.');
      return;
    }
    setBusy(true);
    setError('');
    void flight.current.run(async () => {
      const { data, error: rpcError } = await client.rpc('provision_my_website', {
        p_salon_name: cleanName,
        p_slug: cleanSlug,
      });
      if (rpcError) throw rpcError;
      const salonId = typeof data?.salon_id === 'string' ? data.salon_id : '';
      const returnedSlug = typeof data?.slug === 'string' ? data.slug : '';
      if (!salonId || !returnedSlug) throw new Error('Website setup could not be completed.');
      return { salonId, slug: returnedSlug };
    }).then((site) => {
      if (site) onProvisioned(site);
    }).catch((cause: unknown) => {
      setError(toSafeReferralError(cause).message === 'Something went wrong. Please try again.'
        ? 'We could not create your website. Please check the name and address, then try again.'
        : toSafeReferralError(cause).message);
    }).finally(() => setBusy(false));
  };

  return (
    <GatewayShell
      title="Set up your website"
      subtitle="Choose your salon name and website address. You can change branding and services in the editor."
      footer={
        <>
          Signed in as <span className="font-bold text-slate-900">{email}</span>.{' '}
          <button type="button" onClick={onLogout} className="font-bold text-slate-900 underline underline-offset-2 cursor-pointer hover:opacity-80">Sign out</button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <Field
          id="business-name"
          label="Salon / Business Name"
          value={name}
          autoComplete="organization"
          placeholder="e.g. My Salon"
          disabled={busy}
          onChange={(value) => {
            setName(value);
            if (!slugEdited) setSlug(websiteSlug(value));
          }}
        />
        <Field
          id="website-slug"
          label="Website Address"
          value={slug}
          autoComplete="off"
          placeholder="e.g. my-salon"
          disabled={busy}
          onChange={(value) => { setSlug(websiteSlug(value)); setSlugEdited(true); }}
        />
        <p className="text-xs text-slate-500">Your preview address: <span className="font-bold text-slate-700">{preview || 'your-salon'}.nexora.in</span></p>
        {error && <FormAlert tone="error">{error}</FormAlert>}
        <SubmitButton busy={busy} busyLabel="Creating your website…">Create Website & Open Editor</SubmitButton>
      </form>
    </GatewayShell>
  );
};
