import React, { useState } from 'react';
import { Check, Copy, Download, FileText, Images, Megaphone, RefreshCw } from 'lucide-react';
import {
} from '../../lib/partnerPortalOperations';
import { growthPartnerService } from '../../services/growthPartner';
import { usePartnerServiceQuery } from '../../lib/partnerServiceQueries';
import { formatPartnerDate, formatPartnerFileSize } from '../../lib/partnerPresentation';
import { partnerReferralShareLink } from '../../lib/partnerReferralLink';
import { usePartnerClipboard } from '../../lib/usePartnerClipboard';
import {
  PartnerInlineNotice,
  PartnerModuleButton,
  PartnerModuleCard,
  PartnerModuleHeader,
  PartnerFilterChip,
  PartnerSectionEmpty,
  PartnerSectionError,
  PartnerSectionLoading,
  PartnerStatGrid,
} from './PartnerModuleKit';

// ============================================================================
// MARKETING MATERIALS — /partner/marketing
//
// The partner's asset library plus the one link they actually send out. Assets
// are published centrally (`partner_marketing_assets`), the library is read
// through `get_partner_marketing_assets` (published rows only — an unpublished
// draft cannot be fetched even by id), and downloads go through
// `/api/partner/marketing-assets/:id/download`, which verifies the asset is in
// the CALLER's published list before signing the private-bucket URL. The page
// therefore never handles a long-lived storage token.
// ============================================================================

const CATEGORY_LABELS: Record<string, string> = {
  banner: 'Banners & posters',
  email_template: 'Email templates',
  social_graphic: 'Social graphics',
  video_demo: 'Video demos',
};

const categoryLabel = (category: string) =>
  CATEGORY_LABELS[category] || category.replaceAll('_', ' ');

/** The three formats a partner asks for most — guidance, not a fake download. */
const PLAYBOOK = [
  {
    title: 'Share the link once, follow up twice',
    body: 'Send your referral link, then check in the day the shop starts its website and again when it is ready to publish. Referral Status on this portal shows which of the two happened.',
  },
  {
    title: 'Put the code where customers already look',
    body: 'A standee at billing and a line in your WhatsApp status outperform a single post. Your code is short and case-insensitive on purpose.',
  },
  {
    title: 'Never promise a discount you cannot verify',
    body: 'Offer terms belong to the shop, not to the referral. Keep your message about onboarding and support, and let Nexora pricing stand on its own.',
  },
];

