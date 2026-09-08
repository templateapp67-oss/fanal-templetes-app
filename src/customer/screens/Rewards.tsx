// ============================================================================
// Rewards: wallet, membership tier, offers, QR counter payments, referrals.
//
// What the current schema actually gives us, and what the screen therefore says:
//
//   • wallet          → `clients.points` / `lifetime_points` / `total_spent`,
//                       one row per salon that has you as a client
//   • ledger          → `loyalty_point_transactions` (earn, redeem, qr_payment)
//   • membership      → `clients.loyalty_tier` measured against
//                       `loyalty_config` thresholds and multipliers
//   • offers          → `loyalty_rewards` (active, per salon), redeemable when
//                       the wallet covers `required_points`
//   • QR payments     → rows in the same ledger with type 'qr_payment'; the
//                       wallet balance is the thing that moves
//   • referrals       → your code (from your auth uid) plus bookings that
//                       carried it in `bookings.metadata.referral_code`
//
// There is no `reward_wallets` or `qr_payments` table in this deployment, so
// nothing here pretends to read one: every number names the table it came from,
// and a balance is never shown as "0" when the read actually failed.
// ============================================================================

import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  BadgePercent,
  Check,
  Copy,
  Gift,
  Loader2,
  QrCode,
  Share2,
  Sparkles,
  Star,
  Ticket,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import type { Offer, QrPayment, RewardWallet } from '../../lib/customer/types';
import {
  confirmQrPayment,
  listMyMemberships,
  listOffers,
  listMyQrPayments,
  listMyReferrals,
  listMyRewards,
  normalizeCustomerErrorMessage,
  redeemOffer,
} from '../../lib/customer/api';
import { money, Button, CARD_CLASS, Chip, EmptyState, ErrorState, Field, LoadingRows, MUTED_CLASS, SectionTitle, SourceChip, StatTile, useCustomerQuery, useCustomerRealtime } from '../ui';

export interface RewardsProps {
  userId?: string | null;
  email?: string | null;
  accentHex?: string;
  refreshToken?: number;
  /** Deep link (`/app/qr`) opens the matching tab instead of the default. */
  initialTab?: Tab;
  onOpenSalon?: (salonId: string) => void;
}

type Tab = 'wallet' | 'offers' | 'qr' | 'membership' | 'referral';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'wallet', label: 'Wallet' },
  { id: 'offers', label: 'Offers' },
  { id: 'qr', label: 'QR payments' },
  { id: 'membership', label: 'Membership' },
  { id: 'referral', label: 'Refer & earn' },
];

