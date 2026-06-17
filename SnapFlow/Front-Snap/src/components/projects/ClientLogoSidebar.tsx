import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Check, Loader2, RefreshCw, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ClientLogoSidebarProps {
  siteUrl: string;
  projectId?: string;
  currentUrl?: string | null;
  onApply?: (logoUrl: string) => void;
}

type DetectLogoResult = {
  logo_url: string | null;
  source?: string;
  confidence?: number;
  reason?: string;
  candidates?: Array<{ url: string; source: string; confidence: number; reason?: string }>;
  detection_errors?: string[];
};

function sourceLabel(source?: string) {
  if (!source) return 'Source inconnue';
  if (source === 'page-logo') return 'Logo de page';
  if (source === 'jsonld-logo') return 'Logo JSON-LD';
  if (source === 'header-image') return 'Image d entete';
  if (source === 'background-logo') return 'Fond de marque';
  if (source === 'common-path') return 'Chemin courant';
  if (source === 'stored-fallback') return 'Logo enregistre';
  if (source === 'page-icon') return 'Icone du site';
  if (source === 'social-image') return 'Image sociale';
  return source;
}

export function ClientLogoSidebar({ siteUrl, projectId, currentUrl, onApply }: ClientLogoSidebarProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DetectLogoResult | null>(null);
  const [manualUrl, setManualUrl] = useState(currentUrl ?? '');

  useEffect(() => {
    setManualUrl(currentUrl ?? '');
    setSaved(false);
  }, [currentUrl]);

  const fetchLogo = async () => {
    if (!siteUrl) return;
    setLoading(true);
    setSaved(false);
    setError(null);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('detect-logo', {
        body: { siteUrl },
      });
      if (error) {
        setError('Detection indisponible. Vous pouvez coller une URL manuellement.');
        return;
      }
      const detected = data as DetectLogoResult;
      setResult(detected);
      if (!detected?.logo_url) {
        setError('Aucun logo detecte automatiquement. Vous pouvez coller une URL manuellement.');
      }
    } catch {
      setError('Detection indisponible. Vous pouvez coller une URL manuellement.');
    } finally {
      setLoading(false);
    }
  };

  const saveLogo = async (logoUrl: string) => {
    const trimmed = logoUrl.trim();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      if (projectId) {
        const { error } = await supabase
          .from('projects')
          .update({ logo_url: trimmed || null })
          .eq('id', projectId);
        if (error) throw error;
      }
      setManualUrl(trimmed);
      onApply?.(trimmed);
      setSaved(true);
    } catch (err: any) {
      setError(err?.message || "Impossible d'enregistrer le logo.");
    } finally {
      setSaving(false);
    }
  };

  const useDetectedLogo = () => {
    if (!result?.logo_url) return;
    setManualUrl(result.logo_url);
    setSaved(false);
  };

  return (
    <div className="rounded-lg border border-border/60 bg-muted/10 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Logo client</p>
        <Button variant="ghost" size="sm" className="h-8 px-2" onClick={fetchLogo} disabled={loading || !siteUrl}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          <span className="ml-1.5 text-xs">Detecter</span>
        </Button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Recherche du logo...
        </div>
      )}

      {!loading && result?.logo_url && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">
              Detecte: {sourceLabel(result.source)}
              {typeof result.confidence === 'number' ? ` (${Math.round(result.confidence * 100)}%)` : ''}
            </span>
            <Button type="button" size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={useDetectedLogo}>
              Utiliser ce logo
            </Button>
          </div>
          <div className="relative rounded-lg border border-border bg-white p-3 flex items-center justify-center min-h-24">
            <img src={result.logo_url} alt="Logo detecte" className="max-h-16 max-w-full object-contain" />
          </div>
          {result.reason && <p className="text-[11px] text-muted-foreground">{result.reason}</p>}
        </div>
      )}

      {!loading && error && <p className="text-xs text-muted-foreground">{error}</p>}

      <div className="space-y-2">
        <p className="text-[11px] text-muted-foreground">URL enregistree</p>
        <input
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          value={manualUrl}
          onChange={(e) => {
            setManualUrl(e.target.value);
            setSaved(false);
          }}
          placeholder="https://exemple.com/logo.png"
        />
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Button size="sm" variant="outline" className="w-full" onClick={() => saveLogo(manualUrl)} disabled={saving}>
            {saving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}
            Enregistrer l URL
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="px-2"
            onClick={() => saveLogo('')}
            disabled={saving || !manualUrl.trim()}
            title="Supprimer le logo"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
        {saved && (
          <p className="flex items-center gap-1 text-xs text-emerald-600">
            <Check className="w-3.5 h-3.5" /> Sauvegarde
          </p>
        )}
      </div>
    </div>
  );
}
