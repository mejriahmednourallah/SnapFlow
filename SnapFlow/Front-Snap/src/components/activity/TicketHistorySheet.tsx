import { useEffect, useState } from 'react';
import { formatDate, formatDateTime } from '@/lib/dateFormat';
import {
  Clock, Paperclip, User, ArrowRight, MessageSquare,
  Loader2, AlertCircle, ExternalLink,
} from 'lucide-react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface JournalDetail {
  property: 'attr' | 'cf' | 'attachment' | string;
  name: string;
  old_value: string | null;
  new_value: string | null;
}

interface Journal {
  id: number;
  user: { id: number; name: string };
  created_on: string;
  notes: string;
  private_notes: boolean;
  details: JournalDetail[];
}

interface Attachment {
  id: number;
  filename: string;
  filesize: number;
  content_type: string;
  content_url: string;
  author: { id: number; name: string };
  created_on: string;
}

interface TicketDetail {
  id: number;
  subject: string;
  description: string | null;
  status: { id: number; name: string };
  tracker: { id: number; name: string };
  priority: { id: number; name: string };
  author: { id: number; name: string };
  assigned_to?: { id: number; name: string };
  created_on: string;
  updated_on: string;
  done_ratio: number;
  estimated_hours?: number | null;
  spent_hours?: number | null;
  journals: Journal[];
  attachments: Attachment[];
}