export const RewardsScreen: React.FC<RewardsProps> = ({ userId, email, accentHex = '#C20E5A', refreshToken = 0, initialTab = 'wallet', onOpenSalon }) => {
  const [tab, setTab] = useState<Tab>(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  const rewards = useCustomerQuery(() => listMyRewards(), [userId, refreshToken]);
  const offers = useCustomerQuery(() => listOffers(), [userId, refreshToken]);
  const qr = useCustomerQuery(() => listMyQrPayments(), [userId, refreshToken]);
  const memberships = useCustomerQuery(() => listMyMemberships(), [userId, refreshToken]);
  const referrals = useCustomerQuery(() => listMyReferrals(), [userId, refreshToken]);
  useCustomerRealtime(['rewards', 'notifications'], email, () => {
    rewards.reload();
    offers.reload();
    qr.reload();
    memberships.reload();
  });

  const wallets = rewards.data?.wallets || [];
  const transactions = rewards.data?.transactions || [];
  const totalPoints = wallets.reduce((sum: number, wallet: RewardWallet) => sum + Number(wallet.points || 0), 0);

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Rewards"
        subtitle="Your points live on the salon's client record, not in a rewards table of their own — so each card below says which salon it belongs to."
      />

      {rewards.loading ? <LoadingRows rows={2} label="Reading your loyalty rows…" /> : null}
      {rewards.failed ? <ErrorState message={rewards.error} onRetry={rewards.reload} hint="A failed read is not a zero balance." /> : null}

      {!rewards.loading && !rewards.failed && !wallets.length ? (
        <EmptyState
          icon={<Wallet className="w-6 h-6 text-slate-400" />}
          title="No loyalty record yet"
          body="A wallet appears once a salon has you in their client list — usually after your first completed visit. Nothing is created here by the app."
        />
      ) : null}

      {wallets.length ? (
        <div className="grid grid-cols-3 gap-2">
          <StatTile label="Points" value={String(totalPoints)} hint="across all salons" accentHex={accentHex} />
          <StatTile label="Visits" value={String(wallets.reduce((sum: number, wallet: RewardWallet) => sum + Number(wallet.totalVisits || 0), 0))} hint="completed" />
          <StatTile label="Lifetime" value={String(wallets.reduce((sum: number, wallet: RewardWallet) => sum + Number(wallet.lifetimePoints || 0), 0))} hint="never decreases" />
        </div>
      ) : null}

      <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist">
        {TABS.map((item) => {
          const active = item.id === tab;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(item.id)}
              className={`shrink-0 px-3.5 py-2 rounded-full text-xs font-bold border transition ${
                active ? 'border-transparent text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
              }`}
              style={active ? { backgroundColor: accentHex } : undefined}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {tab === 'wallet' ? <WalletPanel wallets={wallets} transactions={transactions} state={rewards} onOpenSalon={onOpenSalon} /> : null}
      {tab === 'offers' ? (
        <OffersPanel state={offers} wallets={wallets} accentHex={accentHex} userId={userId} onRedeemed={() => { offers.reload(); rewards.reload(); }} />
      ) : null}
      {tab === 'qr' ? <QrPanel wallets={wallets} state={qr} userId={userId} accentHex={accentHex} onRecorded={() => { qr.reload(); rewards.reload(); }} /> : null}
      {tab === 'membership' ? <MembershipPanel state={memberships} onOpenSalon={onOpenSalon} /> : null}
      {tab === 'referral' ? <ReferralPanel state={referrals} accentHex={accentHex} /> : null}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------
const WalletPanel: React.FC<{
  wallets: RewardWallet[];
  transactions: any[];
  state: { notice: string; mode: 'live' | 'mock'; loading?: boolean };
  onOpenSalon?: (salonId: string) => void;
}> = ({ wallets, transactions, state, onOpenSalon }) => (
  <div className="space-y-3">
    {wallets.map((wallet) => (
      <Card key={wallet.id} salon={wallet} onOpenSalon={onOpenSalon} />
    ))}

    <div className={`${CARD_CLASS} p-4`}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-bold text-slate-900">Points ledger</p>
        <SourceChip source="supabase" mode={state.mode} title="Every row here is in loyalty_point_transactions — earned, redeemed or QR-paid" />
      </div>
      {!transactions.length ? (
        <p className={`text-sm ${MUTED_CLASS}`}>
          No transactions on your client rows yet. Your first completed visit or redeemed offer writes one.
          {state.notice ? ` (${state.notice})` : ''}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {transactions.slice(0, 30).map((entry) => (
            <li key={entry.id} className="py-2.5 flex items-start gap-3">
              <span className="mt-0.5 w-7 h-7 rounded-lg bg-slate-100 grid place-items-center shrink-0">
                {entry.pointsChange >= 0 ? <TrendingUp className="w-3.5 h-3.5 text-emerald-600" /> : <BadgePercent className="w-3.5 h-3.5 text-slate-500" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-900 font-semibold">{entry.description}</p>
                <p className="text-[11px] text-slate-500">
                  {entry.salonName ? `${entry.salonName} · ` : ''}
                  {entry.date ? new Date(entry.date).toLocaleDateString() : ''} · {entry.type.replace(/_/g, ' ')}
                </p>
              </div>
              <span className={`text-sm font-extrabold shrink-0 ${entry.pointsChange >= 0 ? 'text-emerald-600' : 'text-slate-600'}`}>
                {entry.pointsChange > 0 ? '+' : ''}
                {entry.pointsChange}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  </div>
);

const Card: React.FC<{ salon: RewardWallet; onOpenSalon?: (id: string) => void }> = ({ salon, onOpenSalon }) => (
  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={`${CARD_CLASS} p-4`}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-extrabold text-slate-900 truncate">{salon.salonName || 'Salon'}</p>
        <p className={`text-xs ${MUTED_CLASS}`}>
          {salon.programEnabled ? 'Loyalty program active' : 'This salon has the loyalty program switched off'} · tier {salon.tier || 'unassigned'}
        </p>
      </div>
      <SourceChip source={salon.source} />
    </div>
    <div className="flex items-end gap-2 mt-3">
      <p className="text-3xl font-extrabold text-slate-900">{salon.points}</p>
      <p className={`text-xs pb-1.5 ${MUTED_CLASS}`}>points</p>
      <p className="ml-auto text-xs text-slate-500 pb-1.5">
        {salon.totalSpent ? `${money(salon.totalSpent, salon.currency || '₹')} spent · ` : ''}
        {salon.totalVisits} visit{salon.totalVisits === 1 ? '' : 's'}
      </p>
    </div>
    {salon.nextTier ? (
      <div className="mt-3">
        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-slate-900"
            style={{ width: `${Math.round(salon.nextTier.progress * 100)}%` }}
          />
        </div>
        <p className="text-[11px] text-slate-500 mt-1.5">
          {salon.nextTier.pointsNeeded} more point{salon.nextTier.pointsNeeded === 1 ? '' : 's'} for {salon.nextTier.tier}
        </p>
      </div>
    ) : null}
    {salon.lastVisit ? <p className="text-[11px] text-slate-400 mt-2">Last visit {new Date(salon.lastVisit).toLocaleDateString()}</p> : null}
    {onOpenSalon && salon.salonId ? (
      <button type="button" onClick={() => onOpenSalon(salon.salonId)} className="text-xs font-bold mt-2" style={{ color: '#0f172a' }}>
        View salon →
      </button>
    ) : null}
  </motion.div>
);

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------
const OffersPanel: React.FC<{
  state: { data: Offer[] | null; loading: boolean; failed: boolean; error: string; reload: () => void };
  wallets: RewardWallet[];
  accentHex: string;
  userId?: string | null;
  onRedeemed: () => void;
}> = ({ state, wallets, accentHex, onRedeemed }) => {
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState({ text: '', kind: 'info' as 'info' | 'error' | 'ok' });
  const offers = state.data || [];
  const pointsBySalon = useMemo(() => {
    const map = new Map<string, number>();
    for (const wallet of wallets) map.set(wallet.salonId, Number(wallet.points || 0));
    return map;
  }, [wallets]);

  async function redeem(offer: Offer) {
    setBusy(offer.id);
    setMessage({ text: '', kind: 'info' });
    const result = await redeemOffer({ offerId: offer.id, salonId: offer.salonId });
    setBusy('');
    if (!result.ok) {
      setMessage({ text: normalizeCustomerErrorMessage(result), kind: 'error' });
      return;
    }
    const coupon = result.data?.redemption?.couponCode || '';
    setMessage({
      text: coupon
        ? `Redeemed. Coupon ${coupon} — ${result.data?.transaction ? `${-result.data.transaction.pointsChange} points deducted` : 'points deducted'}. Show it at the counter.`
        : 'Redeemed. The salon will see it on your client record.',
      kind: 'ok',
    });
    onRedeemed();
  }

  if (state.loading) return <LoadingRows rows={2} label="Loading active rewards from loyalty_rewards…" />;
  if (state.failed) return <ErrorState message={state.error} onRetry={state.reload} />;
  if (!offers.length) {
    return (
      <EmptyState
        icon={<Sparkles className="w-6 h-6 text-slate-400" />}
        title="No offers are live right now"
        body="Offers are the salon's `loyalty_rewards` rows with `is_active` on. When the owner turns one on it appears here — this screen never shows a made-up discount."
      />
    );
  }
  return (
    <div className="space-y-3">
      {message.text ? (
        <p
          className={`text-xs font-semibold rounded-xl px-3 py-2 border ${
            message.kind === 'error'
              ? 'text-rose-800 bg-rose-50 border-rose-200'
              : 'text-emerald-800 bg-emerald-50 border-emerald-200'
          }`}
        >
          {message.text}
        </p>
      ) : null}
      {offers.map((offer) => (
        <div key={`${offer.salonId}-${offer.id}`} className={`${CARD_CLASS} p-4`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-extrabold text-slate-900">{offer.title}</p>
              <p className={`text-xs mt-0.5 ${MUTED_CLASS}`}>{offer.description || 'No description set by the salon.'}</p>
            </div>
            <Chip tone={offer.active ? 'success' : 'neutral'}>{offer.active ? 'active' : 'inactive'}</Chip>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-2.5 text-[11px]">
            <Chip tone="neutral" title="How the reward is applied at the counter">
              {offer.rewardType.replace(/_/g, ' ')}
              {offer.rewardType === 'percentage_discount' ? ` ${offer.discountValue}%` : ''}
              {offer.rewardType === 'flat_discount' ? ` ${money(offer.discountValue, '₹')}` : ''}
            </Chip>
            <Chip tone="neutral">
              <Star className="w-3 h-3" /> {offer.requiredPoints} pts
            </Chip>
            {offer.applicableCategory ? <Chip tone="neutral">{offer.applicableCategory}</Chip> : null}
            {offer.expiresLabel ? <Chip tone="warn">{offer.expiresLabel}</Chip> : null}
            {offer.redeemedCount ? <Chip tone="neutral">{offer.redeemedCount} redeemed</Chip> : null}
            <SourceChip source={offer.source} title="loyalty_rewards row, filtered by whether your wallet covers the cost" />
          </div>
          <div className="flex items-center justify-between gap-3 mt-3">
            <p className={`text-xs ${MUTED_CLASS}`}>
              {offer.salonName} · your balance here: {pointsBySalon.get(offer.salonId) ?? 0} pts
            </p>
            {offer.redeemable ? (
              <Button busy={busy === offer.id} onClick={() => redeem(offer)} accentHex={accentHex}>
                <Ticket className="w-4 h-4" /> Redeem
              </Button>
            ) : (
              <span className="text-[11px] font-bold text-slate-500">
                {offer.pointsShort > 0 ? `${offer.pointsShort} points short` : 'Not redeemable now'}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// QR payments at the counter
// ---------------------------------------------------------------------------
const QrPanel: React.FC<{
  wallets: RewardWallet[];
  state: { data: QrPayment[] | null; loading: boolean; failed: boolean; error: string; reload: () => void; notice: string };
  userId?: string | null;
  accentHex: string;
  onRecorded: () => void;
}> = ({ wallets, state, userId, accentHex, onRecorded }) => {
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ text: '', kind: 'info' as 'info' | 'error' | 'ok' });
  const payments = state.data || [];
  const code = useMemo(() => counterCode(userId), [userId]);

  async function record() {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setMessage({ text: 'Enter the amount from your payment slip, in rupees.', kind: 'error' });
      return;
    }
    if (!reference.trim()) {
      setMessage({ text: 'The salon gives you a UPI/QR reference with the slip — it is what ties this entry to the payment.', kind: 'error' });
      return;
    }
    if (!wallets.length) {
      setMessage({ text: 'You have no wallet at any salon yet, so there is nothing to credit points to.', kind: 'error' });
      return;
    }
    setBusy(true);
    setMessage({ text: '', kind: 'info' });
    const result = await confirmQrPayment({ salonId: wallets[0].salonId, amount: value, reference: reference.trim() });
    setBusy(false);
    if (!result.ok) {
      setMessage({ text: normalizeCustomerErrorMessage(result), kind: 'error' });
      return;
    }
    const credited = result.data?.payment?.pointsCredited ?? 0;
    setMessage({
      text: `Recorded as ${result.data?.payment?.status || 'pending'}: ${credited} point${credited === 1 ? '' : 's'} ${result.data?.payment?.status === 'pending' ? 'will appear when the salon confirms' : 'credited to your wallet'}.`,
      kind: 'ok',
    });
    setAmount('');
    setReference('');
    onRecorded();
  }

  return (
    <div className="space-y-3">
      <div className={`${CARD_CLASS} p-4`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-slate-900">Your counter code</p>
            <p className={`text-xs mt-0.5 ${MUTED_CLASS}`}>
              Shown to the reception desk so they can find your client row before the payment is recorded.
            </p>
          </div>
          <QrCode className="w-5 h-5 text-slate-400" />
        </div>
        <div className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center">
          <p className="font-mono text-xl font-extrabold tracking-[0.2em] text-slate-900">{code || '—'}</p>
          <p className="text-[11px] text-slate-500 mt-2">
            Derived from your own auth id. A scannable QR image is not rendered here: this app has no QR-encoder dependency, and drawing a fake code the
            salon cannot scan would be worse than none.
          </p>
        </div>
        {userId ? null : <p className="text-[11px] text-slate-500 mt-2">Sign in to get a code tied to your account.</p>}
      </div>

      <div className={`${CARD_CLASS} p-4 space-y-3`}>
        <p className="text-sm font-bold text-slate-900">I paid by QR — log it</p>
        <p className={`text-xs ${MUTED_CLASS}`}>
          This writes a `loyalty_point_transactions` row of type `qr_payment` against your client record and credits points the way the salon's
          configuration says. It does not move money — the money moved in your UPI app.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount paid (₹)" value={amount} onChange={setAmount} placeholder="e.g. 750" type="number" />
          <Field label="Payment reference" value={reference} onChange={setReference} placeholder="UPI slip / txn id" />
        </div>
        {message.text ? (
          <p className={`text-xs font-semibold rounded-xl px-3 py-2 border ${message.kind === 'error' ? 'text-rose-800 bg-rose-50 border-rose-200' : 'text-emerald-800 bg-emerald-50 border-emerald-200'}`}>
            {message.text}
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          <Button busy={busy} onClick={record} accentHex={accentHex}>
            <Check className="w-4 h-4" /> Record payment
          </Button>
          {state.notice ? <span className="text-[11px] text-slate-500">{state.notice}</span> : null}
        </div>
      </div>

      <div className={`${CARD_CLASS} p-4`}>
        <p className="text-sm font-bold text-slate-900 mb-2">Payment history</p>
        {state.loading ? <LoadingRows rows={2} label="Reading qr_payment rows…" /> : null}
        {state.failed ? <ErrorState message={state.error} onRetry={state.reload} /> : null}
        {!state.loading && !state.failed && !payments.length ? (
          <p className={`text-sm ${MUTED_CLASS}`}>No QR payments recorded on your client rows yet.</p>
        ) : null}
        <ul className="divide-y divide-slate-100">
          {(payments || []).slice(0, 20).map((payment) => (
            <li key={payment.id} className="py-2.5 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">
                  {money(payment.amount, '₹')} · +{payment.pointsCredited} pts
                </p>
                <p className="text-[11px] text-slate-500">
                  {payment.salonName ? `${payment.salonName} · ` : ''}
                  {payment.reference} · {payment.date ? new Date(payment.date).toLocaleString() : ''}
                </p>
              </div>
              <Chip tone={payment.status === 'credited' ? 'success' : 'warn'} title={payment.status === 'credited' ? 'ledger row + wallet update both written' : 'ledger row written; the salon confirms the amount'}>
                {payment.status}
              </Chip>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

/**
 * A stable, readable code for the customer. Derived from the auth uid on purpose:
 * no table stores such a column, so inventing a per-salon member number would
 * mean inventing a sequence, and the schema forbids adding one.
 */
function counterCode(userId?: string | null): string {
  const id = String(userId || '');
  if (!id) return '';
  const digits = id.replace(/[^0-9]/g, '').slice(-6).padStart(6, '0');
  return `NX ${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 6)}`;
}

// ---------------------------------------------------------------------------
// Membership + referral
// ---------------------------------------------------------------------------
const MembershipPanel: React.FC<{
  state: { data: any[] | null; loading: boolean; failed: boolean; error: string; reload: () => void };
  onOpenSalon?: (salonId: string) => void;
}> = ({ state, onOpenSalon }) => {
  const rows = state.data || [];
  if (state.loading) return <LoadingRows rows={2} label="Comparing your points with the salon's tier thresholds…" />;
  if (state.failed) return <ErrorState message={state.error} onRetry={state.reload} />;
  if (!rows.length) {
    return (
      <EmptyState
        icon={<Gift className="w-6 h-6 text-slate-400" />}
        title="No membership configured"
        body="A tier appears once a salon has `loyalty_config` enabled and your client row carries a tier. Until then there is nothing to show, and this screen will not guess one."
      />
    );
  }
  return (
    <div className="space-y-3">
      {rows.map((membership) => (
        <div key={`${membership.salonId}-${membership.tier}`} className={`${CARD_CLASS} p-4`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-extrabold text-slate-900">{membership.tier}</p>
              <p className={`text-xs ${MUTED_CLASS}`}>
                {membership.salonName} · {membership.multiplier > 1 ? `${membership.multiplier}× points` : 'standard rate'}
                {membership.memberSince ? ` · member since ${new Date(membership.memberSince).getFullYear()}` : ''}
              </p>
            </div>
            <SourceChip source={membership.source} title="tier from clients.loyalty_tier, thresholds from loyalty_config" />
          </div>
          {membership.nextTier ? (
            <div className="mt-3">
              <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.round(membership.nextTier.progress * 100)}%`, backgroundColor: accent(membership.nextTier.progress) }} />
              </div>
              <p className="text-[11px] text-slate-500 mt-1.5">
                {membership.nextTier.pointsNeeded} point{membership.nextTier.pointsNeeded === 1 ? '' : 's'} to {membership.nextTier.tier}
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-emerald-700 mt-2">Top tier at this salon.</p>
          )}
          {membership.benefits?.length ? (
            <ul className="mt-3 space-y-1">
              {membership.benefits.map((benefit: string) => (
                <li key={benefit} className="text-xs text-slate-700 flex items-start gap-1.5">
                  <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-600" />
                  {benefit}
                </li>
              ))}
            </ul>
          ) : null}
          {onOpenSalon && membership.salonId ? (
            <button type="button" onClick={() => onOpenSalon(membership.salonId)} className="text-xs font-bold mt-3 text-slate-900">
              Book at this salon →
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
};

const accent = (progress: number) => (progress >= 0.75 ? '#059669' : '#0f172a');

const ReferralPanel: React.FC<{
  state: { data: any; loading: boolean; failed: boolean; error: string; reload: () => void };
  accentHex: string;
}> = ({ state, accentHex }) => {
  const [copied, setCopied] = useState('');
  const payload = state.data;
  if (state.loading) return <LoadingRows rows={2} label="Building your referral code and history…" />;
  if (state.failed) return <ErrorState message={state.error} onRetry={state.reload} />;
  const items = payload?.items || [];
  return (
    <div className="space-y-3">
      <div className={`${CARD_CLASS} p-4`}>
        <p className="text-sm font-bold text-slate-900">Your code</p>
        <p className={`text-xs mt-0.5 ${MUTED_CLASS}`}>
          Derived from your account id and stored on any booking that uses it — the salon credits the reward when the visit completes.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <p className="font-mono text-lg font-extrabold tracking-wider text-slate-900 flex-1 min-w-0 break-all">{payload?.code || '—'}</p>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(payload?.code || '');
                setCopied('code');
              } catch {
                setCopied('unavailable');
              }
            }}
            className="w-9 h-9 rounded-xl border border-slate-200 grid place-items-center text-slate-600 hover:bg-slate-50"
            title="Copy code"
          >
            {copied === 'code' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
        {payload?.link ? (
          <div className="mt-2 flex items-center gap-2">
            <p className="text-[11px] font-mono text-slate-500 truncate flex-1">{payload.link}</p>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(payload.link);
                  setCopied('link');
                } catch {
                  setCopied('unavailable');
                }
              }}
              className="text-[11px] font-bold text-slate-700 inline-flex items-center gap-1"
            >
              {copied === 'link' ? <Check className="w-3 h-3 text-emerald-600" /> : <Share2 className="w-3 h-3" />} Copy invite link
            </button>
          </div>
        ) : null}
        {copied === 'unavailable' ? <p className="text-[11px] text-amber-700 mt-2">Your browser blocked the clipboard. Select the code and copy it manually.</p> : null}
      </div>

      <div className={`${CARD_CLASS} p-4`}>
        <p className="text-sm font-bold text-slate-900 mb-2">Who used it</p>
        {!items.length ? (
          <p className={`text-sm ${MUTED_CLASS}`}>
            Nobody has booked with your code yet. It is matched on `bookings.metadata.referral_code`, so it only counts when a booking actually carries it.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((item: any) => (
              <li key={item.id} className="py-2.5 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">{item.label}</p>
                  <p className="text-[11px] text-slate-500">
                    {item.salonName ? `${item.salonName} · ` : ''}
                    {item.date ? new Date(item.date).toLocaleDateString() : ''}
                  </p>
                </div>
                <Chip tone={item.status === 'credited' ? 'success' : 'neutral'} title="booked = a booking carries your code; credited = the salon awarded the points">
                  {item.status}
                </Chip>
                {item.pointsEarned ? <span className="text-sm font-extrabold text-emerald-600">+{item.pointsEarned}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={`${CARD_CLASS} p-4 flex items-start gap-3`}>
        <Sparkles className="w-4 h-4 mt-0.5 text-slate-400 shrink-0" />
        <p className={`text-xs ${MUTED_CLASS}`}>
          Paste a friend's code in the last step of booking. Codes look like <span className="font-mono">NX-XXXXXXXX</span>; anything else is rejected before the
          booking is written, so a typo can never silently swallow a reward.
        </p>
      </div>
      <button type="button" onClick={state.reload} className="text-xs font-bold text-slate-500 inline-flex items-center gap-1">
        <Loader2 className="w-3.5 h-3.5" /> Reload referral history
      </button>
    </div>
  );
};
