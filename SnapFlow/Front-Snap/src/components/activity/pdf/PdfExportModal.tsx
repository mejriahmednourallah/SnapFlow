import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface PdfExportModalProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;

  // Sections
  pdfSections: Record<string, boolean>;
  setPdfSections: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;

  // Advanced visibility toggle
  showAdvanced: boolean;
  setShowAdvanced: (v: boolean) => void;

  // Color
  pdfColor: string;
  setPdfColor: (c: string) => void;

  // Cover KPIs
  coverKpis: Record<string, boolean>;
  setCoverKpis: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;

  // Branding & contact
  pdfBrandLeft: string;  setPdfBrandLeft:  (v: string) => void;
  pdfBrandRight: string; setPdfBrandRight: (v: string) => void;
  pdfContactEmail: string; setPdfContactEmail: (v: string) => void;
  pdfContactWeb: string;   setPdfContactWeb:   (v: string) => void;
  pdfContactWeb2: string;  setPdfContactWeb2:  (v: string) => void;

  // Export state
  isExporting: boolean;
  doExportPDF: () => void;
}

// ─── Section definitions ──────────────────────────────────────────────────────

const COVER_KPI_DEFS = [
  { key: 'total',    label: 'Total' },
  { key: 'open',     label: 'En cours' },
  { key: 'resolved', label: 'Résolues' },
  { key: 'critical', label: 'Critiques' },
  { key: 'blocked',  label: 'Bloquées' },
  { key: 'closure',  label: 'Délai clôture' },
] as const;

const SECTION_DEFS = [
  { key: 'sommaire',    label: 'Sommaire (table des matières)' },
  { key: 'separateurs', label: 'Diapositives de séparation' },
  { key: 'perimetre',   label: 'Périmètre du projet' },
  { key: 'indicateurs', label: 'Indicateurs globaux' },
  { key: 'statuts',     label: 'Répartition par statut' },
  { key: 'perStatus',   label: 'Détail par statut (une diapo / statut)' },
  { key: 'bloqueSynth', label: 'Synthèse tickets bloqués' },
  { key: 'reunions',    label: 'Réunions et points d\'échange' },
  { key: 'evolution',   label: 'Évolution temporelle' },
  { key: 'trackers',    label: 'Répartition par catégorie' },
  { key: 'priorities',  label: 'Répartition par priorité' },
  { key: 'health',      label: 'Score de santé / radargram' },
  { key: 'insights',    label: 'Recommandations automatiques' },
  { key: 'merci',       label: 'Page de clôture' },
] as const;

// ─── Component ────────────────────────────────────────────────────────────────

export function PdfExportModal({
  open, onOpenChange,
  pdfSections, setPdfSections,
  showAdvanced, setShowAdvanced,
  pdfColor, setPdfColor,
  coverKpis, setCoverKpis,
  pdfBrandLeft, setPdfBrandLeft,
  pdfBrandRight, setPdfBrandRight,
  pdfContactEmail, setPdfContactEmail,
  pdfContactWeb, setPdfContactWeb,
  pdfContactWeb2, setPdfContactWeb2,
  isExporting, doExportPDF,
}: PdfExportModalProps) {
  // ── helpers ────────────────────────────────────────────────────────────────
  const toggleSection = (key: string) =>
    setPdfSections(prev => ({ ...prev, [key]: !prev[key] }));

  const toggleKpi = (key: string) =>
    setCoverKpis(prev => ({ ...prev, [key]: !prev[key] }));

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Exporter en PDF</DialogTitle>
        </DialogHeader>

        {/* ── Sections to include ─────────────────────────────────────────── */}
        <div className="space-y-1">
          <p className="text-sm font-semibold text-stone-700 mb-2">Diapositives à inclure</p>
          {SECTION_DEFS.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between py-1">
              <Label htmlFor={`sec-${key}`} className="text-sm text-stone-600 cursor-pointer">{label}</Label>
              <Switch
                id={`sec-${key}`}
                checked={pdfSections[key] ?? true}
                onCheckedChange={() => toggleSection(key)}
              />
            </div>
          ))}
        </div>

        <hr className="my-3 border-stone-200" />

        {/* ── Cover KPIs ──────────────────────────────────────────────────── */}
        <div>
          <p className="text-sm font-semibold text-stone-700 mb-2">KPIs sur la page de couverture</p>
          <div className="grid grid-cols-3 gap-2">
            {COVER_KPI_DEFS.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 text-sm text-stone-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={coverKpis[key] ?? true}
                  onChange={() => toggleKpi(key)}
                  className="accent-teal-500"
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <hr className="my-3 border-stone-200" />

        {/* ── Advanced options collapsible ─────────────────────────────────── */}
        <button
          type="button"
          className="flex items-center gap-2 text-sm font-semibold text-stone-700 w-full"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
          Options avancées
        </button>

        {showAdvanced && (
          <div className="mt-3 space-y-4">
            {/* Color */}
            <div className="flex items-center gap-4">
              <Label className="text-sm text-stone-600 w-32 flex-shrink-0">Couleur principale</Label>
              <label className="flex items-center gap-3 cursor-pointer">
                <div
                  className="w-8 h-8 rounded-full border-2 border-stone-300 shadow-sm"
                  style={{ background: pdfColor }}
                />
                <input
                  type="color"
                  value={pdfColor}
                  onChange={e => setPdfColor(e.target.value)}
                  className="sr-only"
                  id="pdfColorPicker"
                />
                <label htmlFor="pdfColorPicker" className="text-xs text-teal-600 underline cursor-pointer">
                  Changer
                </label>
              </label>
            </div>

            {/* Branding */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-stone-500">Marque (gauche)</Label>
                <Input
                  value={pdfBrandLeft}
                  onChange={e => setPdfBrandLeft(e.target.value)}
                  placeholder="Ex : MEDIANET"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-stone-500">Marque (droite)</Label>
                <Input
                  value={pdfBrandRight}
                  onChange={e => setPdfBrandRight(e.target.value)}
                  placeholder="Ex : RUN SERVICES"
                  className="h-8 text-sm"
                />
              </div>
            </div>

            {/* Contact info */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
                Contact (page Merci)
              </p>
              <div className="space-y-2">
                <Input
                  value={pdfContactEmail}
                  onChange={e => setPdfContactEmail(e.target.value)}
                  placeholder="Email de contact"
                  className="h-8 text-sm"
                />
                <Input
                  value={pdfContactWeb}
                  onChange={e => setPdfContactWeb(e.target.value)}
                  placeholder="Site web principal"
                  className="h-8 text-sm"
                />
                <Input
                  value={pdfContactWeb2}
                  onChange={e => setPdfContactWeb2(e.target.value)}
                  placeholder="Site web secondaire (optionnel)"
                  className="h-8 text-sm"
                />
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isExporting}>
            Annuler
          </Button>
          <Button
            onClick={doExportPDF}
            disabled={isExporting}
            style={{ background: pdfColor, color: '#fff', border: 'none' }}
          >
            {isExporting ? 'Export en cours…' : 'Exporter le PDF'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
