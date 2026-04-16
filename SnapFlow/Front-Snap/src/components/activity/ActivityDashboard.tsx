import { useRef, useMemo, useState, useCallback } from 'react';
import {
  PieChart, Pie, Cell, Tooltip as ReTooltip, ResponsiveContainer,
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  BarChart, Bar,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
} from 'recharts';
import {
  Download, Loader2, TrendingDown, TrendingUp, Minus, LayoutDashboard,
  Lightbulb, AlertTriangle, CheckCircle, Info, Archive, X, HelpCircle,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PdfSlides } from './pdf/PdfSlides';
import { PdfExportModal } from './pdf/PdfExportModal';
import { format, differenceInDays, startOfWeek } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

// ─── Brand palette (SnapFlow primary hsl 187 85% 40% ≈ #0e9fb0) ──────────────

const BRAND   = '#0e9fb0';
const GREEN   = '#16a34a';
const RED     = '#dc2626';
const AMBER   = '#d97706';
const BLUE    = '#2563eb';
const STONE   = '#78716c';
const STONE_L = '#d6d3d1';

const STATUS_COLOR: Record<string, string> = {
  'Nouveau': BLUE,    'New': BLUE,
  'En cours': AMBER,  'In Progress': AMBER,
  'Fermé': GREEN,     'Closed': GREEN,
  'Résolu': GREEN,    'Resolved': GREEN,
  'Rejeté': STONE,    'Rejected': STONE,
  'Bloqué': RED,      'Blocked': RED,
};
const STATUS_FALLBACK = [BRAND, STONE, STONE_L, '#0284c7', '#7c3aed'];
const TRACKER_COLORS  = [BRAND, '#0284c7', '#0369a1', '#0891b2', STONE];
const PRIORITY_COLOR  = (name: string): string =>
  /critique|critical|urgent|immédiat|immediate/i.test(name) ? RED :
  /majeur|haut|high/i.test(name) ? AMBER :
  /faible|bas|basse|low|mineur/i.test(name) ? STONE_L : BRAND;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RedmineIssue {
  id: number;
  subject: string;
  status: { id: number; name: string };
  tracker: { id: number; name: string };
  priority: { id: number; name: string };
  assigned_to?: { id: number; name: string };
  author: { id: number; name: string };
  created_on: string;
  updated_on: string;
  done_ratio: number;
  estimated_hours?: number;
  spent_hours?: number;
}

export interface DashboardProject {
  id: string;
  site_name: string;
  url: string;
  redmine_url?: string | null;
}

interface Props {
  issues: RedmineIssue[];
  totalCount: number;
  project: DashboardProject;
  dateFrom?: string;
  dateTo?: string;
  isLoading?: boolean;
  onSnapshotSaved?: () => void;
}

type FilterDimension = 'status' | 'tracker' | 'priority';
type ActiveFilter = { dimension: FilterDimension; value: string } | null;
type InsightLevel = 'positive' | 'negative' | 'warning' | 'info';

interface Insight {
  level: InsightLevel;
  title: string;
  text: string;
}

