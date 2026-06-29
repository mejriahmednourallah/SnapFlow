import { useState } from 'react';
import { Bot, PlayCircle, Plus, Sparkles, Workflow } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { CreateWorkflowModal } from '@/components/form-tester/CreateWorkflowModal';

interface WorkflowTemplate {
  id: string;
  titre: string;
  description: string;
  frequence: string;
  statut: 'Brouillon' | 'Bientôt disponible';
}

const templates: WorkflowTemplate[] = [
  {
    id: 'audit-hebdomadaire',
    titre: 'Audit hebdomadaire automatisé',
    description: "Déclencher un audit complet chaque semaine et envoyer un résumé à l'équipe.",
    frequence: 'Chaque lundi à 08:00',
    statut: 'Bientôt disponible',
  },
  {
    id: 'alerte-kpi',
    titre: 'Alerte KPI critique',
    description: 'Notifier instantanément les responsables quand un KPI passe sous le seuil défini.',
    frequence: 'En temps réel',
    statut: 'Brouillon',
  },
  {
    id: 'suivi-actions',
    titre: 'Suivi des actions correctives',
    description: "Relancer automatiquement les propriétaires d'actions non clôturées après 7 jours.",
    frequence: 'Tous les jours à 09:00',
    statut: 'Bientôt disponible',
  },
];

const WorkflowsPage = () => {
  const navigate = useNavigate();
  const [createModalOpen, setCreateModalOpen] = useState(false);

  return (
    <div className="space-y-6 fade-in">
      <div className="flex items-center gap-3">
        <Workflow className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Flux de travail</h1>
          <p className="text-sm text-muted-foreground">Construisez vos automatisations pour les audits et les rapports</p>
        </div>
      </div>

      <div className="glass-card p-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Assistant IA + Flux de travail</p>
          <h2 className="text-lg font-semibold mt-1">Orchestrez vos actions en quelques clics</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
            Les workflows enchaînent des contrôles, validations et notifications internes sans canal mail pour cette phase.
          </p>
        </div>
        <Button onClick={() => navigate('/app/assistant')} className="w-full sm:w-auto">
          <Bot className="w-4 h-4 mr-2" /> Ouvrir Assistant IA
        </Button>
      </div>

      <div className="glass-card p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold">Module Form Tester</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Créez des workflows de test de formulaires, soumettez-les pour validation et suivez les exécutions.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-2">
          <Button onClick={() => setCreateModalOpen(true)} className="w-full sm:w-auto">
            <Plus className="w-4 h-4 mr-2" /> Nouveau workflow
          </Button>
          <Button onClick={() => navigate('/app/workflows/form-tester')} variant="outline" className="w-full sm:w-auto">
            Ouvrir Form Tester
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
        {[
          ['Auto-détecter', 'Static HTML, rendu JS et confirmation Chromium récupèrent les champs réels.'],
          ['Valider', 'Captcha, login, paiement, upload ou booking passent en revue avant exécution.'],
          ['Exécuter', 'Les preuves finales viennent de Chromium: trace, URL finale, réseau et capture.'],
          ['Notifier', 'Les alertes restent dans SnapFlow avec files de validation et résultats récents.'],
        ].map(([title, text]) => (
          <div key={title} className="rounded-lg border border-border bg-background/70 p-4">
            <p className="text-sm font-semibold">{title}</p>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{text}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {templates.map((workflowItem) => (
          <article key={workflowItem.id} className="glass-card-hover p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center">
                <PlayCircle className="w-5 h-5 text-primary" />
              </div>
              <span className="text-[11px] rounded-full px-2 py-1 bg-secondary text-muted-foreground">
                {workflowItem.statut}
              </span>
            </div>

            <h3 className="text-base font-semibold mt-4">{workflowItem.titre}</h3>
            <p className="text-sm text-muted-foreground mt-2">{workflowItem.description}</p>

            <div className="mt-4 pt-4 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
              <span>Fréquence</span>
              <span className="font-medium text-foreground">{workflowItem.frequence}</span>
            </div>
          </article>
        ))}
      </div>

      <div className="glass-card p-4 flex items-start gap-3">
        <Sparkles className="w-5 h-5 text-primary mt-0.5" />
        <p className="text-sm text-muted-foreground">
          Utilisez le Form Tester pour créer des workflows de test de formulaires automatisés.
        </p>
      </div>

      <CreateWorkflowModal open={createModalOpen} onOpenChange={setCreateModalOpen} />
    </div>
  );
};

export default WorkflowsPage;
