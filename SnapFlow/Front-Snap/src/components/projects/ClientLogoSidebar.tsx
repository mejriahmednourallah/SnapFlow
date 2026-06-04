import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, RefreshCw, Copy } from 'lucide-react';
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
};

export function ClientLogoSidebar({ siteUrl, projectId, currentUrl, onApply }: ClientLogoSidebarProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DetectLogoResult | null>(null);
  const [manualUrl, setManualUrl] = useState(currentUrl ?? '');

  const fetchLogo = async () => {
    if (!siteUrl) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('detect-logo', {
        body: { siteUrl },
      });
      if (error) {
        setError('Detection indisponible. Ajoutez l URL du logo manuellement.');
        setResult(null);
      } else {
        setResult(data as DetectLogoResult);
        if (data?.logo_url) {
          setManualUrl(data.logo_url);
        } else {
          setError('Aucun logo detecte automatiquement. Ajoutez l URL du logo manuellement.');
        }
      }
    } catch {
      setError('Detection indisponible. Ajoutez l URL du logo manuellement.');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setManualUrl(currentUrl ?? '');
  }, [currentUrl]);

  const saveLogo = async (logoUrl: string) => {
    if (!logoUrl) return;
    if (onApply) onApply(logoUrl);
    if (projectId) {
      await supabase.from('projects').update({ logo_url: logoUrl }).eq('id', projectId);
    }
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
          Recherche du logoâ€¦
        </div>
      )}

      {!loading && result?.logo_url && (
        <div className="space-y-2">
          <div className="relative rounded-lg border border-border bg-white p-3 flex items-center justify-center min-h-24">
            <img
              src={result.logo_url}
              alt="Logo dÃ©tectÃ©"
              className="max-h-16 max-w-full object-contain"
            />
          </div>
        </div>
      )}

      {!loading && error && (
        <p className="text-xs text-muted-foreground">{error}</p>
      )}

      <div className="space-y-2">
        <input
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          value={manualUrl}
          onChange={(e) => setManualUrl(e.target.value)}
          placeholder="https://exemple.com/logo.png"
        />
        <Button size="sm" variant="outline" className="w-full" onClick={() => saveLogo(manualUrl)}>
          <Copy className="w-3.5 h-3.5 mr-1" /> Modifier
        </Button>
      </div>
    </div>
  );
}
