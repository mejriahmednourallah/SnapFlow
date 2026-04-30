import { useState, useMemo, useEffect } from 'react';
import { type AuditReport } from '@/data/mockAuditData';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { Loader2, CheckCircle2, AlertCircle, Send, MapPin, AlertTriangle } from 'lucide-react';
import { useRedmineIdentifier } from '@/hooks/useRedmineIdentifier';
import { useProjectAssignments } from '@/hooks/useProjectAssignments';
import { searchIssues, createRedmineIssue, fetchRedmineUsers } from '@/services/redmineService';

interface TicketItem {
  findingId: string;
  axisName: string;
  title: string;
  description: string;
  criticality: string;
  priority: string;
  recommendation: string;
}

interface TicketStatus {
  status: 'idle' | 'checking' | 'exists' | 'creating' | 'created' | 'error';
  redmineId?: number;
  redmineStatus?: string;
  error?: string;
}

function getRedmineIssueUrl(issueId?: number): string {
  if (!issueId) return 'https://maintenance.medianet.tn/issues';
  return new URL(String(issueId), 'https://maintenance.medianet.tn/issues/').toString();
}

// Statuses that mean ticket is "closed" and can be recreated
const CLOSED_STATUSES = ['fermé', 'closed', 'résolu', 'resolved', 'bloqué', 'blocked', 'annulé', 'cancelled', 'rejected', 'rejeté'];
const BATCH_SIZE = 5;

interface Props {
  audit: AuditReport;
  projectUrl?: string;
  projectId?: string;
}

