import { Document, Image, Page, Path, Svg, Text, View } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import { differenceInDays, format } from 'date-fns';
import { fr } from 'date-fns/locale';
import snapflowLogo from '@/assets/snapflow-logo.png';
import type { PdfTheme } from '@/components/pdf/theme';
import { getStatusColor, makePageStyles } from '@/components/pdf/theme';
import { hasProjectPerimeterBlocks, type ProjectPerimeterBlock } from '@/lib/projectPerimeters';
import type { ActivityPdfOptions, DashboardProject, RedmineIssue } from './pdfTypes';

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
  perimeterBlocks?: ProjectPerimeterBlock[];
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
const MANUAL_CYAN = '#22A9D1';
const MANUAL_CYAN_DARK = '#0E9FB0';
const MANUAL_SLATE = '#10243C';
const MANUAL_YELLOW = '#F6B21A';
const MANUAL_GRID_WHITE = 'rgba(255,255,255,0.72)';
const CHART_COLORS = ['#78B8D4', '#FED948', '#1FA8D7', '#EE2B2B', '#2AA876', '#F6B21A', '#10243C', '#64748B'];
const PAGE_PADDING_X = 58;
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
    blockedTickets.length > 0 ? `${blockedTickets.length} ticket(s) de traitement bloqués demandent une décision ou une action de déblocage.` : 'Aucun blocage majeur détecté sur la période.',
    pendingValidation.length > 0 ? `${pendingValidation.length} ticket(s) résolus attendent une validation client prolongée.` : 'Aucun ticket résolu ne semble attendre une validation prolongée.',
    criticalIssues.length > 0 ? `${criticalIssues.length} ticket(s) critiques doivent rester sous surveillance projet.` : 'La sélection ne contient pas de ticket critique.',
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
    text: theme?.text ?? '#0B0F14',
    muted: theme?.textMuted ?? '#5E6670',
    primary: theme?.primary ?? MANUAL_SLATE,
    accent: theme?.accent ?? MANUAL_CYAN,
    surface: theme?.surface ?? '#FFFFFF',
    border: theme?.border ?? '#D8DEE8',
    bg: theme?.bg ?? '#FFFFFF',
    hero: theme?.heroBg ?? MANUAL_CYAN,
    recBg: theme?.recBg ?? '#F5F7FA',
    headerBg: theme?.headerBg ?? MANUAL_CYAN,
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
    <Page {...SLIDE_PAGE} style={{ backgroundColor: dark ? t.hero : t.bg, color: dark ? '#FFFFFF' : t.text, fontFamily: 'DMSans', paddingTop: 42, paddingHorizontal: PAGE_PADDING_X, paddingBottom: 44 }}>
      {!dark ? <View fixed style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 22, backgroundColor: MANUAL_CYAN }} /> : null}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 34 }}>
        <View>
          <Text style={{ fontSize: 11, fontFamily: 'DMSans', fontWeight: 700, color: dark ? 'rgba(255,255,255,0.9)' : MANUAL_CYAN_DARK, textTransform: 'uppercase' }}>
            {options.brandLeft || 'MEDIANET RUN SERVICES'}
          </Text>
          {options.brandRight ? <Text style={{ fontSize: 8, marginTop: 3, color: dark ? 'rgba(255,255,255,0.68)' : t.muted }}>{options.brandRight}</Text> : null}
        </View>
        {project.logo_url ? <Image src={project.logo_url} style={{ width: 104, height: 34, objectFit: 'contain' }} /> : null}
      </View>

      <View style={{ marginBottom: 28 }}>
        <Text style={{ fontFamily: 'DMSans', fontWeight: 700, fontSize: 28, color: dark ? '#FFFFFF' : t.text, textTransform: 'uppercase', lineHeight: 1.05 }}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ fontSize: 10, marginTop: 7, color: dark ? 'rgba(255,255,255,0.78)' : t.muted, textTransform: 'uppercase' }}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      <View style={{ flex: 1 }}>
        {children}
      </View>

      <View style={{ position: 'absolute', left: PAGE_PADDING_X, right: PAGE_PADDING_X, bottom: 24, borderTopWidth: 1, borderTopColor: dark ? 'rgba(255,255,255,0.24)' : '#1F2937', paddingTop: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Image src={snapflowLogo} style={{ width: 74, height: 22, objectFit: 'contain' }} />
          <Text style={{ fontSize: 8, color: dark ? 'rgba(255,255,255,0.68)' : t.muted }}>Medianet x Snapflow App | Rapport confidentiel</Text>
        </View>
        <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} style={{ fontSize: 8, color: dark ? 'rgba(255,255,255,0.68)' : t.muted }} fixed />
      </View>
    </Page>
  );
}

