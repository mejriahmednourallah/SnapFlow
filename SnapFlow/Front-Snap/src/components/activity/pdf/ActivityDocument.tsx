import { Document, Image, Page, Path, Svg, Text, View } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import { differenceInDays, format } from 'date-fns';
import { fr } from 'date-fns/locale';
import snapflowLogo from '@/assets/snapflow-logo.png';
import type { PdfTheme } from '@/components/pdf/theme';
import { getStatusColor, makePageStyles } from '@/components/pdf/theme';
import type { ActivityPdfOptions, DashboardProject, RedmineIssue } from './pdfTypes';
import type { ProjectPerimeterBlock } from '@/lib/projectPerimeters';
import { hasProjectPerimeterBlocks } from '@/lib/projectPerimeters';

interface ActivityDocumentProps {
  project: DashboardProject;
  issues: RedmineIssue[];
  totalCount: number;
  perimeterBlocks?: ProjectPerimeterBlock[];
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
type CountRow = { name: string; count: number; color?: string };
type ActivityKpi = {
  key: string;
  label: string;
  value: string;
  caption: string;
  status: SeverityStatus;
};

const SLIDE_PAGE = { size: [1440, 810] as [number, number] };
const LANDSCAPE_PAGE = SLIDE_PAGE;
const MANUAL_CYAN = '#22A9D1';
const MANUAL_SLATE = '#10243C';
const MANUAL_YELLOW = '#F6B21A';
const MANUAL_GRID_WHITE = 'rgba(255,255,255,0.72)';
const COVER_TITLE = "RAPPORT D'ACTIVITÉ";
const CHART_COLORS = [MANUAL_CYAN, MANUAL_YELLOW, '#1E3A5F', '#4E8CCF', '#3B9B86', '#F97316', '#DC2626', '#64748B'];
const PAGE_PADDING_X = 34;
const TABLE_PAGE_SIZE = 15;

const clean = (value?: string | null) => (value || '').trim();
const deAccent = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const normalizeLabel = (value: string) => deAccent(value).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const matchesAny = (value: string, needles: string[]) => {
  const normalized = normalizeLabel(value);
  return needles.some(needle => normalized.includes(normalizeLabel(needle)));
};

const isClosed = (value: string) => matchesAny(value, ['clotur', 'closed', 'clos', 'ferme', 'resolu', 'resolved']);
const isResolvedOnly = (value: string) => matchesAny(value, ['resolu', 'resolved']);
const isCancelled = (value: string) => matchesAny(value, ['annul', 'cancel', 'reject', 'rejete', 'rejet']);
const isBlocked = (value: string) => matchesAny(value, ['bloqu', 'attente', 'hold', 'suspend']);
const isTesting = (value: string) => matchesAny(value, ['test', 'validation', 'recette']);
const isAcknowledged = (value: string) => matchesAny(value, ['pris en charge', 'assign', 'ack']);
const isInProgress = (value: string) => matchesAny(value, ['en cours de traitement', 'traitement', 'progress']);
const isCritical = (value: string) => matchesAny(value, ['critique', 'critical', 'urgent', 'immediat', 'immediate']);
const isMeeting = (value: string) => matchesAny(value, ['reunion', 'point d echange', "point d'echange"]);

function pct(count: number, total: number) {
  if (!total) return 0;
  return Math.round((count / total) * 100);
}

function short(value: string, max = 84) {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function safeDate(value?: string | null, pattern = 'dd/MM/yyyy') {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return format(date, pattern, { locale: fr });
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

function avgResolutionDays(issues: RedmineIssue[]) {
  if (!issues.length) return null;
  const sum = issues.reduce((acc, issue) => {
    return acc + Math.max(0, differenceInDays(new Date(issue.updated_on), new Date(issue.created_on)));
  }, 0);
  return Math.round(sum / issues.length);
}

function avgAgeDays(issues: RedmineIssue[]) {
  if (!issues.length) return null;
  const sum = issues.reduce((acc, issue) => {
    return acc + Math.max(0, differenceInDays(new Date(), new Date(issue.created_on)));
  }, 0);
  return Math.round(sum / issues.length);
}

function colorize(rows: CountRow[]) {
  return rows.map((row, index) => ({ ...row, color: CHART_COLORS[index % CHART_COLORS.length] }));
}

function rowsWithOther(rows: CountRow[], limit: number): CountRow[] {
  if (rows.length <= limit) return rows;
  const visible = rows.slice(0, Math.max(1, limit - 1));
  const otherCount = rows.slice(Math.max(1, limit - 1)).reduce((sum, row) => sum + row.count, 0);
  return [...visible, { name: 'Autres', count: otherCount, color: '#64748B' }];
}

function paginate<T>(items: T[], size = TABLE_PAGE_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function buildData(issues: RedmineIssue[], totalCount: number) {
  const meetings = issues.filter(issue => isMeeting(issue.tracker.name));
  const treatmentIssues = issues.filter(issue => !isMeeting(issue.tracker.name));
  const total = treatmentIssues.length;

  const cancelledTickets = treatmentIssues.filter(issue => isCancelled(issue.status.name));
  const closedTickets = treatmentIssues.filter(issue => isClosed(issue.status.name));
  const openTickets = treatmentIssues.filter(issue => !isClosed(issue.status.name) && !isCancelled(issue.status.name));
  const blockedTickets = treatmentIssues.filter(issue => isBlocked(issue.status.name));
  const testingTickets = treatmentIssues.filter(issue => isTesting(issue.status.name) && !isClosed(issue.status.name));
  const acknowledgedTickets = treatmentIssues.filter(issue =>
    isAcknowledged(issue.status.name) &&
    !isClosed(issue.status.name) &&
    !isBlocked(issue.status.name) &&
    !isTesting(issue.status.name)
  );
  const activeTickets = treatmentIssues.filter(issue =>
    isInProgress(issue.status.name) &&
    !isClosed(issue.status.name) &&
    !isBlocked(issue.status.name) &&
    !isTesting(issue.status.name)
  );
  const criticalIssues = treatmentIssues.filter(issue => isCritical(issue.priority.name));
  const pendingValidation = treatmentIssues.filter(issue => isResolvedOnly(issue.status.name) && differenceInDays(new Date(), new Date(issue.updated_on)) > 2);
  const avgClosed = avgResolutionDays(closedTickets);
  const avgOpen = avgAgeDays(openTickets);
  const kpis: ActivityKpi[] = [
    { key: 'total', label: 'Tickets', value: String(totalCount !== undefined && totalCount !== total ? totalCount : total), caption: totalCount !== undefined && totalCount !== total ? `${total} traitement (hors réunions)` : 'Périmètre traitement (hors réunions)', status: 'success' },
    { key: 'meetings', label: 'Réunions', value: String(meetings.length), caption: "Points d'échange", status: meetings.length ? 'success' : 'warning' },
    { key: 'open', label: 'Ouverts', value: String(openTickets.length), caption: `${pct(openTickets.length, total)} % du volume`, status: openTickets.length ? 'warning' : 'success' },
    { key: 'resolved', label: 'Clôturés', value: String(closedTickets.length), caption: `${pct(closedTickets.length, total)} % livrés`, status: 'success' },
    { key: 'cancelled', label: 'Annulés', value: String(cancelledTickets.length), caption: `${pct(cancelledTickets.length, total)} % sans suite`, status: cancelledTickets.length ? 'warning' : 'success' },
    { key: 'critical', label: 'Critiques', value: String(criticalIssues.length), caption: 'Priorité urgente ou critique', status: criticalIssues.length ? 'danger' : 'success' },
    { key: 'blocked', label: 'Bloqués', value: String(blockedTickets.length), caption: 'Actions en attente', status: blockedTickets.length ? 'danger' : 'success' },
  ];

  const insights = [
    blockedTickets.length > 0 ? `${blockedTickets.length} ticket(s) de traitement bloques demandent une decision ou une action de deblocage.` : 'Aucun blocage majeur detecte sur la periode.',
    pendingValidation.length > 0 ? `${pendingValidation.length} ticket(s) resolus attendent une validation client prolongee.` : 'Aucun ticket resolu ne semble attendre une validation prolongee.',
    criticalIssues.length > 0 ? `${criticalIssues.length} ticket(s) critiques doivent rester sous surveillance projet.` : 'La selection ne contient pas de ticket critique.',
  ];

  return {
    total,
    totalCount,
    meetings,
    treatmentIssues,
    openTickets,
    closedTickets,
    cancelledTickets,
    blockedTickets,
    testingTickets,
    acknowledgedTickets,
    activeTickets,
    criticalIssues,
    pendingValidation,
    avgClosed,
    avgOpen,
    kpis,
    insights,
    statusRows: colorize(countBy(treatmentIssues, issue => issue.status.name)),
    trackerRows: colorize(countBy(treatmentIssues, issue => issue.tracker.name)),
    priorityRows: colorize(countBy(treatmentIssues, issue => issue.priority.name)),
    closedByType: colorize(countBy(closedTickets, issue => issue.tracker.name)),
    openByType: colorize(countBy(openTickets, issue => issue.tracker.name)),
    cancelledByType: colorize(countBy(cancelledTickets, issue => issue.tracker.name)),
    cancelledByPriority: colorize(countBy(cancelledTickets, issue => issue.priority.name)),
    activeByType: colorize(countBy(activeTickets, issue => issue.tracker.name)),
    blockedByType: colorize(countBy(blockedTickets, issue => issue.tracker.name)),
    blockedByPriority: colorize(countBy(blockedTickets, issue => issue.priority.name)),
    blockedByStatus: colorize(countBy(blockedTickets, issue => issue.status.name)),
  };
}

type ActivityData = ReturnType<typeof buildData>;

function buildActivitySections(data: ActivityData) {
  return {
    showActiveTables: data.activeTickets.length > 0,
    showValidationDetails: data.testingTickets.length > 0,
    showAcknowledgedDetails: data.acknowledgedTickets.length > 0,
    showCancelledAnalysis: data.cancelledTickets.length > 0,
    showCancelledTables: data.cancelledTickets.length > 0,
    showBlockedAnalysis: data.blockedTickets.length > 0,
    showBlockedTables: data.blockedTickets.length > 0,
    showMeetings: data.meetings.length > 0,
  };
}

function filterSummary(filters?: ActivityDocumentProps['filters']) {
  const parts = [
    filters?.statusLabel ? `Statut : ${filters.statusLabel}` : null,
    filters?.trackerLabel ? `Tracker : ${filters.trackerLabel}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' | ') : null;
}

function periodLabel(filters?: ActivityDocumentProps['filters']) {
  if (filters?.dateFrom && filters?.dateTo) return `Période du ${filters.dateFrom} au ${filters.dateTo}`;
  if (filters?.dateFrom) return `Depuis le ${filters.dateFrom}`;
  if (filters?.dateTo) return `Jusqu'au ${filters.dateTo}`;
  return 'Toutes périodes confondues';
}

function periodSentence(filters?: ActivityDocumentProps['filters']) {
  if (filters?.dateFrom && filters?.dateTo) return `la période du ${filters.dateFrom} au ${filters.dateTo}`;
  if (filters?.dateFrom) return `la période depuis le ${filters.dateFrom}`;
  if (filters?.dateTo) return `la période jusqu'au ${filters.dateTo}`;
  return 'toutes périodes confondues';
}

function pageText(theme?: PdfTheme) {
  return {
    text: theme?.text ?? '#111827',
    muted: theme?.textMuted ?? '#64748B',
    primary: theme?.primary ?? '#1E3A5F',
    accent: theme?.accent ?? '#0E9FB0',
    surface: theme?.surface ?? '#FFFFFF',
    border: theme?.border ?? '#D7E0EA',
    bg: theme?.bg ?? '#F8FAFC',
    hero: theme?.heroBg ?? MANUAL_SLATE,
    recBg: theme?.recBg ?? '#F1F4F8',
    headerBg: theme?.headerBg ?? '#E7EEF7',
  };
}

function ActivitySlidePage({
  title,
  subtitle,
  project,
  theme,
  options,
  children,
  tone = 'light',
}: {
  title: string;
  subtitle?: string;
  project: DashboardProject;
  theme?: PdfTheme;
  options: ActivityPdfOptions;
  children: ReactNode;
  tone?: 'light' | 'brand';
}) {
  const t = pageText(theme);
  const brandColor = options.pdfColor || t.accent;
  const dark = tone === 'brand';
  return (
    <Page {...LANDSCAPE_PAGE} style={{ backgroundColor: dark ? t.hero : t.bg, color: dark ? '#FFFFFF' : t.text, fontFamily: 'DMSans', padding: 28 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          <View style={{ width: 30, height: 4, backgroundColor: dark ? '#FFFFFF' : brandColor, borderRadius: 3 }} />
          <Text style={{ fontSize: 8, fontFamily: 'DMSans', fontWeight: 700, color: dark ? 'rgba(255,255,255,0.82)' : t.muted }}>
            {options.brandLeft || 'MEDIANET RUN SERVICES'}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {project.logo_url ? <Image src={project.logo_url} style={{ width: 86, height: 28, objectFit: 'contain' }} /> : null}
        </View>
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 }}>
        <View>
          <Text style={{ fontFamily: 'DMSans', fontWeight: 700, fontSize: 23, color: dark ? '#FFFFFF' : t.text, textTransform: 'uppercase' }}>{title}</Text>
          {subtitle ? <Text style={{ fontSize: 8.5, marginTop: 5, color: dark ? 'rgba(255,255,255,0.72)' : t.muted }}>{subtitle}</Text> : null}
        </View>
      </View>

      <View style={{ flex: 1 }}>
        {children}
      </View>

      <View style={{ position: 'absolute', left: PAGE_PADDING_X, right: PAGE_PADDING_X, bottom: 18, borderTopWidth: 0.8, borderTopColor: dark ? 'rgba(255,255,255,0.24)' : t.border, paddingTop: 7, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Image src={snapflowLogo} style={{ width: 70, height: 22, objectFit: 'contain' }} />
          <Text style={{ fontSize: 7, color: dark ? 'rgba(255,255,255,0.68)' : t.muted }}>Medianet x Snapflow App | Rapport confidentiel</Text>
        </View>
        <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} style={{ fontSize: 7, color: dark ? 'rgba(255,255,255,0.68)' : t.muted }} fixed />
      </View>
    </Page>
  );
}

function SectionNote({ children, theme, accentColor }: { children: ReactNode; theme?: PdfTheme; accentColor: string }) {
  const t = pageText(theme);
  return (
    <View style={{ backgroundColor: t.surface, borderLeftWidth: 5, borderLeftColor: accentColor, borderRadius: 10, padding: 11, borderWidth: 0.7, borderColor: t.border }}>
      <Text style={{ fontSize: 8.8, lineHeight: 1.45, color: t.text }}>{children}</Text>
    </View>
  );
}

function BigNumberPanel({
  value,
  label,
  caption,
  theme,
  status = 'success',
  accentColor,
  grow = false,
}: {
  value: string | number;
  label: string;
  caption?: string;
  theme?: PdfTheme;
  status?: SeverityStatus;
  accentColor: string;
  grow?: boolean;
}) {
  const t = pageText(theme);
  const color = status === 'success' ? accentColor : getStatusColor(status);
  return (
    <View style={{ flex: grow ? 1 : undefined, backgroundColor: t.surface, borderRadius: 12, padding: 16, borderWidth: 0.8, borderColor: t.border, minHeight: 120, justifyContent: 'center' }}>
      <Text style={{ fontSize: 8, color: t.muted, fontFamily: 'DMSans', fontWeight: 700, textTransform: 'uppercase' }}>{label}</Text>
      <Text style={{ fontSize: 54, lineHeight: 1, color, fontFamily: 'DMSans', fontWeight: 700, marginTop: 5 }}>{value}</Text>
      {caption ? <Text style={{ fontSize: 8.2, color: t.muted, marginTop: 8, lineHeight: 1.35 }}>{caption}</Text> : null}
    </View>
  );
}

function MetricStrip({ kpis, theme, accentColor }: { kpis: ActivityKpi[]; theme?: PdfTheme; accentColor: string }) {
  const t = pageText(theme);
  return (
    <View style={{ flexDirection: 'row', gap: 9 }}>
      {kpis.map(kpi => (
        <View key={kpi.key} style={{ flex: 1, backgroundColor: t.surface, borderRadius: 10, borderWidth: 0.7, borderColor: t.border, padding: 10, minHeight: 78 }}>
          <Text style={{ fontSize: 7.2, color: t.muted, textTransform: 'uppercase', fontFamily: 'DMSans', fontWeight: 700 }}>{kpi.label}</Text>
          <Text style={{ fontSize: 24, color: kpi.status === 'success' ? accentColor : getStatusColor(kpi.status), fontFamily: 'DMSans', fontWeight: 700, marginTop: 3 }}>{kpi.value}</Text>
          <Text style={{ fontSize: 7.1, color: t.muted, marginTop: 3 }}>{kpi.caption}</Text>
        </View>
      ))}
    </View>
  );
}

function TableLegend({ rows, total, theme, accentColor, label = 'Libelle', limit = 8 }: { rows: CountRow[]; total: number; theme?: PdfTheme; accentColor: string; label?: string; limit?: number }) {
  const t = pageText(theme);
  const visible = rowsWithOther(rows, limit);
  if (!visible.length) {
    return <SectionNote theme={theme} accentColor={accentColor}>Aucune donnee disponible pour cette repartition.</SectionNote>;
  }
  return (
    <View style={{ backgroundColor: MANUAL_YELLOW, borderRadius: 12, padding: 12, minHeight: 218 }}>
      <View style={{ flexDirection: 'row', borderBottomWidth: 0.8, borderBottomColor: MANUAL_GRID_WHITE, paddingBottom: 7 }}>
        <Text style={{ width: 170, fontSize: 8.5, fontFamily: 'DMSans', fontWeight: 700, color: '#FFFFFF' }}>{label}</Text>
        <Text style={{ width: 42, fontSize: 8.5, fontFamily: 'DMSans', fontWeight: 700, color: '#FFFFFF', textAlign: 'right' }}>Tickets</Text>
        <Text style={{ width: 42, fontSize: 8.5, fontFamily: 'DMSans', fontWeight: 700, color: '#FFFFFF', textAlign: 'right' }}>%</Text>
      </View>
      {visible.map((row, index) => (
        <View key={`${row.name}-${index}`} style={{ flexDirection: 'row', paddingVertical: 7, borderBottomWidth: index === visible.length - 1 ? 0 : 0.5, borderBottomColor: MANUAL_GRID_WHITE }}>
          <Text style={{ width: 170, fontSize: 8.4, color: '#FFFFFF' }}>{short(row.name, 34)}</Text>
          <Text style={{ width: 42, fontSize: 8.4, color: '#FFFFFF', textAlign: 'right', fontFamily: 'DMSans', fontWeight: 700 }}>{row.count}</Text>
          <Text style={{ width: 42, fontSize: 8.4, color: '#FFFFFF', textAlign: 'right' }}>{pct(row.count, total)}%</Text>
        </View>
      ))}
      <Text style={{ fontSize: 6.8, color: 'rgba(255,255,255,0.82)', marginTop: 8 }}>Chiffres bases sur les tickets charges dans le rapport.</Text>
    </View>
  );
}

function HorizontalBars({ rows, theme, limit = 8 }: { rows: CountRow[]; theme?: PdfTheme; limit?: number }) {
  const t = pageText(theme);
  const visible = rowsWithOther(rows, limit);
  const max = Math.max(...visible.map(row => row.count), 1);
  if (!visible.length) return <Text style={{ fontSize: 9, color: t.muted }}>Aucune donnee.</Text>;
  return (
    <View style={{ gap: 10 }}>
      {visible.map((row, index) => (
        <View key={`${row.name}-${index}`}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
            <Text style={{ fontSize: 9, color: t.text }}>{short(row.name, 32)}</Text>
            <Text style={{ fontSize: 9, color: t.muted, fontFamily: 'DMSans', fontWeight: 700 }}>{row.count}</Text>
          </View>
          <View style={{ height: 13, backgroundColor: t.border, borderRadius: 8 }}>
            <View style={{ width: `${Math.max(4, (row.count / max) * 100)}%`, height: 13, backgroundColor: row.color ?? CHART_COLORS[index % CHART_COLORS.length], borderRadius: 8 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

function VerticalBars({ rows, theme, limit = 7 }: { rows: CountRow[]; theme?: PdfTheme; limit?: number }) {
  const t = pageText(theme);
  const visible = rowsWithOther(rows, limit);
  const max = Math.max(...visible.map(row => row.count), 1);
  if (!visible.length) return <Text style={{ fontSize: 9, color: t.muted }}>Aucune donnee.</Text>;
  return (
    <View style={{ height: 248, flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingTop: 12 }}>
      {visible.map((row, index) => {
        const height = Math.max(24, (row.count / max) * 188);
        return (
          <View key={`${row.name}-${index}`} style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ fontSize: 10, fontFamily: 'DMSans', fontWeight: 700, color: row.color ?? CHART_COLORS[index % CHART_COLORS.length], marginBottom: 5 }}>{row.count}</Text>
            <View style={{ height, width: '72%', backgroundColor: row.color ?? CHART_COLORS[index % CHART_COLORS.length], borderRadius: 6 }} />
            <Text style={{ fontSize: 7.2, color: t.muted, textAlign: 'center', marginTop: 6 }}>{short(row.name, 15)}</Text>
          </View>
        );
      })}
    </View>
  );
}

function polar(cx: number, cy: number, radius: number, angle: number) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}

function donutSegmentPath(cx: number, cy: number, outerR: number, innerR: number, startAngle: number, endAngle: number) {
  const end = Math.min(endAngle, startAngle + 359.99);
  const largeArc = end - startAngle > 180 ? 1 : 0;
  const outerStart = polar(cx, cy, outerR, startAngle);
  const outerEnd = polar(cx, cy, outerR, end);
  const innerEnd = polar(cx, cy, innerR, end);
  const innerStart = polar(cx, cy, innerR, startAngle);
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ');
}

function DonutChart({ rows, theme, size = 190, limit = 7 }: { rows: CountRow[]; theme?: PdfTheme; size?: number; limit?: number }) {
  const t = pageText(theme);
  const visible = rowsWithOther(rows.filter(row => row.count > 0), limit);
  const total = visible.reduce((sum, row) => sum + row.count, 0);
  if (!visible.length || !total) return <HorizontalBars rows={rows} theme={theme} limit={limit} />;
  let cursor = 0;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
      <Svg width={size} height={size} viewBox="0 0 140 140">
        {visible.map((row, index) => {
          const angle = (row.count / total) * 360;
          const path = donutSegmentPath(70, 70, 54, 30, cursor, cursor + angle);
          cursor += angle;
          return <Path key={`${row.name}-${index}`} d={path} fill={row.color ?? CHART_COLORS[index % CHART_COLORS.length]} />;
        })}
      </Svg>
      <View style={{ flex: 1, gap: 7 }}>
        <Text style={{ fontSize: 44, lineHeight: 1, fontFamily: 'DMSans', fontWeight: 700, color: t.primary }}>{total}</Text>
        {visible.map((row, index) => (
          <View key={`${row.name}-${index}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: row.color ?? CHART_COLORS[index % CHART_COLORS.length] }} />
            <Text style={{ fontSize: 8.5, color: t.text, width: 145 }}>{short(row.name, 29)}</Text>
            <Text style={{ fontSize: 8.5, color: t.muted, textAlign: 'right', width: 38 }}>{row.count}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function FigureTableLayout({
  chart,
  rows,
  total,
  tableLabel,
  theme,
  accentColor,
  reverse = false,
}: {
  chart: 'donut' | 'vertical' | 'horizontal';
  rows: CountRow[];
  total: number;
  tableLabel: string;
  theme?: PdfTheme;
  accentColor: string;
  reverse?: boolean;
}) {
  const t = pageText(theme);
  const chartNode = (
    <View style={{ flex: 1.35, backgroundColor: t.surface, borderRadius: 14, borderWidth: 0.8, borderColor: t.border, padding: 18, minHeight: 318, justifyContent: 'center' }}>
      {chart === 'donut' && <DonutChart rows={rows} theme={theme} />}
      {chart === 'vertical' && <VerticalBars rows={rows} theme={theme} />}
      {chart === 'horizontal' && <HorizontalBars rows={rows} theme={theme} />}
    </View>
  );
  const tableNode = (
    <View style={{ flex: 0.9 }}>
      <TableLegend rows={rows} total={total} theme={theme} accentColor={accentColor} label={tableLabel} />
    </View>
  );
  return (
    <View style={{ flexDirection: 'row', gap: 18, alignItems: 'stretch' }}>
      {reverse ? tableNode : chartNode}
      {reverse ? chartNode : tableNode}
    </View>
  );
}

function TicketMiniCard({ issue, theme, accentColor, emptyLabel }: { issue?: RedmineIssue; theme?: PdfTheme; accentColor: string; emptyLabel: string }) {
  const t = pageText(theme);
  if (!issue) {
    return <SectionNote theme={theme} accentColor={accentColor}>{emptyLabel}</SectionNote>;
  }
  return (
    <View style={{ backgroundColor: t.surface, borderRadius: 10, borderWidth: 0.7, borderColor: t.border, padding: 11, minHeight: 86 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={{ fontSize: 8, color: accentColor, fontFamily: 'DMSans', fontWeight: 700 }}>#{issue.id}</Text>
        <Text style={{ fontSize: 7.4, color: t.muted }}>{safeDate(issue.updated_on)}</Text>
      </View>
      <Text style={{ fontSize: 10, color: t.text, fontFamily: 'DMSans', fontWeight: 700, lineHeight: 1.25 }}>{short(issue.subject, 72)}</Text>
      <Text style={{ fontSize: 7.8, color: t.muted, marginTop: 7 }}>Type: {issue.tracker.name} | Priorité: {issue.priority.name} | Avancement: {issue.done_ratio}%</Text>
    </View>
  );
}

function WorkflowPanel({ data, theme, accentColor }: { data: ActivityData; theme?: PdfTheme; accentColor: string }) {
  const t = pageText(theme);
  const cards = [
    { label: 'En cours de test', value: data.testingTickets.length, caption: 'Validation côté client', status: data.testingTickets.length ? 'warning' as const : 'success' as const },
    { label: 'En cours de traitement', value: data.activeTickets.length, caption: 'Traitement côté équipe', status: data.activeTickets.length ? 'warning' as const : 'success' as const },
    { label: 'Pris en charge', value: data.acknowledgedTickets.length, caption: 'En attente de fermeture', status: data.acknowledgedTickets.length ? 'warning' as const : 'success' as const },
    { label: 'Tickets bloqués', value: data.blockedTickets.length, caption: 'Action de déblocage requise', status: data.blockedTickets.length ? 'danger' as const : 'success' as const },
  ];
  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {cards.map(card => (
          <BigNumberPanel key={card.label} value={card.value} label={card.label} caption={card.caption} theme={theme} status={card.status} accentColor={accentColor} grow />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 14 }}>
        <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: 12, borderWidth: 0.8, borderColor: t.border, padding: 14 }}>
          <Text style={{ fontSize: 10, fontFamily: 'DMSans', fontWeight: 700, color: t.primary, marginBottom: 10 }}>Chiffres basés sur la typologie des tickets en cours de traitement</Text>
          <HorizontalBars rows={data.activeByType} theme={theme} limit={5} />
        </View>
        <View style={{ flex: 1, gap: 9 }}>
          <TicketMiniCard issue={data.testingTickets[0]} theme={theme} accentColor={accentColor} emptyLabel="Aucun ticket en cours de test: aucune validation client n'est en attente sur la période." />
          <TicketMiniCard issue={data.acknowledgedTickets[0]} theme={theme} accentColor={accentColor} emptyLabel="Aucun ticket pris en charge: aucun ticket accepté n'attend une fermeture." />
        </View>
      </View>
    </View>
  );
}

function FullWidthTicketTable({
  issues,
  title,
  theme,
  accentColor,
  continuation,
  totalRows,
}: {
  issues: RedmineIssue[];
  title: string;
  theme?: PdfTheme;
  accentColor: string;
  continuation?: string;
  totalRows: number;
}) {
  const t = pageText(theme);
  const widths = [78, 408, 92, 92, 92];
  return (
    <View style={{ backgroundColor: t.surface, borderRadius: 12, borderWidth: 0.8, borderColor: t.border, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: accentColor, paddingVertical: 10, paddingHorizontal: 12 }}>
        <Text style={{ fontSize: 11, fontFamily: 'DMSans', fontWeight: 700, color: '#FFFFFF', textTransform: 'uppercase' }}>{title}</Text>
        <Text style={{ fontSize: 8, color: 'rgba(255,255,255,0.84)' }}>{continuation || `${totalRows} ticket(s)`}</Text>
      </View>
      <View style={{ flexDirection: 'row', backgroundColor: t.headerBg, paddingVertical: 7, paddingHorizontal: 10 }}>
        {['Identifiant', 'Sujet', 'Type', 'Priorité', 'Date ouverture'].map((label, index) => (
          <Text key={label} style={{ width: widths[index], fontSize: 8, color: t.primary, fontFamily: 'DMSans', fontWeight: 700 }}>{label}</Text>
        ))}
      </View>
      {issues.map((issue, index) => (
        <View key={issue.id} wrap={false} style={{ flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 10, borderTopWidth: 0.45, borderTopColor: t.border, backgroundColor: index % 2 ? t.recBg : t.surface }}>
          <Text style={{ width: widths[0], fontSize: 8.3, color: t.text, fontFamily: 'DMSans', fontWeight: 700 }}>#{issue.id}</Text>
          <Text style={{ width: widths[1], fontSize: 8.3, color: t.text, lineHeight: 1.22 }}>{short(issue.subject, 96)}</Text>
          <Text style={{ width: widths[2], fontSize: 8.1, color: t.text }}>{short(issue.tracker.name, 18)}</Text>
          <Text style={{ width: widths[3], fontSize: 8.1, color: t.text }}>{short(issue.priority.name, 18)}</Text>
          <Text style={{ width: widths[4], fontSize: 8.1, color: t.text }}>{safeDate(issue.created_on, 'yyyy')}</Text>
        </View>
      ))}
    </View>
  );
}

function renderTicketTablePages({
  issues,
  title,
  subtitle,
  project,
  theme,
  options,
  accentColor,
}: {
  issues: RedmineIssue[];
  title: string;
  subtitle: string;
  project: DashboardProject;
  theme?: PdfTheme;
  options: ActivityPdfOptions;
  accentColor: string;
}) {
  return paginate(issues).map((chunk, index, chunks) => (
    <ActivitySlidePage
      key={`${title}-${index}`}
      title={title}
      subtitle={chunks.length > 1 ? `${subtitle} | suite ${index + 1}/${chunks.length}` : subtitle}
      project={project}
      theme={theme}
      options={options}
    >
      <FullWidthTicketTable
        issues={chunk}
        title={title}
        theme={theme}
        accentColor={accentColor}
        totalRows={issues.length}
        continuation={`${index * TABLE_PAGE_SIZE + 1}-${index * TABLE_PAGE_SIZE + chunk.length} / ${issues.length}`}
      />
    </ActivitySlidePage>
  ));
}

function CoverPage({ project, filters, options, data, theme, accentColor }: { project: DashboardProject; filters?: ActivityDocumentProps['filters']; options: ActivityPdfOptions; data: ActivityData; theme?: PdfTheme; accentColor: string }) {
  const selectedKpis = data.kpis.filter(kpi => options.coverKpis[kpi.key] !== false);
  const t = pageText(theme);
  return (
    <Page {...LANDSCAPE_PAGE} style={{ backgroundColor: t.hero, color: '#FFFFFF', fontFamily: 'DMSans', padding: 34 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 46 }}>
        <View>
          <Text style={{ color: 'rgba(255,255,255,0.88)', fontSize: 9, fontFamily: 'DMSans', fontWeight: 700 }}>{options.brandLeft || 'MEDIANET RUN SERVICES'}</Text>
          {options.brandRight ? <Text style={{ color: 'rgba(255,255,255,0.62)', fontSize: 7, marginTop: 3 }}>{options.brandRight}</Text> : null}
        </View>
        {project.logo_url ? <Image src={project.logo_url} style={{ width: 94, height: 30, objectFit: 'contain' }} /> : null}
      </View>
      <Text style={{ fontFamily: 'PlayfairDisplay', fontSize: 44, color: '#FFFFFF', lineHeight: 1.06 }}>{COVER_TITLE.replace(' ', '\n')}</Text>
      <Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 9, marginTop: 8 }}>{periodLabel(filters)}</Text>
      {filterSummary(filters) ? (
        <Text style={{ color: 'rgba(255,255,255,0.64)', fontSize: 8, marginTop: 4 }}>{filterSummary(filters)}</Text>
      ) : null}
      <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 8, marginTop: 14, width: '64%', lineHeight: 1.45 }}>
        #Maintenance #Webmastering #Sécurité #Hosting #Backup #Data #Business #Support
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 30 }}>
        {selectedKpis.map(kpi => (
          <View key={kpi.key} wrap={false} style={{ width: '23.2%', minHeight: 68, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 10, padding: 9 }}>
            <Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 7, textTransform: 'uppercase' }}>{kpi.label}</Text>
            <Text style={{ color: kpi.status === 'danger' ? '#FCA5A5' : kpi.status === 'warning' ? '#FDBA74' : '#FFFFFF', fontSize: 22, fontFamily: 'DMSans', fontWeight: 700, marginTop: 3 }}>{kpi.value}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 7, marginTop: 3 }}>{kpi.caption}</Text>
          </View>
        ))}
      </View>
      <View style={{ position: 'absolute', bottom: 28, left: 34, right: 34, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 8 }}>Généré le {format(new Date(), 'dd/MM/yyyy HH:mm', { locale: fr })}</Text>
        <Image src={snapflowLogo} style={{ width: 86, height: 26, objectFit: 'contain' }} />
      </View>
    </Page>
  );
}

function SommairePage({ project, options, theme, sections, showPerimeter }: { project: DashboardProject; options: ActivityPdfOptions; theme?: PdfTheme; sections: string[]; showPerimeter: boolean }) {
  const t = pageText(theme);
  const groups = [
    showPerimeter ? {
      num: '01',
      title: 'PÉRIMÈTRE',
      subtitle: 'Cadre du projet et services couverts',
      items: ['Maintenance corrective', 'Webmastering', 'Système de ticketing'],
    } : null,
    {
      num: showPerimeter ? '02' : '01',
      title: 'SUIVI DES ACTIVITÉS RÉALISÉES',
      subtitle: 'Indicateurs, graphiques et détails tickets',
      items: sections.slice(0, 7),
    },
    {
      num: showPerimeter ? '03' : '02',
      title: 'SYNTHÈSE ET CONCLUSION',
      subtitle: 'Blocages, réunions et clôture du rapport',
      items: sections.slice(7),
    },
  ].filter(Boolean) as Array<{ num: string; title: string; subtitle: string; items: string[] }>;
  return (
    <ActivitySlidePage title="SOMMAIRE" subtitle="Périmètre, suivi des activités réalisées, synthèse et conclusion" project={project} theme={theme} options={options}>
      <View style={{ flexDirection: 'row', gap: 14, marginTop: 8 }}>
        {groups.map(group => (
          <View key={group.num} style={{ flex: 1, backgroundColor: t.surface, borderRadius: 16, padding: 18, borderWidth: 0.8, borderColor: t.border, minHeight: 318 }}>
            <Text style={{ fontSize: 38, color: options.pdfColor || t.accent, fontFamily: 'DMSans', fontWeight: 700, lineHeight: 1 }}>{group.num}</Text>
            <Text style={{ fontSize: 13, color: t.text, fontFamily: 'DMSans', fontWeight: 700, marginTop: 12, textTransform: 'uppercase', lineHeight: 1.2 }}>{group.title}</Text>
            <Text style={{ fontSize: 8.2, color: t.muted, marginTop: 6, lineHeight: 1.35 }}>{group.subtitle}</Text>
            <View style={{ marginTop: 14, gap: 7 }}>
              {(group.items.length ? group.items : ['Merci']).slice(0, 8).map(item => (
                <Text key={item} style={{ fontSize: 8.8, color: t.text, lineHeight: 1.25 }}>• {item}</Text>
              ))}
            </View>
          </View>
        ))}
      </View>
    </ActivitySlidePage>
  );
}

function PerimetrePage({ project, filters, options, theme, accentColor, perimeterBlocks }: { project: DashboardProject; filters?: ActivityDocumentProps['filters']; options: ActivityPdfOptions; theme?: PdfTheme; accentColor: string; perimeterBlocks: ProjectPerimeterBlock[] }) {
  const t = pageText(theme);
  const blocks = perimeterBlocks.filter(block => block.title.trim() || block.items.length > 0);
  return (
    <ActivitySlidePage title="PÉRIMÈTRE & CADRE DU PROJET" subtitle={`Services couverts par le contrat | ${periodLabel(filters)}`} project={project} theme={theme} options={options}>
      <View style={{ gap: 14 }}>
        <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 0.8, borderColor: t.border, padding: 17 }}>
          <Text style={{ fontSize: 10, color: t.text, lineHeight: 1.5 }}>
            Ce rapport est élaboré dans le cadre du contrat de run services du site audité. Il présente le périmètre couvert, les activités suivies via le système de ticketing et les interventions réalisées durant {periodSentence(filters)}.
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 14 }}>
          {blocks.slice(0, 3).map(block => (
            <View key={block.title} style={{ flex: 1, backgroundColor: t.surface, borderRadius: 16, borderWidth: 0.8, borderColor: t.border, padding: 16, minHeight: 238 }}>
              <Text style={{ fontSize: 10, color: accentColor, fontFamily: 'DMSans', fontWeight: 700, textTransform: 'uppercase' }}>{block.title}</Text>
              {block.subtitle ? <Text style={{ fontSize: 8.3, color: t.muted, marginTop: 5, textTransform: 'uppercase' }}>{block.subtitle}</Text> : null}
              <View style={{ marginTop: 14, gap: 8 }}>
                {block.items.map(item => (
                  <Text key={item} style={{ fontSize: 8.8, color: t.text, lineHeight: 1.35 }}>• {item}</Text>
                ))}
              </View>
            </View>
          ))}
        </View>
      </View>
    </ActivitySlidePage>
  );
}

function statusSentence(issue: RedmineIssue) {
  const status = clean(issue.status.name);
  if (isTesting(status)) return 'En attente d une validation client ou recette fonctionnelle.';
  if (isAcknowledged(status)) return 'Ticket pris en charge, en attente de fermeture ou confirmation finale.';
  if (isBlocked(status)) return 'Traitement interrompu: une action de deblocage est requise.';
  return status ? `Statut Redmine actuel: ${status}.` : 'Statut Redmine non renseigne.';
}

function TicketNarrativePage({ title, issues, project, theme, options, accentColor }: { title: string; issues: RedmineIssue[]; project: DashboardProject; theme?: PdfTheme; options: ActivityPdfOptions; accentColor: string }) {
  const t = pageText(theme);
  return (
    <ActivitySlidePage title={title} subtitle="Détail généré depuis les champs Redmine disponibles" project={project} theme={theme} options={options}>
      <View style={{ flexDirection: 'row', gap: 18 }}>
        <View style={{ width: 210 }}>
          <BigNumberPanel value={issues.length} label="NOMBRE DE TICKETS" caption="Tickets appartenant à cette catégorie" theme={theme} status={issues.length ? 'warning' : 'success'} accentColor={accentColor} />
        </View>
        <View style={{ flex: 1, gap: 10 }}>
          {issues.slice(0, 5).map(issue => (
            <View key={issue.id} style={{ backgroundColor: t.surface, borderRadius: 10, borderWidth: 0.8, borderColor: t.border, padding: 12 }}>
              <Text style={{ fontSize: 10.5, color: t.text, fontFamily: 'DMSans', fontWeight: 700, lineHeight: 1.25 }}>
                {issue.tracker.name} #{issue.id} : {short(issue.subject, 110)} - {issue.priority.name}
              </Text>
              <Text style={{ fontSize: 8, color: t.muted, marginTop: 6, lineHeight: 1.35 }}>{statusSentence(issue)}</Text>
            </View>
          ))}
        </View>
      </View>
    </ActivitySlidePage>
  );
}

export function ActivityDocument({ project, issues, totalCount, perimeterBlocks = [], filters, options }: ActivityDocumentProps) {
  const theme = options.theme;
  makePageStyles(theme);
  const data = buildData(issues, totalCount);
  const sections = buildActivitySections(data);
  const t = pageText(theme);
  const accentColor = options.pdfColor || t.accent;
  const showPerimeter = options.sections.perimetre !== false && hasProjectPerimeterBlocks(perimeterBlocks);
  const contactLine = [options.contactEmail, options.contactWeb, options.contactWeb2].filter(Boolean).join(' | ');
  const generatedSections = [
    showPerimeter ? 'Périmètre' : null,
    'Indicateurs globaux',
    'État des tickets',
    'Typologie des tickets',
    'Priorité des tickets',
    'Détails des tickets clôturés',
    'Détails des tickets ouverts',
    sections.showCancelledAnalysis ? 'Tickets annulés' : null,
    'Tickets en cours de test et pris en charge',
    sections.showActiveTables ? 'Tickets en cours de traitement' : null,
    sections.showBlockedAnalysis ? 'Tickets bloqués' : null,
    sections.showMeetings ? "Réunions et points d'échange" : null,
  ].filter(Boolean) as string[];

  return (
    <Document title={`Rapport d'activité - ${project.site_name}`}>
      <CoverPage project={project} filters={filters} options={options} data={data} theme={theme} accentColor={accentColor} />

      {options.sections.sommaire !== false && (
        <SommairePage project={project} options={options} theme={theme} sections={generatedSections} showPerimeter={showPerimeter} />
      )}

      {showPerimeter && (
        <PerimetrePage project={project} filters={filters} options={options} theme={theme} accentColor={accentColor} perimeterBlocks={perimeterBlocks} />
      )}

      <ActivitySlidePage title="SUIVI DES ACTIVITÉS RÉALISÉES" subtitle="INDICATEURS GLOBAUX" project={project} theme={theme} options={options}>
        <View style={{ flexDirection: 'row', gap: 18 }}>
          <View style={{ flex: 1.05, gap: 12 }}>
            <View style={{ backgroundColor: t.surface, borderRadius: 15, padding: 18, borderWidth: 0.8, borderColor: t.border }}>
              <Text style={{ fontSize: 10, color: t.muted, lineHeight: 1.45 }}>
                Ce rapport est élaboré dans le cadre du contrat de run services du site afin de présenter les interventions réalisées durant {periodSentence(filters)} et qui sont en définitif au nombre de {data.totalCount || data.total} dont {data.meetings.length} réunion(s).
              </Text>
            </View>
            <MetricStrip kpis={data.kpis.slice(0, 3)} theme={theme} accentColor={accentColor} />
            <MetricStrip kpis={data.kpis.slice(3)} theme={theme} accentColor={accentColor} />
          </View>
          <View style={{ flex: 0.78, gap: 10 }}>
            {data.insights.map(insight => <SectionNote key={insight} theme={theme} accentColor={accentColor}>{insight}</SectionNote>)}
          </View>
        </View>
      </ActivitySlidePage>

      <ActivitySlidePage title="ÉTAT DES TICKETS" subtitle={`LES ${data.total} TICKETS SONT RÉPARTIS COMME SUIT :`} project={project} theme={theme} options={options}>
        <FigureTableLayout chart="donut" rows={data.statusRows} total={data.total} tableLabel="Statut" theme={theme} accentColor={accentColor} />
      </ActivitySlidePage>

      <ActivitySlidePage title="TYPOLOGIE DES TICKETS" subtitle={`LES ${data.total} TICKETS SONT RÉPARTIS COMME SUIT :`} project={project} theme={theme} options={options}>
        <FigureTableLayout chart="vertical" rows={data.trackerRows} total={data.total} tableLabel="Type" theme={theme} accentColor={accentColor} />
      </ActivitySlidePage>

      <ActivitySlidePage title="PRIORITÉ DES TICKETS" subtitle={`LES ${data.total} TICKETS SONT RÉPARTIS COMME SUIT :`} project={project} theme={theme} options={options}>
        <FigureTableLayout chart="horizontal" rows={data.priorityRows} total={data.total} tableLabel="Priorité" theme={theme} accentColor={accentColor} reverse />
      </ActivitySlidePage>

      <ActivitySlidePage title="DÉTAILS DES TICKETS CLÔTURÉS" subtitle="Chiffres basés sur la typologie des tickets clôturés" project={project} theme={theme} options={options}>
        <View style={{ flexDirection: 'row', gap: 18 }}>
          <View style={{ width: 210 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <BigNumberPanel value={data.closedTickets.length} label="NOMBRE TICKETS CLÔTURÉS" caption="Chiffres basés sur la typologie des tickets clôturés" theme={theme} accentColor={accentColor} grow />
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ backgroundColor: t.surface, borderRadius: 12, padding: 14, borderWidth: 0.8, borderColor: t.border }}>
              <Text style={{ fontSize: 10, fontFamily: 'DMSans', fontWeight: 700, color: t.primary, marginBottom: 10 }}>Chiffres basés sur la typologie des tickets clôturés</Text>
              <VerticalBars rows={data.closedByType} theme={theme} />
            </View>
          </View>
        </View>
      </ActivitySlidePage>

      <ActivitySlidePage title="DÉTAILS DES TICKETS OUVERTS" subtitle="Chiffres basés sur la typologie des tickets ouverts" project={project} theme={theme} options={options}>
        <View style={{ flexDirection: 'row', gap: 18 }}>
          <View style={{ width: 210 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <BigNumberPanel value={data.openTickets.length} label="NOMBRE TICKETS OUVERTS" caption="Chiffres basés sur la typologie des tickets ouverts" theme={theme} status={data.openTickets.length ? 'warning' : 'success'} accentColor={accentColor} grow />
            </View>
            {data.openTickets[0] ? (
              <View style={{ marginTop: 12 }}>
                <SectionNote theme={theme} accentColor={accentColor}>
                  Le ticket est ouvert parce qu'il reste en attente d'une action, d'une décision ou d'un retour permettant de poursuivre le traitement.
                </SectionNote>
              </View>
            ) : null}
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ backgroundColor: t.surface, borderRadius: 12, padding: 14, borderWidth: 0.8, borderColor: t.border }}>
              <Text style={{ fontSize: 10, fontFamily: 'DMSans', fontWeight: 700, color: t.primary, marginBottom: 10 }}>Chiffres basés sur la typologie des tickets ouverts</Text>
              <HorizontalBars rows={data.openByType} theme={theme} />
            </View>
          </View>
        </View>
      </ActivitySlidePage>

      {sections.showCancelledAnalysis && (
        <ActivitySlidePage title="TICKETS ANNULÉS" subtitle="Tickets sortis du périmètre de traitement ou clôturés sans suite" project={project} theme={theme} options={options}>
          <View style={{ flexDirection: 'row', gap: 16 }}>
            <View style={{ width: 188 }}>
              <BigNumberPanel value={data.cancelledTickets.length} label="NOMBRE TICKETS ANNULÉS" caption="Demandes annulées, rejetées ou sorties du périmètre actif" theme={theme} status="warning" accentColor={accentColor} />
            </View>
            <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: 12, borderWidth: 0.8, borderColor: t.border, padding: 14 }}>
              <Text style={{ fontSize: 10, fontFamily: 'DMSans', fontWeight: 700, color: t.primary, marginBottom: 10 }}>TYPOLOGIE DES TICKETS ANNULÉS</Text>
              <VerticalBars rows={data.cancelledByType} theme={theme} />
            </View>
            <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: 12, borderWidth: 0.8, borderColor: t.border, padding: 14 }}>
              <Text style={{ fontSize: 10, fontFamily: 'DMSans', fontWeight: 700, color: t.primary, marginBottom: 10 }}>PRIORITÉ DES TICKETS ANNULÉS</Text>
              <HorizontalBars rows={data.cancelledByPriority} theme={theme} limit={5} />
            </View>
          </View>
        </ActivitySlidePage>
      )}

      {sections.showCancelledTables && renderTicketTablePages({
        issues: data.cancelledTickets,
        title: 'TICKETS ANNULÉS',
        subtitle: "Identifiant, sujet, type, priorité et date d'ouverture",
        project,
        theme,
        options,
        accentColor,
      })}

      <ActivitySlidePage title="TICKETS EN COURS DE TEST ET PRIS EN CHARGE" subtitle="Le traitement complet côté équipe est présenté avec les tickets en validation ou en attente de fermeture." project={project} theme={theme} options={options}>
        <WorkflowPanel data={data} theme={theme} accentColor={accentColor} />
      </ActivitySlidePage>

      {sections.showValidationDetails && (
        <TicketNarrativePage title="TICKETS EN COURS DE VALIDATION" issues={data.testingTickets} project={project} theme={theme} options={options} accentColor={accentColor} />
      )}

      {sections.showAcknowledgedDetails && (
        <TicketNarrativePage title="TICKETS PRIS EN CHARGE" issues={data.acknowledgedTickets} project={project} theme={theme} options={options} accentColor={accentColor} />
      )}

      {sections.showActiveTables && renderTicketTablePages({
        issues: data.activeTickets,
        title: 'DÉTAILS DES TICKETS EN COURS DE TRAITEMENT',
        subtitle: "Identifiant, sujet, type, priorité et date d'ouverture",
        project,
        theme,
        options,
        accentColor,
      })}

      {sections.showBlockedAnalysis && (
        <ActivitySlidePage title="TICKETS BLOQUÉS" subtitle="Analyse des tickets en attente d'action ou de décision" project={project} theme={theme} options={options}>
          <View style={{ flexDirection: 'row', gap: 16 }}>
            <View style={{ width: 170 }}>
              <BigNumberPanel value={data.blockedTickets.length} label="NOMBRE TICKETS BLOQUÉS" caption="Tickets en attente de déblocage" theme={theme} status="danger" accentColor={accentColor} />
            </View>
            <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: 12, borderWidth: 0.8, borderColor: t.border, padding: 14 }}>
              <Text style={{ fontSize: 10, fontFamily: 'DMSans', fontWeight: 700, color: t.primary, marginBottom: 10 }}>PRIORITÉ DES TICKETS BLOQUÉS</Text>
              <HorizontalBars rows={data.blockedByPriority} theme={theme} limit={5} />
            </View>
            <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: 12, borderWidth: 0.8, borderColor: t.border, padding: 14 }}>
              <Text style={{ fontSize: 10, fontFamily: 'DMSans', fontWeight: 700, color: t.primary, marginBottom: 10 }}>TYPOLOGIE DES TICKETS BLOQUÉS</Text>
              <DonutChart rows={data.blockedByType} theme={theme} size={150} limit={5} />
            </View>
          </View>
        </ActivitySlidePage>
      )}

      {sections.showBlockedTables && renderTicketTablePages({
        issues: data.blockedTickets,
        title: 'TICKETS BLOQUÉS',
        subtitle: "Identifiant, sujet, type, priorité et date d'ouverture",
        project,
        theme,
        options,
        accentColor,
      })}

      {sections.showMeetings && renderTicketTablePages({
        issues: data.meetings,
        title: "RÉUNIONS ET POINTS D'ÉCHANGE",
        subtitle: 'Historique des points de gouvernance et de suivi client',
        project,
        theme,
        options,
        accentColor,
      })}

      {options.sections.merci === true && (
        <ActivitySlidePage title="Merci" subtitle="Rapport genere automatiquement depuis Redmine" project={project} theme={theme} options={options} tone="brand">
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#FFFFFF', fontFamily: 'PlayfairDisplay', fontSize: 44 }}>Merci !</Text>
            {contactLine ? (
              <Text style={{ color: 'rgba(255,255,255,0.78)', fontSize: 10, textAlign: 'center', marginTop: 22 }}>
                {contactLine}
              </Text>
            ) : null}
          </View>
        </ActivitySlidePage>
      )}
    </Document>
  );
}
