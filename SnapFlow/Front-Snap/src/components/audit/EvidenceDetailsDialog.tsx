import { useMemo } from 'react';
import type { AuditFinding } from '@/data/mockAuditData';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

interface EvidenceDetailsDialogProps {
  finding: AuditFinding;
  triggerLabel?: string;
}

function cleanLine(value: string): string {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  const comparable = normalized
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (
    comparable.startsWith('formule:') ||
    comparable.startsWith('formule du score:') ||
    comparable.includes('formule conforme=100') ||
    comparable.includes('formule conforme 100')
  ) {
    return '';
  }
  if (/^(VALID|PARTIAL|MISSING)$/i.test(normalized)) return '';
  if (normalized.startsWith('{') || normalized.startsWith('[')) {
    return 'Donnee technique structuree disponible dans les preuves tabulaires.';
  }
  return normalized
    .replace(/\bevidence\./gi, '')
    .replace(/\bmetrics\./gi, '')
    .replace(/\bKPI\b/gi, 'indicateur')
    .replace(/Largest Contentful Paint/gi, "temps d'affichage principal")
    .replace(/\bLCP\b/g, "temps d'affichage principal")
    .replace(/\bFCP\b/g, 'premier affichage visible')
    .replace(/\bCLS\b/g, 'stabilite visuelle')
    .replace(/\bCVE\b/gi, 'vulnerabilite connue')
    .replace(/\bCMS\b/g, 'systeme de gestion du site')
    .replace(/\bSSL\b/g, 'certificat de securite')
    .replace(/\bRGPD\b/gi, 'protection des données')
    .replace(/\bSEO\b/gi, 'SEO')
    .replace(/\bJS\b/g, 'JavaScript')
    .replace(/\banomalie\b/gi, 'signal')
    .replace(/\banomalies\b/gi, 'signaux');
}

function cleanColumnLabel(value: string): string {
  return cleanLine(value)
    .replace(/_/g, ' ')
    .replace(/\burl\b/gi, 'adresse de page')
    .replace(/\bstatus code\b/gi, 'code de reponse')
    .replace(/\bstatus\b/gi, 'statut')
    .replace(/\bverification result\b/gi, 'resultat de verification')
    .replace(/\bverification source\b/gi, 'source de verification')
    .replace(/\blatest known version\b/gi, 'derniere version connue')
    .replace(/\bminimum safe version\b/gi, 'version minimale securisee')
    .replace(/\brisk\b/gi, 'risque')
    .replace(/\brecommendation\b/gi, 'recommandation')
    .replace(/\bmodule\b/gi, 'module')
    .replace(/\bname\b/gi, 'nom')
    .replace(/\bversion\b/gi, 'version')
    .replace(/\blcp ms\b/gi, "temps d'affichage principal")
    .replace(/\bfcp ms\b/gi, 'premier affichage visible')
    .replace(/\bcls\b/gi, 'stabilite visuelle')
    .replace(/\bthreshold ms\b/gi, 'seuil attendu');
}

function splitSummaryLine(value: string): { label: string; value: string } | null {
  const idx = value.indexOf(':');
  if (idx <= 0 || idx > 48) return null;
  const label = value.slice(0, idx).trim();
  const lineValue = value.slice(idx + 1).trim();
  if (!label || !lineValue) return null;
  return { label: cleanColumnLabel(label), value: lineValue };
}

function shouldShowEvidenceColumn(value: string): boolean {
  const normalized = String(value ?? '')
    .replace(/_/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  return normalized !== 'score formula' && normalized !== 'formule' && normalized !== 'formule du score';
}

function csvEscape(value: unknown): string {
  const rendered = renderEvidenceValue(value).replace(/\r?\n/g, ' ').trim();
  if (/[",;]/.test(rendered)) {
    return `"${rendered.replace(/"/g, '""')}"`;
  }
  return rendered;
}

function translateEvidenceValue(value: string): string {
  return cleanLine(value)
    .replace(/^missing$/i, 'manquant')
    .replace(/^present$/i, 'present')
    .replace(/^true$/i, 'oui')
    .replace(/^false$/i, 'non')
    .replace(/^non_verifie$/i, 'non verifie')
    .replace(/^donnees_incompletes$/i, 'donnees incompletes')
    .replace(/^a_verifier$/i, 'a verifier')
    .replace(/^risque_confirme$/i, 'risque confirme')
    .replace(/^verifie_conforme$/i, 'verifie conforme')
    .replace(/^hybrid_offline_first$/i, 'hybride, catalogue local d abord')
    .replace(/^non_configure$/i, 'non configure')
    .replace(/^offline_module_catalog_2026_04$/i, 'catalogue local modules 2026-04');
}

function renderEvidenceValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'non renseigne';
  if (typeof value === 'string') return translateEvidenceValue(value);
  if (typeof value === 'number' || typeof value === 'boolean') return translateEvidenceValue(String(value));
  if (Array.isArray(value)) {
    const rendered = value.map(renderEvidenceValue).filter(Boolean);
    return rendered.length ? rendered.join(', ') : 'non renseigne';
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== null && entryValue !== undefined && entryValue !== '')
      .map(([key, entryValue]) => `${cleanColumnLabel(key)}: ${renderEvidenceValue(entryValue)}`);
    return entries.length ? entries.join(' | ') : 'non renseigne';
  }
  return translateEvidenceValue(String(value));
}