function SectionNote({ children, theme, accentColor }: { children: ReactNode; theme?: PdfTheme; accentColor: string }) {
  const t = pageText(theme);
  return (
    <View style={{ backgroundColor: '#F8FAFC', borderLeftWidth: 5, borderLeftColor: accentColor, padding: 13, borderWidth: 1, borderColor: t.border }}>
      <Text style={{ fontSize: 10, lineHeight: 1.45, color: t.text }}>{children}</Text>
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
    <View style={{ flex: grow ? 1 : undefined, backgroundColor: t.surface, padding: 18, borderBottomWidth: 1, borderBottomColor: '#1F2937', minHeight: 152, justifyContent: 'center' }}>
      <Text style={{ fontSize: 10, color, fontFamily: 'DMSans', fontWeight: 700, textTransform: 'uppercase', textAlign: 'center' }}>{label}</Text>
      <Text style={{ fontSize: 88, lineHeight: 1, color: '#000000', fontFamily: 'DMSans', fontWeight: 700, marginTop: 7, textAlign: 'center' }}>{String(value).padStart(2, '0')}</Text>
      {caption ? <Text style={{ fontSize: 8.5, color: t.muted, marginTop: 8, lineHeight: 1.35, textAlign: 'center' }}>{caption}</Text> : null}
    </View>
  );
}

function MetricStrip({ kpis, theme, accentColor }: { kpis: ActivityKpi[]; theme?: PdfTheme; accentColor: string }) {
  const t = pageText(theme);
  return (
    <View style={{ flexDirection: 'row', gap: 14 }}>
      {kpis.map(kpi => (
        <View key={kpi.key} style={{ flex: 1, backgroundColor: t.surface, paddingVertical: 10, minHeight: 86, justifyContent: 'center' }}>
          <Text style={{ fontSize: 11, color: '#000000', fontFamily: 'DMSans', fontWeight: 700, textAlign: 'center' }}>{String(kpi.value).padStart(2, '0')}.</Text>
          <Text style={{ fontSize: 9, color: kpi.status === 'success' ? accentColor : getStatusColor(kpi.status), fontFamily: 'DMSans', fontWeight: 700, marginTop: 4, textTransform: 'uppercase', textAlign: 'center' }}>{kpi.label}</Text>
          <Text style={{ fontSize: 7.5, color: t.muted, marginTop: 4, textAlign: 'center' }}>{kpi.caption}</Text>
        </View>
      ))}
    </View>
  );
}

