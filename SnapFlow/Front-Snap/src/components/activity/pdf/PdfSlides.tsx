import { forwardRef } from 'react';
import {
  PieChart, Pie, Cell, Tooltip as ReTooltip,
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  BarChart, Bar,
} from 'recharts';
import { formatDate } from '@/lib/dateFormat';
import type { PdfConfig, PdfData } from './pdfTypes';
import { GREEN, RED, AMBER, BLUE, TRACKER_COLORS, GOLD_BG, GOLD_BD, GOLD } from './pdfTypes';

// ─── Shared slide helpers ─────────────────────────────────────────────────────

const SLIDE = {
  width: 1120,
  height: 793,
  base: {
    width: 1120,
    height: 793,
    background: '#fff',
    display: 'flex' as const,
    flexDirection: 'column' as const,
    // Arial/Helvetica ensures accented French chars (É, à, é…) render correctly
    // in html2canvas across all platforms (system-ui can silently corrupt them)
    fontFamily: 'Arial,\'Helvetica Neue\',Helvetica,sans-serif',
    overflow: 'hidden' as const,
  },
};

function SlideHeader({
  title, subtitle, pageNum, projectName, color,
}: {
  title: string; subtitle?: string; pageNum?: number; projectName: string; color: string;
}) {
  return (
    <div style={{ background: color, padding: '14px 28px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
      <div style={{ flex: 1 }} />
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.75)', marginTop: 2 }}>{subtitle}</div>}
      </div>
      <div style={{ flex: 1, fontSize: 10, color: 'rgba(255,255,255,0.75)', textAlign: 'right' }}>
        <div style={{ fontWeight: 600 }}>{projectName}</div>
        {pageNum != null && <div>Page {pageNum} · {format(new Date(), 'dd MMM yyyy', { locale: fr })}</div>}
      </div>
    </div>
  );
}

function SlideFooter({ color, label = 'SNAPFLOW' }: { color: string; label?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 28px', borderTop: '1px solid #e7e5e4', background: '#fafaf9', flexShrink: 0 }}>
      <span style={{ fontSize: 10, color: '#a8a29e' }}>Généré le {format(new Date(), 'dd MMMM yyyy à HH:mm', { locale: fr })}</span>
      <span style={{ fontSize: 10, fontWeight: 700, color, letterSpacing: '0.08em' }}>{label}</span>
    </div>
  );
}

function GoldTable({ rows, columns }: {
  rows: (string | number)[][];
  columns: string[];
}) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr>
          {columns.map((col, i) => (
            <th key={i} style={{
              background: GOLD_BG, border: `1px solid ${GOLD_BD}`,
              padding: '12px 14px', textAlign: 'left', fontWeight: 800, color: GOLD,
              fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>{col}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri} style={{ background: ri % 2 === 0 ? '#fff' : '#fffbeb' }}>
            {row.map((cell, ci) => (
              <td key={ci} style={{
                border: `1px solid ${GOLD_BD}`, padding: '12px 14px',
                color: '#44403c', verticalAlign: 'middle',
              }}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Callout({ value, color = '#1c1917' }: { value: number | string; color?: string }) {
  return (
    <div style={{ fontSize: 96, fontWeight: 900, color, lineHeight: 1, textAlign: 'center' }}>
      {String(value).padStart(2, '0')}
    </div>
  );
}

// ─── Individual slides ────────────────────────────────────────────────────────

// ── SLIDE 1: Cover (full-bleed)
function CoverSlide({ cfg, data }: { cfg: PdfConfig; data: PdfData }) {
  const { pdfColor, pdfBrandLeft, pdfBrandRight, coverKpis } = cfg;
  const { project, totalCount, total, open, resolved, critical, blocked,
    dateFrom, dateTo, dataMinDate, dataMaxDate, assignedTo } = data;

  const period = dateFrom && dateTo
    ? `P\u00e9riode du ${format(new Date(dateFrom), 'dd MMMM yyyy', { locale: fr })} au ${format(new Date(dateTo), 'dd MMMM yyyy', { locale: fr })}`
    : dataMinDate && dataMaxDate
      ? `P\u00e9riode du ${format(dataMinDate, 'dd MMMM yyyy', { locale: fr })} au ${format(dataMaxDate, 'dd MMMM yyyy', { locale: fr })}`
      : 'Toutes p\u00e9riodes confondues';

  const hashtags = data.trackerData.map(t => `#${t.name.replace(/\s+/g, '')}`).join('   ');

  const kpiList = ([
    { key: 'total',    label: 'Total',         val: totalCount,                                           alarm: false },
    { key: 'open',     label: 'En cours',      val: open,                                                 alarm: false },
    { key: 'resolved', label: 'R\u00e9solues', val: resolved,                                             alarm: false },
    { key: 'critical', label: 'Critiques',     val: critical,                                             alarm: critical > 0 },
    { key: 'blocked',  label: 'Bloqu\u00e9es', val: blocked,                                              alarm: blocked  > 0 },
  ] as { key: string; label: string; val: number | string; alarm: boolean }[]).filter(k => coverKpis[k.key]);

  return (
    <div data-pdf-slide="cover" style={{ ...SLIDE.base, background: pdfColor, justifyContent: 'space-between', position: 'relative' }}>
      {/* Diagonal gradient overlay: dark top-left \u2192 light bottom-right */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(0,0,0,0.22) 0%, rgba(255,255,255,0.12) 100%)', pointerEvents: 'none' }} />

      {/* Top row: left brand \u2014 right brand, fontSize:11 */}
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 40px', flexShrink: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.85)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{pdfBrandLeft}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.85)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{pdfBrandRight}</span>
      </div>

      {/* Center block */}
      <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 80px' }}>
        {/* Main title */}
        <div style={{ fontSize: 72, fontWeight: 900, color: '#fff', textAlign: 'center', lineHeight: 1.05, marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
          RAPPORT<br />D'ACTIVITÉ
        </div>
        {/* Divider */}
        <div style={{ width: 56, height: 3, background: 'rgba(255,255,255,0.4)', borderRadius: 2, marginBottom: 16 }} />
        {/* Period \u2014 fontSize:18 */}
        <div style={{ fontSize: 18, fontWeight: 400, color: 'rgba(255,255,255,0.88)', textAlign: 'center', marginBottom: 10 }}>
          {period}
        </div>
        {/* Site name — fontSize:28, fontWeight:700 */}
        <div style={{ fontSize: 28, fontWeight: 700, color: '#fff', textAlign: 'center', marginBottom: assignedTo ? 10 : (kpiList.length > 0 ? 32 : 0) }}>
          {project.site_name}
        </div>

        {/* Chargé de projet — dynamic from Redmine assigned_to */}
        {assignedTo && (
          <div style={{
            fontSize: 14, color: 'rgba(255,255,255,0.78)', textAlign: 'center',
            marginBottom: kpiList.length > 0 ? 24 : 0, fontWeight: 500,
          }}>
            <span style={{ opacity: 0.7, marginRight: 6 }}>Charge de projet :</span>
            <strong style={{ color: '#fff' }}>{assignedTo}</strong>
          </div>
        )}

        {/* KPI strip \u2014 white translucent card */}
        {kpiList.length > 0 && (
          <div style={{
            width: '100%', maxWidth: 840,
            background: 'rgba(255,255,255,0.12)',
            border: '1px solid rgba(255,255,255,0.25)',
            borderRadius: 14,
            padding: '16px 20px',
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${kpiList.length},1fr)`, gap: 0 }}>
              {kpiList.map((k, i) => (
                <div key={k.key} style={{
                  textAlign: 'center',
                  padding: '8px 12px',
                  borderRight: i < kpiList.length - 1 ? '1px solid rgba(255,255,255,0.2)' : 'none',
                  background: k.alarm ? 'rgba(220,38,38,0.22)' : 'transparent',
                  borderRadius: k.alarm ? 8 : 0,
                }}>
                  <div style={{ fontSize: 30, fontWeight: 800, color: '#fff', lineHeight: 1 }}>{k.val}</div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.7)', marginTop: 5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom: service hashtags + timestamp */}
      <div style={{ position: 'relative', padding: '12px 40px 18px', flexShrink: 0 }}>
        {hashtags && (
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', textAlign: 'center', marginBottom: 10, letterSpacing: '0.04em' }}>
            {hashtags}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.15)', paddingTop: 10 }}>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>G\u00e9n\u00e9r\u00e9 le {format(new Date(), 'dd MMMM yyyy \u00e0 HH:mm', { locale: fr })}</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.65)', letterSpacing: '0.08em' }}>SNAPFLOW</span>
        </div>
      </div>
    </div>
  );
}

// ── SLIDE 2: Sommaire (3-chapter TOC)
function SommaireSlide({ cfg, data }: { cfg: PdfConfig; data: PdfData }) {
  const { pdfColor } = cfg;
  const { project, totalCount, total, dateFrom, dateTo, dataMinDate, dataMaxDate } = data;

  const chapters = [
    {
      num: '01', title: 'Périmètre',
      items: ['Cadre du projet', 'Services couverts'],
    },
    {
      num: '02', title: 'Suivi des activités réalisées',
      items: ['Indicateurs globaux', 'État des tickets', 'Répartition par catégorie & priorité', 'Évolution temporelle'],
    },
    {
      num: '03', title: 'Synthèse et conclusion',
      items: ["Points d'attention et recommandations"],
    },
  ];

  return (
    <div data-pdf-slide="sommaire" style={SLIDE.base}>
      <SlideHeader title="Sommaire" subtitle="Contenu de ce rapport" pageNum={2} projectName={project.site_name} color={pdfColor} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '24px 60px', gap: 0 }}>
        {/* Intro */}
        <div style={{ marginBottom: 20, padding: '12px 18px', borderLeft: `4px solid ${pdfColor}`, background: '#fafaf9', borderRadius: '0 8px 8px 0' }}>
          <p style={{ fontSize: 12, color: '#44403c', lineHeight: 1.7, margin: 0 }}>
            Ce rapport présente une synthèse de l'activité des demandes enregistrées{' '}
            {dateFrom && dateTo
              ? `du ${format(new Date(dateFrom), 'dd MMMM yyyy', { locale: fr })} au ${format(new Date(dateTo), 'dd MMMM yyyy', { locale: fr })}`
              : dataMinDate && dataMaxDate
                ? `du ${format(dataMinDate, 'dd MMMM yyyy', { locale: fr })} au ${format(dataMaxDate, 'dd MMMM yyyy', { locale: fr })}`
                : 'sur l\u2019ensemble des périodes disponibles'}.
            {' '}Il porte sur{' '}
            <span style={{ fontWeight: 700, color: '#1c1917' }}>{totalCount} demande{totalCount !== 1 ? 's' : ''}</span>.
            {total !== totalCount && (
              <>{' '}Vue courante : <span style={{ fontWeight: 700 }}>{total}</span> après filtres.</>
            )}
          </p>
        </div>

        {/* Chapters */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {chapters.map((ch) => (
            <div key={ch.num} style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '16px 20px', background: '#fafaf9', borderRadius: 10, border: '1px solid #e7e5e4' }}>
              <div style={{ width: 56, height: 56, borderRadius: 10, background: pdfColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 20, fontWeight: 900, color: '#fff' }}>{ch.num}</span>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start' }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#1c1917', marginBottom: 6 }}>{ch.title}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxWidth: '100%' }}>
                  {ch.items.map((item, i) => (
                    <span key={i} style={{ fontSize: 11, color: '#57534e', background: '#fff', border: '1px solid #e7e5e4', borderRadius: 6, padding: '4px 10px', whiteSpace: 'nowrap' }}>{item}</span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <SlideFooter color={pdfColor} />
    </div>
  );
}

// ── SLIDE: Section separator (full-bleed diagonal gradient)
function SeparatorSlide({ label, slideKey, color }: { label: string; slideKey: string; color: string }) {
  return (
    <div data-pdf-slide={slideKey} style={{
      ...SLIDE.base,
      background: color,
      position: 'relative',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      {/* Diagonal overlay: dark top-left → light bottom-right, works for any pdfColor */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(135deg, rgba(0,0,0,0.28) 0%, rgba(255,255,255,0.18) 100%)',
        pointerEvents: 'none',
      }} />
      <div style={{ position: 'relative', textAlign: 'center' }}>
        <div style={{
          fontSize: 64,
          fontWeight: 900,
          color: '#fff',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          lineHeight: 1.1,
        }}>
          {label}
        </div>
        <div style={{ width: 60, height: 4, background: 'rgba(255,255,255,0.3)', borderRadius: 2, margin: '24px auto 0' }} />
      </div>
    </div>
  );
}

// ── SLIDE: Périmètre
function PerimetreSlide({ cfg, data }: { cfg: PdfConfig; data: PdfData }) {
  const { pdfColor } = cfg;
  const { project, trackerData } = data;
  const trackerNames = trackerData.map(t => t.name);
  const leftItems = trackerNames.filter(n => /web|content|feature|fonc/i.test(n));
  const rightItems = trackerNames.filter(n => /bug|maintenance|securit|fix/i.test(n));
  const leftFallback = ['Mise à jour des rubriques et contenus', 'Gestion des médias et bannières', 'Correction des liens cassés', 'Déploiement de nouvelles fonctionnalités'];
  const rightFallback = ['Correction de bugs et anomalies', 'Mise à jour des modules et plugins', 'Surveillance des failles de sécurité', 'Tests de non-régression'];

  const renderItems = (items: string[], fallback: string[]) =>
    (items.length ? items : fallback).map((item, i) => (
      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: pdfColor, flexShrink: 0, marginTop: 5 }} />
        <span style={{ fontSize: 12, color: '#44403c', lineHeight: 1.5 }}>{item}</span>
      </div>
    ));

  return (
    <div data-pdf-slide="perimetre" style={SLIDE.base}>
      <SlideHeader title="Périmètre & Cadre du projet" subtitle="Services couverts par le contrat" pageNum={4} projectName={project.site_name} color={pdfColor} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', padding: '24px 40px', gap: 24 }}>
        {/* Left col */}
        <div style={{ flex: 1, padding: '20px', background: '#f8fafc', borderRadius: 10, border: '1px solid #e7e5e4' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: pdfColor, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Webmastering & Gestion de contenu
          </div>
          <div style={{ fontSize: 10, color: '#78716c', marginBottom: 14 }}>Maintenance évolutive du site</div>
          {renderItems(leftItems, leftFallback)}
        </div>
        {/* Right col */}
        <div style={{ flex: 1, padding: '20px', background: '#f8fafc', borderRadius: 10, border: '1px solid #e7e5e4' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: pdfColor, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Maintenance corrective & Sécurité
          </div>
          <div style={{ fontSize: 10, color: '#78716c', marginBottom: 14 }}>Corrections et mises à jour techniques</div>
          {renderItems(rightItems, rightFallback)}
        </div>
      </div>
      {/* Bottom banner */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '12px 40px', background: '#f0f9ff', borderTop: '1px solid #bae6fd', flexShrink: 0 }}>
        {["Syst\u00e8me de ticketing Redmine", "Rapport d'activit\u00e9 annuel", "Suivi continu des demandes client"].map((txt, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {i > 0 && <div style={{ width: 1, height: 14, background: '#bae6fd' }} />}
            <span style={{ fontSize: 11, color: '#0369a1', fontWeight: 600 }}>{txt}</span>
          </div>
        ))}
      </div>
      <SlideFooter color={pdfColor} />
    </div>
  );
}

// ── SLIDE: Indicateurs Globaux
function IndicateursSlide({ cfg, data }: { cfg: PdfConfig; data: PdfData }) {
  const { pdfColor } = cfg;
  const { project, totalCount, filteredIssues, dateFrom, dateTo, dataMinDate, dataMaxDate } = data;

  const meetingCount = filteredIssues.filter(i => /r[ée]union/i.test(i.tracker.name)).length;
  const docCount = filteredIssues.filter(i => /doc|rapport|report/i.test(i.tracker.name)).length;
  const interventions = totalCount;

  const period = dateFrom && dateTo
    ? `${format(new Date(dateFrom), 'dd MMM yyyy', { locale: fr })} – ${format(new Date(dateTo), 'dd MMM yyyy', { locale: fr })}`
    : dataMinDate && dataMaxDate
      ? `${format(dataMinDate, 'dd MMM yyyy', { locale: fr })} – ${format(dataMaxDate, 'dd MMM yyyy', { locale: fr })}`
      : 'Toutes périodes';

  return (
    <div data-pdf-slide="indicateurs" style={SLIDE.base}>
      <SlideHeader title="Indicateurs Globaux" subtitle="Vue d'ensemble de la période" pageNum={6} projectName={project.site_name} color={pdfColor} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '16px 60px', gap: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20, width: '100%' }}>
          {[
            { num: interventions,  label: 'Tickets',                  sub: 'Interventions totales' },
            { num: meetingCount,   label: 'R\u00e9unions',             sub: "Points d'\u00e9change" },
            { num: docCount || 1,  label: "Documents",                sub: 'Livrables produits' },
          ].map((item, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '24px 16px', background: '#fafaf9', borderRadius: 12, border: '1px solid #e7e5e4' }}>
              <div style={{ fontSize: 72, fontWeight: 900, color: pdfColor, lineHeight: 1 }}>{String(item.num).padStart(2, '0')}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#1c1917', marginTop: 12 }}>{item.label}</div>
              <div style={{ fontSize: 11, color: '#78716c', marginTop: 4 }}>{item.sub}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 13, color: '#78716c', textAlign: 'center', maxWidth: 600, lineHeight: 1.7 }}>
          Période : <strong style={{ color: '#1c1917' }}>{period}</strong><br />
          {interventions} intervention{interventions !== 1 ? 's' : ''} enregistrée{interventions !== 1 ? 's' : ''} dans le système de ticketing.
          {meetingCount > 0 && ` Dont ${meetingCount} réunion${meetingCount > 1 ? 's' : ''} de suivi.`}
        </div>
      </div>
      <SlideFooter color={pdfColor} />
    </div>
  );
}

// ── SLIDE: Statuts (Donut + table)
function StatutsSlide({ cfg, data }: { cfg: PdfConfig; data: PdfData }) {
  const { pdfColor } = cfg;
  const { project, total, resolved, blocked, critical,
    statusData, filteredIssues, statusColorOf, countByFn } = data;

  return (
    <div data-pdf-slide="statuts" style={SLIDE.base}>
      <SlideHeader title="État des Tickets" subtitle="Répartition par statut actuel" pageNum={7} projectName={project.site_name} color={pdfColor} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', padding: '16px 28px', gap: 24 }}>
        {/* Left: donut + legend table */}
        <div style={{ width: 400, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <PieChart width={340} height={260}>
            <Pie
              data={statusData}
              cx={170} cy={130}
              innerRadius={75} outerRadius={110}
              paddingAngle={2}
              dataKey="count"
              isAnimationActive={false}
              labelLine={false}
              label={(props: { cx: number; cy: number; midAngle: number; innerRadius: number; outerRadius: number; count: number }) => {
                const { cx, cy, midAngle, innerRadius, outerRadius, count } = props;
                const pct = Math.round((count / Math.max(total, 1)) * 100);
                if (pct < 5) return null;
                const RADIAN = Math.PI / 180;
                const radius = innerRadius + (outerRadius - innerRadius) * 0.55;
                const x = cx + radius * Math.cos(-midAngle * RADIAN);
                const y = cy + radius * Math.sin(-midAngle * RADIAN);
                return (
                  <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={700}>
                    {pct}%
                  </text>
                );
              }}
            >
              {statusData.map((entry, idx) => <Cell key={idx} fill={statusColorOf(entry.name, idx)} />)}
            </Pie>
            <ReTooltip formatter={(v: number, n: string) => [v, n]} contentStyle={{ fontSize: 11 }} />
          </PieChart>
          <div style={{ width: '100%' }}>
            <GoldTable
              columns={['Statut', 'Nb', '%']}
              rows={countByFn(filteredIssues, i => i.status.name).map((e, idx) => [
                e.name,
                e.count,
                `${Math.round((e.count / Math.max(total, 1)) * 100)} %`,
              ])}
            />
          </div>
        </div>

        {/* Right: insights */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1c1917', marginBottom: 4 }}>Ce que ces chiffres signifient pour vous</div>
          <div style={{ background: resolved / Math.max(total, 1) >= 0.5 ? '#f0fdf4' : '#fef2f2', border: `1px solid ${resolved / Math.max(total, 1) >= 0.5 ? '#bbf7d0' : '#fecaca'}`, borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: resolved / Math.max(total, 1) >= 0.5 ? '#14532d' : '#991b1b', marginBottom: 4 }}>
              {Math.round((resolved / Math.max(total, 1)) * 100)} % de vos demandes ont été traitées
            </div>
            <div style={{ fontSize: 11, color: resolved / Math.max(total, 1) >= 0.5 ? '#166534' : '#b91c1c', lineHeight: 1.5 }}>
              {resolved} demande{resolved !== 1 ? 's résolues' : ' résolue'} sur {total} au total.
            </div>
          </div>
          {blocked > 0 && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: '#991b1b', marginBottom: 2 }}>{blocked} demande{blocked > 1 ? 's bloquées' : ' bloquée'}</div>
              <div style={{ fontSize: 11, color: '#b91c1c', lineHeight: 1.5 }}>Signalé dans le suivi — action requise.</div>
            </div>
          )}
          {critical > 0 && (
            <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: '#9a3412', marginBottom: 2 }}>{critical} demande{critical !== 1 ? 's critiques' : ' critique'}</div>
              <div style={{ fontSize: 11, color: '#c2410c', lineHeight: 1.5 }}>Suivi prioritaire recommandé.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── SLIDE: Per-status detail (dynamic)
function PerStatusSlide({
  cfg, data, statusName, pageNum, startIdx = 0,
}: {
  cfg: PdfConfig; data: PdfData; statusName: string; pageNum: number; startIdx?: number;
}) {
  const { pdfColor } = cfg;
  const { project, filteredIssues, total } = data;
  const tickets = filteredIssues.filter(i => i.status.name === statusName);
  if (!tickets.length) return null;

  const slug = statusName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const chunkPage = startIdx > 0 ? `-p${Math.floor(startIdx / 8) + 1}` : '';
  const pageTickets = tickets.slice(startIdx, startIdx + 8);
  const rows = pageTickets.map(t => [
    `#${t.id}`,
    t.subject.length > 55 ? t.subject.slice(0, 55) + '…' : t.subject,
    t.tracker.name,
    t.priority.name,
    format(new Date(t.created_on), 'dd/MM/yyyy'),
  ]);

  const pct = Math.round((tickets.length / Math.max(total, 1)) * 100);

  return (
    <div data-pdf-slide={`status-${slug}${chunkPage}`} style={SLIDE.base}>
      <SlideHeader title={statusName} subtitle={`${tickets.length} ticket${tickets.length > 1 ? 's' : ''} · ${pct} % du total${startIdx > 0 ? ` · suite (${startIdx + 1}–${Math.min(startIdx + 8, tickets.length)})` : ''}`} pageNum={pageNum} projectName={project.site_name} color={pdfColor} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', padding: '20px 28px', gap: 28, alignItems: 'flex-start' }}>
        {/* Callout */}
        <div style={{ width: 160, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: 24 }}>
          <div style={{ fontSize: 80, fontWeight: 900, color: pdfColor, lineHeight: 1 }}>{String(tickets.length).padStart(2, '0')}</div>
          <div style={{ fontSize: 11, color: '#78716c', marginTop: 8, textAlign: 'center' }}>ticket{tickets.length > 1 ? 's' : ''}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: pdfColor, marginTop: 4 }}>{pct} %</div>
          <div style={{ fontSize: 10, color: '#78716c' }}>du total</div>
        </div>
        {/* Table */}
        <div style={{ flex: 1 }}>
          <GoldTable
            columns={['ID', 'Sujet', 'Type', 'Priorité', 'Date']}
            rows={rows}
          />
          {startIdx + 8 < tickets.length && (
            <div style={{ fontSize: 10, color: '#78716c', marginTop: 6, textAlign: 'right' }}>
              Suite sur la diapositive suivante →
            </div>
          )}
        </div>
      </div>
      <SlideFooter color={pdfColor} />
    </div>
  );
}

// ── SLIDE: Bloqués synthesis
function BloquesSynthSlide({ cfg, data }: { cfg: PdfConfig; data: PdfData }) {
  const { pdfColor } = cfg;
  const { project, filteredIssues, countByFn } = data;

  const blockedTickets = filteredIssues.filter(i => /bloqu/i.test(i.status.name));
  if (!blockedTickets.length) return null;

  const blockedByPriority = countByFn(blockedTickets, i => i.priority.name).map(d => ({ ...d, fill: pdfColor }));
  const blockedByTracker  = countByFn(blockedTickets, i => i.tracker.name);
  const donutTrackerColors = [AMBER, GREEN, '#0284c7', '#7c3aed', '#db2777'];

  const yearBuckets = countByFn(blockedTickets, i => new Date(i.created_on).getFullYear().toString());

  return (
    <div data-pdf-slide="bloques-synth" style={SLIDE.base}>
      <SlideHeader title="Tickets Bloqués — Synthèse" subtitle={`${blockedTickets.length} ticket${blockedTickets.length > 1 ? 's' : ''} bloqué${blockedTickets.length > 1 ? 's' : ''}`} projectName={project.site_name} color={pdfColor} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', padding: '16px 28px', gap: 20, alignItems: 'flex-start' }}>
        {/* Callout */}
        <div style={{ width: 120, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 16 }}>
          <Callout value={blockedTickets.length} color={pdfColor} />
          <div style={{ fontSize: 11, color: '#78716c', marginTop: 6, textAlign: 'center' }}>bloqué{blockedTickets.length > 1 ? 's' : ''}</div>
        </div>
        {/* Bar: priority */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#1c1917', marginBottom: 8 }}>Par priorité</div>
          <BarChart width={240} height={200} data={blockedByPriority} margin={{ top: 4, right: 8, left: -20, bottom: 0 }} barCategoryGap="25%">
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#a8a29e' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 9, fill: '#a8a29e' }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Bar dataKey="count" fill={pdfColor} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </div>
        {/* Donut: by year */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#1c1917', marginBottom: 8 }}>Par année</div>
          <PieChart width={200} height={200}>
            <Pie data={yearBuckets} cx={100} cy={100} innerRadius={50} outerRadius={85} paddingAngle={2} dataKey="count" isAnimationActive={false}>
              {yearBuckets.map((_e, idx) => <Cell key={idx} fill={idx === 0 ? pdfColor : '#0284c7'} />)}
            </Pie>
            <ReTooltip formatter={(v: number, n: string) => [v, n]} contentStyle={{ fontSize: 10 }} />
          </PieChart>
          {yearBuckets.map((b, i) => (
            <div key={b.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#44403c' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: i === 0 ? pdfColor : '#0284c7' }} />
              {b.name}: {b.count}
            </div>
          ))}
        </div>
        {/* Donut: by tracker */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#1c1917', marginBottom: 8 }}>Par type</div>
          <PieChart width={200} height={200}>
            <Pie data={blockedByTracker} cx={100} cy={100} innerRadius={50} outerRadius={85} paddingAngle={2} dataKey="count" isAnimationActive={false}>
              {blockedByTracker.map((_e, idx) => <Cell key={idx} fill={donutTrackerColors[idx % donutTrackerColors.length]} />)}
            </Pie>
            <ReTooltip formatter={(v: number, n: string) => [v, n]} contentStyle={{ fontSize: 10 }} />
          </PieChart>
          {blockedByTracker.map((b, i) => (
            <div key={b.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#44403c' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: donutTrackerColors[i % donutTrackerColors.length] }} />
              {b.name}: {b.count}
            </div>
          ))}
        </div>
      </div>
      <SlideFooter color={pdfColor} />
    </div>
  );
}

// ── SLIDE: Réunions
function ReunionsSlide({ cfg, data }: { cfg: PdfConfig; data: PdfData }) {
  const { pdfColor } = cfg;
  const { project, filteredIssues } = data;

  const meetings = filteredIssues.filter(i => /r[ée]union/i.test(i.tracker.name));
  if (!meetings.length) return null;

  return (
    <div data-pdf-slide="reunions" style={SLIDE.base}>
      <SlideHeader title="Réunions et Points d'échange" subtitle="Comptes-rendus et suivi" projectName={project.site_name} color={pdfColor} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', padding: '20px 28px', gap: 24 }}>
        {/* Left panel */}
        <div style={{ width: 220, flexShrink: 0, background: GOLD_BG, borderRadius: 12, border: `1px solid ${GOLD_BD}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px 16px', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'center' }}>
            Réunions &<br />Points d'échange
          </div>
          <div style={{ fontSize: 80, fontWeight: 900, color: GOLD, lineHeight: 1 }}>{String(meetings.length).padStart(2, '0')}</div>
          <div style={{ fontSize: 11, color: GOLD }}>réunion{meetings.length > 1 ? 's' : ''} tenue{meetings.length > 1 ? 's' : ''}</div>
        </div>
        {/* Right: table */}
        <div style={{ flex: 1 }}>
          <GoldTable
            columns={['ID', 'Sujet', 'Date']}
            rows={meetings.slice(0, 6).map(t => [
              `#${t.id}`,
              t.subject.length > 70 ? t.subject.slice(0, 70) + '…' : t.subject,
              format(new Date(t.created_on), 'dd/MM/yyyy'),
            ])}
          />
        </div>
      </div>
      <SlideFooter color={pdfColor} />
    </div>
  );
}

// ── SLIDE: Évolution temporelle (area chart) — KEPT
function EvolutionSlide({ cfg, data }: { cfg: PdfConfig; data: PdfData }) {
  const { pdfColor } = cfg;
  const { project, totalCount, timelineData } = data;

  return (
    <div data-pdf-slide="evolution" style={SLIDE.base}>
      <SlideHeader title="Évolution des demandes dans le temps" subtitle="Volume de demandes créées, semaine par semaine" pageNum={undefined} projectName={project.site_name} color={pdfColor} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px 28px', gap: 16 }}>
        <AreaChart width={1060} height={400} data={timelineData} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
          <defs>
            <linearGradient id="pdfGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={pdfColor} stopOpacity={0.3} />
              <stop offset="95%" stopColor={pdfColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
          <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#a8a29e' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: '#a8a29e' }} axisLine={false} tickLine={false} allowDecimals={false} />
          <ReTooltip formatter={(v: number) => [v, 'Demandes']} contentStyle={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 8, fontSize: 11 }} />
          <Area type="monotone" dataKey="count" stroke={pdfColor} strokeWidth={2.5} fill="url(#pdfGrad)" dot={{ r: 3, fill: pdfColor }} isAnimationActive={false} />
        </AreaChart>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div style={{ background: '#fafaf9', border: '1px solid #e7e5e4', borderRadius: 8, padding: '14px 16px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#78716c', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Total sur la période</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: '#1c1917' }}>{totalCount}</div>
            <div style={{ fontSize: 11, color: '#78716c', marginTop: 4 }}>demandes enregistrées au total</div>
          </div>
          <div style={{ background: '#fafaf9', border: '1px solid #e7e5e4', borderRadius: 8, padding: '14px 16px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#78716c', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Semaine la plus chargée</div>
            {(() => {
              const peak = timelineData.length ? timelineData.reduce((b, w) => w.count > b.count ? w : b) : { week: '—', count: 0 };
              return (
                <>
                  <div style={{ fontSize: 28, fontWeight: 800, color: pdfColor }}>{peak.count}</div>
                  <div style={{ fontSize: 11, color: '#78716c', marginTop: 4 }}>demandes — semaine du {peak.week}</div>
                </>
              );
            })()}
          </div>
          <div style={{ background: '#fafaf9', border: '1px solid #e7e5e4', borderRadius: 8, padding: '14px 16px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#78716c', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Tendance récente</div>
            {(() => {
              const len = timelineData.length;
              if (len < 2) return <div style={{ fontSize: 11, color: '#78716c' }}>Données insuffisantes</div>;
              const last = timelineData[len - 1].count;
              const prev = timelineData[len - 2].count;
              const change = prev > 0 ? Math.round(((last - prev) / prev) * 100) : 0;
              return (
                <>
                  <div style={{ fontSize: 28, fontWeight: 800, color: change > 0 ? RED : change < 0 ? GREEN : '#78716c' }}>{change > 0 ? '+' : ''}{change}%</div>
                  <div style={{ fontSize: 11, color: '#78716c', marginTop: 4 }}>
                    {change > 25 ? 'Forte hausse — suivi rapproché conseillé' : change < -25 ? 'Baisse notable' : 'Activité stable'}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SLIDE: Trackers (bar chart) — KEPT
function TrackersSlide({ cfg, data }: { cfg: PdfConfig; data: PdfData }) {
  const { pdfColor } = cfg;
  const { project, total, trackerData } = data;

  return (
    <div data-pdf-slide="trackers" style={SLIDE.base}>
      <SlideHeader title="Répartition par catégorie" subtitle="Quels types de demandes avez-vous soumis ?" projectName={project.site_name} color={pdfColor} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', padding: '20px 28px', gap: 32 }}>
        <div style={{ width: 480, flexShrink: 0 }}>
          <BarChart width={460} height={600} data={[...trackerData].reverse()} layout="vertical" margin={{ top: 4, right: 30, left: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: '#a8a29e' }} axisLine={false} tickLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#44403c' }} axisLine={false} tickLine={false} width={130} />
            <ReTooltip formatter={(v: number) => [v, 'Demandes']} contentStyle={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 8, fontSize: 11 }} />
            <Bar dataKey="count" radius={[0, 4, 4, 0]} isAnimationActive={false}>
              {trackerData.map((_e, idx) => <Cell key={idx} fill={TRACKER_COLORS[idx % TRACKER_COLORS.length]} />)}
            </Bar>
          </BarChart>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1c1917', marginBottom: 4 }}>Détail par catégorie</div>
          <GoldTable
            columns={['Catégorie', 'Nb', '%']}
            rows={trackerData.map((t, idx) => [t.name, t.count, `${Math.round((t.count / Math.max(total, 1)) * 100)} %`])}
          />
          {trackerData[0] && trackerData[0].count / Math.max(total, 1) > 0.4 && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', marginTop: 4 }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: '#92400e', marginBottom: 4 }}>Point d'attention</div>
              <div style={{ fontSize: 11, color: '#b45309', lineHeight: 1.5 }}>
                La catégorie « {trackerData[0].name} » représente {Math.round((trackerData[0].count / Math.max(total, 1)) * 100)} % de toutes vos demandes.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── SLIDE: Priorités (bar chart) — KEPT
function PrioritesSlide({ cfg, data }: { cfg: PdfConfig; data: PdfData }) {
  const { pdfColor } = cfg;
  const { project, total, critical, priorityData } = data;

  return (
    <div data-pdf-slide="priorities" style={SLIDE.base}>
      <SlideHeader title="Répartition par priorité" subtitle="Vos demandes selon leur niveau d'urgence déclaré" projectName={project.site_name} color={pdfColor} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', padding: '20px 28px', gap: 32 }}>
        <div style={{ width: 460, flexShrink: 0 }}>
          <BarChart width={440} height={580} data={priorityData} margin={{ top: 8, right: 16, left: -20, bottom: 0 }} barCategoryGap="30%">
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#a8a29e' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#a8a29e' }} axisLine={false} tickLine={false} allowDecimals={false} />
            <ReTooltip formatter={(v: number) => [v, 'Demandes']} contentStyle={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 8, fontSize: 11 }} />
            <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {priorityData.map((entry, idx) => <Cell key={idx} fill={entry.color} />)}
            </Bar>
          </BarChart>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1c1917', marginBottom: 4 }}>Analyse des niveaux de priorité</div>
          <GoldTable
            columns={['Priorité', 'Nb', '%']}
            rows={priorityData.map(p => [p.name, p.count, `${Math.round((p.count / Math.max(total, 1)) * 100)} %`])}
          />
          {critical === 0 && priorityData.every(p => !/critique|critical|major/i.test(p.name) || p.count === 0) && (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', marginTop: 4 }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: '#14532d', marginBottom: 2 }}>Zéro critique, zéro majeure</div>
              <div style={{ fontSize: 11, color: '#166534', lineHeight: 1.5 }}>Aucune demande à priorité élevée sur la période — bonne maîtrise des urgences.</div>
            </div>
          )}
          {critical > 0 && critical / Math.max(total, 1) > 0.15 && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', marginTop: 4 }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: '#991b1b' }}>Trop de demandes critiques</div>
              <div style={{ fontSize: 11, color: '#b91c1c', lineHeight: 1.5 }}>{Math.round((critical / Math.max(total, 1)) * 100)} % critiques — confirmez les priorités avec votre interlocuteur.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── SLIDE: Insights / Recommandations — KEPT
function InsightsSlide({ cfg, data }: { cfg: PdfConfig; data: PdfData }) {
  const { pdfColor } = cfg;
  const { project, insights } = data;

  return (
    <div data-pdf-slide="insights" style={SLIDE.base}>
      <SlideHeader title="Points d'attention et recommandations" subtitle="Analyse automatique basée sur vos données" projectName={project.site_name} color={pdfColor} />
      <div style={{ flex: 1, padding: '20px 28px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {insights.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#f0fdf4', border: '2px solid #bbf7d0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: GREEN }}>Aucun point d'attention détecté</div>
            <div style={{ fontSize: 13, color: '#78716c', textAlign: 'center', maxWidth: 480 }}>
              Vos demandes sont gérées dans des conditions satisfaisantes sur la période analysée.
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {insights.map((ins, idx) => {
              const bg  = { positive: '#f0fdf4', negative: '#fef2f2', warning: '#fffbeb', info: '#f0f9ff' }[ins.level];
              const bd  = { positive: '#bbf7d0', negative: '#fecaca', warning: '#fde68a', info: '#bae6fd' }[ins.level];
              const tc  = { positive: '#14532d', negative: '#991b1b', warning: '#92400e', info: '#0c4a6e' }[ins.level];
              const tx  = { positive: '#166534', negative: '#b91c1c', warning: '#b45309', info: '#0369a1' }[ins.level];
              const dot = { positive: GREEN, negative: RED, warning: AMBER, info: BLUE }[ins.level];
              return (
                <div key={idx} style={{ background: bg, border: `1px solid ${bd}`, borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 6 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0, marginTop: 4 }} />
                    <div style={{ fontWeight: 700, fontSize: 13, color: tc, lineHeight: 1.3 }}>{ins.title}</div>
                  </div>
                  <div style={{ fontSize: 12, color: tx, lineHeight: 1.6, paddingLeft: 18 }}>{ins.text}</div>
                </div>
              );
            })}
          </div>
        )}
        <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid #e7e5e4', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: '#a8a29e' }}>Généré le {format(new Date(), 'dd MMMM yyyy à HH:mm', { locale: fr })}</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: pdfColor, letterSpacing: '0.08em' }}>SNAPFLOW</span>
        </div>
      </div>
    </div>
  );
}

// ── SLIDE: Merci (brand closing) — UPGRADED
function MerciSlide({ cfg, data }: { cfg: PdfConfig; data: PdfData }) {
  const { pdfColor, pdfBrandLeft, pdfContactEmail, pdfContactWeb, pdfContactWeb2 } = cfg;
  const { project } = data;

  return (
    <div data-pdf-slide="merci" style={{ ...SLIDE.base, background: pdfColor }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 120px', gap: 0 }}>
        <div style={{ width: 56, height: 4, background: 'rgba(255,255,255,0.4)', borderRadius: 2, marginBottom: 32 }} />
        <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.7)', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 16 }}>
          Rapport d'activité
        </div>
        <div style={{ fontSize: 56, fontWeight: 900, color: '#fff', textAlign: 'center', lineHeight: 1.15, marginBottom: 20 }}>
          Merci !
        </div>
        <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.8)', textAlign: 'center', maxWidth: 580, lineHeight: 1.7, marginBottom: 32 }}>
          Ce rapport a été généré automatiquement à partir des données du projet{' '}
          <span style={{ fontWeight: 700, color: '#fff' }}>{project.site_name}</span>.{' '}
          Notre équipe reste à votre disposition pour toute question ou besoin de suivi.
        </div>
        <div style={{ width: 56, height: 4, background: 'rgba(255,255,255,0.4)', borderRadius: 2, marginBottom: 32 }} />
        {(pdfContactEmail || pdfContactWeb || pdfContactWeb2) && (
          <div style={{ display: 'flex', gap: 24, justifyContent: 'center', flexWrap: 'wrap' }}>
            {pdfContactEmail && <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', fontWeight: 600 }}>✉ {pdfContactEmail}</span>}
            {pdfContactWeb   && <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', fontWeight: 600 }}>🌐 {pdfContactWeb}</span>}
            {pdfContactWeb2  && <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', fontWeight: 600 }}>🌐 {pdfContactWeb2}</span>}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 28px', borderTop: '1px solid rgba(255,255,255,0.2)', flexShrink: 0 }}>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>Généré le {format(new Date(), 'dd MMMM yyyy à HH:mm', { locale: fr })}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.7)', letterSpacing: '0.08em' }}>{pdfBrandLeft || 'SNAPFLOW'}</span>
      </div>
    </div>
  );
}

// ─── Root PdfSlides component ─────────────────────────────────────────────────

export interface PdfSlidesProps {
  cfg: PdfConfig;
  data: PdfData;
}

export const PdfSlides = forwardRef<HTMLDivElement, PdfSlidesProps>(
  function PdfSlides({ cfg, data }, ref) {
    const { pdfSections, pdfColor } = cfg;
    const { filteredIssues } = data;

    // Unique statuses: Bloqués first, Clôturés second, then by count descending
    const uniqueStatuses = Array.from(
      new Map(filteredIssues.map(i => [i.status.name, i.status])).values(),
    ).sort((a, b) => {
      const isBloque  = (n: string) => /bloqu/i.test(n);
      const isCloture = (n: string) => /cl[oô]tur/i.test(n);
      if (isBloque(a.name)  && !isBloque(b.name))  return -1;
      if (!isBloque(a.name) &&  isBloque(b.name))  return  1;
      if (isCloture(a.name) && !isCloture(b.name)) return -1;
      if (!isCloture(a.name) && isCloture(b.name)) return  1;
      return (
        filteredIssues.filter(i => i.status.name === b.name).length -
        filteredIssues.filter(i => i.status.name === a.name).length
      );
    });

    const hasMeetings = filteredIssues.some(i => /r[ée]union/i.test(i.tracker.name));
    const hasBlocked  = filteredIssues.some(i => /bloqu/i.test(i.status.name));

    // Running page counter for per-status slides (start after slide 7 = statuts)
    let pageCounter = 8;

    return (
      <div
        ref={ref}
        style={{ position: 'fixed', left: -9999, top: 0, zIndex: -100, pointerEvents: 'none' }}
        aria-hidden="true"
      >
        {/* 1. Cover */}
        <CoverSlide cfg={cfg} data={data} />

        {/* 2. Sommaire */}
        {pdfSections.sommaire && <SommaireSlide cfg={cfg} data={data} />}

        {/* 3. Section separator: Périmètre */}
        {pdfSections.separateurs && <SeparatorSlide label="PÉRIMÈTRE" slideKey="sep-perimetre" color={pdfColor} />}

        {/* 4. Périmètre */}
        {pdfSections.perimetre && <PerimetreSlide cfg={cfg} data={data} />}

        {/* 5. Section separator: Suivi */}
        {pdfSections.separateurs && <SeparatorSlide label="SUIVI DES ACTIVITÉS" slideKey="sep-suivi" color={pdfColor} />}

        {/* 6. Indicateurs Globaux */}
        {pdfSections.indicateurs && <IndicateursSlide cfg={cfg} data={data} />}

        {/* 7. Statuts overview */}
        {pdfSections.statuts && <StatutsSlide cfg={cfg} data={data} />}

        {/* Per-status detail slides (one slide per 8 tickets, continuation slides auto-spawned) */}
        {pdfSections.perStatus && uniqueStatuses.flatMap(status => {
          const tickets = filteredIssues.filter(i => i.status.name === status.name);
          if (!tickets.length) return [];
          const chunks = Math.ceil(tickets.length / 8);
          return Array.from({ length: chunks }, (_, chunkIdx) => {
            const slide = (
              <PerStatusSlide
                key={`${status.name}-${chunkIdx}`}
                cfg={cfg}
                data={data}
                statusName={status.name}
                startIdx={chunkIdx * 8}
                pageNum={pageCounter}
              />
            );
            pageCounter++;
            return slide;
          });
        })}

        {/* Bloqués synthesis */}
        {pdfSections.bloqueSynth && hasBlocked && <BloquesSynthSlide cfg={cfg} data={data} />}

        {/* Réunions */}
        {pdfSections.reunions && hasMeetings && <ReunionsSlide cfg={cfg} data={data} />}

        {/* Section separator: Synthèse */}
        {pdfSections.separateurs && <SeparatorSlide label="SYNTHÈSE" slideKey="sep-synthese" color={pdfColor} />}

        {/* Evolution — KEPT */}
        {pdfSections.evolution && <EvolutionSlide cfg={cfg} data={data} />}

        {/* Trackers — KEPT */}
        {pdfSections.trackers && <TrackersSlide cfg={cfg} data={data} />}

        {/* Priorities — KEPT */}
        {pdfSections.priorities && <PrioritesSlide cfg={cfg} data={data} />}

        {/* Insights / recommendations — KEPT */}
        {pdfSections.insights && <InsightsSlide cfg={cfg} data={data} />}

        {/* Merci */}
        {pdfSections.merci && <MerciSlide cfg={cfg} data={data} />}
      </div>
    );
  },
);
