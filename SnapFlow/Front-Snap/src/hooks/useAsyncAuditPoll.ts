import { useState, useEffect, useRef, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { pollAuditJob, completeAuditRow, failAuditRow, type PendingJob, type ProjectRef } from '@/services/auditService';

interface UseAsyncAuditPollOptions {
  onComplete: () => Promise<void>;
}

interface UseAsyncAuditPollReturn {
  pendingJob: PendingJob | null;
  generating: boolean;
  setPendingJob: (job: PendingJob | null) => void;
  setGenerating: (v: boolean) => void;
}

/**
 * Manages the async audit polling mechanism.
 * Fires a setInterval every 5s whenever `pendingJob` is set.
 * On completion or error, it cleans up and calls `onComplete`.
 *
 * Usage:
 *   const { pendingJob, generating, setPendingJob, setGenerating } = useAsyncAuditPoll({ onComplete: fetchData });
 */
export function useAsyncAuditPoll(
  project: ProjectRef | null,
  userId: string | undefined,
  options: UseAsyncAuditPollOptions,
): UseAsyncAuditPollReturn {
  const { toast } = useToast();
  const [pendingJob, setPendingJob] = useState<PendingJob | null>(null);
  const [generating, setGenerating] = useState(false);

  // Stable refs to avoid stale closures inside the interval
  const projectRef = useRef<ProjectRef | null>(project);
  const userIdRef = useRef<string | undefined>(userId);
  const onCompleteRef = useRef(options.onComplete);

  useEffect(() => { projectRef.current = project; }, [project]);
  useEffect(() => { userIdRef.current = userId; }, [userId]);
  useEffect(() => { onCompleteRef.current = options.onComplete; }, [options.onComplete]);

  useEffect(() => {
    if (!pendingJob) return;

    const interval = setInterval(async () => {
      const { status, result, error: jobError } = await pollAuditJob(pendingJob.jobId);

      if (status === 'error' || jobError) {
        clearInterval(interval);
        const msg = jobError ?? 'Le job a échoué côté backend';
        await failAuditRow(pendingJob.auditId, msg);
        toast({ title: 'Erreur lors de la génération', description: msg, variant: 'destructive' });
        setPendingJob(null);
        setGenerating(false);
        await onCompleteRef.current();
        return;
      }

      if (status === 'done' && result) {
        clearInterval(interval);
        const proj = projectRef.current;
        const uid = userIdRef.current;
        if (!proj || !uid) {
          await failAuditRow(pendingJob.auditId, 'Contexte projet manquant');
          setPendingJob(null);
          setGenerating(false);
          return;
        }
        try {
          const score = await completeAuditRow(pendingJob.auditId, result, proj, uid);
          toast({ title: 'Rapport généré avec succès', description: `Score global : ${score}/100` });
        } catch (mapErr: any) {
          await failAuditRow(pendingJob.auditId, mapErr.message);
          toast({ title: 'Erreur de traitement', description: mapErr.message, variant: 'destructive' });
        } finally {
          setPendingJob(null);
          setGenerating(false);
          await onCompleteRef.current();
        }
      }
      // status 'pending' | 'running' → keep polling
    }, 15_000);

    return () => clearInterval(interval);
  }, [pendingJob, toast]);

  return { pendingJob, generating, setPendingJob, setGenerating };
}