interface RadarAxisData {
  axis: string;
  value: number;
  detail: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Strip all diacritical marks so é/è/ê all collapse to plain ASCII e.
// This makes every comparison immune to NFC vs NFD encoding from Redmine.
const deAccent = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// "Clôturé" → NFD strip → "cloture" → needs "clotur" stem
// "Fermé"   → NFD strip → "ferme"  → needs "ferm"   stem
// "Résolu"  → NFD strip → "resolu" → needs "resolu"  stem
const isResolved     = (s: string): boolean => /ferm|clotur|clos|resolu|resolved|reject|valid/.test(deAccent(s));
// Truly closed/validated by client — ticket lifecycle is fully done
const isClosed       = (s: string): boolean => /ferm|clotur|clos|reject|valid/.test(deAccent(s));
// Resolved by the team but NOT yet validated by client (waiting for client sign-off)
const isResolvedOnly = (s: string): boolean => /resolu|resolved/.test(deAccent(s)) && !isClosed(s);
// Catch any status that indicates a ticket is stuck/waiting:
// « Bloqué », « En attente », « En hold », « Feedback », « Suspendu »…
const isBlocked  = (s: string): boolean =>
  /bloqu|attente|hold|feedback|suspendu|suspend|en cours de valid/.test(deAccent(s));
const isCritical = (p: string): boolean => /critique|critical|urgent|immediat|immediate/.test(deAccent(p));
const isHigh     = (p: string): boolean => /majeur|haut|high/.test(deAccent(p));

function groupByWeek(issues: RedmineIssue[]): { week: string; count: number }[] {
  const sorted = [...issues].sort((a, b) =>
    new Date(a.created_on).getTime() - new Date(b.created_on).getTime());
  const ordered: string[] = [];
  const map = new Map<string, number>();
  for (const issue of sorted) {
    const key = format(startOfWeek(new Date(issue.created_on), { weekStartsOn: 1 }), 'dd/MM');
    if (!map.has(key)) ordered.push(key);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return ordered.map(k => ({ week: k, count: map.get(k)! }));
}

function countBy<T>(arr: T[], key: (item: T) => string): { name: string; count: number }[] {
  const map = new Map<string, number>();
  for (const item of arr) {
    const k = key(item).normalize('NFC'); // collapse NFD variants from Redmine API
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: number | string;
  sub?: string;
  trend?: 'positive' | 'negative' | 'neutral';
  variant?: 'success';
  accentClass?: string;
  onClick?: () => void;
  active?: boolean;
  tooltip?: string;
}

function KpiCard({ label, value, sub, trend, variant, accentClass, onClick, active, tooltip }: KpiCardProps) {
  // 'success' variant overrides trend — uses a checkmark to signal "this is a win"
  const isSuccess = variant === 'success';
  const Icon = isSuccess ? CheckCircle
    : trend === 'positive' ? TrendingDown
    : trend === 'negative' ? TrendingUp
    : Minus;
  const trendColor = isSuccess ? 'text-green-600'
    : trend === 'positive' ? 'text-green-600'
    : trend === 'negative' ? 'text-red-600'
    : 'text-stone-400';
  return (
    <button type="button" onClick={onClick}
      className={cn(
        'border rounded-xl p-4 flex flex-col gap-1.5 text-left transition-all duration-200',
        isSuccess ? 'bg-green-50 border-green-200' : 'bg-white border-stone-200',
        onClick ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5' : 'cursor-default',
        active ? 'ring-2 ring-offset-1 ring-[#0e9fb0]' : '',
      )}>
      <div className="flex items-center gap-1">
        <span className={cn('text-[10px] font-semibold uppercase tracking-widest', isSuccess ? 'text-green-700' : 'text-stone-500')}>{label}</span>
        {tooltip && (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="w-3 h-3 text-stone-400 hover:text-stone-600 cursor-help flex-shrink-0" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[220px] text-xs">{tooltip}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      <div className="flex items-end gap-1.5">
        <span className={cn('text-2xl font-bold tabular-nums leading-none', accentClass ?? (isSuccess ? 'text-green-700' : 'text-stone-800'))}>{value}</span>
        {(isSuccess || trend) && <Icon className={cn('w-3.5 h-3.5 mb-0.5 flex-shrink-0', trendColor)} />}
      </div>
      {sub && <span className={cn('text-[11px] leading-tight', isSuccess ? 'text-green-600 font-medium' : 'text-stone-400')}>{sub}</span>}
    </button>
  );
}

function InsightCard({ insight }: { insight: Insight }) {
  const cfg = {
    positive: { icon: CheckCircle, bg: 'bg-green-50 border-green-200', title: 'text-green-900', text: 'text-green-800', ic: 'text-green-600' },
    negative: { icon: AlertTriangle, bg: 'bg-red-50 border-red-200',   title: 'text-red-900',   text: 'text-red-800',   ic: 'text-red-500'   },
    warning:  { icon: AlertTriangle, bg: 'bg-amber-50 border-amber-200', title: 'text-amber-900', text: 'text-amber-800', ic: 'text-amber-500' },
    info:     { icon: Info, bg: 'bg-sky-50 border-sky-200', title: 'text-sky-900', text: 'text-sky-800', ic: 'text-sky-500' },
  }[insight.level];
  const Icon = cfg.icon;
  return (
    <div className={cn('flex items-start gap-2.5 border rounded-lg px-3 py-3', cfg.bg)}>
      <Icon className={cn('w-4 h-4 flex-shrink-0 mt-0.5', cfg.ic)} />
      <div className="flex flex-col gap-0.5">
        <span className={cn('text-[11px] font-semibold leading-snug', cfg.title)}>{insight.title}</span>
        <p className={cn('text-xs leading-relaxed', cfg.text)}>{insight.text}</p>
      </div>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-bold text-stone-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
      {children}
    </h3>
  );
}

interface LegendDotProps {
  color: string; label: string; count: number;
  active: boolean; hidden: boolean;
  onClick: () => void; onDoubleClick: () => void;
}
function LegendDot({ color, label, count, active, hidden, onClick, onDoubleClick }: LegendDotProps) {
  return (
    <button type="button" onClick={onClick} onDoubleClick={onDoubleClick}
      title="Clic: filtrer — Double-clic: masquer"
      className={cn(
        'flex items-center justify-between gap-2 w-full px-2 py-1 rounded-md text-xs transition-all duration-150 hover:bg-stone-100',
        active && 'bg-stone-100 font-semibold',
        hidden && 'opacity-30 line-through',
      )}>
      <div className="flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
        <span className="text-stone-600">{label}</span>
      </div>
      <span className="tabular-nums text-stone-500 font-medium">{count}</span>
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ActivityDashboard({ issues, totalCount, project, dateFrom, dateTo, isLoading, onSnapshotSaved }: Props) {
  const dashboardRef = useRef<HTMLDivElement>(null);
  const pdfContainerRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>(null);
  const [hiddenItems, setHiddenItems] = useState<Set<string>>(new Set());
  const [hoveredPieIndex, setHoveredPieIndex] = useState<number | null>(null);
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [pdfSections, setPdfSections] = useState<Record<string, boolean>>({
    separateurs: true, perimetre: true, indicateurs: true,
    sommaire: true, statuts: true, perStatus: true, bloqueSynth: true, reunions: true,
    evolution: true, trackers: true,
    priorities: true, health: true, insights: true, merci: true,
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pdfColor, setPdfColor]         = useState(BRAND);
  const [coverKpis, setCoverKpis]       = useState<Record<string, boolean>>({
    total: true, open: true, resolved: true, critical: true, blocked: true, closure: true,
  });
  const [pdfBrandLeft,  setPdfBrandLeft]  = useState("RAPPORT D'ACTIVIT\u00C9");
  const [pdfBrandRight, setPdfBrandRight] = useState('SNAPFLOW');
  const [pdfContactEmail, setPdfContactEmail] = useState('');
  const [pdfContactWeb,   setPdfContactWeb]   = useState('');
  const [pdfContactWeb2,  setPdfContactWeb2]  = useState('');

  // ── Filtered dataset ─────────────────────────────────────────────────────

  // Actual date span of the full dataset (used when no filter is applied)
  const { dataMinDate, dataMaxDate } = useMemo(() => {
    if (!issues.length) return { dataMinDate: null, dataMaxDate: null };
    const dates = issues.map(i => new Date(i.created_on).getTime());
    return {
      dataMinDate: new Date(Math.min(...dates)),
      dataMaxDate: new Date(Math.max(...dates)),
    };
  }, [issues]);

  const filteredIssues = useMemo((): RedmineIssue[] => {
    if (!activeFilter) return issues;
    return issues.filter(i => {
      if (activeFilter.dimension === 'status')   return i.status.name   === activeFilter.value;
      if (activeFilter.dimension === 'tracker')  return i.tracker.name  === activeFilter.value;
      if (activeFilter.dimension === 'priority') return i.priority.name === activeFilter.value;
      return true;
    });
  }, [issues, activeFilter]);

  // ── KPI metrics ──────────────────────────────────────────────────────────

  const total    = filteredIssues.length;
  const open     = useMemo(() => filteredIssues.filter(i => !isResolved(i.status.name)).length, [filteredIssues]);
  const blocked  = useMemo(() => filteredIssues.filter(i => isBlocked(i.status.name)).length, [filteredIssues]);
  const critical = useMemo(() => filteredIssues.filter(i => isCritical(i.priority.name)).length, [filteredIssues]);

  // Tickets that are marked Résolu (team-resolved) but still awaiting client validation, sitting there >2 days
  const pendingValidation = useMemo(
    () => filteredIssues.filter(i =>
      isResolvedOnly(i.status.name) &&
      differenceInDays(Date.now(), new Date(i.updated_on).getTime()) > 2,
    ),
    [filteredIssues],
  );
  const closedCount = useMemo(() => filteredIssues.filter(i => isClosed(i.status.name)).length, [filteredIssues]);
  const resolvedOnlyCount = useMemo(() => filteredIssues.filter(i => isResolvedOnly(i.status.name)).length, [filteredIssues]);
  const resolved = closedCount + resolvedOnlyCount;

  // Average days from creation to team-resolved (not yet client-validated)
  const avgResolutionDays = useMemo((): number | null => {
    const cl = filteredIssues.filter(i => isResolvedOnly(i.status.name));
    if (!cl.length) return null;
    return Math.max(0, Math.round(
      cl.reduce((s, i) => s + differenceInDays(new Date(i.updated_on), new Date(i.created_on)), 0) / cl.length,
    ));
  }, [filteredIssues]);

  // Average days from creation to fully closed/validated by client
  const avgClosureDays = useMemo((): number | null => {
    const cl = filteredIssues.filter(i => isClosed(i.status.name));
    if (!cl.length) return null;
    return Math.max(0, Math.round(
      cl.reduce((s, i) => s + differenceInDays(new Date(i.updated_on), new Date(i.created_on)), 0) / cl.length,
    ));
  }, [filteredIssues]);

  const avgDaysOpen = useMemo((): number | null => {
    const op = filteredIssues.filter(i => !isResolved(i.status.name));
    if (!op.length) return null;
    const now = Date.now();
    return Math.max(0, Math.round(
      op.reduce((s, i) => s + differenceInDays(now, new Date(i.created_on).getTime()), 0) / op.length,
    ));
  }, [filteredIssues]);

  // ── Chart datasets ────────────────────────────────────────────────────────

  // Debug: log unique status names from the API so we can verify detection logic
  const uniqueStatuses = useMemo(() => {
    const names = [...new Set(issues.map(i => i.status.name))];
    console.log('[ActivityDashboard] statuts Redmine détectés:', names);
    return names;
  }, [issues]);

  const statusData  = useMemo(() => countBy(filteredIssues, i => i.status.name).filter(d => !hiddenItems.has(d.name)), [filteredIssues, hiddenItems]);
  const trackerData = useMemo(() => countBy(filteredIssues, i => i.tracker.name).filter(d => !hiddenItems.has(d.name)), [filteredIssues, hiddenItems]);
  const priorityData = useMemo(
    () => countBy(filteredIssues, i => i.priority.name)
      .map(d => ({ ...d, color: PRIORITY_COLOR(d.name) }))
      .filter(d => !hiddenItems.has(d.name)),
    [filteredIssues, hiddenItems],
  );
  const blockedByTracker = useMemo(
    () => countBy(filteredIssues.filter(i => isBlocked(i.status.name)), i => i.tracker.name),
    [filteredIssues],
  );
  const timelineData = useMemo(() => groupByWeek(filteredIssues), [filteredIssues]);
  const maxTracker   = trackerData[0]?.count ?? 1;

  const statusColorOf = (name: string, idx: number): string => {
    // Normalize to NFC so 'Bloqué' (NFD from Redmine) matches the NFC object keys
    const key = name.normalize('NFC');
    return STATUS_COLOR[key] ?? STATUS_FALLBACK[idx % STATUS_FALLBACK.length];
  };

  // ── Radar axes ────────────────────────────────────────────────────────────

  const radarData = useMemo((): RadarAxisData[] => {
    const safeTotal = Math.max(total, 1);
    const resolutionRate = Math.round((resolved / safeTotal) * 100);
    const trackerBalance = Math.round(Math.max(0, 100 - (maxTracker / safeTotal) * 100));
    const highCount = filteredIssues.filter(i => isHigh(i.priority.name)).length;
    const priorityControl = Math.round(Math.max(0, 100 - ((critical + highCount) / safeTotal) * 100));
    const assigneeCounts = countBy(filteredIssues.filter(i => i.assigned_to), i => i.assigned_to!.name);
    const topAssignee = assigneeCounts[0]?.count ?? 0;
    const topAssigneeName = assigneeCounts[0]?.name;
    const blockedCount = filteredIssues.filter(i => isBlocked(i.status.name)).length;
    const fluencyScore = Math.round(Math.max(0, 100 - (blockedCount / safeTotal) * 100));
    const velocityScore = avgClosureDays === null ? 50 : Math.max(0, 100 - Math.min(avgClosureDays * 3, 100));
    return [
      { axis: 'Résolution',          value: resolutionRate,  detail: `${resolutionRate}% résolus` },
      { axis: 'Équilibre trackers',   value: trackerBalance,  detail: `Dominant: ${trackerData[0]?.name ?? '—'} (${trackerData[0]?.count ?? 0})` },
      { axis: 'Maîtrise priorités',   value: priorityControl, detail: `${critical} critiques` },
      { axis: 'Fluidité',             value: fluencyScore,    detail: blockedCount === 0 ? 'Aucun blocage' : `${blockedCount} bloqué${blockedCount > 1 ? 's' : ''}` },
      { axis: 'Vélocité résolution',  value: velocityScore,   detail: avgClosureDays !== null ? `Clôture moy. ${avgClosureDays}j` : 'N/A' },
    ];
  }, [total, resolved, critical, maxTracker, filteredIssues, trackerData, avgResolutionDays, avgClosureDays]);

  // ── Rule-based insights ───────────────────────────────────────────────────

  const insights = useMemo((): Insight[] => {
    const list: Insight[] = [];
    if (!total) return list;

    // 1 — Tracker hotspot
    if (trackerData[0] && trackerData[0].count / total > 0.4) {
      const pct = Math.round((trackerData[0].count / total) * 100);
      const count = trackerData[0].count;
      list.push({
        level: 'warning',
        title: `Beaucoup de vos demandes concernent un seul domaine`,
        text: `${pct} % de vos demandes (${count} sur ${total}) concernent la catégorie « ${trackerData[0].name} ». `
            + `C'est un volume élevé pour un seul domaine. `
            + `Assurez-vous que ces demandes sont bien suivies et qu'elles avancent dans des délais raisonnables.`,
      });
    }

    // 2 — Resolution rate
    const resRate = resolved / total;
    if (resRate < 0.3) {
      const pending = total - resolved;
      list.push({
        level: 'negative',
        title: `La majorité de vos demandes n'ont pas encore été traitées`,
        text: `Sur ${total} demandes soumises, ${resolved} ont été résolues — ${pending} sont toujours en attente. `
            + `Si certaines de ces demandes vous semblent urgentes ou sans nouvelles depuis longtemps, `
            + `n'hésitez pas à les signaler afin qu'elles soient priorisées.`,
      });
    } else if (resRate > 0.7) {
      list.push({
        level: 'positive',
        title: `Vos demandes sont bien prises en charge`,
        text: `${Math.round(resRate * 100)} % de vos demandes ont été résolues. `
            + `La quasi-totalité de vos problèmes signalés ont reçu une réponse. `
            + `Continuez à soumettre vos demandes dès qu'un nouveau problème se présente.`,
      });
    }

    // 3 — Blocked tickets
    if (blocked > 0) {
      const names = blockedByTracker.slice(0, 2).map(t => `« ${t.name} » (${t.count})`).join(' et ');
      list.push({
        level: 'negative',
        title: `Certaines de vos demandes sont bloquées`,
        text: `${blocked} de vos demande${blocked > 1 ? 's sont bloquées' : ' est bloquée'} et n'avance${blocked > 1 ? 'nt' : ''} pas pour le moment. `
            + (names ? `Cela concerne principalement ${names}. ` : '')
            + `Si vous attendez une réponse sur ces points, signalez-le à votre interlocuteur pour en accélérer le traitement.`,
      });
    }

    // 4 — High critical ratio
    if (critical > 0 && critical / total > 0.15) {
      const pct = Math.round((critical / total) * 100);
      list.push({
        level: 'negative',
        title: `Un grand nombre de vos demandes sont marquées critiques`,
        text: `${pct} % de vos demandes (${critical} sur ${total}) sont classées comme critiques. `
            + `Quand trop de demandes portent ce niveau d'urgence, certaines risquent de ne pas être traitées aussi rapidement que prévu. `
            + `Confirmez avec votre interlocuteur lesquelles doivent absolument être résolues en priorité.`,
      });
    }

    // 5 — Weekly volume trend
    if (timelineData.length >= 2) {
      const last = timelineData[timelineData.length - 1].count;
      const prev = timelineData[timelineData.length - 2].count;
      if (prev > 0) {
        const change = Math.round(((last - prev) / prev) * 100);
        if (change > 25) {
          list.push({
            level: 'warning',
            title: `Vous avez soumis beaucoup plus de demandes cette semaine`,
            text: `${last} nouvelle${last > 1 ? 's' : ''} demande${last > 1 ? 's' : ''} cette semaine, contre ${prev} la semaine précédente — soit une hausse de ${change} %. `
                + `Un suivi rapproché est conseillé pour s'assurer que toutes vos demandes sont bien enregistrées et prises en charge sans délai.`,
          });
        } else if (change < -25) {
          list.push({
            level: 'positive',
            title: `Moins de problèmes signalés cette semaine`,
            text: `Vous avez soumis ${last} demande${last > 1 ? 's' : ''} cette semaine, contre ${prev} la semaine précédente. `
                + `C'est une bonne occasion de vérifier l'état de vos demandes en cours et de confirmer que rien n'est resté sans réponse.`,
          });
        }
      }
    }

    // 6 — Priority calibration
    const topPriority = priorityData[0];
    if (topPriority && topPriority.count / total > 0.65) {
      const pct = Math.round((topPriority.count / total) * 100);
      list.push({
        level: 'info',
        title: `Presque toutes vos demandes ont la même priorité`,
        text: `${pct} % de vos demandes sont classées « ${topPriority.name} ». `
            + `Pour que vos demandes les plus importantes soient traitées en premier, `
            + `il peut être utile de préciser, lors de la soumission, lesquelles sont vraiment urgentes et lesquelles peuvent attendre quelques jours.`,
      });
    }

    // 7 — Old open tickets
    if (avgDaysOpen !== null && avgDaysOpen > 30) {
      list.push({
        level: 'warning',
        title: `Certaines de vos demandes attendent depuis trop longtemps`,
        text: `Vos demandes encore ouvertes ont en moyenne ${avgDaysOpen} jours d'ancienneté. `
            + `Si vous n'avez pas eu de nouvelles sur des points importants, `
            + `n'hésitez pas à relancer votre interlocuteur pour obtenir un état d'avancement.`,
      });
    }

    // 8 — Pending client validation
    if (pendingValidation.length > 0) {
      list.push({
        level: 'warning',
        title: `${pendingValidation.length} demande${pendingValidation.length > 1 ? 's attendent' : ' attend'} votre validation depuis plus de 2 jours`,
        text: `Ces demandes ont été résolues par l'équipe mais ne sont pas encore clôturées. `
            + `Elles sont considérées comme terminées côté technique mais restent ouvertes en attente de votre retour. `
            + `Validez-les ou signalez un problème à votre interlocuteur pour qu'elles puissent être archivées.`,
      });
    }

    return list;
  }, [total, resolved, blocked, critical, trackerData, priorityData, timelineData, blockedByTracker, avgDaysOpen, pendingValidation]);

  // ── Legend interaction ────────────────────────────────────────────────────

  const handleLegendClick = useCallback((dimension: FilterDimension, value: string): void => {
    setActiveFilter(prev => prev?.dimension === dimension && prev.value === value ? null : { dimension, value });
  }, []);

  const handleLegendDoubleClick = useCallback((value: string): void => {
    setHiddenItems(prev => { const n = new Set(prev); n.has(value) ? n.delete(value) : n.add(value); return n; });
  }, []);

  const clearFilter = useCallback((): void => setActiveFilter(null), []);

  // ── PDF export ───────────────────────────────────────────────────────────

  const handleExportPDF = (): void => { setShowPdfModal(true); };

  const doExportPDF = async (): Promise<void> => {
    if (!pdfContainerRef.current) return;
    setShowPdfModal(false);
    setIsExporting(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF('l', 'mm', 'a4');
      const pw = pdf.internal.pageSize.getWidth();
      const ph = pdf.internal.pageSize.getHeight();
      const slides = Array.from(pdfContainerRef.current.querySelectorAll<HTMLElement>('[data-pdf-slide]'))
        .filter(el => {
          const key = el.getAttribute('data-pdf-slide');
          return key === 'cover' || pdfSections[key ?? ''] === true;
        });
      for (let i = 0; i < slides.length; i++) {
        const canvas = await html2canvas(slides[i], { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false });
        if (i > 0) pdf.addPage();
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pw, ph);
      }
      pdf.save(`rapport-${project.site_name.replace(/\s+/g, '-').toLowerCase()}-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
    } catch (err) { console.error('PDF export failed', err); }
    finally { setIsExporting(false); }
  };

  // ── Save snapshot ────────────────────────────────────────────────────────

  const handleSaveSnapshot = async (): Promise<void> => {
    setIsSaving(true);
    try {
      await supabase.from('activity_reports').insert({
        project_id: project.id,
        report_data: {
          type: 'dashboard_snapshot',
          issues: filteredIssues,
          totalCount,
          kpis: { total, open, resolved, blocked, critical, avgResolutionDays, avgClosureDays, avgDaysOpen },
          insights: insights.map(i => i.text),
          generatedAt: new Date().toISOString(),
        },
        filters: activeFilter ?? {},
        ticket_count: filteredIssues.length,
      } as never);
      onSnapshotSaved?.();
    } catch (err) { console.error('Snapshot save failed', err); }
    finally { setIsSaving(false); }
  };

  // ── Guards ───────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-stone-500">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: BRAND }} />
        <span className="text-sm">Chargement des données…</span>
      </div>
    );
  }
  if (!issues.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-stone-500">
        <LayoutDashboard className="w-10 h-10 text-stone-400" />
        <span className="text-sm">Aucun ticket pour générer le tableau de bord.</span>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Report header */}
      <div className="bg-white border border-stone-200 rounded-xl px-6 py-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-stone-400 mb-1">
              Rapport d'activité
            </p>
            <h1 className="text-2xl font-bold text-stone-900 leading-snug">
              {project.site_name}
            </h1>
            <p className="mt-2 text-sm text-stone-600 leading-relaxed max-w-2xl">
              Ce rapport présente une synthèse de l'activité des demandes enregistrées
              {dateFrom || dateTo
                ? <> pour la période du{' '}
                    <span className="font-medium text-stone-800">
                      {dateFrom ? format(new Date(dateFrom), 'dd MMMM yyyy', { locale: fr }) : '—'}
                    </span>
                    {' '}au{' '}
                    <span className="font-medium text-stone-800">
                      {dateTo ? format(new Date(dateTo), 'dd MMMM yyyy', { locale: fr }) : '—'}
                    </span>
                  </>
                : <> sur l'ensemble des périodes disponibles</>
              }.{' '}
              Il porte sur{' '}
              <span className="font-medium text-stone-800">
                {totalCount} demande{totalCount !== 1 ? 's' : ''}
              </span>
              {' '}enregistrées dans le système de suivi.
              {totalCount !== issues.length && (
                <>{' '}La vue courante inclut{' '}
                  <span className="font-medium text-stone-800">{issues.length} demande{issues.length !== 1 ? 's' : ''}</span>
                  {' '}après application des filtres.</>
              )}
            </p>
          </div>
          <div className="flex-shrink-0 text-right">
            <p className="text-[11px] text-stone-400 leading-relaxed">
              Généré le<br />
              <span className="font-medium text-stone-600">
                {format(new Date(), 'dd MMMM yyyy', { locale: fr })} à {format(new Date(), 'HH:mm')}
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* PDF Export Modal */}
      <PdfExportModal
        open={showPdfModal}
        onOpenChange={setShowPdfModal}
        pdfSections={pdfSections}
        setPdfSections={setPdfSections}
        showAdvanced={showAdvanced}
        setShowAdvanced={setShowAdvanced}
        pdfColor={pdfColor}
        setPdfColor={setPdfColor}
        coverKpis={coverKpis}
        setCoverKpis={setCoverKpis}
        pdfBrandLeft={pdfBrandLeft}
        setPdfBrandLeft={setPdfBrandLeft}
        pdfBrandRight={pdfBrandRight}
        setPdfBrandRight={setPdfBrandRight}
        pdfContactEmail={pdfContactEmail}
        setPdfContactEmail={setPdfContactEmail}
        pdfContactWeb={pdfContactWeb}
        setPdfContactWeb={setPdfContactWeb}
        pdfContactWeb2={pdfContactWeb2}
        setPdfContactWeb2={setPdfContactWeb2}
        isExporting={isExporting}
        doExportPDF={doExportPDF}
      />

      {/* Toolbar */}
      <div className="flex items-center justify-end flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={handleSaveSnapshot} disabled={isSaving}
          className="border-stone-200 text-stone-700 hover:bg-stone-50">
          {isSaving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Archive className="w-3.5 h-3.5 mr-1.5" />}
          Archiver
        </Button>
        <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={isExporting}
          className="border-stone-200 text-stone-700 hover:bg-stone-50">
          {isExporting ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1.5" />}
          Export PDF
        </Button>
      </div>

      {/* Active filter banner */}
      {activeFilter && (
        <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border"
          style={{ background: `${BRAND}14`, borderColor: `${BRAND}40`, color: BRAND }}>
          <Info className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Filtre actif : <strong>{activeFilter.dimension}</strong> = <strong>{activeFilter.value}</strong> — toutes les métriques sont recalculées sur ce segment.</span>
          <button onClick={clearFilter} className="ml-auto hover:opacity-70"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* ⚠ Pending validation alert */}
      {pendingValidation.length > 0 && (
        <div className="border border-amber-300 bg-amber-50 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-900">
                {pendingValidation.length} demande{pendingValidation.length > 1 ? 's résolues attendent' : ' résolue attend'} votre validation depuis plus de 2 jours
              </p>
              <p className="text-xs text-amber-700 mt-0.5 mb-2">
                Ces demandes ont été marquées « Résolu » par l’équipe mais restent ouvertes. Validez-les ou signalez un problème à votre interlocuteur pour les clôturer.
              </p>
              <div className="flex flex-col gap-1">
                {pendingValidation.slice(0, 5).map(i => (
                  <div key={i.id} className="flex items-center justify-between gap-3 bg-amber-100 rounded-lg px-3 py-1.5 text-xs">
                    <span className="font-medium text-amber-900 truncate">#{i.id} — {i.subject}</span>
                    <span className="text-amber-600 whitespace-nowrap flex-shrink-0">
                      {differenceInDays(Date.now(), new Date(i.updated_on).getTime())} j sans validation
                    </span>
                  </div>
                ))}
                {pendingValidation.length > 5 && (
                  <p className="text-xs text-amber-600 mt-0.5">+ {pendingValidation.length - 5} autre{pendingValidation.length - 5 > 1 ? 's' : ''}…</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Dashboard capture zone */}
      <div ref={dashboardRef} className="bg-stone-50 rounded-xl p-5 space-y-5">

        {/* ── Intro summary ── */}
        <p className="text-xs text-stone-500 leading-relaxed border-l-2 pl-3" style={{ borderColor: BRAND }}>
          Ce rapport présente une synthèse de l'activité des demandes enregistrées
          {dateFrom && dateTo
            ? ` du ${format(new Date(dateFrom), 'dd MMMM yyyy', { locale: fr })} au ${format(new Date(dateTo), 'dd MMMM yyyy', { locale: fr })}`
            : dataMinDate && dataMaxDate
              ? ` du ${format(dataMinDate, 'dd MMMM yyyy', { locale: fr })} au ${format(dataMaxDate, 'dd MMMM yyyy', { locale: fr })}`
              : ' sur l\u2019ensemble des p\u00e9riodes disponibles'}.
          {' '}Il porte sur <span className="font-semibold text-stone-700">{totalCount} demande{totalCount !== 1 ? 's' : ''}</span> enregistrée{totalCount !== 1 ? 's' : ''} dans le système de suivi.
          {total !== totalCount && (
            <> La vue courante inclut <span className="font-semibold text-stone-700">{total} demande{total !== 1 ? 's' : ''}</span> après application des filtres.</>
          )}
        </p>

        {/* ── Row 1: KPI strip ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <KpiCard label="Total" value={totalCount} sub="scope complet"
            tooltip="Nombre total de demandes enregistrées dans le système de suivi." />
          <KpiCard label="Ouverts" value={open}
            sub={`${Math.round((open / Math.max(total, 1)) * 100)} % de la vue`}
            trend={open > resolved ? 'negative' : 'neutral'}
            tooltip="Demandes ouvertes, en cours de traitement ou en attente." />
          <KpiCard label="Clôturés" value={closedCount}
            sub={`${Math.round((closedCount / Math.max(total, 1)) * 100)} % — validés client`}
            variant="success"
            tooltip="Demandes entièrement résolues et validées par le client. État final positif." />
          <KpiCard label="Résolus" value={resolvedOnlyCount}
            sub={resolvedOnlyCount > 0 ? 'En attente validation' : 'Aucun'}
            trend={resolvedOnlyCount > 0 ? 'neutral' : 'positive'}
            accentClass={resolvedOnlyCount > 0 ? 'text-blue-600' : undefined}
            tooltip="Résolus par l'équipe mais pas encore validés par le client." />
          <KpiCard label="⚠ À valider (+2j)" value={pendingValidation.length}
            sub={pendingValidation.length > 0 ? 'Action requise' : 'Aucun en retard'}
            trend={pendingValidation.length > 0 ? 'negative' : 'positive'}
            accentClass={pendingValidation.length > 0 ? 'text-amber-600' : undefined}
            tooltip="Demandes marquées Résolu depuis plus de 2 jours sans validation de votre part." />
          <KpiCard label="Critiques" value={critical}
            sub={critical > 0 ? `${Math.round((critical / Math.max(total, 1)) * 100)} % — urgent` : 'Aucun'}
            trend={critical > 0 ? 'negative' : 'positive'}
            accentClass={critical > 0 ? 'text-red-600' : undefined}
            tooltip="Demandes à priorité Critique ou Urgente nécessitant une intervention immédiate." />
          <KpiCard label="Moy. clôture"
            value={avgClosureDays !== null ? `${avgClosureDays}j` : '—'}
            sub={
              avgClosureDays !== null
                ? avgResolutionDays !== null
                  ? `Résolu à ${avgResolutionDays}j · clôturé à ${avgClosureDays}j`
                  : `sur ${closedCount} clôturé${closedCount !== 1 ? 's' : ''}`
                : 'Aucun clôturé'
            }
            trend={avgClosureDays !== null ? (avgClosureDays <= 3 ? 'positive' : avgClosureDays <= 14 ? 'neutral' : 'negative') : 'neutral'}
            tooltip="Délai moyen jusqu'au ticket clôturé (validé client). La sous-ligne compare avec le délai de résolution équipe." />
        </div>

        {/* ── Row 2: Status donut + Timeline ── */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">

          {/* Donut */}
          <div className="md:col-span-2 bg-white border border-stone-200 rounded-xl p-5">
            <SectionHeading>Statuts — clic pour filtrer</SectionHeading>
            <div className="relative" style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%" cy="50%"
                    innerRadius={60} outerRadius={82}
                    paddingAngle={2} dataKey="count"
                    animationBegin={0} animationDuration={700}
                    labelLine={false}
                    label={(props: {
                      cx: number; cy: number; midAngle: number;
                      outerRadius: number; name: string; value: number;
                      index: number; percent: number;
                    }) => {
                      const { cx, cy, midAngle, outerRadius, name, value, index, percent } = props;
                      if (percent < 0.03) return null;
                      const RAD = Math.PI / 180;
                      const sin = Math.sin(-midAngle * RAD);
                      const cos = Math.cos(-midAngle * RAD);
                      const ex = cx + (outerRadius + 22) * cos;
                      const ey = cy + (outerRadius + 22) * sin;
                      const ex2 = cx + (outerRadius + 46) * cos;
                      const ey2 = ey;
                      const anchor = cos >= 0 ? 'start' : 'end';
                      const isHovered = hoveredPieIndex === index;
                      const isFilterMatch = activeFilter?.dimension === 'status' && activeFilter.value === name;
                      const isDimmed = (hoveredPieIndex !== null && !isHovered) || (activeFilter?.dimension === 'status' && !isFilterMatch);
                      const opacity = isDimmed ? 0.15 : isHovered || isFilterMatch ? 1 : 0.28;
                      const color = statusColorOf(name, index);
                      return (
                        <g style={{ transition: 'opacity 0.18s', pointerEvents: 'none' }} opacity={opacity}>
                          <line x1={ex} y1={ey} x2={ex2} y2={ey2} stroke={color} strokeWidth={1.2} />
                          <circle cx={ex2} cy={ey2} r={2.5} fill={color} />
                          <text
                            x={ex2 + (cos >= 0 ? 5 : -5)}
                            y={ey2}
                            textAnchor={anchor}
                            dominantBaseline="middle"
                            fill={color}
                            fontSize={10}
                            fontWeight={isHovered || isFilterMatch ? 700 : 500}
                            fontFamily="system-ui,-apple-system,sans-serif"
                          >
                            {name} ({value})
                          </text>
                        </g>
                      );
                    }}
                  >
                    {statusData.map((entry, idx) => {
                      const isFilterDimmed = activeFilter?.dimension === 'status' && activeFilter.value !== entry.name;
                      const isHoverDimmed  = hoveredPieIndex !== null && hoveredPieIndex !== idx;
                      return (
                        <Cell key={idx}
                          fill={statusColorOf(entry.name, idx)}
                          opacity={isFilterDimmed || isHoverDimmed ? 0.25 : 1}
                          style={{ cursor: 'pointer', transition: 'opacity 0.18s' }}
                          onClick={() => handleLegendClick('status', entry.name)}
                          onMouseEnter={() => setHoveredPieIndex(idx)}
                          onMouseLeave={() => setHoveredPieIndex(null)}
                        />
                      );
                    })}
                  </Pie>
                  <ReTooltip formatter={(v: number, n: string) => [v, n]}
                    contentStyle={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 8, fontSize: 12, fontFamily: 'inherit' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex flex-col gap-0.5">
              {countBy(filteredIssues, i => i.status.name).map((entry, idx) => (
                <LegendDot key={entry.name} color={statusColorOf(entry.name, idx)}
                  label={entry.name} count={entry.count}
                  active={activeFilter?.dimension === 'status' && activeFilter.value === entry.name}
                  hidden={hiddenItems.has(entry.name)}
                  onClick={() => handleLegendClick('status', entry.name)}
                  onDoubleClick={() => handleLegendDoubleClick(entry.name)} />
              ))}
            </div>
          </div>

          {/* Timeline */}
          <div className="md:col-span-3 bg-white border border-stone-200 rounded-xl p-5">
            <SectionHeading>Tickets créés par semaine</SectionHeading>
            {timelineData.length < 2 ? (
              <div className="flex items-center justify-center h-48 text-stone-400 text-sm">Données insuffisantes</div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={timelineData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={BRAND} stopOpacity={0.18} />
                      <stop offset="95%" stopColor={BRAND} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
                  <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#a8a29e' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#a8a29e' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <ReTooltip formatter={(v: number) => [v, 'Tickets créés']}
                    contentStyle={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 8, fontSize: 12, fontFamily: 'inherit' }} />
                  <Area type="monotone" dataKey="count" stroke={BRAND} strokeWidth={2.5}
                    fill="url(#areaGrad)" dot={false}
                    activeDot={{ r: 4, fill: BRAND, stroke: '#fff', strokeWidth: 2 }}
                    animationDuration={700} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* ── Row 3: Tracker bars + Priority ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Tracker bars */}
          <div className="bg-white border border-stone-200 rounded-xl p-5">
            <SectionHeading>Trackers — clic pour filtrer</SectionHeading>
            {!trackerData.length ? (
              <div className="text-stone-400 text-sm text-center py-8">Aucune donnée</div>
            ) : (
              <div className="space-y-2.5">
                {countBy(filteredIssues, i => i.tracker.name).map((t, idx) => {
                  const isActive = activeFilter?.dimension === 'tracker' && activeFilter.value === t.name;
                  const isHid = hiddenItems.has(t.name);
                  const pct = Math.round((t.count / Math.max(total, 1)) * 100);
                  return (
                    <button key={t.name} type="button"
                      onClick={() => handleLegendClick('tracker', t.name)}
                      onDoubleClick={() => handleLegendDoubleClick(t.name)}
                      title="Clic: filtrer — Double-clic: masquer"
                      className={cn('w-full text-left space-y-1 rounded-md p-1 -mx-1 transition-colors hover:bg-stone-50', isActive && 'bg-stone-50', isHid && 'opacity-30')}>
                      <div className="flex items-center justify-between text-xs">
                        <span className={cn('text-stone-600 font-medium', isActive && 'font-bold')}>{t.name}</span>
                        <span className="tabular-nums text-stone-500">{t.count} <span className="text-stone-400">({pct}%)</span></span>
                      </div>
                      <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${(t.count / Math.max(maxTracker, 1)) * 100}%`, background: TRACKER_COLORS[idx % TRACKER_COLORS.length] }} />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Priority chart */}
          <div className="bg-white border border-stone-200 rounded-xl p-5">
            <SectionHeading>Priorités — clic pour filtrer</SectionHeading>
            {!priorityData.length ? (
              <div className="text-stone-400 text-sm text-center py-8">Aucune donnée</div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={150}>
                  <BarChart data={priorityData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }} barCategoryGap="30%">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#a8a29e' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#a8a29e' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <ReTooltip formatter={(v: number) => [v, 'Tickets']}
                      contentStyle={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 8, fontSize: 12, fontFamily: 'inherit' }} />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]} animationDuration={600}
                      onClick={(d: { name: string }) => handleLegendClick('priority', d.name)}>
                      {priorityData.map((entry, idx) => (
                        <Cell key={idx} fill={entry.color}
                          opacity={activeFilter?.dimension === 'priority' && activeFilter.value !== entry.name ? 0.25 : 1}
                          style={{ cursor: 'pointer', transition: 'opacity 0.2s' }} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-2 flex flex-wrap gap-x-2 gap-y-0.5">
                  {countBy(filteredIssues, i => i.priority.name).map(p => (
                    <LegendDot key={p.name} color={PRIORITY_COLOR(p.name)} label={p.name} count={p.count}
                      active={activeFilter?.dimension === 'priority' && activeFilter.value === p.name}
                      hidden={hiddenItems.has(p.name)}
                      onClick={() => handleLegendClick('priority', p.name)}
                      onDoubleClick={() => handleLegendDoubleClick(p.name)} />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Row 4: Blocked breakdown + Radar ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Blocked by tracker */}
          <div className="bg-white border border-stone-200 rounded-xl p-5">
            <SectionHeading>Tickets bloqués par tracker</SectionHeading>
            {!blockedByTracker.length ? (
              <div className="flex flex-col items-center justify-center gap-2 h-28 text-sm">
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle className="w-4 h-4" /> Aucun ticket bloqué/en attente
                </div>
                {uniqueStatuses.length > 0 && (
                  <p className="text-[10px] text-stone-400 text-center max-w-xs">
                    Statuts dans les données :{' '}
                    <span className="font-medium text-stone-500">{uniqueStatuses.join(', ')}</span>
                  </p>
                )}
              </div>
            ) : blockedByTracker.length === 1 ? (
              <div className="flex flex-col items-center justify-center gap-0.5 py-3">
                <span className="text-4xl font-bold tabular-nums text-red-600">{blockedByTracker[0].count}</span>
                <span className="text-sm font-medium text-stone-600">{blockedByTracker[0].name}</span>
                <span className="text-[10px] text-stone-400">ticket{blockedByTracker[0].count !== 1 ? 's' : ''} bloqué{blockedByTracker[0].count !== 1 ? 's' : ''}</span>
              </div>
            ) : (
              <div className="space-y-2.5">
                {blockedByTracker.map(t => (
                  <div key={t.name} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-stone-700">{t.name}</span>
                      <span className="tabular-nums font-semibold text-red-600">{t.count}</span>
                    </div>
                    <div className="h-1.5 bg-red-50 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${(t.count / Math.max(blockedByTracker[0].count, 1)) * 100}%`, background: RED }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Radar / health chart */}
          <div className="bg-white border border-stone-200 rounded-xl p-5">
            <SectionHeading>Profil de santé (0 → 100, plus = mieux)</SectionHeading>
            <ResponsiveContainer width="100%" height={200}>
              <RadarChart data={radarData} margin={{ top: 8, right: 28, bottom: 8, left: 28 }}>
                <PolarGrid stroke="#e7e5e4" />
                <PolarAngleAxis dataKey="axis" tick={{ fontSize: 10, fill: '#78716c' }} />
                <ReTooltip
                  formatter={(v: number, _n: string, props: { payload?: RadarAxisData }) => [
                    `${v}/100 — ${props.payload?.detail ?? ''}`, '',
                  ]}
                  contentStyle={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 8, fontSize: 11, fontFamily: 'inherit' }} />
                <Radar dataKey="value" stroke={BRAND} fill={BRAND} fillOpacity={0.18}
                  dot={{ r: 3, fill: BRAND }} animationDuration={700} />
              </RadarChart>
            </ResponsiveContainer>
            <div className="mt-3 grid grid-cols-1 gap-1.5">
              {[
                { axis: 'Résolution',         desc: '% de tickets fermés ou clôturés' },
                { axis: 'Équilibre trackers',  desc: 'Diversité des types de demandes' },
                { axis: 'Maîtrise priorités',  desc: 'Peu de tickets critiques ou urgents' },
                { axis: 'Fluidité',            desc: 'Peu ou pas de tickets bloqués en attente' },
                { axis: 'Vélocité résolution', desc: 'Rapidité moyenne de traitement' },
              ].map(({ axis, desc }) => (
                <div key={axis} className="flex items-start gap-2">
                  <span className="mt-0.5 w-2 h-2 rounded-full flex-shrink-0" style={{ background: BRAND }} />
                  <div className="flex flex-col leading-tight">
                    <span className="text-[11px] font-semibold text-stone-600">{axis}</span>
                    <span className="text-[10px] text-stone-400">{desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Row 5: Resolution timing ── */}
        {(avgResolutionDays !== null || avgClosureDays !== null || avgDaysOpen !== null) && (
          <div className="bg-white border border-stone-200 rounded-xl p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-center">
            {avgResolutionDays !== null && (
              <div>
                <span className="text-[10px] font-bold text-stone-500 uppercase tracking-widest block mb-1">Délai moy. résolution équipe</span>
                <span className="text-3xl font-bold tabular-nums text-stone-800">{avgResolutionDays}<span className="text-base font-normal text-stone-500 ml-1">jours</span></span>
                <span className="text-[10px] text-stone-400 mt-0.5 block">Marqué « Résolu » — en attente client</span>
              </div>
            )}
            {avgClosureDays !== null && (
              <div>
                <span className="text-[10px] font-bold text-stone-500 uppercase tracking-widest block mb-1">Délai moy. clôture client</span>
                <span className="text-3xl font-bold tabular-nums" style={{ color: avgClosureDays <= 3 ? '#16a34a' : avgClosureDays <= 14 ? '#d97706' : '#dc2626' }}>{avgClosureDays}<span className="text-base font-normal text-stone-500 ml-1">jours</span></span>
                <span className="text-[10px] text-stone-400 mt-0.5 block">Validé et clôturé par le client</span>
              </div>
            )}
            {avgDaysOpen !== null && (
              <div>
                <span className="text-[10px] font-bold text-stone-500 uppercase tracking-widest block mb-1">Ancienneté moy. tickets ouverts</span>
                <span className="text-3xl font-bold tabular-nums text-stone-800">{avgDaysOpen}<span className="text-base font-normal text-stone-500 ml-1">jours</span></span>
              </div>
            )}
            <p className="text-xs text-stone-400">
              Résolution = marqué « Résolu » par l'équipe. Clôture = validé par le client. Chaque clôturé est résolu, mais l'inverse n'est pas vrai.
            </p>
          </div>
        )}

        {/* ── Row 6: Smart insights ── */}
        {insights.length > 0 && (
          <div className="bg-white border border-stone-200 rounded-xl p-5">
            <SectionHeading>
              <Lightbulb className="w-3.5 h-3.5" style={{ color: BRAND }} />
              Analyse automatique — {insights.length} observation{insights.length !== 1 ? 's' : ''}
            </SectionHeading>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {insights.map((ins, idx) => <InsightCard key={idx} insight={ins} />)}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-1 border-t border-stone-200 text-[10px] text-stone-400">
          <span>Généré le {format(new Date(), 'dd MMMM yyyy à HH:mm', { locale: fr })}</span>
          <span className="font-semibold tracking-wide">SnapFlow</span>
        </div>
      </div>

      {/* ─── Hidden PDF slides rendered off-screen ──────────────────────── */}
      <PdfSlides
        ref={pdfContainerRef}
        cfg={{
          pdfColor, pdfSections, coverKpis,
          pdfBrandLeft, pdfBrandRight,
          pdfContactEmail, pdfContactWeb, pdfContactWeb2,
        }}
        data={{
          project, dateFrom, dateTo, dataMinDate, dataMaxDate,
          totalCount, total, open, resolved, critical, blocked,
          avgResolutionDays, avgClosureDays, avgDaysOpen,
          statusData, timelineData, trackerData, priorityData, radarData,
          filteredIssues, insights,
          assignedTo: countBy(filteredIssues.filter(i => i.assigned_to), i => i.assigned_to!.name)[0]?.name,
          statusColorOf,
          countByFn: countBy,
        }}
      />
    </div>
  );
}