function downloadCsv(filename: string, columns: string[], rows: Record<string, unknown>[]) {
  if (columns.length === 0 || rows.length === 0) return;
  const csv = [
    columns.map(csvEscape).join(','),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(',')),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function EvidenceDetailsDialog({
  finding,
  triggerLabel = 'Voir les preuves',
}: EvidenceDetailsDialogProps) {
  const summaryLines = useMemo(() => {
    const source = finding.evidenceSummary ?? finding.evidence ?? finding.annexes ?? [];
    return source
      .map((line) => cleanLine(line))
      .filter(Boolean)
      .slice(0, 20);
  }, [finding.evidenceSummary, finding.evidence, finding.annexes]);

  const evidenceRows = useMemo(
    () => (finding.evidenceRows ?? [])
      .map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => shouldShowEvidenceColumn(key))))
      .slice(0, 10),
    [finding.evidenceRows],
  );

  const csvRows = useMemo(
    () => ((finding.evidenceCsvRows ?? finding.evidenceRows ?? []) as Record<string, unknown>[])
      .map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => shouldShowEvidenceColumn(key)))),
    [finding.evidenceCsvRows, finding.evidenceRows],
  );

  const csvColumns = useMemo(() => {
    const configured = (finding.evidenceCsvColumns ?? []).filter(Boolean).filter(shouldShowEvidenceColumn);
    if (configured.length > 0) return configured;
    const first = csvRows[0];
    return first ? Object.keys(first) : [];
  }, [finding.evidenceCsvColumns, csvRows]);

  const canDownloadCsv = csvRows.length > 0 && csvColumns.length > 0;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="text-xs px-2 py-1 rounded border border-primary/30 text-primary hover:bg-primary/10 transition-colors"
        >
          {triggerLabel}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{finding.title}</DialogTitle>
          <DialogDescription>
            {finding.kpiLabels
              ? `Statut : ${finding.kpiLabels.statut} - Type : ${finding.kpiLabels.typeLabel} - Priorite : ${finding.kpiLabels.priorite}`
              : 'Vue structuree des preuves associees au controle.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          {finding.kpiLabels && (
            <section className="grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-muted/20 border border-border/30 p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">Statut</p>
                <span className={finding.kpiLabels.statut === 'Concluant' ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>
                  {finding.kpiLabels.statut}
                </span>
              </div>
              <div className="rounded-lg bg-muted/20 border border-border/30 p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">Type</p>
                <p className="font-semibold">{finding.kpiLabels.typeLabel}</p>
              </div>
              <div className="rounded-lg bg-muted/20 border border-border/30 p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">Priorite</p>
                <p className="font-semibold">{finding.kpiLabels.priorite}</p>
              </div>
            </section>
          )}

          {evidenceRows.length > 0 && (
            <section>
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-sm font-semibold">Table des preuves ({csvRows.length})</p>
                {canDownloadCsv && (
                  <button
                    type="button"
                    className="text-xs px-2 py-1 rounded border border-primary/30 text-primary hover:bg-primary/10 transition-colors"
                    onClick={() => downloadCsv(`${finding.id || 'kpi'}-preuves.csv`, csvColumns, csvRows)}
                  >
                    Telecharger CSV
                  </button>
                )}
              </div>
              <div className="overflow-x-auto rounded border border-border/40">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      {csvColumns.map((column) => (
                        <th key={column} className="text-left font-semibold px-2 py-1.5 whitespace-nowrap">
                          {cleanColumnLabel(column)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {evidenceRows.map((row, rowIndex) => (
                      <tr key={rowIndex} className="border-t border-border/30">
                        {csvColumns.map((column) => (
                          <td key={`${rowIndex}-${column}`} className="px-2 py-1.5 align-top break-words max-w-[260px]">
                            {renderEvidenceValue(row[column])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {csvRows.length > evidenceRows.length && (
                <p className="text-xs text-muted-foreground mt-1">
                  Apercu limite aux 10 premieres lignes. Le CSV contient les lignes disponibles.
                </p>
              )}
            </section>
          )}

          <Accordion type="single" collapsible className="rounded border border-border/40 px-3">
            <AccordionItem value="context" className="border-b-0">
              <AccordionTrigger className="py-3 text-sm font-semibold hover:no-underline">
                Preuves et contexte
              </AccordionTrigger>
              <AccordionContent>
                {summaryLines.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {finding.evidenceMissingReason ?? 'Aucune preuve textuelle resumee.'}
                  </p>
                ) : (
                  <div className="overflow-hidden rounded border border-border/40">
                    {summaryLines.map((line, index) => {
                      const split = splitSummaryLine(line);
                      return split ? (
                        <div key={`${line}-${index}`} className="grid grid-cols-[160px_1fr] gap-3 border-t first:border-t-0 border-border/30 px-3 py-2 text-sm">
                          <span className="font-medium text-foreground">{split.label}</span>
                          <span className="text-muted-foreground break-words">{split.value}</span>
                        </div>
                      ) : (
                        <div key={`${line}-${index}`} className="border-t first:border-t-0 border-border/30 px-3 py-2 text-sm text-muted-foreground">
                          {line}
                        </div>
                      );
                    })}
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </DialogContent>
    </Dialog>
  );
}
