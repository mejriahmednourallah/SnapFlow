import { Document, Page, Text, View } from '@react-pdf/renderer';
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

const clean = (value?: string | null) => (value || '').trim();
const deAccent = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const isClosed = (value: string) => /ferm|clotur|clos|reject|valid/.test(deAccent(value));
const isResolved = (value: string) => /ferm|clotur|clos|resolu|resolved|reject|valid/.test(deAccent(value));
const isResolvedOnly = (value: string) => /resolu|resolved/.test(deAccent(value)) && !isClosed(value);
const isBlocked = (value: string) => /bloqu|attente|hold|feedback|suspendu|suspend|en cours de valid/.test(deAccent(value));
const isCritical = (value: string) => /critique|critical|urgent|immediat|immediate/.test(deAccent(value));

function pct(count: number, total: number) {
  if (!total) return 0;
  return Math.round((count / total) * 100);
}

function countBy<T>(items: T[], key: (item: T) => string) {
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

function buildData(issues: RedmineIssue[], totalCount: number) {
  const total = issues.length;
  const resolvedIssues = issues.filter((issue) => isResolved(issue.status.name));
  const openIssues = issues.filter((issue) => !isResolved(issue.status.name));
  const blockedIssues = issues.filter((issue) => isBlocked(issue.status.name));
  const criticalIssues = issues.filter((issue) => isCritical(issue.priority.name));
  const pendingValidation = issues.filter((issue) => isResolvedOnly(issue.status.name) && differenceInDays(Date.now(), new Date(issue.updated_on).getTime()) > 2);
  const avgResolutionDays = avgDays(resolvedIssues);
  const avgOpenDays = avgDays(openIssues);
  const health = clamp(100 - pct(blockedIssues.length, Math.max(total, 1)) * 0.5 - pct(criticalIssues.length, Math.max(total, 1)) * 0.35 - Math.min(avgOpenDays || 0, 60) * 0.35);
  const status: SeverityStatus = health >= 75 ? 'success' : health >= 50 ? 'warning' : 'danger';

  const kpis: ActivityKpi[] = [
    { key: 'total', label: 'Tickets', value: String(totalCount || total), caption: totalCount !== total ? `${total} dans la vue filtree` : 'Perimetre complet', status: 'success' },
    { key: 'open', label: 'En cours', value: String(openIssues.length), caption: `${pct(openIssues.length, total)} % des tickets`, status: openIssues.length ? 'warning' : 'success' },
    { key: 'resolved', label: 'Resolus', value: String(resolvedIssues.length), caption: `${pct(resolvedIssues.length, total)} % traites`, status: 'success' },
    { key: 'critical', label: 'Critiques', value: String(criticalIssues.length), caption: 'Priorite urgente ou critique', status: criticalIssues.length ? 'danger' : 'success' },
    { key: 'blocked', label: 'Bloques', value: String(blockedIssues.length), caption: 'Tickets en attente ou bloques', status: blockedIssues.length ? 'danger' : 'success' },
    { key: 'closure', label: 'Delai moyen', value: avgResolutionDays == null ? '-' : `${avgResolutionDays} j`, caption: 'Resolution des tickets clos', status: avgResolutionDays == null || avgResolutionDays <= 7 ? 'success' : avgResolutionDays <= 21 ? 'warning' : 'danger' },
  ];

  const insights = [
    blockedIssues.length > 0 ? `Traiter en priorite les ${blockedIssues.length} ticket(s) bloques ou en attente.` : 'Aucun blocage majeur detecte dans la selection.',
    pendingValidation.length > 0 ? `${pendingValidation.length} ticket(s) resolus attendent une validation client.` : 'Aucun ticket resolu ne semble attendre une validation prolongee.',
    criticalIssues.length > 0 ? `Surveiller les ${criticalIssues.length} ticket(s) critiques pour eviter un impact projet.` : 'La selection ne contient pas de ticket critique.',
  ];

  return {
    total,
    totalCount,
    open: openIssues.length,
    resolved: resolvedIssues.length,
    blocked: blockedIssues.length,
    critical: criticalIssues.length,
    pendingValidation,
    blockedIssues,
    criticalIssues,
    avgResolutionDays,
    avgOpenDays,
    health,
    healthStatus: status,
    kpis,
    statusRows: countBy(issues, (issue) => issue.status.name),
    trackerRows: countBy(issues, (issue) => issue.tracker.name),
    priorityRows: countBy(issues, (issue) => issue.priority.name),
    timelineRows: groupByWeek(issues),
    insights,
  };
}

function filterSummary(filters?: ActivityDocumentProps['filters']) {
  const parts = [
    filters?.statusLabel ? `Statut : ${filters.statusLabel}` : null,
    filters?.trackerLabel ? `Tracker : ${filters.trackerLabel}` : null,
    filters?.dateFrom ? `Depuis : ${filters.dateFrom}` : null,
    filters?.dateTo ? `Jusqu'au : ${filters.dateTo}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' | ') : 'Tous les tickets disponibles';
}

function periodLabel(filters?: ActivityDocumentProps['filters']) {
  if (filters?.dateFrom && filters?.dateTo) return `Du ${filters.dateFrom} au ${filters.dateTo}`;
  if (filters?.dateFrom) return `Depuis le ${filters.dateFrom}`;
  if (filters?.dateTo) return `Jusqu'au ${filters.dateTo}`;
  return 'Toutes periodes confondues';
}

function KpiCard({ item, theme }: { item: ActivityKpi; theme?: PdfTheme }) {
  const s = makePageStyles(theme);
  const color = getStatusColor(item.status);
  return (
    <View style={{ ...s.card, width: '31.8%', minHeight: 82, marginBottom: 10 }}>
      <Text style={{ fontSize: 7.5, color: theme?.textMuted ?? '#64748B', textTransform: 'uppercase' }}>{item.label}</Text>
      <Text style={{ fontSize: 24, fontFamily: 'DMSans', fontWeight: 700, color, marginTop: 5 }}>{item.value}</Text>
      <Text style={{ fontSize: 8, color: theme?.textMuted ?? '#64748B', marginTop: 4 }}>{item.caption}</Text>
    </View>
  );
}

function Bars({ rows, theme, limit = 10 }: { rows: { name: string; count: number }[]; theme?: PdfTheme; limit?: number }) {
  const max = Math.max(...rows.map((row) => row.count), 1);
  return (
    <View style={{ gap: 7 }}>
      {rows.slice(0, limit).map((row) => (
        <View key={row.name}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
            <Text style={{ fontSize: 8.2, color: theme?.text ?? '#111827' }}>{row.name}</Text>
            <Text style={{ fontSize: 8.2, color: theme?.textMuted ?? '#64748B' }}>{row.count}</Text>
          </View>
          <View style={{ height: 6, backgroundColor: theme?.border ?? '#D7E0EA', borderRadius: 4 }}>
            <View style={{ width: `${Math.max(4, (row.count / max) * 100)}%`, height: 6, backgroundColor: theme?.accent ?? '#4E8CCF', borderRadius: 4 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

function TicketTable({ issues, theme, title }: { issues: RedmineIssue[]; theme?: PdfTheme; title: string }) {
  const s = makePageStyles(theme);
  const rows = issues.slice(0, 18);
  return (
    <View style={{ ...s.card }}>
      <Text style={s.h3}>{title}</Text>
      <View style={{ flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 0.8, borderBottomColor: theme?.border ?? '#D7E0EA' }}>
        {['#', 'Sujet', 'Statut', 'Priorite', 'Avancement'].map((label, index) => (
          <Text key={label} style={{ width: [42, 220, 80, 74, 70][index], fontSize: 7.2, color: theme?.textMuted ?? '#64748B', fontFamily: 'DMSans', fontWeight: 700 }}>{label}</Text>
        ))}
      </View>
      {rows.map((issue) => (
        <View key={issue.id} style={{ flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 0.4, borderBottomColor: theme?.border ?? '#D7E0EA' }}>
          <Text style={{ width: 42, fontSize: 7.5 }}>#{issue.id}</Text>
          <Text style={{ width: 220, fontSize: 7.5 }}>{issue.subject.slice(0, 78)}</Text>
          <Text style={{ width: 80, fontSize: 7.5 }}>{issue.status.name}</Text>
          <Text style={{ width: 74, fontSize: 7.5 }}>{issue.priority.name}</Text>
          <Text style={{ width: 70, fontSize: 7.5 }}>{issue.done_ratio}%</Text>
        </View>
      ))}
    </View>
  );
}

function StandardPage({ title, project, theme, children }: { title: string; project: DashboardProject; theme?: PdfTheme; children: ReactNode }) {
  const s = makePageStyles(theme);
  return (
    <Page size="A4" style={s.page}>
      <PageHeader title={title} siteName={project.site_name} theme={theme} />
      <View style={s.body}>{children}</View>
      <PageFooter preparedBy="Medianet x Snapflow App" theme={theme} />
    </Page>
  );
}

export function ActivityDocument({ project, issues, totalCount, filters, options }: ActivityDocumentProps) {
  const theme = options.theme;
  const s = makePageStyles(theme);
  const data = buildData(issues, totalCount);
  const selectedKpis = data.kpis.filter((kpi) => options.coverKpis[kpi.key] !== false);
  const enabled = (key: string) => options.sections[key] !== false;
  const sectionList = [
    enabled('sommaire') && 'Table des matieres',
    'Resume executif',
    enabled('indicateurs') && 'Grille des indicateurs',
    enabled('statuts') && 'Repartition par statut',
    enabled('trackers') && 'Categories et priorites',
    enabled('evolution') && 'Evolution temporelle',
    enabled('bloqueSynth') && 'Tickets bloques',
    enabled('validation') && 'Validation client',
    enabled('insights') && 'Recommandations',
    enabled('appendix') && 'Annexe tickets',
  ].filter(Boolean) as string[];

  return (
    <Document title={`Rapport activite - ${project.site_name}`}>
      <Page size="A4" style={s.page}>
        <View style={{ backgroundColor: theme?.heroBg ?? '#1E3A5F', minHeight: '100%', padding: 38 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 80 }}>
            <Text style={{ color: '#FFFFFF', fontSize: 9, fontFamily: 'DMSans', fontWeight: 700 }}>{options.brandLeft || "RAPPORT D'ACTIVITE"}</Text>
            <Text style={{ color: '#FFFFFF', fontSize: 9, fontFamily: 'DMSans', fontWeight: 700 }}>{options.brandRight || 'SNAPFLOW'}</Text>
          </View>
          <Text style={{ fontFamily: 'PlayfairDisplay', fontSize: 44, color: '#FFFFFF', lineHeight: 1.08 }}>Rapport{'\n'}d'activite</Text>
          <Text style={{ color: 'rgba(255,255,255,0.82)', fontSize: 13, marginTop: 18 }}>{project.site_name}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 9, marginTop: 8 }}>{periodLabel(filters)}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 8, marginTop: 4 }}>{filterSummary(filters)}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 42 }}>
            {selectedKpis.map((kpi) => (
              <View key={kpi.key} style={{ width: '31%', backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 10, padding: 10 }}>
                <Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 7, textTransform: 'uppercase' }}>{kpi.label}</Text>
                <Text style={{ color: '#FFFFFF', fontSize: 22, fontFamily: 'DMSans', fontWeight: 700, marginTop: 4 }}>{kpi.value}</Text>
                <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 7, marginTop: 3 }}>{kpi.caption}</Text>
              </View>
            ))}
          </View>
          <Text style={{ position: 'absolute', bottom: 34, left: 38, color: 'rgba(255,255,255,0.7)', fontSize: 8 }}>
            Genere le {format(new Date(), 'dd MMMM yyyy a HH:mm', { locale: fr })}
          </Text>
        </View>
      </Page>

      {enabled('sommaire') && (
        <StandardPage title="Table des matieres" project={project} theme={theme}>
          <SectionTitle title="Structure du rapport" theme={theme} />
          {sectionList.map((section, index) => (
            <View key={section} style={{ ...s.card, flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={{ fontSize: 9.2, color: theme?.text ?? '#111827' }}>{section}</Text>
              <Text style={{ fontSize: 8.5, color: theme?.textMuted ?? '#64748B' }}>{String(index + 1).padStart(2, '0')}</Text>
            </View>
          ))}
        </StandardPage>
      )}

      <StandardPage title="Resume executif" project={project} theme={theme}>
        <SectionTitle title="Vue globale" theme={theme} />
        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 14 }}>
          <View style={{ ...s.card, width: 165, alignItems: 'center' }}>
            <ScoreGauge score={data.health} status={data.healthStatus} caption="Score activite" theme={theme} />
          </View>
          <View style={{ ...s.card, flex: 1 }}>
            <Text style={s.h3}>Lecture rapide</Text>
            <Text style={s.bodyText}>
              Le rapport couvre {data.total} ticket(s) pour {project.site_name}. {data.open} restent en cours, {data.resolved} sont resolus et {data.blocked} demandent une attention particuliere.
            </Text>
            <Text style={{ ...s.textMuted, marginTop: 8 }}>{filterSummary(filters)}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          {data.kpis.map((kpi) => <KpiCard key={kpi.key} item={kpi} theme={theme} />)}
        </View>
      </StandardPage>

      {enabled('indicateurs') && (
        <StandardPage title="Grille des indicateurs" project={project} theme={theme}>
          <SectionTitle title="Indicateurs operationnels" theme={theme} />
          <View style={{ gap: 12 }}>
            <ProgressBar label="Taux de resolution" value={pct(data.resolved, data.total)} status={data.resolved >= data.open ? 'success' : 'warning'} theme={theme} />
            <ProgressBar label="Tickets bloques" value={pct(data.blocked, data.total)} status={data.blocked ? 'danger' : 'success'} theme={theme} />
            <ProgressBar label="Tickets critiques" value={pct(data.critical, data.total)} status={data.critical ? 'danger' : 'success'} theme={theme} />
            <ProgressBar label="Tickets encore ouverts" value={pct(data.open, data.total)} status={data.open ? 'warning' : 'success'} theme={theme} />
          </View>
        </StandardPage>
      )}

      {enabled('statuts') && (
        <StandardPage title="Repartition par statut" project={project} theme={theme}>
          <SectionTitle title="Etat des tickets" theme={theme} />
          <Bars rows={data.statusRows} theme={theme} />
        </StandardPage>
      )}

      {enabled('trackers') && (
        <StandardPage title="Categories et priorites" project={project} theme={theme}>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ ...s.card, flex: 1 }}>
              <Text style={s.h3}>Categories</Text>
              <Bars rows={data.trackerRows} theme={theme} limit={8} />
            </View>
            <View style={{ ...s.card, flex: 1 }}>
              <Text style={s.h3}>Priorites</Text>
              <Bars rows={data.priorityRows} theme={theme} limit={8} />
            </View>
          </View>
        </StandardPage>
      )}

      {enabled('evolution') && (
        <StandardPage title="Evolution temporelle" project={project} theme={theme}>
          <SectionTitle title="Volume cree par semaine" theme={theme} />
          <Bars rows={data.timelineRows} theme={theme} limit={16} />
        </StandardPage>
      )}

      {enabled('bloqueSynth') && data.blockedIssues.length > 0 && (
        <StandardPage title="Tickets bloques" project={project} theme={theme}>
          <TicketTable issues={data.blockedIssues} theme={theme} title="Tickets a debloquer" />
        </StandardPage>
      )}

      {enabled('validation') && data.pendingValidation.length > 0 && (
        <StandardPage title="Validation client" project={project} theme={theme}>
          <TicketTable issues={data.pendingValidation} theme={theme} title="Tickets resolus en attente de validation" />
        </StandardPage>
      )}

      {enabled('insights') && (
        <StandardPage title="Recommandations" project={project} theme={theme}>
          <SectionTitle title="Actions recommandees" theme={theme} />
          {data.insights.map((insight) => (
            <View key={insight} style={{ ...s.card, marginBottom: 10 }}>
              <Text style={s.bodyText}>{insight}</Text>
            </View>
          ))}
        </StandardPage>
      )}

      {enabled('appendix') && (
        <StandardPage title="Annexe tickets" project={project} theme={theme}>
          <TicketTable issues={issues} theme={theme} title="Liste des tickets exportes" />
          {issues.length > 18 && <Text style={{ ...s.textMuted, marginTop: 8 }}>Seuls les 18 premiers tickets sont affiches dans cette annexe pour garder le PDF lisible.</Text>}
        </StandardPage>
      )}

      {enabled('merci') && (
        <Page size="A4" style={s.page}>
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
