import { Document, Page, Text, View, Svg, Circle } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import { format, differenceInDays, startOfWeek } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { PdfTheme } from '@/components/pdf/theme';
import { getStatusColor, makePageStyles } from '@/components/pdf/theme';
import { PageHeader } from '@/components/pdf/shared/PageHeader';
import { PageFooter } from '@/components/pdf/shared/PageFooter';
import { SectionTitle } from '@/components/pdf/shared/SectionTitle';
import { ScoreGauge } from '@/components/pdf/shared/ScoreGauge';
import { ProgressBar } from '@/components/pdf/shared/ProgressBar';
import type { RedmineIssue, DashboardProject, ActivityPdfOptions } from './pdfTypes';

interface ActivityDocumentProps {
  project: DashboardProject;
  issues: RedmineIssue[];
  totalCount: number;
  filters?: {
    status?: string;
    tracker?: string;
    dateFrom?: string;
    dateTo?: string;
    statusLabel?: string;
    trackerLabel?: string;
  };
  options: ActivityPdfOptions;
}

type SeverityStatus = 'success' | 'warning' | 'danger';

interface ActivityKpi {
  key: string;
  label: string;
  value: string;
  caption: string;
  status: SeverityStatus;
}

type CountRow = { name: string; count: number; color?: string };

const CHART_COLORS = ['#1E3A5F', '#4E8CCF', '#3B9B86', '#BD8C4F', '#F97316', '#DC2626', '#64748B', '#7C3AED'];
const LANDSCAPE_PAGE = { size: 'A4' as const, orientation: 'landscape' as const };

const clean = (value?: string | null) => (value || '').trim();
const deAccent = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const normalizeLabel = (value: string) => deAccent(value).replace(/\s+/g, ' ').trim();
const matchesExact = (value: string, labels: string[]) => labels.some(label => normalizeLabel(value) === normalizeLabel(label));

const ASCII_STATUS_LABELS = {
  closed: ['Ferme', 'Closed', 'Cloture', 'Resolu'],
  resolvedOnly: ['Resolu'],
  blocked: ['Bloque'],
  testing: ['En cours de test'],
  acknowledged: ['Pris en charge'],
  active: ['En cours de traitement'],
};

const ASCII_TRACKER_LABELS = {
  meetings: ['Reunion', 'Point d echange', "Point d'echange"],
  feature: ['Feature'],
};

const ASCII_PRIORITY_LABELS = {
  critical: ['Critique', 'Critical', 'Urgent', 'Immediat', 'Immediate'],
};

const isClosed = (value: string) => matchesExact(value, ASCII_STATUS_LABELS.closed);
const isResolvedOnly = (value: string) => matchesExact(value, ASCII_STATUS_LABELS.resolvedOnly);
const isBlocked = (value: string) => matchesExact(value, ASCII_STATUS_LABELS.blocked);
const isTesting = (value: string) => matchesExact(value, ASCII_STATUS_LABELS.testing);
const isAcknowledged = (value: string) => matchesExact(value, ASCII_STATUS_LABELS.acknowledged);
const isInProgress = (value: string) => matchesExact(value, ASCII_STATUS_LABELS.active);
const isCritical = (value: string) => matchesExact(value, ASCII_PRIORITY_LABELS.critical);
const isMeeting = (value: string) => matchesExact(value, ASCII_TRACKER_LABELS.meetings);
const isFeature = (value: string) => matchesExact(value, ASCII_TRACKER_LABELS.feature);

function pct(count: number, total: number) {
  if (!total) return 0;
  return Math.round((count / total) * 100);
}