function TableLegend({ rows, total, theme, accentColor, label = 'Libelle', limit = 8 }: { rows: CountRow[]; total: number; theme?: PdfTheme; accentColor: string; label?: string; limit?: number }) {
  const t = pageText(theme);
  const visible = rowsWithOther(rows, limit);
  if (!visible.length) {
    return <SectionNote theme={theme} accentColor={accentColor}>Aucune donnée disponible pour cette répartition.</SectionNote>;
  }
  return (
    <View style={{ backgroundColor: MANUAL_YELLOW, padding: 0, minHeight: 286, borderWidth: 1, borderColor: MANUAL_GRID_WHITE }}>
      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: MANUAL_GRID_WHITE }}>
        <Text style={{ width: 230, fontSize: 10, fontFamily: 'DMSans', fontWeight: 700, color: '#FFFFFF', padding: 10, borderRightWidth: 1, borderRightColor: MANUAL_GRID_WHITE }}>{label}</Text>
        <Text style={{ width: 70, fontSize: 10, fontFamily: 'DMSans', fontWeight: 700, color: '#FFFFFF', textAlign: 'right', padding: 10 }}>Tickets</Text>
        <Text style={{ width: 54, fontSize: 10, fontFamily: 'DMSans', fontWeight: 700, color: '#FFFFFF', textAlign: 'right', padding: 10, borderLeftWidth: 1, borderLeftColor: MANUAL_GRID_WHITE }}>%</Text>
      </View>
      {visible.map((row, index) => (
        <View key={`${row.name}-${index}`} style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: index === visible.length - 1 ? 'transparent' : MANUAL_GRID_WHITE }}>
          <Text style={{ width: 230, fontSize: 9.8, color: '#FFFFFF', paddingVertical: 9, paddingHorizontal: 10, borderRightWidth: 1, borderRightColor: MANUAL_GRID_WHITE }}>{short(row.name, 38)}</Text>
          <Text style={{ width: 70, fontSize: 9.8, color: '#FFFFFF', textAlign: 'right', fontFamily: 'DMSans', fontWeight: 700, paddingVertical: 9, paddingHorizontal: 10 }}>{row.count}</Text>
          <Text style={{ width: 54, fontSize: 9.8, color: '#FFFFFF', textAlign: 'right', paddingVertical: 9, paddingHorizontal: 10, borderLeftWidth: 1, borderLeftColor: MANUAL_GRID_WHITE }}>{pct(row.count, total)}%</Text>
        </View>
      ))}
      <Text style={{ fontSize: 8, color: '#FFFFFF', marginTop: 9, paddingHorizontal: 10, paddingBottom: 10 }}>Chiffres basés sur les tickets chargés dans le rapport.</Text>
    </View>
  );
}

