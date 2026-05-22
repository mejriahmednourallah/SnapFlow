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

interface EvidenceDetailsDialogProps {
  finding: AuditFinding;
  triggerLabel?: string;
}

function cleanLine(value: string): string {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
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
    .replace(/\bRGPD\b/gi, 'protection des donnees')
    .replace(/\bSEO\b/gi, 'referencement')
    .replace(/\bJS\b/g, 'JavaScript')
    .replace(/\banomalie\b/gi, 'signal')
    .replace(/\banomalies\b/gi, 'signaux');
}

function cleanColumnLabel(value: string): string {
  return cleanLine(value)
    .replace(/_/g, ' ')
    .replace(/\burl\b/gi, 'adresse de page')
    .replace(/\bstatus code\b/gi, 'code de reponse')
    .replace(/\blcp ms\b/gi, "temps d'affichage principal")
    .replace(/\bfcp ms\b/gi, 'premier affichage visible')
    .replace(/\bcls\b/gi, 'stabilite visuelle')
    .replace(/\bthreshold ms\b/gi, 'seuil attendu');
}

function csvEscape(value: unknown): string {
  const rendered = String(value ?? '').replace(/\r?\n/g, ' ').trim();
  if (/[",;]/.test(rendered)) {
    return `"${rendered.replace(/"/g, '""')}"`;
  }
  return rendered;
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

  const uniqueUrls = useMemo(
    () => Array.from(new Set((finding.exampleUrls ?? []).map((url) => String(url ?? '').trim()).filter(Boolean))).slice(0, 25),
    [finding.exampleUrls],
  );

  const evidenceRows = useMemo(
    () => (finding.evidenceRows ?? []).slice(0, 10),
    [finding.evidenceRows],
  );

  const csvRows = useMemo(
    () => (finding.evidenceCsvRows ?? finding.evidenceRows ?? []) as Record<string, unknown>[],
    [finding.evidenceCsvRows, finding.evidenceRows],
  );

  const csvColumns = useMemo(() => {
    const configured = (finding.evidenceCsvColumns ?? []).filter(Boolean);
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
                <span className={finding.kpiLabels.statut === 'Concluant' ? 'text-emerald-400 font-semibold' : finding.kpiLabels.statut === 'Non testé' ? 'text-yellow-400 font-semibold' : 'text-red-400 font-semibold'}>
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

          <section>
            <p className="text-sm font-semibold mb-2">Preuves et contexte</p>
            {summaryLines.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {finding.evidenceMissingReason ?? 'Aucune preuve textuelle resumee.'}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {summaryLines.map((line, index) => (
                  <li key={`${line}-${index}`} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="text-muted-foreground/60 mt-0.5">-</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

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
                            {String(row[column] ?? '')}
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

          {uniqueUrls.length > 0 && (
            <section>
              <p className="text-sm font-semibold mb-2">Pages concernees ({uniqueUrls.length})</p>
              <ul className="space-y-1">
                {uniqueUrls.map((url) => (
                  <li key={url}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline break-all"
                    >
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
