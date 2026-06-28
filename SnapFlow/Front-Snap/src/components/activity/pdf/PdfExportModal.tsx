import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { PDF_THEMES } from '@/components/pdf/pdfStyles';

export interface PdfExportModalProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pdfSections: Record<string, boolean>;
  setPdfSections: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  showAdvanced: boolean;
  setShowAdvanced: (v: boolean) => void;
  selectedThemeId: string;
  setSelectedThemeId: (v: string) => void;
  pdfColor: string;
  setPdfColor: (c: string) => void;
  coverKpis: Record<string, boolean>;
  setCoverKpis: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  pdfBrandLeft: string;  setPdfBrandLeft:  (v: string) => void;
  pdfBrandRight: string; setPdfBrandRight: (v: string) => void;
  pdfContactEmail: string; setPdfContactEmail: (v: string) => void;
  pdfContactWeb: string;   setPdfContactWeb:   (v: string) => void;
  pdfContactWeb2: string;  setPdfContactWeb2:  (v: string) => void;
  isExporting: boolean;
  doExportPDF: () => void;
  hasPerimeterBlocks?: boolean;
}

const COVER_KPI_DEFS = [
  { key: 'total', label: 'Total' },
  { key: 'meetings', label: 'Réunions' },
  { key: 'open', label: 'En cours' },
  { key: 'resolved', label: 'Résolus' },
  { key: 'cancelled', label: 'Annulés' },
  { key: 'critical', label: 'Critiques' },
  { key: 'blocked', label: 'Bloqués' },
] as const;

const SECTION_DEFS = [
  { key: 'sommaire', label: 'Table des matières' },
  { key: 'perimetre', label: 'Page périmètre' },
  { key: 'merci', label: 'Page de clôture' },
] as const;

const REPORT_STRUCTURE_DEFS = [
  'Périmètre & cadre du projet',
  'Indicateurs globaux',
  'État des tickets avec graphique',
  'Typologie des tickets',
  'Priorité des tickets',
  'Détails des tickets clôturés',
  'Détails des tickets ouverts',
  'Tickets annulés si présents',
  'Tickets en cours de test et pris en charge',
  'Tables actionnables si données',
  'Tickets bloqués si présents',
  "Réunions et points d'échange si présents",
] as const;

export function PdfExportModal({
  open, onOpenChange,
  pdfSections, setPdfSections,
  showAdvanced, setShowAdvanced,
  selectedThemeId, setSelectedThemeId,
  pdfColor, setPdfColor,
  coverKpis, setCoverKpis,
  pdfBrandLeft, setPdfBrandLeft,
  pdfBrandRight, setPdfBrandRight,
  pdfContactEmail, setPdfContactEmail,
  pdfContactWeb, setPdfContactWeb,
  pdfContactWeb2, setPdfContactWeb2,
  isExporting, doExportPDF,
  hasPerimeterBlocks = true,
}: PdfExportModalProps) {
  const toggleSection = (key: string) =>
    setPdfSections(prev => ({ ...prev, [key]: !prev[key] }));

  const toggleKpi = (key: string) =>
    setCoverKpis(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Exporter le rapport d'activité</DialogTitle>
        </DialogHeader>

        <div>
          <p className="text-sm font-semibold text-stone-700 mb-2">Theme du rapport</p>
          <div className="grid grid-cols-2 gap-2">
            {PDF_THEMES.map(theme => (
              <button
                key={theme.id}
                type="button"
                onClick={() => {
                  setSelectedThemeId(theme.id);
                  setPdfColor(theme.primary);
                }}
                className={`text-left rounded-lg border p-2 transition ${selectedThemeId === theme.id ? 'border-primary bg-primary/5' : 'border-stone-200 hover:bg-stone-50'}`}
              >
                <div className="h-7 rounded-md mb-2" style={{ background: theme.heroBg }} />
                <div className="text-xs font-semibold text-stone-700">{theme.name}</div>
              </button>
            ))}
          </div>
        </div>

        <hr className="my-3 border-stone-200" />

        <div>
          <p className="text-sm font-semibold text-stone-700 mb-2">Structure analytique dynamique</p>
          <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-stone-200 bg-stone-50 p-2">
            {REPORT_STRUCTURE_DEFS.map(label => (
              <div key={label} className="rounded-md bg-white px-2 py-1 text-xs font-medium text-stone-600">
                {label}
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-stone-500">
            Les pages vides sont fusionnees automatiquement pour produire un rapport plus dense et plus lisible.
          </p>
        </div>

        <hr className="my-3 border-stone-200" />

        <div className="space-y-1">
          <p className="text-sm font-semibold text-stone-700 mb-2">Pages optionnelles</p>
          {SECTION_DEFS.map(({ key, label }) => {
            const disabled = key === 'perimetre' && !hasPerimeterBlocks;
            return (
            <div key={key} className="flex items-center justify-between py-1">
              <Label htmlFor={`sec-${key}`} className={`text-sm ${disabled ? 'text-stone-400' : 'text-stone-600 cursor-pointer'}`}>
                {label}
                {disabled ? <span className="ml-2 text-xs text-stone-400">Non configuree</span> : null}
              </Label>
              <Switch
                id={`sec-${key}`}
                checked={disabled ? false : (pdfSections[key] ?? true)}
                disabled={disabled}
                onCheckedChange={() => toggleSection(key)}
              />
            </div>
          )})}
        </div>

        <hr className="my-3 border-stone-200" />

        <div>
          <p className="text-sm font-semibold text-stone-700 mb-2">Indicateurs sur la couverture</p>
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

        <button
          type="button"
          className="flex items-center gap-2 text-sm font-semibold text-stone-700 w-full"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
          Options avancees
        </button>

        {showAdvanced && (
          <div className="mt-3 space-y-4">
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

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-stone-500">Marque gauche</Label>
                <Input value={pdfBrandLeft} onChange={e => setPdfBrandLeft(e.target.value)} className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-stone-500">Marque droite</Label>
                <Input value={pdfBrandRight} onChange={e => setPdfBrandRight(e.target.value)} className="h-8 text-sm" />
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
                Contact
              </p>
              <Input value={pdfContactEmail} onChange={e => setPdfContactEmail(e.target.value)} placeholder="Email de contact" className="h-8 text-sm" />
              <Input value={pdfContactWeb} onChange={e => setPdfContactWeb(e.target.value)} placeholder="Site web principal" className="h-8 text-sm" />
              <Input value={pdfContactWeb2} onChange={e => setPdfContactWeb2(e.target.value)} placeholder="Site web secondaire" className="h-8 text-sm" />
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
            {isExporting ? 'Export en cours...' : 'Exporter le PDF'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
