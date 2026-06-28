import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardCheck, FolderKanban, Plus, SquareArrowOutUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFormTester } from '@/hooks/useFormTester';
import type { WorkflowListView, WorkflowStatus } from '@/lib/form-tester/types';
import { formatDate } from '@/lib/dateFormat';
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
  const [listView, setListView] = useState<WorkflowListView>('mine');

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
    await reload(statusFilter === 'all' ? undefined : statusFilter, listView);
  };

  const changeView = async (view: WorkflowListView): Promise<void> => {
    setListView(view);
    setStatusFilter('all');
    await reload(undefined, view);
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

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border bg-muted/30 p-1">
            <button
              type="button"
              onClick={() => void changeView('mine')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                listView === 'mine' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
              }`}
            >
              <FolderKanban className="h-3.5 w-3.5" />
              Mes workflows
            </button>
            {isOperator ? (
              <button
                type="button"
                onClick={() => void changeView('review_queue')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  listView === 'review_queue' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
                }`}
              >
                <ClipboardCheck className="h-3.5 w-3.5" />
                File de validation
              </button>
            ) : null}
          </div>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as WorkflowStatus | 'all')}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">Tous les statuts</option>
            {listView !== 'review_queue' ? <option value="draft">Brouillon</option> : null}
            <option value="needs_review">A valider</option>
            <option value="pending">En attente</option>
            <option value="approved">Accepté</option>
            <option value="executed">Exécuté</option>
            <option value="blocked">Bloque</option>
          </select>
          <Button variant="outline" onClick={() => void handleRefresh()} size="sm">
            Actualiser
          </Button>
        </div>
      </header>

      {listView === 'mine' ? (
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
                  {workflow.confidence ? (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      {workflow.confidence}
                    </span>
                  ) : null}
                  {Array.isArray(workflow.risk_flags) && workflow.risk_flags.length > 0 ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                      {workflow.risk_flags.length} risque{workflow.risk_flags.length > 1 ? 's' : ''}
                    </span>
                  ) : null}
                  <span className="text-xs text-muted-foreground">
                    Modifié le {formatDate(workflow.updated_at)}
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