export interface TicketHistorySheetProps {
  issueId: number | null;
  redmineBaseUrl?: string;
  onClose: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Human-readable label for Redmine attribute names */
const FIELD_LABEL: Record<string, string> = {
  status_id:        'Statut',
  assigned_to_id:   'Assigné à',
  tracker_id:       'Tracker',
  priority_id:      'Priorité',
  done_ratio:       'Avancement',
  subject:          'Sujet',
  description:      'Description',
  due_date:         'Date d\'échéance',
  start_date:       'Date début',
  estimated_hours:  'Heures estimées',
  fixed_version_id: 'Version cible',
  parent_id:        'Ticket parent',
  is_private:       'Privé',
};

function fieldLabel(detail: JournalDetail): string {
  if (detail.property === 'cf') return `Champ #${detail.name}`;
  return FIELD_LABEL[detail.name] ?? detail.name;
}

function formatValue(val: string | null): string {
  if (val === null || val === '') return '—';
  if (val === '1' || val === 'true') return 'Oui';
  if (val === '0' || val === 'false') return 'Non';
  // done_ratio is a number
  if (/^\d+$/.test(val) && val.length <= 3) return `${val}%` ;
  return val;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');
}

const AVATAR_COLORS = [
  'bg-sky-100 text-sky-700',
  'bg-violet-100 text-violet-700',
  'bg-amber-100 text-amber-700',
  'bg-emerald-100 text-emerald-700',
  'bg-rose-100 text-rose-700',
  'bg-cyan-100 text-cyan-700',
];

function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function UserAvatar({ name, size = 'sm' }: { name: string; size?: 'sm' | 'md' }) {
  const sz = size === 'sm' ? 'w-7 h-7 text-[10px]' : 'w-9 h-9 text-xs';
  return (
    <div className={cn('rounded-full font-bold flex items-center justify-center flex-shrink-0', sz, avatarColor(name))}>
      {initials(name)}
    </div>
  );
}

interface JournalEntryProps {
  journal: Journal;
  isFirst: boolean;
}

function JournalEntry({ journal, isFirst }: JournalEntryProps) {
  const hasNotes = journal.notes && journal.notes.trim().length > 0;
  const hasDetails = journal.details.length > 0;
  if (!hasNotes && !hasDetails) return null;

  return (
    <div className="flex gap-3">
      {/* Avatar + connector line */}
      <div className="flex flex-col items-center">
        <UserAvatar name={journal.user.name} />
        {!isFirst && <div className="w-px flex-1 bg-stone-100 mt-1" />}
      </div>

      {/* Content bubble */}
      <div className="flex-1 pb-5 min-w-0">
        <div className="flex items-baseline justify-between gap-2 mb-1.5">
          <span className="text-xs font-semibold text-stone-800">{journal.user.name}</span>
          <time className="text-[10px] text-stone-400 flex-shrink-0">
            {formatDateTime(journal.created_on)}
          </time>
        </div>

        {/* Field changes */}
        {hasDetails && (
          <div className="space-y-1 mb-2">
            {journal.details.map((d, i) => (
              <div key={i} className="flex items-center gap-1.5 flex-wrap text-xs">
                <span className="font-medium text-stone-600">{fieldLabel(d)}</span>
                {d.old_value !== null && (
                  <>
                    <span className="text-stone-400 line-through">{formatValue(d.old_value)}</span>
                    <ArrowRight className="w-3 h-3 text-stone-400 flex-shrink-0" />
                  </>
                )}
                <span className={cn(
                  'font-semibold',
                  d.name === 'status_id' ? 'text-primary' : 'text-stone-800',
                )}>
                  {formatValue(d.new_value)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Comment */}
        {hasNotes && (
          <div className="bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-xs text-stone-700 leading-relaxed whitespace-pre-wrap">
            <MessageSquare className="w-3 h-3 inline-block mr-1.5 text-stone-400 -mt-0.5" />
            {journal.notes}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Creation event (synthetic first entry) ───────────────────────────────────

function CreationEntry({ ticket }: { ticket: TicketDetail }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <UserAvatar name={ticket.author.name} />
      </div>
      <div className="flex-1 pb-5">
        <div className="flex items-baseline justify-between gap-2 mb-1.5">
          <span className="text-xs font-semibold text-stone-800">{ticket.author.name}</span>
          <time className="text-[10px] text-stone-400 flex-shrink-0">
            {formatDateTime(ticket.created_on)}
          </time>
        </div>
        <div className="text-xs text-stone-500 italic">
          Ticket #{ticket.id} créé — « {ticket.subject} »
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function TicketHistorySheet({ issueId, redmineBaseUrl, onClose }: TicketHistorySheetProps) {
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!issueId) { setTicket(null); setError(null); return; }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setTicket(null);

    supabase.functions.invoke('fetch-redmine', {
      body: { type: 'issue_detail', issue_id: issueId },
    }).then(({ data, error: err }) => {
      if (cancelled) return;
      if (err) { setError(err.message); setLoading(false); return; }
      if (!data?.issue) { setError('Ticket introuvable.'); setLoading(false); return; }
      setTicket(data.issue as TicketDetail);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [issueId]);

  const priorityColor = (name: string) =>
    /critique|critical|urgent/i.test(name) ? 'bg-red-100 text-red-700 border-red-200'
    : /majeur|haut|high/i.test(name)       ? 'bg-amber-100 text-amber-700 border-amber-200'
    : /faible|bas|low|mineur/i.test(name)  ? 'bg-stone-100 text-stone-500 border-stone-200'
    : 'bg-sky-100 text-sky-700 border-sky-200';

  const statusColor = (name: string) =>
    /ferm|clotur|clos/i.test(name) ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
    : /resolu|resolved/i.test(name) ? 'bg-green-100 text-green-700 border-green-200'
    : /bloqu|attente/i.test(name)   ? 'bg-red-100 text-red-700 border-red-200'
    : /cours/i.test(name)           ? 'bg-amber-100 text-amber-700 border-amber-200'
    : 'bg-blue-100 text-blue-700 border-blue-200';

  // Journals sorted oldest → newest (already from Redmine, but be safe)
  const journals = ticket
    ? [...ticket.journals].sort((a, b) =>
        new Date(a.created_on).getTime() - new Date(b.created_on).getTime())
    : [];

  const redmineTicketUrl = redmineBaseUrl && ticket
    ? `${redmineBaseUrl.replace(/\/projects\/.*/, '')}/issues/${ticket.id}`
    : null;

  return (
    <Sheet open={issueId !== null} onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl p-0 flex flex-col"
        aria-describedby={undefined}
      >
        {/* ── Header ── */}
        <SheetHeader className="px-5 pt-5 pb-4 border-b border-stone-100 flex-shrink-0">
          {loading && !ticket ? (
            <div className="flex items-center gap-2 text-stone-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Chargement du ticket…</span>
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 text-red-500">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">{error}</span>
            </div>
          ) : ticket ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] font-mono text-stone-400">#{ticket.id}</span>
                    <Badge variant="outline" className={cn('text-[10px] px-2 py-0 border', statusColor(ticket.status.name))}>
                      {ticket.status.name}
                    </Badge>
                    <Badge variant="outline" className={cn('text-[10px] px-2 py-0 border', priorityColor(ticket.priority.name))}>
                      {ticket.priority.name}
                    </Badge>
                  </div>
                  <SheetTitle className="text-base font-semibold text-stone-900 leading-snug">
                    {ticket.subject}
                  </SheetTitle>
                </div>
                {redmineTicketUrl && (
                  <a
                    href={redmineTicketUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 flex items-center gap-1 text-[11px] text-primary hover:underline mt-1"
                  >
                    Redmine <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>

              {/* Meta row */}
              <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-[11px] text-stone-500">
                <span className="flex items-center gap-1">
                  <User className="w-3 h-3" />
                  <strong className="text-stone-700">{ticket.assigned_to?.name ?? 'Non assigné'}</strong>
                </span>
                <span>Tracker : <strong className="text-stone-700">{ticket.tracker.name}</strong></span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Créé {formatDate(ticket.created_on)}
                </span>
                <span>Mis à jour {formatDate(ticket.updated_on)}</span>
              </div>

              {/* Progress bar */}
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-stone-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${ticket.done_ratio}%` }}
                  />
                </div>
                <span className="text-[11px] font-medium text-stone-500 tabular-nums w-8 text-right">
                  {ticket.done_ratio}%
                </span>
              </div>
            </>
          ) : null}
        </SheetHeader>

        {ticket && (
          <ScrollArea className="flex-1">
            <div className="px-5 py-4 space-y-5">

              {/* Description */}
              {ticket.description && ticket.description.trim() && (
                <section>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-400 mb-2">Description</p>
                  <div className="text-sm text-stone-700 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2.5 leading-relaxed whitespace-pre-wrap">
                    {ticket.description}
                  </div>
                </section>
              )}

              <Separator />

              {/* History timeline */}
              <section>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-400 mb-3">
                  Historique
                  <span className="ml-1.5 text-stone-300 font-normal normal-case tracking-normal">
                    ({journals.filter(j => j.notes || j.details.length).length + 1} entrée{journals.filter(j => j.notes || j.details.length).length > 0 ? 's' : ''})
                  </span>
                </p>

                {/* Timeline: oldest first, creation at bottom */}
                <div className="flex flex-col-reverse gap-0">
                  {/* Newest entries first (reversed display) */}
                  {journals.map((j, idx) => (
                    <JournalEntry
                      key={j.id}
                      journal={j}
                      isFirst={idx === journals.length - 1}
                    />
                  ))}
                  {/* Creation is always the oldest */}
                  <CreationEntry ticket={ticket} />
                </div>

                {journals.filter(j => j.notes || j.details.length).length === 0 && (
                  <p className="text-xs text-stone-400 italic mt-2">Aucune modification enregistrée.</p>
                )}
              </section>

              {/* Attachments */}
              {ticket.attachments.length > 0 && (
                <>
                  <Separator />
                  <section>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-400 mb-2">
                      Pièces jointes ({ticket.attachments.length})
                    </p>
                    <div className="space-y-2">
                      {ticket.attachments.map(att => (
                        <a
                          key={att.id}
                          href={att.content_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2.5 bg-stone-50 hover:bg-stone-100 border border-stone-200 rounded-lg px-3 py-2 text-xs transition-colors"
                        >
                          <Paperclip className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-stone-800 truncate">{att.filename}</div>
                            <div className="text-stone-400 text-[10px]">
                              {formatFileSize(att.filesize)} · {att.author.name} · {formatDate(att.created_on)}
                            </div>
                          </div>
                          <ExternalLink className="w-3 h-3 text-stone-300 flex-shrink-0" />
                        </a>
                      ))}
                    </div>
                  </section>
                </>
              )}

              {/* Hours row */}
              {(ticket.estimated_hours || ticket.spent_hours) && (
                <>
                  <Separator />
                  <section className="flex gap-6 text-xs text-stone-500">
                    {ticket.estimated_hours ? (
                      <span>Estimé : <strong className="text-stone-700">{ticket.estimated_hours}h</strong></span>
                    ) : null}
                    {ticket.spent_hours ? (
                      <span>Passé : <strong className="text-stone-700">{ticket.spent_hours}h</strong></span>
                    ) : null}
                  </section>
                </>
              )}

              {/* Bottom spacer */}
              <div className="h-4" />
            </div>
          </ScrollArea>
        )}

        {/* Loading overlay while refreshing */}
        {loading && ticket && (
          <div className="absolute inset-0 bg-white/60 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
