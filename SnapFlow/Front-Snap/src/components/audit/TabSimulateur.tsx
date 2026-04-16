import { useState } from 'react';
import { Sparkles, Loader2, TrendingUp, Zap, Target, Clock, Archive, CheckCircle, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { type AuditReport } from '@/data/mockAuditData';

interface SimulationData {
  simulatedScore: number;
  scoreImprovement: number;
  originalScore: number;
  siteName: string;
  generatedAt: string;
  summary: string;
  uxRecommendations: { title: string; description: string; impact: string; category: string }[];
  seoImprovements: { title: string; before: string; after: string; impact: string }[];
  performanceGains: {
    currentLoadTime: string;
    estimatedLoadTime: string;
    currentPageWeight: string;
    estimatedPageWeight: string;
    currentRequests: number;
    estimatedRequests: number;
  };
  roiEstimation: {
    trafficIncrease: string;
    bounceRateReduction: string;
    conversionImprovement: string;
    estimatedTimeline: string;
  };
  priorityActions: { action: string; effort: string; impact: string; timeline: string }[];
}

interface TabSimulateurProps {
  audit: AuditReport;
}

const impactColor = (impact: string) => {
  switch (impact) {
    case 'high': return 'text-red-500 bg-red-500/10';
    case 'medium': return 'text-yellow-500 bg-yellow-500/10';
    case 'low': return 'text-emerald-500 bg-emerald-500/10';
    default: return 'text-muted-foreground bg-muted';
  }
};

const effortLabel = (effort: string) => {
  switch (effort) {
    case 'faible': return { text: 'Faible', color: 'text-emerald-500' };
    case 'moyen': return { text: 'Moyen', color: 'text-yellow-500' };
    case 'élevé': return { text: 'Élevé', color: 'text-red-500' };
    default: return { text: effort, color: 'text-muted-foreground' };
  }
};

export function TabSimulateur({ audit }: TabSimulateurProps) {
  const [simulation, setSimulation] = useState<SimulationData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isArchived, setIsArchived] = useState(false);
  const { toast } = useToast();

  const handleLaunchSimulation = async () => {
    setIsLoading(true);
    setSimulation(null);

    try {
      const { data, error } = await supabase.functions.invoke('simulate-audit', {
        body: { audit },
      });

      if (error) throw new Error(error.message);

      if (data?.success && data?.simulation) {
        setSimulation(data.simulation);
        setIsArchived(false);
        toast({ title: 'Simulation terminée', description: 'Les recommandations ont été générées avec succès.' });
      } else {
        throw new Error(data?.error || 'Erreur inconnue');
      }
    } catch (err: any) {
      console.error('Simulation error:', err);
      toast({ title: 'Erreur', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleArchive = () => {
    setIsArchived(true);
    toast({ title: 'Simulation archivée', description: 'La simulation a été sauvegardée.' });
  };

  if (isLoading) {
    return (
      <div className="space-y-6 fade-in">
        <div className="glass-card p-12 text-center">
          <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
          <h3 className="text-xl font-bold mb-2">Simulation en cours…</h3>
          <p className="text-muted-foreground max-w-md mx-auto">
            L'IA analyse les recommandations de l'audit et simule l'impact des améliorations pour <strong>{audit.siteName}</strong>. Cela peut prendre 15 à 30 secondes.
          </p>
        </div>
      </div>
    );
  }

  if (!simulation) {
    return (
      <div className="space-y-6 fade-in">
        <div className="glass-card p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Sparkles className="w-8 h-8 text-primary" />
          </div>
          <h3 className="text-xl font-bold mb-2">Simulateur IA</h3>
          <p className="text-muted-foreground max-w-md mx-auto mb-6">
            Ce module utilise l'IA pour proposer des refontes UX, optimiser le SEO et simuler l'impact des améliorations recommandées pour <strong>{audit.siteName}</strong>.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl mx-auto mb-8">
            {[
              { title: 'Refonte UX', desc: 'Proposition de nouvelle structure et navigation' },
              { title: 'Optimisation SEO', desc: 'Structure de contenu et mots-clés optimisés' },
              { title: 'Impact estimé', desc: 'Projection des gains en performance et trafic' },
            ].map(item => (
              <div key={item.title} className="p-4 rounded-lg bg-muted/30 border border-border/30">
                <p className="font-semibold text-sm mb-1">{item.title}</p>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>
          <Button size="lg" className="glow-pulse" onClick={handleLaunchSimulation}>
            <Sparkles className="w-4 h-4 mr-2" />
            Lancer la simulation IA
          </Button>
        </div>
      </div>
    );
  }

  // Simulation results
  return (
    <div className="space-y-6 fade-in">
      {/* Header with score comparison */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          Résultats de la simulation
        </h3>
        <div className="flex items-center gap-2">
          {isArchived ? (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> Archivée
            </span>
          ) : (
            <Button variant="outline" size="sm" onClick={handleArchive}>
              <Archive className="w-3.5 h-3.5 mr-1.5" /> Archiver
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleLaunchSimulation}>
            <Sparkles className="w-3.5 h-3.5 mr-1.5" /> Relancer
          </Button>
        </div>
      </div>

      {/* Score comparison cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass-card p-5 text-center">
          <div className="text-xs text-muted-foreground mb-1">Score actuel</div>
          <div className={`text-3xl font-bold ${simulation.originalScore >= 70 ? 'text-emerald-500' : simulation.originalScore >= 50 ? 'text-yellow-500' : 'text-red-500'}`}>
            {simulation.originalScore}/100
          </div>
        </div>
        <div className="glass-card p-5 text-center border-primary/30">
          <div className="text-xs text-muted-foreground mb-1">Score simulé</div>
          <div className={`text-3xl font-bold ${simulation.simulatedScore >= 70 ? 'text-emerald-500' : simulation.simulatedScore >= 50 ? 'text-yellow-500' : 'text-red-500'}`}>
            {simulation.simulatedScore}/100
          </div>
        </div>
        <div className="glass-card p-5 text-center">
          <div className="text-xs text-muted-foreground mb-1">Amélioration</div>
          <div className="text-3xl font-bold text-emerald-500 flex items-center justify-center gap-1">
            <TrendingUp className="w-6 h-6" />
            +{simulation.scoreImprovement}
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="glass-card p-5">
        <p className="text-sm leading-relaxed">{simulation.summary}</p>
      </div>

      {/* ROI Estimation */}
      <div className="glass-card p-5">
        <h4 className="font-semibold text-sm mb-4 flex items-center gap-2">
          <Target className="w-4 h-4 text-primary" /> Estimation ROI
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <div className="text-xl font-bold text-emerald-500">{simulation.roiEstimation.trafficIncrease}</div>
            <div className="text-xs text-muted-foreground">Trafic</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold text-emerald-500">{simulation.roiEstimation.bounceRateReduction}</div>
            <div className="text-xs text-muted-foreground">Taux de rebond</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold text-emerald-500">{simulation.roiEstimation.conversionImprovement}</div>
            <div className="text-xs text-muted-foreground">Conversion</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold text-primary">{simulation.roiEstimation.estimatedTimeline}</div>
            <div className="text-xs text-muted-foreground">Délai estimé</div>
          </div>
        </div>
      </div>

      {/* Performance Gains */}
      <div className="glass-card p-5">
        <h4 className="font-semibold text-sm mb-4 flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" /> Gains de performance
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <div className="text-xs text-muted-foreground mb-1">Temps de chargement</div>
            <div className="flex items-center justify-center gap-2">
              <span className="text-sm text-red-400 line-through">{simulation.performanceGains.currentLoadTime}</span>
              <span className="text-sm">→</span>
              <span className="text-sm font-bold text-emerald-500">{simulation.performanceGains.estimatedLoadTime}</span>
            </div>
          </div>
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <div className="text-xs text-muted-foreground mb-1">Poids des pages</div>
            <div className="flex items-center justify-center gap-2">
              <span className="text-sm text-red-400 line-through">{simulation.performanceGains.currentPageWeight}</span>
              <span className="text-sm">→</span>
              <span className="text-sm font-bold text-emerald-500">{simulation.performanceGains.estimatedPageWeight}</span>
            </div>
          </div>
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <div className="text-xs text-muted-foreground mb-1">Requêtes HTTP</div>
            <div className="flex items-center justify-center gap-2">
              <span className="text-sm text-red-400 line-through">{simulation.performanceGains.currentRequests}</span>
              <span className="text-sm">→</span>
              <span className="text-sm font-bold text-emerald-500">{simulation.performanceGains.estimatedRequests}</span>
            </div>
          </div>
        </div>
      </div>

      {/* UX Recommendations */}
      <div className="glass-card p-5">
        <h4 className="font-semibold text-sm mb-4">Recommandations UX/Design</h4>
        <div className="space-y-3">
          {simulation.uxRecommendations?.map((rec, i) => (
            <div key={i} className="flex items-start gap-3 p-3 bg-muted/20 rounded-lg">
              <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 mt-0.5 ${impactColor(rec.impact)}`}>
                {rec.impact}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{rec.title}</span>
                  <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">{rec.category}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{rec.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* SEO Improvements */}
      <div className="glass-card p-5">
        <h4 className="font-semibold text-sm mb-4">Améliorations SEO</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 text-muted-foreground">
                <th className="text-left p-2">Élément</th>
                <th className="text-left p-2">Avant</th>
                <th className="text-left p-2">Après</th>
                <th className="text-center p-2">Impact</th>
              </tr>
            </thead>
            <tbody>
              {simulation.seoImprovements?.map((seo, i) => (
                <tr key={i} className="border-b border-border/30">
                  <td className="p-2 font-medium">{seo.title}</td>
                  <td className="p-2 text-red-400 text-xs">{seo.before}</td>
                  <td className="p-2 text-emerald-400 text-xs">{seo.after}</td>
                  <td className="p-2 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${impactColor(seo.impact)}`}>{seo.impact}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Priority Actions */}
      <div className="glass-card p-5">
        <h4 className="font-semibold text-sm mb-4 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-primary" /> Plan d'action prioritaire
        </h4>
        <div className="space-y-2">
          {simulation.priorityActions?.map((action, i) => {
            const effort = effortLabel(action.effort);
            return (
              <div key={i} className="flex items-center gap-3 p-3 bg-muted/20 rounded-lg">
                <span className="text-xs font-mono text-muted-foreground w-6">{i + 1}.</span>
                <div className="flex-1 min-w-0">
                  <span className="text-sm">{action.action}</span>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className={`text-xs ${effort.color}`}>Effort: {effort.text}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${impactColor(action.impact)}`}>{action.impact}</span>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {action.timeline}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Simulation générée le {new Date(simulation.generatedAt).toLocaleString('fr-FR')}
      </p>
    </div>
  );
}
