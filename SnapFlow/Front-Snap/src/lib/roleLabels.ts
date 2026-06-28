import type { UserRole } from '@/services/authService';

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Super Admin',
  charge_de_projet: 'Charge de projet',
  testeur: 'Testeur',
  rapporteur: 'Rapporteur',
};

export const ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = [
  { value: 'charge_de_projet', label: ROLE_LABELS.charge_de_projet },
  { value: 'testeur', label: ROLE_LABELS.testeur },
  { value: 'rapporteur', label: ROLE_LABELS.rapporteur },
  { value: 'admin', label: ROLE_LABELS.admin },
];

export function roleLabel(role: string | null | undefined): string {
  if (!role) return 'Aucun role';
  return ROLE_LABELS[role as UserRole] ?? role;
}
