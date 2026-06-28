import { useEffect, useState } from 'react';
import { Settings, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import {
  ACTIVITY_PDF_BRAND_DEFAULTS,
  fetchActivityPdfBrandDefaults,
  saveActivityPdfBrandDefaults,
} from '@/lib/appSettings';

const AdminSettings = () => {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const [brandLeft, setBrandLeft] = useState(ACTIVITY_PDF_BRAND_DEFAULTS.left);
  const [brandRight, setBrandRight] = useState(ACTIVITY_PDF_BRAND_DEFAULTS.right);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user || !isAdmin) return;
    fetchActivityPdfBrandDefaults()
      .then((defaults) => {
        setBrandLeft(defaults.left);
        setBrandRight(defaults.right);
      })
      .catch((error) => {
        toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
      })
      .finally(() => setLoading(false));
  }, [user, isAdmin, toast]);

  if (!isAdmin) {
    return (
      <div className="glass-card p-6 text-sm text-muted-foreground">
        Acces reserve aux Super Admins.
      </div>
    );
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) return;
    setSaving(true);
    try {
      await saveActivityPdfBrandDefaults({ left: brandLeft, right: brandRight }, user.id);
      toast({ title: 'Parametres enregistres' });
    } catch (error: any) {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="h-5 w-5 text-primary" />
        <div>
          <h1 className="text-xl font-bold">Parametres</h1>
          <p className="text-sm text-muted-foreground">Valeurs globales utilisees par les exports.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="glass-card max-w-2xl space-y-4 p-5">
        <div>
          <h2 className="text-sm font-semibold">Branding PDF du rapport d'activite</h2>
          <p className="text-xs text-muted-foreground">
            Ces valeurs alimentent les champs de marque par defaut. Elles restent modifiables au moment de l'export.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Marque gauche</label>
            <Input value={brandLeft} onChange={(event) => setBrandLeft(event.target.value)} disabled={loading || saving} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Marque droite</label>
            <Input value={brandRight} onChange={(event) => setBrandRight(event.target.value)} disabled={loading || saving} />
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={loading || saving}>
            <Save className="mr-1.5 h-4 w-4" />
            {saving ? 'Enregistrement...' : 'Enregistrer'}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default AdminSettings;