function countBy<T>(items: T[], key: (item: T) => string): CountRow[] {
  const counts = new Map<string, number>();
  items.forEach((item) => {
    const label = clean(key(item)) || 'Non renseigne';
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function groupByWeek(issues: RedmineIssue[]) {
  const counts = new Map<string, number>();
  issues.forEach((issue) => {
    const week = format(startOfWeek(new Date(issue.created_on), { weekStartsOn: 1 }), 'dd/MM');
    counts.set(week, (counts.get(week) || 0) + 1);
  });
  return Array.from(counts.entries()).map(([name, count]) => ({ name, count }));
}

function avgDays(issues: RedmineIssue[]) {
  if (!issues.length) return null;
  const sum = issues.reduce((acc, issue) => {
    return acc + Math.max(0, differenceInDays(new Date(issue.updated_on), new Date(issue.created_on)));
  }, 0);
  return Math.round(sum / issues.length);
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function short(value: string, max = 74) {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function withColors(rows: CountRow[]) {
  return rows.map((row, index) => ({ ...row, color: CHART_COLORS[index % CHART_COLORS.length] }));
}

function buildData(issues: RedmineIssue[], totalCount: number) {
  const total = issues.length;
  const meetings = issues.filter(issue => isMeeting(issue.tracker.name));
  const closedTickets = issues.filter(issue => isClosed(issue.status.name));
  const openTickets = issues.filter(issue => !isClosed(issue.status.name));
  const blockedTickets = issues.filter(issue => isBlocked(issue.status.name));
  const testingTickets = issues.filter(issue => isTesting(issue.status.name));
  const acknowledgedTickets = issues.filter(issue => isAcknowledged(issue.status.name) && !isClosed(issue.status.name) && !isBlocked(issue.status.name));
  const activeTickets = issues.filter(issue =>
    isInProgress(issue.status.name) &&
    !isClosed(issue.status.name) &&
    !isBlocked(issue.status.name) &&
    !isTesting(issue.status.name)
  );
  const criticalIssues = issues.filter(issue => isCritical(issue.priority.name));
  const pendingValidation = issues.filter(issue => isResolvedOnly(issue.status.name) && differenceInDays(Date.now(), new Date(issue.updated_on).getTime()) > 2);
  const blockedFeatureTickets = blockedTickets.filter(issue => isFeature(issue.tracker.name));
  const blockedOtherTickets = blockedTickets.filter(issue => !isFeature(issue.tracker.name));
  const avgResolutionDays = avgDays(closedTickets);
  const avgOpenDays = avgDays(openTickets);
  const health = clamp(100 - pct(blockedTickets.length, Math.max(total, 1)) * 0.5 - pct(criticalIssues.length, Math.max(total, 1)) * 0.35 - Math.min(avgOpenDays || 0, 60) * 0.35);
  const status: SeverityStatus = health >= 75 ? 'success' : health >= 50 ? 'warning' : 'danger';

  const kpis: ActivityKpi[] = [
    { key: 'total', label: 'Tickets', value: String(totalCount || total), caption: totalCount !== total ? `${total} dans la vue filtree` : 'Perimetre complet', status: 'success' },
    { key: 'meetings', label: 'Reunions', value: String(meetings.length), caption: "Points d'echange", status: meetings.length ? 'success' : 'warning' },
    { key: 'open', label: 'Ouverts', value: String(openTickets.length), caption: `${pct(openTickets.length, total)} % des tickets`, status: openTickets.length ? 'warning' : 'success' },
    { key: 'resolved', label: 'Clotures', value: String(closedTickets.length), caption: `${pct(closedTickets.length, total)} % livres`, status: 'success' },
    { key: 'critical', label: 'Critiques', value: String(criticalIssues.length), caption: 'Priorite urgente ou critique', status: criticalIssues.length ? 'danger' : 'success' },
    { key: 'blocked', label: 'Bloques', value: String(blockedTickets.length), caption: 'Tickets en attente', status: blockedTickets.length ? 'danger' : 'success' },
    { key: 'closure', label: 'Delai moyen', value: avgResolutionDays == null ? '-' : `${avgResolutionDays} j`, caption: 'Resolution des tickets clos', status: avgResolutionDays == null || avgResolutionDays <= 7 ? 'success' : avgResolutionDays <= 21 ? 'warning' : 'danger' },
  ];

  const insights = [
    blockedTickets.length > 0 ? `Traiter en priorite les ${blockedTickets.length} ticket(s) bloques ou en attente.` : 'Aucun blocage majeur detecte dans la selection.',
    pendingValidation.length > 0 ? `${pendingValidation.length} ticket(s) resolus attendent une validation client.` : 'Aucun ticket resolu ne semble attendre une validation prolongee.',
    criticalIssues.length > 0 ? `Surveiller les ${criticalIssues.length} ticket(s) critiques pour eviter un impact projet.` : 'La selection ne contient pas de ticket critique.',
  ];

  return {
    total,
    totalCount,
    open: openTickets.length,
    resolved: closedTickets.length,
    blocked: blockedTickets.length,
    critical: criticalIssues.length,
    meetings,
    openTickets,
    closedTickets,
    blockedTickets,
    testingTickets,
    acknowledgedTickets,
    activeTickets,
    pendingValidation,
    blockedFeatureTickets,
    blockedOtherTickets,
    criticalIssues,
    avgResolutionDays,
    avgOpenDays,
    health,
    healthStatus: status,
    kpis,
    statusRows: withColors(countBy(issues, issue => issue.status.name)),
    trackerRows: withColors(countBy(issues, issue => issue.tracker.name)),
    priorityRows: withColors(countBy(issues, issue => issue.priority.name)),
    closedByType: withColors(countBy(closedTickets, issue => issue.tracker.name)),
    openByType: withColors(countBy(openTickets, issue => issue.tracker.name)),
    activeByType: withColors(countBy(activeTickets, issue => issue.tracker.name)),
    blockedByType: withColors(countBy(blockedTickets, issue => issue.tracker.name)),
    blockedByPriority: withColors(countBy(blockedTickets, issue => issue.priority.name)),
    blockedByStatus: withColors(countBy(blockedTickets, issue => issue.status.name)),
    timelineRows: groupByWeek(issues),
    insights,
  };
}

function filterSummary(filters?: ActivityDocumentProps['filters']) {
  const parts = [
    filters?.statusLabel ? `Statut : ${filters.statusLabel}` : null,
    filters?.trackerLabel ? `Tracker : ${filters.trackerLabel}` : null,
    filters?.dateFrom ? `Depuis : ${filters.dateFrom}` : null,
    filters?.dateTo ? `Jusqu'au ${filters.dateTo}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' | ') : 'Tous les tickets disponibles';
}

function periodLabel(filters?: ActivityDocumentProps['filters']) {
  if (filters?.dateFrom && filters?.dateTo) return `Du ${filters.dateFrom} au ${filters.dateTo}`;
  if (filters?.dateFrom) return `Depuis le ${filters.dateFrom}`;
  if (filters?.dateTo) return `Jusqu'au ${filters.dateTo}`;
  return 'Toutes periodes confondues';
}

function EmptyState({ theme, label = 'Aucun element sur cette periode' }: { theme?: PdfTheme; label?: string }) {
  return (
    <View wrap={false} style={{ borderWidth: 0.8, borderColor: theme?.border ?? '#D7E0EA', backgroundColor: theme?.recBg ?? '#F1F4F8', borderRadius: 10, padding: 12 }}>
      <Text style={{ fontSize: 9, color: theme?.textMuted ?? '#64748B' }}>{label}</Text>
    </View>
  );
}

function KpiCard({ item, theme, compact = false }: { item: ActivityKpi; theme?: PdfTheme; compact?: boolean }) {
  const s = makePageStyles(theme);
  const color = getStatusColor(item.status);
  return (
    <View wrap={false} style={{ ...s.card, width: '23.5%', minHeight: compact ? 58 : 62, marginBottom: 7, padding: compact ? 8 : 9 }}>
      <Text style={{ fontSize: 7.2, color: theme?.textMuted ?? '#64748B', textTransform: 'uppercase' }}>{item.label}</Text>
      <Text style={{ fontSize: compact ? 20 : 22, fontFamily: 'DMSans', fontWeight: 700, color, marginTop: 3 }}>{item.value}</Text>
      <Text style={{ fontSize: 7.4, color: theme?.textMuted ?? '#64748B', marginTop: 3 }}>{item.caption}</Text>
    </View>
  );
}

function CounterCard({ label, value, caption, theme, status = 'success' }: { label: string; value: number | string; caption: string; theme?: PdfTheme; status?: SeverityStatus }) {
  return (
    <KpiCard
      compact
      theme={theme}
      item={{ key: label, label, value: String(value), caption, status }}
    />
  );
}

function LegendTable({ rows, theme, total, label = 'Libelle', limit = 9 }: { rows: CountRow[]; theme?: PdfTheme; total: number; label?: string; limit?: number }) {
  const visible = rows.slice(0, limit);
  if (!visible.length) return <EmptyState theme={theme} />;
  const widths = [270, 45, 45];
  return (
    <View wrap={false} style={{ borderWidth: 0.7, borderColor: theme?.border ?? '#D7E0EA', borderRadius: 9, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', backgroundColor: theme?.headerBg ?? '#E7EEF7', paddingVertical: 5, paddingHorizontal: 7 }}>
        <Text style={{ width: widths[0], fontSize: 7.2, fontFamily: 'DMSans', fontWeight: 700, color: theme?.primary ?? '#1E3A5F' }}>{label}</Text>
        <Text style={{ width: widths[1], fontSize: 7.2, fontFamily: 'DMSans', fontWeight: 700, color: theme?.primary ?? '#1E3A5F', textAlign: 'right' }}>Nb</Text>
        <Text style={{ width: widths[2], fontSize: 7.2, fontFamily: 'DMSans', fontWeight: 700, color: theme?.primary ?? '#1E3A5F', textAlign: 'right' }}>%</Text>
      </View>
      {visible.map((row, index) => (
        <View key={`${row.name}-${index}`} style={{ flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 7, borderTopWidth: index ? 0.4 : 0, borderTopColor: theme?.border ?? '#D7E0EA' }}>
          <Text style={{ width: widths[0], fontSize: 7.4, color: theme?.text ?? '#111827' }}>{short(row.name, 48)}</Text>
          <Text style={{ width: widths[1], fontSize: 7.4, color: theme?.text ?? '#111827', textAlign: 'right' }}>{row.count}</Text>
          <Text style={{ width: widths[2], fontSize: 7.4, color: theme?.textMuted ?? '#64748B', textAlign: 'right' }}>{pct(row.count, total)}%</Text>
        </View>
      ))}
    </View>
  );
}

function HorizontalBars({ rows, theme, limit = 8 }: { rows: CountRow[]; theme?: PdfTheme; limit?: number }) {
  const visible = rows.slice(0, limit);
  const max = Math.max(...visible.map(row => row.count), 1);
  if (!visible.length) return <EmptyState theme={theme} />;
  return (
    <View style={{ gap: 6 }}>
      {visible.map((row, index) => (
        <View key={`${row.name}-${index}`}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
            <Text style={{ fontSize: 7.7, color: theme?.text ?? '#111827' }}>{short(row.name, 32)}</Text>
            <Text style={{ fontSize: 7.7, color: theme?.textMuted ?? '#64748B' }}>{row.count}</Text>
          </View>
          <View style={{ height: 8, backgroundColor: theme?.border ?? '#D7E0EA', borderRadius: 5 }}>
            <View style={{ width: `${Math.max(5, (row.count / max) * 100)}%`, height: 8, backgroundColor: row.color ?? theme?.accent ?? '#4E8CCF', borderRadius: 5 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

function VerticalBars({ rows, theme, limit = 7 }: { rows: CountRow[]; theme?: PdfTheme; limit?: number }) {
  const visible = rows.slice(0, limit);
  const max = Math.max(...visible.map(row => row.count), 1);
  if (!visible.length) return <EmptyState theme={theme} />;
  return (
    <View style={{ height: 170, flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingTop: 6 }}>
      {visible.map((row, index) => {
        const height = Math.max(18, (row.count / max) * 132);
        return (
          <View key={`${row.name}-${index}`} style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ fontSize: 8, fontFamily: 'DMSans', fontWeight: 700, color: row.color ?? theme?.accent ?? '#4E8CCF', marginBottom: 3 }}>{row.count}</Text>
            <View style={{ height, width: '70%', backgroundColor: row.color ?? theme?.accent ?? '#4E8CCF', borderRadius: 5 }} />
            <Text style={{ fontSize: 6.5, color: theme?.textMuted ?? '#64748B', textAlign: 'center', marginTop: 4 }}>{short(row.name, 13)}</Text>
          </View>
        );
      })}
    </View>
  );
}

function DonutChart({ rows, theme, size = 132 }: { rows: CountRow[]; theme?: PdfTheme; size?: number }) {
  const visible = rows.filter(row => row.count > 0).slice(0, 6);
  const total = visible.reduce((sum, row) => sum + row.count, 0);
  if (!visible.length || !total) return <HorizontalBars rows={rows} theme={theme} limit={5} />;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <View wrap={false} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
      <Svg width={size} height={size} viewBox="0 0 120 120">
        <Circle cx="60" cy="60" r={radius} stroke={theme?.border ?? '#D7E0EA'} strokeWidth="14" fill="none" />
        {visible.map((row, index) => {
          const length = (row.count / total) * circumference;
          const dashOffset = -offset;
          offset += length;
          return (
            <Circle
              key={`${row.name}-${index}`}
              cx="60"
              cy="60"
              r={radius}
              stroke={row.color ?? CHART_COLORS[index % CHART_COLORS.length]}
              strokeWidth="15"
              fill="none"
              strokeDasharray={`${length} ${circumference}`}
              strokeDashoffset={dashOffset}
              transform="rotate(-90 60 60)"
            />
          );
        })}
        <Circle cx="60" cy="60" r="25" fill={theme?.surface ?? '#FFFFFF'} />
      </Svg>
      <View style={{ flex: 1, gap: 5 }}>
        <Text style={{ fontSize: 16, fontFamily: 'DMSans', fontWeight: 700, color: theme?.primary ?? '#1E3A5F' }}>{total}</Text>
        {visible.map((row, index) => (
          <View key={`${row.name}-${index}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: row.color ?? CHART_COLORS[index % CHART_COLORS.length] }} />
            <Text style={{ fontSize: 7.6, color: theme?.text ?? '#111827', width: 110 }}>{short(row.name, 26)}</Text>
            <Text style={{ fontSize: 7.3, color: theme?.textMuted ?? '#64748B', textAlign: 'right', width: 30 }}>{row.count}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function TicketDetailCard({ issue, theme, emptyLabel }: { issue?: RedmineIssue; theme?: PdfTheme; emptyLabel: string }) {
  if (!issue) return <EmptyState theme={theme} label={emptyLabel} />;
  const s = makePageStyles(theme);
  return (
    <View style={{ ...s.card, padding: 11 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
        <Text style={{ fontSize: 9, fontFamily: 'DMSans', fontWeight: 700, color: theme?.primary ?? '#1E3A5F' }}>#{issue.id}</Text>
        <Text style={{ fontSize: 7.5, color: theme?.textMuted ?? '#64748B' }}>{format(new Date(issue.updated_on), 'dd/MM/yyyy', { locale: fr })}</Text>
      </View>
      <Text style={{ fontSize: 12, fontFamily: 'DMSans', fontWeight: 700, color: theme?.text ?? '#111827', marginBottom: 5 }}>{short(issue.subject, 110)}</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
        <Text style={{ fontSize: 8, color: theme?.textMuted ?? '#64748B' }}>Statut: {issue.status.name}</Text>
        <Text style={{ fontSize: 8, color: theme?.textMuted ?? '#64748B' }}>Type: {issue.tracker.name}</Text>
        <Text style={{ fontSize: 8, color: theme?.textMuted ?? '#64748B' }}>Priorite: {issue.priority.name}</Text>
      </View>
      <View style={{ marginTop: 8 }}>
        <ProgressBar label="Avancement" value={issue.done_ratio} status={issue.done_ratio >= 80 ? 'success' : issue.done_ratio >= 40 ? 'warning' : 'danger'} theme={theme} />
      </View>
    </View>
  );
}

function DenseTicketTable({ issues, theme, title, limit = 15, emptyLabel }: { issues: RedmineIssue[]; theme?: PdfTheme; title: string; limit?: number; emptyLabel?: string }) {
  const rows = issues.slice(0, limit);
  if (!rows.length) return <EmptyState theme={theme} label={emptyLabel} />;
  const widths = [48, 350, 110, 108, 102, 32];
  return (
    <View wrap={false} style={{ borderWidth: 0.7, borderColor: theme?.border ?? '#D7E0EA', borderRadius: 9, overflow: 'hidden' }}>
      <View style={{ backgroundColor: theme?.headerBg ?? '#E7EEF7', padding: 7 }}>
        <Text style={{ fontSize: 9, fontFamily: 'DMSans', fontWeight: 700, color: theme?.primary ?? '#1E3A5F' }}>{title}</Text>
      </View>
      <View style={{ flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 7, borderTopWidth: 0.4, borderTopColor: theme?.border ?? '#D7E0EA' }}>
        {['ID', 'Sujet', 'Statut', 'Type', 'Priorite', '%'].map((label, index) => (
          <Text key={label} style={{ width: widths[index], fontSize: 7.2, color: theme?.textMuted ?? '#64748B', fontFamily: 'DMSans', fontWeight: 700 }}>{label}</Text>
        ))}
      </View>
      {rows.map((issue, index) => (
        <View key={issue.id} wrap={false} style={{ flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 7, borderTopWidth: 0.35, borderTopColor: theme?.border ?? '#D7E0EA', backgroundColor: index % 2 ? theme?.recBg ?? '#F1F4F8' : theme?.surface ?? '#FFFFFF' }}>
          <Text style={{ width: widths[0], fontSize: 7.35 }}>#{issue.id}</Text>
          <Text style={{ width: widths[1], fontSize: 7.35 }}>{short(issue.subject, 94)}</Text>
          <Text style={{ width: widths[2], fontSize: 7.35 }}>{short(issue.status.name, 24)}</Text>
          <Text style={{ width: widths[3], fontSize: 7.35 }}>{short(issue.tracker.name, 22)}</Text>
          <Text style={{ width: widths[4], fontSize: 7.35 }}>{short(issue.priority.name, 22)}</Text>
          <Text style={{ width: widths[5], fontSize: 7.35 }}>{issue.done_ratio}%</Text>
        </View>
      ))}
      {issues.length > limit && (
        <Text style={{ fontSize: 7.2, color: theme?.textMuted ?? '#64748B', padding: 6 }}>+ {issues.length - limit} ticket(s) non affiches pour conserver une page lisible.</Text>
      )}
    </View>
  );
}

function CompactPage({ title, project, theme, children }: { title: string; project: DashboardProject; theme?: PdfTheme; children: ReactNode }) {
  const s = makePageStyles(theme);
  return (
    <Page {...LANDSCAPE_PAGE} style={s.page}>
      <PageHeader title={title} siteName={project.site_name} theme={theme} siteLogoSrc={project.logo_url ?? undefined} />
      <View style={{ paddingHorizontal: 30, gap: 7 }}>
        <SectionTitle title={title} theme={theme} />
        {children}
      </View>
      <PageFooter preparedBy="Medianet x Snapflow App" theme={theme} />
    </Page>
  );
}

function ChartTablePage({
  title, project, theme, rows, total, chart, tableLabel,
}: {
  title: string;
  project: DashboardProject;
  theme?: PdfTheme;
  rows: CountRow[];
  total: number;
  chart: 'donut' | 'vertical' | 'horizontal';
  tableLabel: string;
}) {
  return (
    <CompactPage title={title} project={project} theme={theme}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1.1, backgroundColor: theme?.surface ?? '#FFFFFF', borderColor: theme?.border ?? '#D7E0EA', borderWidth: 0.8, borderRadius: 10, padding: 10 }}>
          {chart === 'donut' && <DonutChart rows={rows} theme={theme} />}
          {chart === 'vertical' && <VerticalBars rows={rows} theme={theme} />}
          {chart === 'horizontal' && <HorizontalBars rows={rows} theme={theme} />}
        </View>
        <View style={{ flex: 1 }}>
          <LegendTable rows={rows} theme={theme} total={total} label={tableLabel} />
        </View>
      </View>
    </CompactPage>
  );
}

function StandardPage({ title, project, theme, children }: { title: string; project: DashboardProject; theme?: PdfTheme; children: ReactNode }) {
  const s = makePageStyles(theme);
  return (
    <Page {...LANDSCAPE_PAGE} style={s.page}>
      <PageHeader title={title} siteName={project.site_name} theme={theme} siteLogoSrc={project.logo_url ?? undefined} />
      <View style={s.body}>{children}</View>
      <PageFooter preparedBy="Medianet x Snapflow App" theme={theme} />
    </Page>
  );
}

export function ActivityDocument({ project, issues, totalCount, filters, options }: ActivityDocumentProps) {
  const theme = options.theme;
  const s = makePageStyles(theme);
  const data = buildData(issues, totalCount);
  const selectedKpis = data.kpis.filter(kpi => options.coverKpis[kpi.key] !== false);
  const enabled = (key: string) => options.sections[key] !== false;

  return (
    <Document title={`Rapport activite - ${project.site_name}`}>
      <Page {...LANDSCAPE_PAGE} style={s.page}>
        <View style={{ backgroundColor: theme?.heroBg ?? '#1E3A5F', minHeight: '100%', padding: 34 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 54 }}>
            <Text style={{ color: '#FFFFFF', fontSize: 9, fontFamily: 'DMSans', fontWeight: 700 }}>{options.brandLeft || "RAPPORT D'ACTIVITE"}</Text>
            <Text style={{ color: '#FFFFFF', fontSize: 9, fontFamily: 'DMSans', fontWeight: 700 }}>{options.brandRight || 'SNAPFLOW'}</Text>
          </View>
          <Text style={{ fontFamily: 'PlayfairDisplay', fontSize: 44, color: '#FFFFFF', lineHeight: 1.08 }}>Rapport{'\n'}d'activite</Text>
          <Text style={{ color: 'rgba(255,255,255,0.82)', fontSize: 13, marginTop: 18 }}>{project.site_name}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 9, marginTop: 8 }}>{periodLabel(filters)}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 8, marginTop: 4 }}>{filterSummary(filters)}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 32 }}>
            {selectedKpis.map(kpi => (
              <View key={kpi.key} wrap={false} style={{ width: '23.2%', minHeight: 72, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 10, padding: 9 }}>
                <Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 7, textTransform: 'uppercase' }}>{kpi.label}</Text>
                <Text style={{ color: '#FFFFFF', fontSize: 21, fontFamily: 'DMSans', fontWeight: 700, marginTop: 3 }}>{kpi.value}</Text>
                <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 7, marginTop: 3 }}>{kpi.caption}</Text>
              </View>
            ))}
          </View>
          <Text style={{ position: 'absolute', bottom: 30, left: 34, color: 'rgba(255,255,255,0.7)', fontSize: 8 }}>
            Genere le {format(new Date(), 'dd MMMM yyyy a HH:mm', { locale: fr })}
          </Text>
        </View>
      </Page>

      {enabled('sommaire') && (
        <StandardPage title="Table des matieres" project={project} theme={theme}>
          <SectionTitle title="Structure du rapport" theme={theme} />
          {[
            'Resume executif',
            'Cadre du rapport',
            'Periode et filtres',
            'Synthese avant analyse',
            'Indicateurs globaux',
            'Etat des tickets',
            'Typologie des tickets',
            'Priorites des tickets',
            'Details par cycle de traitement',
            'Blocages et reunions',
          ].map((section, index) => (
            <View key={section} style={{ ...s.card, flexDirection: 'row', justifyContent: 'space-between', marginBottom: 7, padding: 9 }}>
              <Text style={{ fontSize: 8.8, color: theme?.text ?? '#111827' }}>{section}</Text>
              <Text style={{ fontSize: 8.2, color: theme?.textMuted ?? '#64748B' }}>{String(index + 1).padStart(2, '0')}</Text>
            </View>
          ))}
        </StandardPage>
      )}

      <StandardPage title="Resume executif" project={project} theme={theme}>
        <SectionTitle title="Vue globale" theme={theme} />
        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
          <View style={{ ...s.card, width: 165, alignItems: 'center' }}>
            <ScoreGauge score={data.health} status={data.healthStatus} caption="Score activite" theme={theme} />
          </View>
          <View style={{ ...s.card, flex: 1 }}>
            <Text style={s.h3}>Lecture rapide</Text>
            <Text style={s.bodyText}>
              Le rapport couvre {data.total} ticket(s) pour {project.site_name}. {data.open} restent ouverts, {data.resolved} sont clotures et {data.blocked} demandent une attention particuliere.
            </Text>
            <Text style={{ ...s.textMuted, marginTop: 7 }}>{filterSummary(filters)}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          {data.kpis.map(kpi => <KpiCard key={kpi.key} item={kpi} theme={theme} />)}
        </View>
      </StandardPage>

      <StandardPage title="Cadre du rapport" project={project} theme={theme}>
        <SectionTitle title="Perimetre operationnel" theme={theme} />
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ ...s.card, flex: 1 }}>
            <Text style={s.h3}>Source</Text>
            <Text style={s.bodyText}>Donnees Redmine consolidees pour le projet {project.site_name}. Les tickets sont classes par statut, type, priorite et avancement.</Text>
          </View>
          <View style={{ ...s.card, flex: 1 }}>
            <Text style={s.h3}>Lecture</Text>
            <Text style={s.bodyText}>Les pages suivantes distinguent le travail livre, le travail ouvert, les blocages et les points d'echange de gouvernance.</Text>
          </View>
        </View>
      </StandardPage>

      <StandardPage title="Periode et filtres" project={project} theme={theme}>
        <SectionTitle title="Contexte de generation" theme={theme} />
        <View style={{ ...s.card, marginBottom: 12 }}>
          <Text style={s.h3}>{periodLabel(filters)}</Text>
          <Text style={s.bodyText}>{filterSummary(filters)}</Text>
        </View>
        <View style={{ gap: 9 }}>
          <ProgressBar label="Taux de cloture" value={pct(data.resolved, data.total)} status={data.resolved >= data.open ? 'success' : 'warning'} theme={theme} />
          <ProgressBar label="Tickets ouverts" value={pct(data.open, data.total)} status={data.open ? 'warning' : 'success'} theme={theme} />
          <ProgressBar label="Tickets bloques" value={pct(data.blocked, data.total)} status={data.blocked ? 'danger' : 'success'} theme={theme} />
        </View>
      </StandardPage>

      <StandardPage title="Synthese avant analyse" project={project} theme={theme}>
        <SectionTitle title="Points de pilotage" theme={theme} />
        {data.insights.map(insight => (
          <View key={insight} style={{ ...s.card, marginBottom: 9, padding: 10 }}>
            <Text style={s.bodyText}>{insight}</Text>
          </View>
        ))}
      </StandardPage>

      <CompactPage title="Indicateurs Globaux" project={project} theme={theme}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <CounterCard label="Tickets" value={data.totalCount || data.total} caption="Charge globale" theme={theme} />
          <CounterCard label="Reunions" value={data.meetings.length} caption="Points d'echange" theme={theme} status={data.meetings.length ? 'success' : 'warning'} />
          <CounterCard label="Ouverts" value={data.openTickets.length} caption="Demandes non cloturees" theme={theme} status={data.openTickets.length ? 'warning' : 'success'} />
          <CounterCard label="Bloques" value={data.blockedTickets.length} caption="Actions en attente" theme={theme} status={data.blockedTickets.length ? 'danger' : 'success'} />
        </View>
        <View style={{ ...s.card, padding: 10 }}>
          <Text style={s.bodyText}>Synthese executive de la charge: {data.total} ticket(s) et {data.meetings.length} reunion(s) sur la periode analysee.</Text>
        </View>
      </CompactPage>

      <ChartTablePage title="Etat des Tickets" project={project} theme={theme} rows={data.statusRows} total={data.total} chart="donut" tableLabel="Statut" />
      <ChartTablePage title="Typologie des Tickets" project={project} theme={theme} rows={data.trackerRows} total={data.total} chart="vertical" tableLabel="Categorie" />
      <ChartTablePage title="Priorite des Tickets" project={project} theme={theme} rows={data.priorityRows} total={data.total} chart="horizontal" tableLabel="Priorite" />

      <CompactPage title="Details des Tickets Clotures" project={project} theme={theme}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
          <CounterCard label="Clotures" value={data.closedTickets.length} caption="Travail livre" theme={theme} />
          <CounterCard label="Delai moyen" value={data.avgResolutionDays == null ? '-' : `${data.avgResolutionDays} j`} caption="Cycle de cloture" theme={theme} />
        </View>
        <VerticalBars rows={data.closedByType} theme={theme} />
      </CompactPage>

      <CompactPage title="Details des Tickets Ouverts" project={project} theme={theme}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
          <CounterCard label="Ouverts" value={data.openTickets.length} caption="Demandes non resolues" theme={theme} status={data.openTickets.length ? 'warning' : 'success'} />
          <CounterCard label="Anciennete" value={data.avgOpenDays == null ? '-' : `${data.avgOpenDays} j`} caption="Age moyen ouvert" theme={theme} status={(data.avgOpenDays || 0) > 30 ? 'danger' : 'warning'} />
        </View>
        <HorizontalBars rows={data.openByType} theme={theme} />
      </CompactPage>

      <CompactPage title="Tickets En Cours de Test" project={project} theme={theme}>
        <CounterCard label="En test" value={data.testingTickets.length} caption="En attente de validation" theme={theme} status={data.testingTickets.length ? 'warning' : 'success'} />
        <TicketDetailCard issue={data.testingTickets[0]} theme={theme} emptyLabel={'Aucun ticket avec statut exact "En cours de test".'} />
      </CompactPage>

      <CompactPage title="Details des Tickets En Cours de Traitement" project={project} theme={theme}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
          <CounterCard label="En traitement" value={data.activeTickets.length} caption="Charge active" theme={theme} status={data.activeTickets.length ? 'warning' : 'success'} />
          <CounterCard label="Types actifs" value={data.activeByType.length} caption="Categories concernees" theme={theme} />
        </View>
        <VerticalBars rows={data.activeByType} theme={theme} />
      </CompactPage>

      <CompactPage title="Tickets En Cours de Traitement" project={project} theme={theme}>
        <DenseTicketTable issues={data.activeTickets} theme={theme} title="Vue operationnelle des tickets actifs" limit={15} emptyLabel={'Aucun ticket avec statut exact "En cours de traitement".'} />
      </CompactPage>

      <CompactPage title="Tickets Pris En Charge" project={project} theme={theme}>
        <CounterCard label="Pris en charge" value={data.acknowledgedTickets.length} caption="Acceptes non clotures" theme={theme} status={data.acknowledgedTickets.length ? 'warning' : 'success'} />
        <TicketDetailCard issue={data.acknowledgedTickets[0]} theme={theme} emptyLabel={'Aucun ticket avec statut exact "Pris en charge".'} />
      </CompactPage>

      <CompactPage title="Tickets Bloques" project={project} theme={theme}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
          <CounterCard label="Bloques" value={data.blockedTickets.length} caption="Backlog a debloquer" theme={theme} status={data.blockedTickets.length ? 'danger' : 'success'} />
          <CounterCard label="Features" value={data.blockedFeatureTickets.length} caption="Demandes fonctionnelles" theme={theme} status={data.blockedFeatureTickets.length ? 'warning' : 'success'} />
          <CounterCard label="Autres" value={data.blockedOtherTickets.length} caption="Bugs ou autres types" theme={theme} status={data.blockedOtherTickets.length ? 'warning' : 'success'} />
          <CounterCard label="Priorites" value={data.blockedByPriority.length} caption="Niveaux impactes" theme={theme} />
        </View>
        {data.blockedTickets.length ? (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <HorizontalBars rows={data.blockedByPriority} theme={theme} limit={5} />
            </View>
            <View style={{ flex: 1 }}>
              <DonutChart rows={data.blockedByStatus} theme={theme} size={118} />
            </View>
            <View style={{ flex: 1 }}>
              <DonutChart rows={data.blockedByType} theme={theme} size={118} />
            </View>
          </View>
        ) : (
          <View wrap={false} style={{ ...s.card, padding: 16 }}>
            <Text style={s.h3}>Aucun ticket bloque</Text>
            <Text style={s.bodyText}>Aucun ticket avec le statut exact "Bloque" n'a ete trouve dans la periode analysee.</Text>
          </View>
        )}
      </CompactPage>

      {data.blockedTickets.length > 0 && (
        <>
          <CompactPage title="Tickets Bloques" project={project} theme={theme}>
            <DenseTicketTable issues={data.blockedFeatureTickets} theme={theme} title="Feature tickets bloques" limit={15} emptyLabel={'Aucun ticket avec statut exact "Bloque" et tracker exact "Feature".'} />
          </CompactPage>

          <CompactPage title="Tickets Bloques" project={project} theme={theme}>
            <DenseTicketTable issues={data.blockedOtherTickets} theme={theme} title="Bugs et autres tickets bloques" limit={15} emptyLabel={'Aucun autre ticket avec statut exact "Bloque".'} />
          </CompactPage>
        </>
      )}

      <CompactPage title="Reunions et Points d'Echange" project={project} theme={theme}>
        <CounterCard label="Reunions" value={data.meetings.length} caption="Historique de gouvernance" theme={theme} status={data.meetings.length ? 'success' : 'warning'} />
        <DenseTicketTable issues={data.meetings} theme={theme} title="Historique des reunions et points d'echange" limit={15} emptyLabel={'Aucun ticket avec tracker exact "Reunion" ou "Point d echange".'} />
      </CompactPage>

      {enabled('merci') && (
        <Page {...LANDSCAPE_PAGE} style={s.page}>
          <View style={{ flex: 1, backgroundColor: theme?.heroBg ?? '#1E3A5F', alignItems: 'center', justifyContent: 'center', padding: 48 }}>
            <Text style={{ color: '#FFFFFF', fontFamily: 'PlayfairDisplay', fontSize: 36 }}>Merci</Text>
            <Text style={{ color: 'rgba(255,255,255,0.78)', fontSize: 10, textAlign: 'center', marginTop: 16 }}>
              Ce rapport a ete genere automatiquement a partir des donnees Redmine du projet {project.site_name}.
            </Text>
            {(options.contactEmail || options.contactWeb || options.contactWeb2) && (
              <Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 9, textAlign: 'center', marginTop: 22 }}>
                {[options.contactEmail, options.contactWeb, options.contactWeb2].filter(Boolean).join(' | ')}
              </Text>
            )}
          </View>
        </Page>
      )}
    </Document>
  );
}
