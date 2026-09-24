import React, { useMemo, useState } from 'react';
import { ChevronDown, LifeBuoy, MessageCircle, RefreshCw, Search, Send, Ticket } from 'lucide-react';
import type { PartnerTicketPriority } from '../../lib/partnerPortalOperations';
import { growthPartnerService } from '../../services/growthPartner';
import { usePartnerServiceAction, usePartnerServiceQuery } from '../../lib/partnerServiceQueries';
import { formatPartnerDate, formatPartnerDateTime, partnerStatusLabel } from '../../lib/partnerPresentation';
import { PartnerToast } from '../PartnerToast';
import {
  PARTNER_INPUT_CLASS,
  PartnerField,
  PartnerFilterChip,
  PartnerInlineNotice,
  PartnerModuleButton,
  PartnerModuleCard,
  PartnerModuleHeader,
  PartnerSectionEmpty,
  PartnerSectionError,
  PartnerSectionLoading,
  PartnerStatGrid,
  PartnerStatusPill,
} from './PartnerModuleKit';

// ============================================================================
// SUPPORT — /partner/support
//
// The ticket desk is the partner's single written channel: a ticket is INSERTED
// into `partner_support_tickets` through `submit_my_partner_support_ticket` (the
// client has no write policy on that table, so nothing here can edit a ticket
// afterwards), and `partner_notifications` receives a row whenever the support
// desk moves the status — the trigger does it, which is why this page can
// honestly promise "you will be notified" without a scheduler behind it.
//
// The FAQ answers are the portal's real rules (clearance hold, payout floor,
// frozen rate), and the partner's own tickets stay on the page as the record of
// what was asked — not a "we'll email you" placeholder.
// ============================================================================

const TICKET_STATUSES = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'resolved', label: 'Resolved' },
];

const PRIORITIES: Array<{ value: PartnerTicketPriority; label: string; hint: string }> = [
  { value: 'low', label: 'Low', hint: 'General question, no deadline' },
  { value: 'normal', label: 'Normal', hint: 'Account, asset or referral question' },
  { value: 'high', label: 'High', hint: 'Payout blocked or account access issue' },
];

const SUBJECT_LIMIT = 180;
const MESSAGE_MIN = 10;
const MESSAGE_LIMIT = 5000;

const FAQS: Array<{ question: string; answer: string; tags: string }> = [
  {
    question: 'When does an earning become withdrawable?',
    answer:
      'A commission row is credited as “Pending” when the referred shop’s subscription payment is recorded, and moves to “Available” seven days after that payment clears. Held or reversed rows never enter the withdrawable balance.',
    tags: 'earnings clearance hold pending available withdraw payout',
  },
  {
    question: 'Why is my payout request refused?',
    answer:
      'Three checks run server-side: the amount must be at least ₹500, it must fit inside the cleared balance left after any open request, and only one request per partner can stay open. Any of those produces the refusal message you saw — the money is never debited by a refused request.',
    tags: 'payout withdrawal minimum 500 refused balance one open request',
  },
  {
    question: 'What rate am I paid, and can it change retroactively?',
    answer:
      'The recurring subscription commission is 15%, and each ledger row freezes the rate it was earned at. A tier change affects rows created after it — never the history you can already see on Earnings.',
    tags: 'rate commission 15 percent retroactive tier change',
  },
  {
    question: 'How do partner levels work?',
    answer:
      'Levels are defined by Nexora in partner_level_definitions and unlock by the number of ACTIVE referred shops you have. Partner Levels shows your current tier, the rate it carries and the distance to the next one.',
    tags: 'levels tiers unlock active shops bronze silver gold platinum',
  },
  {
    question: 'What happens after I raise a ticket?',
    answer:
      'The desk moves it open → in progress → resolved. Every status change writes a row into your portal Notifications, so you do not have to keep coming back here to check.',
    tags: 'ticket status progress resolved notification response',
  },
  {
    question: 'Where do I find posters and social creatives?',
    answer:
      'Marketing Materials lists everything published for partners, newest first, with a signed download for each file. Your referral link on that page is the one every asset should carry.',
    tags: 'marketing assets posters social creative download link',
  },
];

const matchesQuery = (value: string, query: string) => value.toLowerCase().includes(query.trim().toLowerCase());

