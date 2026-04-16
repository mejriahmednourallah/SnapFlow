import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ArrowRight, BarChart3, Shield, Zap, Globe, Mail } from 'lucide-react';
import { AxisIcon } from '@/components/audit/AxisIcon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScoreGauge } from '@/components/ScoreGauge';
import { mockAudit } from '@/data/mockAuditData';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const Index = () => {
  const [url, setUrl] = useState('');
  const [trialEmail, setTrialEmail] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showTrialForm, setShowTrialForm] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const handleAudit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (user) {
      // Authenticated user: go directly
      setIsAnalyzing(true);
      setTimeout(() => navigate('/audit/demo'), 1500);
      return;
    }

    // Not authenticated: show trial email form
    setShowTrialForm(true);
  };

  const handleTrialSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trialEmail) return;

    // Check if email already used a trial
    const { data: existing } = await supabase
      .from('trial_usage')
      .select('id')
      .eq('email', trialEmail)
      .maybeSingle();

    if (existing) {
      toast({
        title: 'Essai déjà utilisé',
        description: 'Cet email a déjà bénéficié d\'un essai gratuit. Veuillez vous connecter pour continuer.',
        variant: 'destructive',
      });
      return;
    }

    // Record trial usage
    await supabase.from('trial_usage').insert({ email: trialEmail });

    setIsAnalyzing(true);
    setTimeout(() => navigate('/audit/demo'), 1500);
  };

  const handleDemoAudit = () => {
    if (user) {
      navigate('/audit/demo');
      return;
    }
    setShowTrialForm(true);
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-border/50 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <Zap className="w-4 h-4 text-primary" />
            </div>
            <span className="text-lg font-bold gradient-text">AuditPro</span>
          </div>
          <div className="flex items-center gap-3">
            {user ? (
              <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>Dashboard</Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={() => navigate('/auth')}>Connexion</Button>
                <Button size="sm" onClick={() => navigate('/auth')}>Commencer</Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16">
        <div className="max-w-3xl mx-auto text-center fade-in">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-medium mb-6">
            <Shield className="w-3.5 h-3.5" />
            Audit digital automatisé
          </div>

          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight mb-4">
            Analysez n'importe quel
            <br />
            <span className="gradient-text">site web en profondeur</span>
          </h1>

          <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-10">
            Rapports d'audit de niveau cabinet de conseil. SEO, performance, accessibilité, RGPD, UX — tout est couvert.
          </p>

          {!showTrialForm ? (
            <form onSubmit={handleAudit} className="flex items-center gap-2 max-w-lg mx-auto mb-6">
              <div className="relative flex-1">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="url"
                  placeholder="https://www.exemple.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="pl-10 h-12 bg-secondary border-border/50 text-foreground placeholder:text-muted-foreground"
                />
              </div>
              <Button type="submit" size="lg" className="h-12 px-6 glow-pulse" disabled={isAnalyzing}>
                {isAnalyzing ? (
                  <span className="flex items-center gap-2">
                    <Search className="w-4 h-4 animate-spin" />
                    Analyse…
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    Auditer <ArrowRight className="w-4 h-4" />
                  </span>
                )}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleTrialSubmit} className="max-w-md mx-auto mb-6 space-y-3">
              <p className="text-sm text-muted-foreground">Entrez votre email pour un essai gratuit (1 audit offert)</p>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="email"
                    placeholder="votre@email.com"
                    value={trialEmail}
                    onChange={e => setTrialEmail(e.target.value)}
                    className="pl-10 h-12 bg-secondary border-border/50"
                    required
                  />
                </div>
                <Button type="submit" size="lg" className="h-12 px-6" disabled={isAnalyzing}>
                  {isAnalyzing ? 'Analyse…' : 'Lancer'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Déjà utilisé ? <button type="button" onClick={() => navigate('/auth')} className="text-primary hover:underline">Connectez-vous</button>
              </p>
            </form>
          )}

          {!showTrialForm && (
            <button onClick={handleDemoAudit} className="text-sm text-muted-foreground hover:text-primary transition-colors underline underline-offset-4">
              Voir la démo : audit de bnda-mali.com
            </button>
          )}
        </div>

        {/* Recent audit card */}
        <div className="max-w-4xl w-full mx-auto mt-16 fade-in" style={{ animationDelay: '0.2s' }}>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Dernier audit</h2>
          <button onClick={handleDemoAudit} className="w-full glass-card-hover p-6 text-left">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                <ScoreGauge score={mockAudit.globalScore} size={80} strokeWidth={6} />
                <div>
                  <h3 className="text-lg font-semibold">{mockAudit.siteName}</h3>
                  <p className="text-sm text-muted-foreground">{mockAudit.url}</p>
                  <p className="text-xs text-muted-foreground mt-1">{mockAudit.date}</p>
                </div>
              </div>
              <div className="hidden md:flex items-center gap-4">
                {mockAudit.axes.slice(0, 4).map(ax => (
                  <div key={ax.id} className="text-center">
                    <AxisIcon id={ax.id} className="w-5 h-5 text-muted-foreground" />
                    <p className="font-mono text-sm font-bold mt-1">{ax.score}</p>
                  </div>
                ))}
              </div>
              <ArrowRight className="w-5 h-5 text-muted-foreground" />
            </div>
          </button>
        </div>

        {/* Features */}
        <div className="max-w-4xl w-full mx-auto mt-16 grid grid-cols-1 md:grid-cols-3 gap-4 fade-in" style={{ animationDelay: '0.4s' }}>
          {[
            { icon: BarChart3, title: '8 axes d\'analyse', desc: 'SEO, perf, UX, RGPD, contenu, accessibilité, éco-index, fonctionnel' },
            { icon: Shield, title: 'Scoring intelligent', desc: 'Notes par axe avec priorisation des recommandations' },
            { icon: Zap, title: 'Rapport PDF pro', desc: 'Export de qualité cabinet de conseil' },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="glass-card p-5">
              <Icon className="w-8 h-8 text-primary mb-3" />
              <h3 className="font-semibold mb-1">{title}</h3>
              <p className="text-sm text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
};

export default Index;
