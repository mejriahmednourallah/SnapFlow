import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, SquareArrowOutUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFormTester } from '@/hooks/useFormTester';
import type { WorkflowStatus } from '@/lib/form-tester/types';
import { StatusBadge } from './StatusBadge';

interface WorkflowListProps {
  isOperator: boolean;
}

export function WorkflowList({ isOperator }: WorkflowListProps) {
  const navigate = useNavigate();
  const { workflows, isLoading, isCreating, error, createWorkflow, reload } = useFormTester(isOperator);

  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [statusFilter, setStatusFilter] = useState<WorkflowStatus | 'all'>('all');

  const filteredWorkflows = useMemo(
    () => (statusFilter === 'all' ? workflows : workflows.filter((item) => item.status === statusFilter)),
    [statusFilter, workflows],
  );

  const handleCreate = async (): Promise<void> => {
    if (!newName.trim() || !newUrl.trim()) return;
    const workflow = await createWorkflow(newName, newUrl);
    setNewName('');
    setNewUrl('');
    navigate(`/app/workflows/form-tester/${workflow.id}`);
  };

  const handleRefresh = async (): Promise<void> => {
    await reload(statusFilter === 'all' ? undefined : statusFilter);
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Form Tester</h1>
          <p className="text-sm text-muted-foreground">
            Concevez des workflows de test de formulaires avec détection et suggestions IA.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as WorkflowStatus | 'all')}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">Tous les statuts</option>
            <option value="draft">Brouillon</option>
            <option value="pending">En attente</option>
            <option value="approved">Approuvé</option>
            <option value="executed">Exécuté</option>
          </select>
          <Button variant="outline" onClick={() => void handleRefresh()} size="sm">
            Actualiser
          </Button>
        </div>
      </header>

      {!isOperator ? (
        <section className="glass-card p-4 space-y-3">
          <p className="text-sm font-medium">Nouveau workflow</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <Input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Nom du workflow" />
            <Input
              value={newUrl}
              onChange={(event) => setNewUrl(event.target.value)}
              placeholder="https://votresite.com/contact"
            />
            <Button onClick={() => void handleCreate()} disabled={isCreating || !newName.trim() || !newUrl.trim()}>
              <Plus className="h-4 w-4 mr-1" />
              {isCreating ? 'Création...' : 'Créer'}
            </Button>
          </div>
        </section>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {isLoading ? (
        <div className="glass-card p-6 text-sm text-muted-foreground">Chargement des workflows...</div>
      ) : filteredWorkflows.length === 0 ? (
        <div className="glass-card p-6 text-sm text-muted-foreground">Aucun workflow trouvé pour ce filtre.</div>
      ) : (
        <div className="space-y-2">
          {filteredWorkflows.map((workflow) => (
            <article key={workflow.id} className="glass-card p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{workflow.name}</p>
                <p className="text-xs text-muted-foreground truncate mt-1">{workflow.target_url}</p>
                <div className="mt-2 flex items-center gap-2">
                  <StatusBadge status={workflow.status} size="sm" />
                  <span className="text-xs text-muted-foreground">
                    Modifié le {new Date(workflow.updated_at).toLocaleDateString('fr-FR')}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/app/workflows/form-tester/${workflow.id}`)}
                >
                  Ouvrir
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate(`/app/workflows/form-tester/${workflow.id}/results`)}
                >
                  <SquareArrowOutUpRight className="h-4 w-4 mr-1" />
                  Résultats
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
