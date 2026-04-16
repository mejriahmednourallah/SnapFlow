import { useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PDF_THEMES } from './pdfStyles';
import type { PdfTheme } from './pdfStyles';

interface Props {
  open: boolean;
  onClose: () => void;
  onGenerate: (theme: PdfTheme) => Promise<void>;
}

export function PdfThemePickerModal({ open, onClose, onGenerate }: Props) {
  const [selected, setSelected] = useState<string>(PDF_THEMES[0].id);
  const [isGenerating, setIsGenerating] = useState(false);

  const selectedTheme = PDF_THEMES.find(t => t.id === selected) ?? PDF_THEMES[0];

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      await onGenerate(selectedTheme);
      onClose();
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v && !isGenerating) onClose(); }}>
      <DialogContent className="sm:max-w-md max-h-[80vh] overflow-y-auto p-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <FileDown className="w-4 h-4" />
            Exporter en PDF
          </DialogTitle>
          <DialogDescription className="text-xs">
            Choisissez un thème de couleur pour le rapport PDF.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 py-2">
          {PDF_THEMES.map(theme => (
            <button
              key={theme.id}
              type="button"
              onClick={() => setSelected(theme.id)}
              className={cn(
                'flex flex-col items-start gap-1.5 p-1.5 rounded-lg border transition-all bg-background text-left',
                selected === theme.id
                  ? 'border-primary ring-1 ring-primary/30'
                  : 'border-border hover:border-muted-foreground/40',
              )}
            >
              <div className="w-full rounded-md overflow-hidden border border-border/60 bg-white">
                <div className="w-full" style={{ height: 24, backgroundColor: theme.heroBg }} />
                <div
                  className="w-full flex items-center justify-between px-1.5"
                  style={{ height: 12, backgroundColor: theme.headerBg, borderBottom: `1px solid ${theme.headerBorder}` }}
                >
                  <div className="flex items-center gap-1">
                    <div className="rounded-full" style={{ width: 4, height: 4, backgroundColor: theme.primary }} />
                    <div className="rounded" style={{ width: 24, height: 2, backgroundColor: theme.headerBorder }} />
                  </div>
                  <div className="rounded" style={{ width: 10, height: 2, backgroundColor: theme.headerBorder }} />
                </div>
                <div className="px-1.5 py-1.5 bg-white space-y-1.5">
                  <div className="flex items-end gap-1.5">
                    <div
                      className="rounded"
                      style={{ width: 20, height: 20, backgroundColor: `${theme.primary}18`, border: `1px solid ${theme.headerBorder}` }}
                    />
                    <div className="flex-1 space-y-1">
                      <div className="rounded" style={{ width: '60%', height: 3, backgroundColor: theme.primary }} />
                      <div className="rounded" style={{ width: '40%', height: 2, backgroundColor: theme.headerBorder }} />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {[0, 1, 2].map((index) => (
                      <div
                        key={`${theme.id}-card-${index}`}
                        className="rounded"
                        style={{ height: 14, backgroundColor: theme.recBg, border: `1px solid ${theme.headerBorder}` }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="w-full flex items-center justify-between">
                <span className="text-[11px] font-semibold" style={{ color: selected === theme.id ? theme.primary : undefined }}>
                  {theme.name}
                </span>
                <div className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full border" style={{ backgroundColor: theme.primary, borderColor: theme.primary }} />
                  <span className="h-2.5 w-2.5 rounded-full border" style={{ backgroundColor: theme.headerBg, borderColor: theme.headerBorder }} />
                  <span className="h-2.5 w-2.5 rounded-full border" style={{ backgroundColor: theme.recBg, borderColor: theme.headerBorder }} />
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isGenerating}>
            Annuler
          </Button>
          <Button size="sm" onClick={handleGenerate} disabled={isGenerating}>
            {isGenerating
              ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Génération...</>
              : <><FileDown className="w-3.5 h-3.5 mr-1.5" />Télécharger</>
            }
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
