import { useEffect, useMemo, useState } from 'react';
import { TicketPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useRedmineIdentifier } from '@/hooks/useRedmineIdentifier';
import { useToast } from '@/hooks/use-toast';
import { createRedmineIssue } from '@/services/redmineService';
import type { WorkflowWithDetails } from '@/lib/form-tester/types';

interface WorkflowRedmineDraftDialogProps {
  workflow: WorkflowWithDetails;
}

interface ProjectDraftInfo {
  id: string;
  site_name: string;
  url: string;
  redmine_url?: string | null;
  redmine_identifier?: string | null;
}

export function WorkflowRedmineDraftDialog({ workflow }: WorkflowRedmineDraftDialogProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [project, setProject] = useState<ProjectDraftInfo | null>(null);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const redmineIdentifier = useRedmineIdentifier(project?.redmine_identifier || project?.redmine_url || project?.url);

  const draft = useMemo(() => {
    const latest = workflow.latest_result;
    const latestStatus = latest ? latest.status : 'aucune execution';
    const failure = latest?.failure_reason || latest?.error_message || '';
    return {
      subject: `[Workflow] ${workflow.name}`,
      description: [
        `Projet: ${project?.site_name ?? workflow.project_name ?? workflow.project_id}`,
        `Workflow: ${workflow.name}`,
        `Scenario: ${workflow.active_scenario?.name ?? 'Scenario actif'}`,
        `URL cible: ${workflow.target_url}`,
        `Dernier resultat: ${latestStatus}`,
        failure ? `Resume echec: ${failure}` : null,
      ].filter(Boolean).join('\n'),
    };
  }, [project?.site_name, workflow]);

  useEffect(() => {
    if (!workflow.project_id) return;
    supabase
      .from('projects')
      .select('id, site_name, url, redmine_url, redmine_identifier')
      .eq('id', workflow.project_id)
      .maybeSingle()
      .then(({ data }) => setProject((data as ProjectDraftInfo | null) ?? null));
  }, [workflow.project_id]);

  useEffect(() => {
    if (!open) return;
    setSubject(draft.subject);
    setDescription(draft.description);
  }, [draft.description, draft.subject, open]);

  if (!workflow.project_id) return null;

  const submit = async () => {
    if (!redmineIdentifier || !subject.trim() || !description.trim()) {
      toast({ title: 'Ticket incomplet', description: 'Projet Redmine, sujet et description sont requis.', variant: 'destructive' });
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await createRedmineIssue({
        projectIdentifier: redmineIdentifier,
        subject: subject.trim(),
        description: description.trim(),
      });
      toast({ title: 'Ticket cree', description: response.issue?.id ? `Ticket #${response.issue.id}` : 'Le ticket Redmine a ete cree.' });
      setOpen(false);
    } catch (err) {
      toast({
        title: 'Erreur Redmine',
        description: err instanceof Error ? err.message : 'Impossible de creer le ticket.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <TicketPlus className="mr-1 h-4 w-4" />
        Creer ticket Redmine
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Brouillon ticket Redmine</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Sujet du ticket" />
            <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={9} />
            <p className="text-xs text-muted-foreground">
              Aucun ticket n'est cree avant validation explicite.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isSubmitting}>Annuler</Button>
            <Button onClick={() => void submit()} disabled={isSubmitting}>
              {isSubmitting ? 'Creation...' : 'Creer le ticket'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