export const PartnerSupportPage: React.FC<{ accentHex?: string }> = ({ accentHex }) => {
  const [status, setStatus] = useState('all');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState<PartnerTicketPriority>('normal');
  const [fieldErrors, setFieldErrors] = useState<{ subject?: string; message?: string }>({});
  const [query, setQuery] = useState('');
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [notice, setNotice] = useState({ id: 0, message: '' });

  const tickets = usePartnerServiceQuery(() => growthPartnerService.getSupportTickets({ limit: 10, status }), [status]);
  const create = usePartnerServiceAction(() => growthPartnerService.submitSupportTicket(subject.trim(), message.trim(), priority));

  const filteredFaqs = useMemo(
    () => (query.trim() ? FAQS.filter((faq) => matchesQuery(`${faq.question} ${faq.answer} ${faq.tags}`, query)) : FAQS),
    [query]
  );

  const rows = tickets.data ?? [];
  const openCount = rows.filter((row) => row.status === 'open').length;

  const validate = () => {
    const next: { subject?: string; message?: string } = {};
    if (subject.trim().length < 3) next.subject = 'Give the ticket a subject of at least 3 characters.';
    else if (subject.trim().length > SUBJECT_LIMIT) next.subject = `Keep the subject under ${SUBJECT_LIMIT} characters.`;
    if (message.trim().length < MESSAGE_MIN) next.message = `Describe the issue in at least ${MESSAGE_MIN} characters.`;
    else if (message.trim().length > MESSAGE_LIMIT) next.message = `Keep it under ${MESSAGE_LIMIT} characters.`;
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    const receipt = await create.run();
    if (!receipt) return;
    setSubject('');
    setMessage('');
    setPriority('normal');
    setFieldErrors({});
    setNotice((state) => ({
      id: state.id + 1,
      message: `Ticket #${receipt.ticket_number} submitted — the partner desk will answer here and in your notifications.`,
    }));
    tickets.reload();
  };

  if (tickets.loading && !tickets.data) return <PartnerSectionLoading label="Loading your support tickets…" kind="table" module="support" />;
  if (tickets.error && !tickets.data) {
    return <PartnerSectionError error={tickets.error} failure={tickets.failure} onRetry={tickets.reload} title="Your tickets could not load" module="support" />;
  }

  return (
    <div data-partner-module="support" className="space-y-5">
      <PartnerToast message={notice.message} noticeId={notice.id} />

      <PartnerModuleHeader
        eyebrow="Partner desk"
        title="Support"
        description="Raise a ticket about payouts, referrals, levels or your marketing kit. Everything stays written, so nothing gets lost in a call."
        icon={LifeBuoy}
        actions={
          <PartnerModuleButton variant="secondary" onClick={tickets.reload} disabled={tickets.refreshing}>
            <RefreshCw className={`h-4 w-4 ${tickets.refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </PartnerModuleButton>
        }
      />

      {tickets.error ? <PartnerInlineNotice message={`${tickets.error} — showing the last tickets we loaded.`} /> : null}

      <PartnerStatGrid
        columns={3}
        stats={[
          { label: 'Tickets on your account', value: String(tickets.data?.length ?? 0), hint: 'Newest first' },
          { label: 'Awaiting a reply', value: String(openCount) },
          { label: 'Fastest route', value: 'High priority', hint: 'Use it for blocked payouts or account access' },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <PartnerModuleCard id="new-ticket" title="Raise a ticket" description="One form, one queue — the desk sees the priority you picked.">
          <div className="space-y-4">
            <PartnerField label="Subject" htmlFor="ticket-subject" error={fieldErrors.subject} hint={`Up to ${SUBJECT_LIMIT} characters`}>
              <input
                id="ticket-subject"
                name="subject"
                type="text"
                value={subject}
                maxLength={SUBJECT_LIMIT}
                onChange={(event) => {
                  setSubject(event.target.value);
                  if (fieldErrors.subject) setFieldErrors((current) => ({ ...current, subject: undefined }));
                }}
                placeholder="Payout request refused although balance looks available"
                className={PARTNER_INPUT_CLASS}
              />
            </PartnerField>

            <PartnerField
              label="What is happening?"
              htmlFor="ticket-message"
              error={fieldErrors.message}
              hint={`${message.trim().length}/${MESSAGE_LIMIT} characters · include dates and references if you have them`}
            >
              <textarea
                id="ticket-message"
                name="message"
                value={message}
                maxLength={MESSAGE_LIMIT}
                rows={6}
                onChange={(event) => {
                  setMessage(event.target.value);
                  if (fieldErrors.message) setFieldErrors((current) => ({ ...current, message: undefined }));
                }}
                placeholder="On 12 September I requested ₹1,200 and it was refused with “Withdrawal exceeds available balance”. My Earnings page shows ₹1,250 available."
                className={`${PARTNER_INPUT_CLASS} min-h-32 resize-y`}
              />
            </PartnerField>

            <PartnerField label="Priority" htmlFor="ticket-priority" hint={PRIORITIES.find((option) => option.value === priority)?.hint}>
              <select
                id="ticket-priority"
                name="priority"
                value={priority}
                onChange={(event) => setPriority(event.target.value as PartnerTicketPriority)}
                className={PARTNER_INPUT_CLASS}
              >
                {PRIORITIES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </PartnerField>

            {create.error ? <PartnerInlineNotice tone="error" message={create.error} /> : null}

            <PartnerModuleButton
              variant="accent"
              accentHex={accentHex}
              onClick={submit}
              disabled={create.pending}
              data-partner-action="submit-ticket"
            >
              <Send className="h-4 w-4" />
              {create.pending ? 'Submitting…' : 'Submit ticket'}
            </PartnerModuleButton>
          </div>
        </PartnerModuleCard>

        <PartnerModuleCard
          id="tickets"
          title="Your tickets"
          description="Status changes are written by the desk; you can read them here."
          padded={false}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {TICKET_STATUSES.map((option) => (
                <PartnerFilterChip
                  key={option.value}
                  label={option.label}
                  active={status === option.value}
                  accentHex={accentHex}
                  onSelect={() => setStatus(option.value)}
                />
              ))}
            </div>
          }
        >
          {rows.length ? (
            <ul className="divide-y divide-slate-100">
              {rows.map((ticket) => (
                <li key={ticket.id} className="p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="min-w-0 text-sm font-black text-slate-950">
                      <span className="mr-2 font-mono text-xs text-slate-400">#{ticket.ticket_number}</span>
                      {ticket.subject}
                    </p>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-slate-500">
                        {ticket.priority}
                      </span>
                      <PartnerStatusPill status={ticket.status} label={partnerStatusLabel(ticket.status)} />
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">{ticket.message}</p>
                  <p className="mt-2 text-xs text-slate-400">
                    raised {formatPartnerDate(ticket.created_at)}
                    {ticket.updated_at && ticket.updated_at !== ticket.created_at
                      ? ` · last update ${formatPartnerDateTime(ticket.updated_at)}`
                      : ''}
                    {ticket.closed_at ? ` · closed ${formatPartnerDate(ticket.closed_at)}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <PartnerSectionEmpty
              icon={Ticket}
              title={status === 'all' ? 'No tickets yet' : `No ${partnerStatusLabel(status).toLowerCase()} tickets`}
              body="When you raise something it stays listed here with its status, so you always have the written record of what was asked and when."
            />
          )}
        </PartnerModuleCard>
      </div>

      <PartnerModuleCard
        id="faq"
        title="Answers we already have"
        description="The portal's own rules — worth a look before you raise a ticket."
        actions={
          <label className="relative flex items-center">
            <span className="sr-only">Search the partner FAQ</span>
            <Search className="pointer-events-none absolute left-3 h-4 w-4 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search the FAQ"
              className="min-h-11 w-48 rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs font-bold text-slate-700 outline-none focus:border-slate-400 sm:w-64"
            />
          </label>
        }
        padded={false}
      >
        {filteredFaqs.length ? (
          <ul className="divide-y divide-slate-100">
            {filteredFaqs.map((faq, index) => {
              const expanded = openFaq === index;
              return (
                <li key={faq.question}>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setOpenFaq(expanded ? null : index)}
                    className="flex w-full cursor-pointer items-center justify-between gap-4 p-5 text-left transition-colors hover:bg-slate-50"
                  >
                    <span className="text-sm font-black text-slate-900">{faq.question}</span>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
                      aria-hidden="true"
                    />
                  </button>
                  {expanded ? <p className="px-5 pb-5 text-sm leading-6 text-slate-600">{faq.answer}</p> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="p-5">
            <PartnerInlineNotice
              message={`Nothing in the FAQ matches “${query.trim()}”. Raise a ticket and the desk will answer in writing.`}
            />
          </div>
        )}
      </PartnerModuleCard>

      <PartnerModuleCard id="channels" title="Other ways to reach us">
        <div className="grid gap-3 sm:grid-cols-2">
          <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
            <MessageCircle className="mr-1.5 inline h-4 w-4 text-slate-400" />
            Your shop owner contacts do not see partner tickets — and partner tickets do not reach their salon dashboard. The ticket queue above is the partner channel.
          </p>
          <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
            <Ticket className="mr-1.5 inline h-4 w-4 text-slate-400" />
            A reply from the desk appears as a notification with the ticket number in it, so you can find this conversation again from your inbox.
          </p>
        </div>
      </PartnerModuleCard>
    </div>
  );
};

export default PartnerSupportPage;
