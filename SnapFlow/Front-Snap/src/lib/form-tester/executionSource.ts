import type { ExecutionSource } from './types';

export interface ExecutionSourceDisplay {
  label: string;
  description: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  isRealBrowser: boolean;
}

export function getExecutionSourceDisplay(source: ExecutionSource | string | null | undefined): ExecutionSourceDisplay {
  switch (source) {
    case 'pending_executor':
      return {
        label: 'En file d attente',
        description: 'Le scenario est versionne et attend sa prise en charge par le moteur navigateur.',
        tone: 'neutral',
        isRealBrowser: false,
      };
    case 'chromium':
      return {
        label: 'Test automatise',
        description: 'Le parcours a ete execute dans un navigateur securise.',
        tone: 'success',
        isRealBrowser: true,
      };
    case 'obscura':
      return {
        label: 'Test automatise',
        description: 'Le parcours a ete execute dans un navigateur securise.',
        tone: 'success',
        isRealBrowser: true,
      };
    case 'simulated_legacy':
      return {
        label: 'Simulation legacy',
        description: 'Ancien mode simule: utile pour historique, mais ce n est pas une execution navigateur reelle.',
        tone: 'warning',
        isRealBrowser: false,
      };
    case 'executor_unavailable':
      return {
        label: 'Executor indisponible',
        description: 'Le moteur reel n etait pas disponible pendant cette execution.',
        tone: 'danger',
        isRealBrowser: false,
      };
    case 'legacy_unknown':
      return {
        label: 'Resultat historique incomplet',
        description: 'Cette ancienne execution ne contient pas assez de preuves pour identifier le moteur ou confirmer un test reel.',
        tone: 'warning',
        isRealBrowser: false,
      };
    default:
      return {
        label: 'Provenance non normalisee',
        description: 'Les metadonnees de cette execution doivent etre migrees avant interpretation.',
        tone: 'danger',
        isRealBrowser: false,
      };
  }
}
