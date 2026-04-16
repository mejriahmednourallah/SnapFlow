import { useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ApprovalViewProps {
  onApprove: (note?: string) => Promise<void>;
  onReject: (note: string) => Promise<void>;
  isLoading: boolean;
}

export function ApprovalView({ onApprove, onReject, isLoading }: ApprovalViewProps) {
  const [note, setNote] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

  return (
    <section className="border-b border-amber-300 bg-amber-50/70 px-6 py-4">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-amber-900">Révision opérateur requise</p>
          <p className="text-xs text-amber-700">Validez le workflow ou rejetez-le avec un commentaire.</p>
        </div>

        {!showRejectInput ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-red-300 text-red-700"
              onClick={() => setShowRejectInput(true)}
            >
              <XCircle className="h-4 w-4 mr-1" /> Rejeter
            </Button>
            <Button size="sm" onClick={() => void onApprove(note)} disabled={isLoading}>
              <CheckCircle2 className="h-4 w-4 mr-1" /> Approuver
            </Button>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Raison du rejet"
              className="sm:w-72"
            />
            <Button
              size="sm"
              variant="destructive"
              onClick={() => void onReject(note)}
              disabled={!note.trim() || isLoading}
            >
              Confirmer le rejet
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowRejectInput(false);
                setNote('');
              }}
            >
              Annuler
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