function HorizontalBars({ rows, theme, limit = 8 }: { rows: CountRow[]; theme?: PdfTheme; limit?: number }) {
  const t = pageText(theme);
  const visible = rowsWithOther(rows, limit);
  const max = Math.max(...visible.map(row => row.count), 1);
  if (!visible.length) return <Text style={{ fontSize: 11, color: t.muted }}>Aucune donnée.</Text>;
  return (
    <View style={{ gap: 14 }}>
      {visible.map((row, index) => (
        <View key={`${row.name}-${index}`}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text style={{ fontSize: 11, color: t.text }}>{short(row.name, 34)}</Text>
            <Text style={{ fontSize: 11, color: t.text, fontFamily: 'DMSans', fontWeight: 700 }}>{row.count}</Text>
          </View>
          <View style={{ height: 14, backgroundColor: '#E9EEF5' }}>
            <View style={{ width: `${Math.max(4, (row.count / max) * 100)}%`, height: 14, backgroundColor: row.color ?? CHART_COLORS[index % CHART_COLORS.length] }} />
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
  if (!visible.length) return <Text style={{ fontSize: 11, color: t.muted }}>Aucune donnée.</Text>;
  return (
    <View style={{ height: 292, flexDirection: 'row', alignItems: 'flex-end', gap: 12, paddingTop: 12 }}>
      {visible.map((row, index) => {
        const height = Math.max(28, (row.count / max) * 218);
        return (
          <View key={`${row.name}-${index}`} style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ fontSize: 11, fontFamily: 'DMSans', fontWeight: 700, color: row.color ?? CHART_COLORS[index % CHART_COLORS.length], marginBottom: 6 }}>{row.count}</Text>
            <View style={{ height, width: '64%', backgroundColor: row.color ?? CHART_COLORS[index % CHART_COLORS.length] }} />
            <Text style={{ fontSize: 8.2, color: t.muted, textAlign: 'center', marginTop: 7 }}>{short(row.name, 17)}</Text>
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
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 28 }}>
      <Svg width={size} height={size} viewBox="0 0 140 140">
        {visible.map((row, index) => {
          const angle = (row.count / total) * 360;
          const path = donutSegmentPath(70, 70, 54, 30, cursor, cursor + angle);
          cursor += angle;
          return <Path key={`${row.name}-${index}`} d={path} fill={row.color ?? CHART_COLORS[index % CHART_COLORS.length]} />;
        })}
      </Svg>
      <View style={{ flex: 1, gap: 7 }}>
        <Text style={{ fontSize: 46, lineHeight: 1, fontFamily: 'DMSans', fontWeight: 700, color: t.primary }}>{total}</Text>
        {visible.map((row, index) => (
          <View key={`${row.name}-${index}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: row.color ?? CHART_COLORS[index % CHART_COLORS.length] }} />
            <Text style={{ fontSize: 9.8, color: t.text, width: 178 }}>{short(row.name, 32)}</Text>
            <Text style={{ fontSize: 9.8, color: t.muted, textAlign: 'right', width: 42 }}>{row.count}</Text>
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
    <View style={{ flex: 1.35, backgroundColor: t.surface, padding: 22, minHeight: 430, justifyContent: 'center' }}>
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
    <View style={{ flexDirection: 'row', gap: 34, alignItems: 'stretch' }}>
      {reverse ? tableNode : chartNode}
      {reverse ? chartNode : tableNode}
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
  const widths = [90, 600, 150, 130, 120];
  return (
    <View style={{ backgroundColor: t.surface, borderWidth: 1, borderColor: '#9CA3AF', overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: MANUAL_CYAN, paddingVertical: 11, paddingHorizontal: 14 }}>
        <Text style={{ fontSize: 13, fontFamily: 'DMSans', fontWeight: 700, color: '#FFFFFF', textTransform: 'uppercase' }}>{title}</Text>
        <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.9)' }}>{continuation || `${totalRows} ticket(s)`}</Text>
      </View>
      <View style={{ flexDirection: 'row', backgroundColor: MANUAL_CYAN, borderTopWidth: 1, borderTopColor: '#FFFFFF' }}>
        {['Identifiant', 'Sujet', 'Type', 'Priorité', 'Date Ouverture'].map((label, index) => (
          <Text key={label} style={{ width: widths[index], fontSize: 9.5, color: '#0B0F14', fontFamily: 'DMSans', fontWeight: 700, paddingVertical: 9, paddingHorizontal: 10, borderRightWidth: 1, borderRightColor: index === widths.length - 1 ? 'transparent' : '#FFFFFF' }}>{label}</Text>
        ))}
      </View>
      {issues.map((issue, index) => (
        <View key={issue.id} wrap={false} style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#D1D5DB', backgroundColor: index % 2 ? '#F8FAFC' : '#FFFFFF' }}>
          <Text style={{ width: widths[0], fontSize: 9.2, color: t.text, fontFamily: 'DMSans', fontWeight: 700, paddingVertical: 10, paddingHorizontal: 10, borderRightWidth: 1, borderRightColor: '#D1D5DB' }}>#{issue.id}</Text>
          <Text style={{ width: widths[1], fontSize: 9.2, color: t.text, lineHeight: 1.22, paddingVertical: 10, paddingHorizontal: 10, borderRightWidth: 1, borderRightColor: '#D1D5DB' }}>{short(issue.subject, 116)}</Text>
          <Text style={{ width: widths[2], fontSize: 9.1, color: t.text, paddingVertical: 10, paddingHorizontal: 10, borderRightWidth: 1, borderRightColor: '#D1D5DB' }}>{short(issue.tracker.name, 22)}</Text>
          <Text style={{ width: widths[3], fontSize: 9.1, color: t.text, paddingVertical: 10, paddingHorizontal: 10, borderRightWidth: 1, borderRightColor: '#D1D5DB' }}>{short(issue.priority.name, 18)}</Text>
          <Text style={{ width: widths[4], fontSize: 9.1, color: t.text, paddingVertical: 10, paddingHorizontal: 10 }}>{safeDate(issue.created_on, 'yyyy')}</Text>
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

function ticketStatusLine(issue: RedmineIssue) {
  const status = clean(issue.status.name);
  const updated = safeDate(issue.updated_on);
  if (status && updated !== '-') return `Statut Redmine : ${status} | Mise à jour : ${updated}`;
  if (status) return `Statut Redmine : ${status}`;
  if (updated !== '-') return `Mise à jour : ${updated}`;
  return '';
}

function TicketDetailLine({ issue, theme, accentColor }: { issue: RedmineIssue; theme?: PdfTheme; accentColor: string }) {
  const t = pageText(theme);
  const statusLine = ticketStatusLine(issue);
  return (
    <View wrap={false} style={{ borderBottomWidth: 1, borderBottomColor: '#8B9199', paddingBottom: 13, marginBottom: 13 }}>
      <Text style={{ fontSize: 13, color: t.text, fontFamily: 'DMSans', fontWeight: 700, lineHeight: 1.22 }}>
        {short(`${issue.tracker.name} #${issue.id} : ${issue.subject}`, 128)} - <Text style={{ color: accentColor }}>{short(issue.priority.name, 18).toUpperCase()}</Text>
      </Text>
      {statusLine ? <Text style={{ fontSize: 9.5, color: t.muted, marginTop: 7 }}>{statusLine}</Text> : null}
    </View>
  );
}

function TicketNarrativePage({
  issues,
  title,
  project,
  theme,
  options,
  accentColor,
}: {
  issues: RedmineIssue[];
  title: string;
  project: DashboardProject;
  theme?: PdfTheme;
  options: ActivityPdfOptions;
  accentColor: string;
}) {
  const shown = issues.slice(0, 5);
  return (
    <ActivitySlidePage title={title} project={project} theme={theme} options={options}>
      <View style={{ flexDirection: 'row', gap: 42, alignItems: 'stretch', marginTop: 8 }}>
        <View style={{ width: 280, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: '#1F2937' }}>
          <Text style={{ fontSize: 124, lineHeight: 1, color: '#000000', fontFamily: 'DMSans', fontWeight: 700, textAlign: 'center' }}>
            {String(issues.length).padStart(2, '0')}
          </Text>
        </View>
        <View style={{ flex: 1, paddingTop: 18 }}>
          {shown.map(issue => (
            <TicketDetailLine key={issue.id} issue={issue} theme={theme} accentColor={accentColor} />
          ))}
          {issues.length > shown.length ? (
            <Text style={{ fontSize: 10, color: pageText(theme).muted, marginTop: 4 }}>
              + {issues.length - shown.length} ticket(s) supplémentaire(s) dans la sélection Redmine.
            </Text>
          ) : null}
        </View>
      </View>
    </ActivitySlidePage>
  );
}

function CoverPage({ project, filters, options, data, theme, accentColor }: { project: DashboardProject; filters?: ActivityDocumentProps['filters']; options: ActivityPdfOptions; data: ActivityData; theme?: PdfTheme; accentColor: string }) {
  return (
    <Page {...SLIDE_PAGE} style={{ backgroundColor: MANUAL_CYAN, color: '#FFFFFF', fontFamily: 'DMSans', paddingTop: 92, paddingHorizontal: 78, paddingBottom: 48 }}>
      <View style={{ position: 'absolute', top: 26, right: 76 }}>
        <Text style={{ color: 'rgba(255,255,255,0.86)', fontSize: 9, fontFamily: 'DMSans', fontWeight: 700, textTransform: 'uppercase' }}>{options.brandLeft || 'RUN SERVICES'}</Text>
      </View>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Text style={{ fontFamily: 'DMSans', fontWeight: 700, fontSize: 48, color: '#FFFFFF', lineHeight: 1.02, textTransform: 'uppercase' }}>RAPPORT D'ACTIVITÉ</Text>
        <View style={{ width: 390, height: 2, backgroundColor: 'rgba(255,255,255,0.42)', marginTop: 14, marginBottom: 17 }} />
        <Text style={{ color: '#FFFFFF', fontSize: 12, fontFamily: 'DMSans', fontWeight: 700 }}>{periodLabel(filters)}</Text>
        {project.url ? <Text style={{ color: '#FFFFFF', fontSize: 12, fontFamily: 'DMSans', fontWeight: 700, marginTop: 11 }}>{project.url}</Text> : null}
        {filterSummary(filters) ? (
          <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 10, marginTop: 8 }}>{filterSummary(filters)}</Text>
        ) : null}
        <Text style={{ color: '#FFFFFF', fontSize: 9.5, marginTop: 12, width: 420, lineHeight: 1.25, textAlign: 'center' }}>
          #Maintenance #Webmastering #Sécurité #Hosting #Backup #Data{'\n'}#Business #Support
        </Text>
        <Text style={{ color: 'rgba(255,255,255,0.78)', fontSize: 8.5, marginTop: 24 }}>
          {data.total} ticket(s) de traitement | {data.meetings.length} réunion(s)
        </Text>
      </View>
      <View style={{ position: 'absolute', bottom: 32, left: 78, right: 78, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View>
          <Text style={{ color: 'rgba(255,255,255,0.78)', fontSize: 9 }}>{options.contactWeb || 'medianet.tn'}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {project.logo_url ? <Image src={project.logo_url} style={{ width: 94, height: 30, objectFit: 'contain' }} /> : null}
          <Image src={snapflowLogo} style={{ width: 88, height: 26, objectFit: 'contain' }} />
        </View>
      </View>
    </Page>
  );
}

function SommairePage({ project, options, theme, sections, perimeterBlocks }: { project: DashboardProject; options: ActivityPdfOptions; theme?: PdfTheme; sections: string[]; perimeterBlocks: ProjectPerimeterBlock[] }) {
  const t = pageText(theme);
  const hasPerimeter = hasProjectPerimeterBlocks(perimeterBlocks);
  const groups = [
    hasPerimeter ? {
      num: '01',
      title: 'PÉRIMÈTRE',
      subtitle: 'Cadre du projet et services couverts',
      items: perimeterBlocks.map((block) => block.title).filter(Boolean),
    } : null,
    {
      num: hasPerimeter ? '02' : '01',
      title: 'SUIVI DES ACTIVITÉS RÉALISÉES',
      subtitle: 'Indicateurs, graphiques et détails tickets',
      items: sections.slice(0, 7),
    },
    {
      num: hasPerimeter ? '03' : '02',
      title: 'SYNTHESE ET CONCLUSION',
      subtitle: 'Blocages, réunions et clôture du rapport',
      items: sections.slice(7),
    },
  ].filter(Boolean) as Array<{ num: string; title: string; subtitle: string; items: string[] }>;
  return (
    <ActivitySlidePage title="SOMMAIRE" subtitle="Périmètre, suivi des activités réalisées, synthèse et conclusion" project={project} theme={theme} options={options}>
      <View style={{ flexDirection: 'row', gap: 34, marginTop: 18 }}>
        {groups.map(group => (
          <View key={group.num} style={{ flex: 1, backgroundColor: t.surface, padding: 28, borderTopWidth: 2, borderTopColor: MANUAL_SLATE, minHeight: 430 }}>
            <Text style={{ fontSize: 44, color: options.pdfColor || t.accent, fontFamily: 'DMSans', fontWeight: 700, lineHeight: 1 }}>{group.num}</Text>
            <Text style={{ fontSize: 17, color: t.text, fontFamily: 'DMSans', fontWeight: 700, marginTop: 18, textTransform: 'uppercase', lineHeight: 1.2 }}>{group.title}</Text>
            <Text style={{ fontSize: 10, color: t.muted, marginTop: 8, lineHeight: 1.35 }}>{group.subtitle}</Text>
            <View style={{ marginTop: 20, gap: 9 }}>
              {(group.items.length ? group.items : ['Merci']).slice(0, 8).map(item => (
                <Text key={item} style={{ fontSize: 10, color: t.text, lineHeight: 1.25 }}>- {item}</Text>
              ))}
            </View>
          </View>
        ))}
      </View>
    </ActivitySlidePage>
  );
}
function PerimetrePage({ project, filters, options, theme, accentColor, blocks }: { project: DashboardProject; filters?: ActivityDocumentProps['filters']; options: ActivityPdfOptions; theme?: PdfTheme; accentColor: string; blocks: ProjectPerimeterBlock[] }) {
  const t = pageText(theme);
  return (
    <ActivitySlidePage title="PÉRIMÈTRE & CADRE DU PROJET" subtitle={`Services couverts par le contrat | ${periodLabel(filters)}`} project={project} theme={theme} options={options}>
      <View style={{ gap: 24 }}>
        <View style={{ backgroundColor: '#F8FAFC', borderLeftWidth: 5, borderLeftColor: accentColor, padding: 18 }}>
          <Text style={{ fontSize: 11, color: t.text, lineHeight: 1.5 }}>
            Ce rapport présente le périmètre configuré pour le projet, les activités suivies via Redmine et les interventions réalisées durant {periodSentence(filters)}.
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 28 }}>
          {blocks.slice(0, 4).map(block => (
            <View key={block.id ?? block.title} style={{ flex: 1, backgroundColor: '#F5F7FA', padding: 22, minHeight: 330 }}>
              <Text style={{ fontSize: 12, color: accentColor, fontFamily: 'DMSans', fontWeight: 700, textTransform: 'uppercase' }}>{block.title}</Text>
              {block.subtitle ? <Text style={{ fontSize: 9, color: t.muted, marginTop: 7, textTransform: 'uppercase' }}>{block.subtitle}</Text> : null}
              <View style={{ marginTop: 18, gap: 10 }}>
                {block.items.map(item => (
                  <Text key={item} style={{ fontSize: 10, color: t.text, lineHeight: 1.35 }}>- {item}</Text>
                ))}
              </View>
            </View>
          ))}
        </View>
      </View>
    </ActivitySlidePage>
  );
}
export function ActivityDocument({ project, issues, totalCount, filters, options, perimeterBlocks = [] }: ActivityDocumentProps) {
  const theme = options.theme;
  makePageStyles(theme);
  const data = buildData(issues, totalCount);
  const sections = buildActivitySections(data);
  const t = pageText(theme);
  const accentColor = options.pdfColor || t.accent;
  const contactLine = [options.contactEmail, options.contactWeb, options.contactWeb2].filter(Boolean).join(' | ');
  const showPerimeter = options.sections.perimetre !== false && hasProjectPerimeterBlocks(perimeterBlocks);
  const generatedSections = [
    showPerimeter ? 'Périmètre' : null,
    'Indicateurs globaux',
    'État des tickets',
    'Typologie des tickets',
    'Priorité des tickets',
    'Détails des tickets clôturés',
    'Détails des tickets ouverts',
    sections.showCancelledAnalysis ? 'Tickets annulés' : null,
    sections.showActiveTables ? 'Tickets en cours de traitement' : null,
    sections.showValidationDetails ? 'Tickets en cours de validation' : null,
    sections.showAcknowledgedDetails ? 'Tickets pris en charge' : null,
    sections.showBlockedAnalysis ? 'Tickets bloqués' : null,
    sections.showMeetings ? "Réunions et points d'échange" : null,
  ].filter(Boolean) as string[];

  return (
    <Document title={`Rapport d'activité - ${project.site_name}`}>
      <CoverPage project={project} filters={filters} options={options} data={data} theme={theme} accentColor={accentColor} />

      {options.sections.sommaire !== false && (
        <SommairePage project={project} options={options} theme={theme} sections={generatedSections} perimeterBlocks={perimeterBlocks} />
      )}

      {showPerimeter && (
        <PerimetrePage project={project} filters={filters} options={options} theme={theme} accentColor={accentColor} blocks={perimeterBlocks} />
      )}

      <ActivitySlidePage title="SUIVI DES ACTIVITÉS RÉALISÉES" subtitle="INDICATEURS GLOBAUX" project={project} theme={theme} options={options}>
        <View style={{ flexDirection: 'row', gap: 34 }}>
          <View style={{ flex: 1.05, gap: 12 }}>
            <View style={{ backgroundColor: '#F8FAFC', borderLeftWidth: 5, borderLeftColor: accentColor, padding: 18 }}>
              <Text style={{ fontSize: 11, color: t.text, lineHeight: 1.45 }}>
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
        <View style={{ flexDirection: 'row', gap: 34 }}>
          <View style={{ width: 330 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <BigNumberPanel value={data.closedTickets.length} label="NOMBRE TICKETS CLÔTURÉS" caption="Chiffres basés sur la typologie des tickets clôturés" theme={theme} accentColor={accentColor} grow />
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ backgroundColor: t.surface, padding: 18 }}>
              <Text style={{ fontSize: 11, fontFamily: 'DMSans', fontWeight: 700, color: t.primary, marginBottom: 10 }}>Chiffres basés sur la typologie des tickets clôturés</Text>
              <VerticalBars rows={data.closedByType} theme={theme} />
            </View>
          </View>
        </View>
      </ActivitySlidePage>

      <ActivitySlidePage title="DÉTAILS DES TICKETS OUVERTS" subtitle="Chiffres basés sur la typologie des tickets ouverts" project={project} theme={theme} options={options}>
        <View style={{ flexDirection: 'row', gap: 34 }}>
          <View style={{ width: 330 }}>
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
            <View style={{ backgroundColor: t.surface, padding: 18 }}>
              <Text style={{ fontSize: 11, fontFamily: 'DMSans', fontWeight: 700, color: t.primary, marginBottom: 10 }}>Chiffres basés sur la typologie des tickets ouverts</Text>
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
            <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: 12, borderWidth: 1, borderColor: t.border, padding: 14 }}>
              <Text style={{ fontSize: 10, fontFamily: 'DMSans', fontWeight: 700, color: t.primary, marginBottom: 10 }}>TYPOLOGIE DES TICKETS ANNULÉS</Text>
              <VerticalBars rows={data.cancelledByType} theme={theme} />
            </View>
            <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: 12, borderWidth: 1, borderColor: t.border, padding: 14 }}>
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

      {sections.showActiveTables && (
        <ActivitySlidePage title="DÉTAILS DES TICKETS EN COURS DE TRAITEMENT" subtitle="Chiffres basés sur la typologie des tickets en cours de traitement" project={project} theme={theme} options={options}>
          <View style={{ flexDirection: 'row', gap: 34 }}>
            <View style={{ width: 330 }}>
              <BigNumberPanel value={data.activeTickets.length} label="NOMBRE TICKETS EN COURS DE TRAITEMENT" caption="Chiffres basés sur la typologie des tickets en cours de traitement" theme={theme} status="warning" accentColor={accentColor} grow />
            </View>
            <View style={{ flex: 1, backgroundColor: t.surface, padding: 18 }}>
              <VerticalBars rows={data.activeByType} theme={theme} />
            </View>
          </View>
        </ActivitySlidePage>
      )}

      {sections.showActiveTables && renderTicketTablePages({
        issues: data.activeTickets,
        title: 'TICKETS EN COURS DE TRAITEMENT',
        subtitle: "Identifiant, sujet, type, priorité et date d'ouverture",
        project,
        theme,
        options,
        accentColor,
      })}

      {sections.showValidationDetails && (
        <TicketNarrativePage
          issues={data.testingTickets}
          title="TICKETS EN COURS DE VALIDATION"
          project={project}
          theme={theme}
          options={options}
          accentColor={accentColor}
        />
      )}

      {sections.showAcknowledgedDetails && (
        <TicketNarrativePage
          issues={data.acknowledgedTickets}
          title="TICKETS PRIS EN CHARGE"
          project={project}
          theme={theme}
          options={options}
          accentColor={accentColor}
        />
      )}

      {sections.showBlockedAnalysis && (
        <ActivitySlidePage title="TICKETS BLOQUÉS" subtitle="Analyse des tickets en attente d'action ou de décision" project={project} theme={theme} options={options}>
          <View style={{ flexDirection: 'row', gap: 16 }}>
            <View style={{ width: 170 }}>
              <BigNumberPanel value={data.blockedTickets.length} label="NOMBRE TICKETS BLOQUÉS" caption="Tickets en attente de déblocage" theme={theme} status="danger" accentColor={accentColor} />
            </View>
            <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: 12, borderWidth: 1, borderColor: t.border, padding: 14 }}>
              <Text style={{ fontSize: 10, fontFamily: 'DMSans', fontWeight: 700, color: t.primary, marginBottom: 10 }}>PRIORITÉ DES TICKETS BLOQUÉS</Text>
              <HorizontalBars rows={data.blockedByPriority} theme={theme} limit={5} />
            </View>
            <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: 12, borderWidth: 1, borderColor: t.border, padding: 14 }}>
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
        <ActivitySlidePage title="Merci" subtitle="Rapport généré automatiquement depuis Redmine" project={project} theme={theme} options={options} tone="brand">
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