export const PartnerMarketingMaterialsPage: React.FC<{
  accentHex?: string;
  referralCode?: string | null;
}> = ({ accentHex, referralCode = null }) => {
  const [category, setCategory] = useState<string>('all');
  const [downloadError, setDownloadError] = useState<{ id: string; message: string } | null>(null);
  const [downloadingId, setDownloadingId] = useState('');

  const categories = usePartnerServiceQuery(() => growthPartnerService.getMarketingCategories(), []);
  const assets = usePartnerServiceQuery(() => growthPartnerService.getMarketingAssets(category), [category]);
  const clipboard = usePartnerClipboard();

  const code = String(referralCode || '').trim();
  const shareLink = code ? partnerReferralShareLink(code) : '';

  const download = async (assetId: string) => {
    setDownloadError(null);
    setDownloadingId(assetId);
    const result = await growthPartnerService.getAssetDownloadUrl(assetId);
    if (result.ok === false) {
      setDownloadError({ id: assetId, message: result.error.message });
    } else {
      window.open(result.data, '_blank', 'noopener,noreferrer');
    }
    {
      setDownloadingId('');
    }
  };

  const rows = assets.data ?? [];
  const chips = [
    { value: 'all', label: `All (${categories.data?.reduce((sum, item) => sum + item.asset_count, 0) ?? 0})` },
    ...(categories.data ?? []).map((entry) => ({
      value: entry.category,
      label: `${categoryLabel(entry.category)} (${entry.asset_count})`,
    })),
  ];

  return (
    <div data-partner-module="marketing-materials" className="space-y-5">
      <PartnerModuleHeader
        tone="gradient"
        eyebrow="Grow your referrals"
        title="Marketing materials"
        description="Ready-to-post creatives for your salon network, plus the referral link every asset should point at."
        icon={Megaphone}
        actions={
          <PartnerModuleButton variant="secondary" onClick={() => { assets.reload(); categories.reload(); }} disabled={assets.refreshing}>
            <RefreshCw className={`h-4 w-4 ${assets.refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </PartnerModuleButton>
        }
      />

      <PartnerModuleCard id="referral-link" title="Your referral link" description="Every download below is built to carry this link.">
        {code ? (
          <div className="flex flex-wrap items-center gap-3">
            <output className="min-w-0 flex-1 truncate rounded-xl bg-slate-50 px-4 py-3 text-sm font-bold text-slate-800">
              {shareLink || `/signup?ref=${encodeURIComponent(code)}`}
            </output>
            <PartnerModuleButton
              variant="accent"
              accentHex={accentHex}
              onClick={() => void clipboard.copy(shareLink || `/signup?ref=${encodeURIComponent(code)}`, 'link')}
              data-partner-action="copy-marketing-link"
            >
              {clipboard.copied === 'link' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {clipboard.copied === 'link' ? 'Copied' : 'Copy link'}
            </PartnerModuleButton>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            Your referral code is still being issued — it shows on My Referral Code as soon as it is ready.
          </p>
        )}
        {clipboard.error ? <div className="mt-3"><PartnerInlineNotice tone="error" message={clipboard.error} /></div> : null}
      </PartnerModuleCard>

      <PartnerStatGrid
        columns={3}
        stats={[
          { label: 'Published assets', value: String(rows.length), hint: category === 'all' ? 'Across every category' : categoryLabel(category) },
          { label: 'Categories', value: String(categories.data?.length ?? 0), hint: 'Banners, email, social, video' },
          { label: 'Your code', value: code ? code.toUpperCase() : '—', hint: 'Case-insensitive on purpose' },
        ]}
      />

      <PartnerModuleCard
        id="library"
        title="Asset library"
        description="Published by the Nexora partner team. Newest first."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {chips.map((chip) => (
              <PartnerFilterChip
                key={chip.value}
                label={chip.label}
                active={category === chip.value}
                accentHex={accentHex}
                onSelect={() => setCategory(chip.value)}
              />
            ))}
          </div>
        }
        padded={false}
      >
        {assets.loading && !assets.data ? (
          <div className="p-6">
            <PartnerSectionLoading label="Loading the asset library…" />
          </div>
        ) : assets.error && !assets.data ? (
          <div className="p-5">
            <PartnerSectionError error={assets.error} failure={assets.failure} onRetry={assets.reload} title="The asset library could not load" />
          </div>
        ) : !rows.length ? (
          <PartnerSectionEmpty
            title={category === 'all' ? 'No assets published yet' : 'Nothing published in this category yet'}
            body="New posters, reels and email templates are added by the partner team. Your referral link above works in the meantime — paste it into any post you make yourself."
            icon={Images}
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((asset) => (
              <li key={asset.id} className="flex flex-wrap items-start gap-4 p-5">
                <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-pink-50">
                  <FileText className="h-5 w-5" style={{ color: accentHex }} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">{categoryLabel(asset.category)}</p>
                  <h4 className="mt-0.5 text-base font-black text-slate-950">{asset.title}</h4>
                  <p className="mt-1 text-sm text-slate-600">
                    {asset.description || 'Partner resource'} · {asset.mime_type} · {formatPartnerFileSize(asset.file_size_bytes)}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {asset.published_at ? `Published ${formatPartnerDate(asset.published_at)}` : 'Publication date pending'}
                  </p>
                  {downloadError?.id === asset.id ? (
                    <div className="mt-2 max-w-xl">
                      <PartnerInlineNotice tone="error" message={downloadError.message} />
                    </div>
                  ) : null}
                </div>
                <PartnerModuleButton
                  variant="secondary"
                  onClick={() => void download(asset.id)}
                  disabled={downloadingId === asset.id}
                  data-partner-action={`download-${asset.id}`}
                >
                  <Download className="h-4 w-4" />
                  {downloadingId === asset.id ? 'Preparing…' : 'Download'}
                </PartnerModuleButton>
              </li>
            ))}
          </ul>
        )}
      </PartnerModuleCard>

      <PartnerModuleCard id="playbook" title="What tends to work" description="Three things partners report, not a promise about your market.">
        <ol className="space-y-3">
          {PLAYBOOK.map((item, index) => (
            <li key={item.title} className="flex gap-3 rounded-2xl bg-slate-50 p-4">
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-black text-white"
                style={{ backgroundColor: accentHex }}
              >
                {index + 1}
              </span>
              <div>
                <p className="text-sm font-black text-slate-900">{item.title}</p>
                <p className="mt-1 text-sm text-slate-600">{item.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </PartnerModuleCard>
    </div>
  );
};

export default PartnerMarketingMaterialsPage;
