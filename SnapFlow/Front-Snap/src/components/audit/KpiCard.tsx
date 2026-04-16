import { useState } from 'react';
import { ChevronDown, AlertCircle, CheckCircle, Lightbulb, Bug, ShieldAlert } from 'lucide-react';
import { CriticalityBadge } from '@/components/CriticalityBadge';
import type { AuditFinding } from '@/data/mockAuditData';
import { KpiUrlIndex } from './KpiUrlIndex';
import { EvidenceDetailsDialog } from '@/components/audit/EvidenceDetailsDialog';

interface KpiCardProps {
  kpi: AuditFinding;
}

export function KpiCard({ kpi }: KpiCardProps) {
  const [showEvidence, setShowEvidence] = useState(false);
  const [showFix, setShowFix] = useState(false);

  const isFailure = kpi.status === 'fail';
  const hasUrls = kpi.exampleUrls && kpi.exampleUrls.length > 0;
  const urlCount = kpi.exampleUrls?.length ?? 0;
  const showUrlIndex = urlCount >= 10;
  const hasEvidenceDetails =
    Boolean(kpi.evidenceRaw) ||
    (kpi.evidenceSummary?.length ?? 0) > 0 ||
    (kpi.evidence?.length ?? 0) > 0 ||
    (kpi.annexes?.length ?? 0) > 0 ||
    (kpi.exampleUrls?.length ?? 0) > 0;

  const getBadge = () => {
    if (kpi.origin === 'RGPD') {
      return (
        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border text-orange-400 bg-orange-500/10 border-orange-500/20">
          <ShieldAlert className="w-3 h-3" />
          <span>RGPD</span>
        </span>
      );
    }
    if (kpi.origin === 'bug' || kpi.type === 'bug') {
      return (
        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border text-red-400 bg-red-500/10 border-red-500/20">
          <Bug className="w-3 h-3" />
          <span>Bug</span>
        </span>
      );
    }
    if (kpi.status === 'pass') {
      return (
        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border text-emerald-400 bg-emerald-500/10 border-emerald-500/20">
          <CheckCircle className="w-3 h-3" />
          <span>KPI validé</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border text-blue-400 bg-blue-500/10 border-blue-500/20">
        <Lightbulb className="w-3 h-3" />
        <span>Recommandation</span>
      </span>
    );
  };

  return (
    <div className="p-4 rounded-lg bg-muted/20 border border-border/30 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <h4 className="font-semibold text-sm">{kpi.title}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">{kpi.description}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {getBadge()}
          <CriticalityBadge level={kpi.criticality} />
        </div>
      </div>

      {/* Evidence accordion (if failure) */}
      {isFailure && (
        <div className="border-t border-border/30 pt-3">
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => setShowEvidence(!showEvidence)}
              className="flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
            >
              <ChevronDown className={`w-4 h-4 transition-transform ${showEvidence ? 'rotate-180' : ''}`} />
              <AlertCircle className="w-4 h-4" />
              Détails de l'échec ({kpi.evidence?.length ?? 0})
            </button>
            {hasEvidenceDetails && (
              <EvidenceDetailsDialog finding={kpi} triggerLabel="Preuves detaillees" />
            )}
          </div>

          {showEvidence && (
            <div className="mt-3 space-y-2 pl-6">
              <p className="text-xs text-muted-foreground">{kpi.description}</p>

              {/* Impact */}
              {kpi.impact && (
                <div className="bg-destructive/5 border border-destructive/10 rounded p-2 mt-2">
                  <p className="text-xs">
                    <span className="font-medium">Impact client :</span> {kpi.impact}
                  </p>
                </div>
              )}

              {/* Evidence items */}
              {kpi.evidence && kpi.evidence.length > 0 && (
                <div className="space-y-1 mt-2">
                  <p className="text-xs font-medium text-muted-foreground">Observations :</p>
                  <ul className="space-y-1">
                    {kpi.evidence.map((e, i) => (
                      <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                        <span className="text-muted-foreground/60 mt-0.5">•</span>
                        <span>{e}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {hasEvidenceDetails && (
                <p className="text-xs text-muted-foreground mt-3">
                  Astuce: utilisez le bouton "Preuves detaillees" pour voir le resume, les URLs et le JSON formate.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* URL Index (if 10+ affected) */}
      {showUrlIndex && hasUrls && (
        <div className="border-t border-border/30 pt-3">
          <KpiUrlIndex
            urls={kpi.exampleUrls!}
            affectedCount={urlCount}
          />
        </div>
      )}

      {/* Fix accordion */}
      {kpi.fix && (
        <div className="border-t border-border/30 pt-3">
          <button
            onClick={() => setShowFix(!showFix)}
            className="flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80 transition-colors w-full"
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${showFix ? 'rotate-180' : ''}`} />
            <Lightbulb className="w-4 h-4" />
            Correction recommandée
          </button>

          {showFix && (
            <div className="mt-3 pl-6">
              <div className="bg-primary/5 border border-primary/10 rounded p-3">
                <p className="text-sm text-foreground">{kpi.fix}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Affected count badge */}
      {hasUrls && (
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-0.5 rounded-full border border-amber-500/20 bg-amber-500/10 text-amber-400">
            {urlCount} élément{urlCount > 1 ? 's' : ''} concerné{urlCount > 1 ? 's' : ''}
          </span>
        </div>
      )}
    </div>
  );
}
