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
  if (normalized.startsWith('{') || normalized.startsWith('[')) {
    return 'Donnee structuree disponible dans la section JSON formatee.';
  }
  return normalized;
}

function toPrettyJson(value: unknown): string {
  if (value === null || value === undefined) {
    return '{}';
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '{}';
  }
}

export function EvidenceDetailsDialog({
  finding,
  triggerLabel = 'Voir les preuves detaillees',
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

  const formattedJson = useMemo(() => toPrettyJson(finding.evidenceRaw ?? {}), [finding.evidenceRaw]);

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
            Vue structuree des preuves et details techniques associes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <section>
            <p className="text-sm font-semibold mb-2">Resume exploitable</p>
            {summaryLines.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune preuve textuelle resumee.</p>
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

          {uniqueUrls.length > 0 && (
            <section>
              <p className="text-sm font-semibold mb-2">URLs concernees ({uniqueUrls.length})</p>
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

          <section>
            <p className="text-sm font-semibold mb-2">JSON formatee</p>
            <pre className="text-xs bg-muted/30 border border-border/40 rounded p-3 overflow-auto whitespace-pre-wrap break-words">
              {formattedJson}
            </pre>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