export const TabTickets = ({ audit, projectUrl, projectId }: Props) => {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ticketStatuses, setTicketStatuses] = useState<Map<string, TicketStatus>>(new Map());
  const [creating, setCreating] = useState(false);
  const [autoChecking, setAutoChecking] = useState(false);
  const [assignedRedmineUserId, setAssignedRedmineUserId] = useState<number | null>(null);
  const [assignedUserName, setAssignedUserName] = useState<string | null>(null);

  const tickets: TicketItem[] = useMemo(() => {
    const items: TicketItem[] = [];
    audit.axes.forEach(axis => {
      axis.findings.forEach(f => {
        // Passing KPIs and coverage-only items are informational — never generate tickets
        if (f.status === 'pass' || f.origin === 'passing_kpi' || f.origin === 'coverage') return;
        items.push({
          findingId: `${axis.id}_${f.id}`,
          axisName: axis.name,
          title: `[Audit] ${f.title}`,
          description: f.description,
          criticality: f.criticality,
          priority: f.priority,
          recommendation: f.recommendation,
        });
      });
    });
    return items;
  }, [audit]);

  // Use hooks instead of inline logic
  const projectIdentifier = useRedmineIdentifier(projectUrl);
  const { assignedUser } = useProjectAssignments(projectId);

  // Resolve assigned Redmine user ID from the profile
  useEffect(() => {
    if (!assignedUser) return;
    const resolve = async () => {
      try {
        const redmineUsers = await fetchRedmineUsers();
        const match = redmineUsers.find(u =>
          u.mail?.toLowerCase() === assignedUser.email.toLowerCase() ||
          (`${u.firstname} ${u.lastname}`.toLowerCase() === (assignedUser.full_name || '').toLowerCase())
        );
        if (match) {
          setAssignedRedmineUserId(match.id);
          setAssignedUserName(`${match.firstname} ${match.lastname}`);
        }
      } catch (err) {
        console.error('Error resolving Redmine user:', err);
      }
    };
    resolve();
  }, [assignedUser]);

  // Auto-check existing Redmine tickets on load
  useEffect(() => {
    if (!projectIdentifier || tickets.length === 0) return;
    const checkExistingTickets = async () => {
      setAutoChecking(true);
      const newStatuses = new Map<string, TicketStatus>();

      for (let i = 0; i < tickets.length; i += BATCH_SIZE) {
        const batch = tickets.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(async (ticket) => {
            const issues = await searchIssues(projectIdentifier, ticket.title);
            return { ticket, issues };
          })
        );
        for (const result of results) {
          if (result.status === 'fulfilled') {
            const { ticket, issues } = result.value;
            const activeExisting = issues.find(i => {
              const statusName = i.status?.name?.toLowerCase() || '';
              return !CLOSED_STATUSES.includes(statusName);
            });
            if (activeExisting) {
              newStatuses.set(ticket.findingId, {
                status: 'exists',
                redmineId: activeExisting.id,
                redmineStatus: activeExisting.status?.name,
              });
            }
          }
        }
      }

      if (newStatuses.size > 0) {
        setTicketStatuses(prev => {
          const merged = new Map(prev);
          newStatuses.forEach((v, k) => merged.set(k, v));
          return merged;
        });
      }
      setAutoChecking(false);
    };
    checkExistingTickets();
  }, [projectIdentifier, tickets]);

  const toggleAll = (checked: boolean) => {
    if (checked) {
      setSelected(new Set(tickets.map(t => t.findingId)));
    } else {
      setSelected(new Set());
    }
  };

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = tickets.length > 0 && selected.size === tickets.length;

  const checkAndCreateTickets = async () => {
    if (selected.size === 0 || !projectIdentifier) {
      toast({ title: 'Erreur', description: 'Aucun ticket sélectionné ou projet non identifié.', variant: 'destructive' });
      return;
    }

    setCreating(true);
    const selectedTickets = tickets.filter(t => selected.has(t.findingId));
    const newStatuses = new Map(ticketStatuses);

    for (const ticket of selectedTickets) {
      newStatuses.set(ticket.findingId, { status: 'checking' });
      setTicketStatuses(new Map(newStatuses));

      try {
        // Check if ticket already exists
        const existingIssues = await searchIssues(projectIdentifier, ticket.title);
        const activeExisting = existingIssues.find(i => {
          const statusName = i.status?.name?.toLowerCase() || '';
          return !CLOSED_STATUSES.includes(statusName);
        });

        if (activeExisting) {
          newStatuses.set(ticket.findingId, {
            status: 'exists',
            redmineId: activeExisting.id,
            redmineStatus: activeExisting.status?.name,
          });
          setTicketStatuses(new Map(newStatuses));
          continue;
        }

        // Create ticket
        newStatuses.set(ticket.findingId, { status: 'creating' });
        setTicketStatuses(new Map(newStatuses));

        // Prefer the Supabase project UUID — the edge function resolves it via
        // the local DB (projects.redmine_url) to get the correct Redmine slug,
        // then to the numeric project_id. Falling back to the URL-extracted slug
        // only when no UUID is available.
        const resolvedIdentifier = projectId ?? projectIdentifier;

        const description = `**${ticket.description}**\n\n**Criticité:** ${ticket.criticality}\n**Priorité:** ${ticket.priority}\n**Axe:** ${ticket.axisName}\n\n**Recommandation:**\n${ticket.recommendation}\n\n---\n_Créé automatiquement depuis l'audit Snapflow du ${audit.date}_`;

        const createPayload = {
          projectIdentifier: resolvedIdentifier!,
          subject: ticket.title,
          description,
          assignedToId: assignedRedmineUserId || undefined,
        };

        console.info('[TabTickets][createRedmineIssue] creating ticket — full payload', {
          findingId: ticket.findingId,
          axisName: ticket.axisName,
          projectId_prop: projectId ?? null,
          projectIdentifier_from_url: projectIdentifier ?? null,
          resolved_identifier_sent: resolvedIdentifier,
          subject: createPayload.subject,
          assignedToId: createPayload.assignedToId ?? null,
          descriptionLength: createPayload.description.length,
        });

        const createData = await createRedmineIssue(createPayload);

        if (createData?.issue || createData?.success) {
          console.info('[TabTickets][createRedmineIssue] ticket created', {
            findingId: ticket.findingId,
            subject: ticket.title,
            redmineId: createData.issue?.id ?? null,
            redmineStatus: createData.redmine_status ?? null,
          });
          newStatuses.set(ticket.findingId, { status: 'created', redmineId: createData.issue?.id });
        } else {
          const details = createData?.details as { errors?: string[] } | undefined;
          console.error('[TabTickets][createRedmineIssue] rejected by backend', {
            findingId: ticket.findingId,
            subject: ticket.title,
            projectIdentifier,
            redmineStatus: createData?.redmine_status ?? null,
            edgeError: createData?.error ?? null,
            responsePreview: createData?.response_preview ?? null,
            details: createData?.details ?? null,
          });
          throw new Error(createData?.error || details?.errors?.join(', ') || 'Erreur inconnue');
        }
      } catch (err: any) {
        console.error('[TabTickets][createRedmineIssue] failed', {
          findingId: ticket.findingId,
          subject: ticket.title,
          projectIdentifier,
          message: err?.message || String(err),
          stack: err?.stack || null,
        });
        newStatuses.set(ticket.findingId, { status: 'error', error: err.message || 'Erreur' });
      }

      setTicketStatuses(new Map(newStatuses));
    }

    setCreating(false);
    const createdCount = [...newStatuses.values()].filter(s => s.status === 'created').length;
    const existsCount = [...newStatuses.values()].filter(s => s.status === 'exists').length;
    const errorCount = [...newStatuses.values()].filter(s => s.status === 'error').length;
    toast({ title: 'Traitement terminé', description: `${createdCount} créé(s), ${existsCount} existant(s), ${errorCount} erreur(s)` });
  };

  const getCriticalityColor = (c: string) => {
    switch (c) {
      case 'critical': return 'bg-destructive/15 text-destructive';
      case 'high': return 'bg-orange-500/15 text-orange-600';
      case 'medium': return 'bg-yellow-500/15 text-yellow-600';
      case 'low': return 'bg-emerald-500/15 text-emerald-600';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const getStatusIcon = (findingId: string) => {
    const st = ticketStatuses.get(findingId);
    if (!st) return null;
    switch (st.status) {
      case 'checking':
      case 'creating':
        return <Loader2 className="w-4 h-4 animate-spin text-primary" />;
      case 'exists':
        return (
          <span className="flex items-center gap-1 text-xs text-yellow-600">
            <AlertCircle className="w-3.5 h-3.5" />
            <a href={getRedmineIssueUrl(st.redmineId)} target="_blank" rel="noopener noreferrer" className="hover:underline">
              #{st.redmineId} ({st.redmineStatus})
            </a>
          </span>
        );
      case 'created':
        return (
          <span className="flex items-center gap-1 text-xs text-emerald-600">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <a href={getRedmineIssueUrl(st.redmineId)} target="_blank" rel="noopener noreferrer" className="hover:underline">
              #{st.redmineId}
            </a>
          </span>
        );
      case 'error':
        return <span className="text-xs text-destructive">{st.error}</span>;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Tickets à créer sur Redmine</h3>
          <p className="text-sm text-muted-foreground">
            {tickets.length} point(s) détecté(s) — {selected.size} sélectionné(s)
            {autoChecking && (
              <span className="ml-2 inline-flex items-center gap-1 text-primary">
                <Loader2 className="w-3 h-3 animate-spin" /> Vérification Redmine…
              </span>
            )}
          </p>
          {assignedUserName && (
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <MapPin className="w-3 h-3" /> Assignés à <strong>{assignedUserName}</strong>
            </p>
          )}
        </div>
        <Button
          onClick={checkAndCreateTickets}
          disabled={creating || selected.size === 0 || !projectIdentifier}
          className="flex-shrink-0"
        >
          {creating ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />}
          Créer les tickets ({selected.size})
        </Button>
      </div>

      {!projectIdentifier && (
        <div className="glass-card p-4 text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> Impossible d'identifier le projet Redmine. Vérifiez l'URL du projet.
        </div>
      )}

      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 text-muted-foreground">
                <th className="p-3 w-10">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(checked) => toggleAll(!!checked)}
                  />
                </th>
                <th className="text-left p-3">Point détecté</th>
                <th className="text-left p-3 hidden md:table-cell">Axe</th>
                <th className="text-center p-3">Criticité</th>
                <th className="text-center p-3 hidden sm:table-cell">Priorité</th>
                <th className="text-center p-3 w-32">Statut</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map(t => {
                const st = ticketStatuses.get(t.findingId);
                const isDisabled = st?.status === 'created' || st?.status === 'exists';
                return (
                  <tr key={t.findingId} className={`border-b border-border/30 hover:bg-muted/20 ${isDisabled ? 'opacity-60' : ''}`}>
                    <td className="p-3">
                      <Checkbox
                        checked={selected.has(t.findingId)}
                        onCheckedChange={() => toggleOne(t.findingId)}
                        disabled={isDisabled}
                      />
                    </td>
                    <td className="p-3">
                      <div className="font-medium">{t.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{t.description}</div>
                    </td>
                    <td className="p-3 hidden md:table-cell text-xs text-muted-foreground">{t.axisName}</td>
                    <td className="p-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${getCriticalityColor(t.criticality)}`}>
                        {t.criticality}
                      </span>
                    </td>
                    <td className="p-3 text-center hidden sm:table-cell">
                      <span className="text-xs bg-muted px-2 py-0.5 rounded-full">{t.priority}</span>
                    </td>
                    <td className="p-3 text-center">
                      {autoChecking && !ticketStatuses.get(t.findingId) ? (
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mx-auto" />
                      ) : (
                        getStatusIcon(t.findingId)
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
