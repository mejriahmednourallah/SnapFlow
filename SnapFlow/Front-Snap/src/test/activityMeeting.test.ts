/**
 * Tests for activity meeting/treatment classification (Ticket 12).
 *
 * Contract:
 * - isMeeting identifies tracker names containing "réunion", "reunion",
 *   "point d'échange", "point d echange" (accent-insensitive).
 * - Meeting issues do not inflate treatment ticket counts.
 * - Meeting KPIs and treatment KPIs are correctly separated.
 */
import { describe, it, expect } from 'vitest';
import { isMeeting } from '@/components/activity/ActivityDashboard';

describe('isMeeting classification', () => {
  it('detects "Réunion" (French, accented)', () => {
    expect(isMeeting('Réunion')).toBe(true);
  });

  it('detects "reunion" (lowercase, no accent)', () => {
    expect(isMeeting('reunion')).toBe(true);
  });

  it('detects "REUNION" (uppercase)', () => {
    expect(isMeeting('REUNION')).toBe(true);
  });

  it('detects "Point d\'échange" (accented)', () => {
    expect(isMeeting("Point d'échange")).toBe(true);
  });

  it('detects "point d echange" (no apostrophe, no accent)', () => {
    expect(isMeeting('point d echange')).toBe(true);
  });

  it('detects "POINT D ECHANGE" (uppercase, no accent)', () => {
    expect(isMeeting('POINT D ECHANGE')).toBe(true);
  });

  it('does NOT detect "Bug" as meeting', () => {
    expect(isMeeting('Bug')).toBe(false);
  });

  it('does NOT detect "Anomalie" as meeting', () => {
    expect(isMeeting('Anomalie')).toBe(false);
  });

  it('does NOT detect "Evolution" as meeting', () => {
    expect(isMeeting('Evolution')).toBe(false);
  });

  it('does NOT detect "Support" as meeting', () => {
    expect(isMeeting('Support')).toBe(false);
  });

  it('does NOT detect empty string as meeting', () => {
    expect(isMeeting('')).toBe(false);
  });
});

describe('meeting/treatment separation invariants', () => {
  // Local deAccent for testing invariants (the real isMeeting is imported above)
  const deAccentLocal = (s: string): string =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  // Simulated RedmineIssue subset
  const makeIssue = (id: number, tracker: string, status: string, priority: string) => ({
    id,
    subject: `Issue ${id}`,
    tracker: { id: 1, name: tracker },
    status: { id: 1, name: status },
    priority: { id: 1, name: priority },
    assigned_to: null,
    author: { id: 1, name: 'Author' },
    created_on: '2026-06-01T10:00:00Z',
    updated_on: '2026-06-10T10:00:00Z',
    done_ratio: 0,
  });

  it('meetings do not inflate treatment ticket count', () => {
    const all = [
      makeIssue(1, 'Bug', 'Nouveau', 'Normal'),
      makeIssue(2, 'Réunion', 'Nouveau', 'Normal'),
      makeIssue(3, 'Anomalie', 'Fermé', 'Haute'),
      makeIssue(4, "Point d'échange", 'Nouveau', 'Normal'),
      makeIssue(5, 'Evolution', 'En cours', 'Normale'),
    ];

    const meetings = all.filter(i => isMeeting(i.tracker.name));
    const treatments = all.filter(i => !isMeeting(i.tracker.name));

    // Meetings: 2 (Réunion, Point d'échange)
    expect(meetings).toHaveLength(2);
    // Treatments: 3 (Bug, Anomalie, Evolution)
    expect(treatments).toHaveLength(3);
    // Total
    expect(all.length).toBe(5);
    // Treatment + meeting = total
    expect(treatments.length + meetings.length).toBe(all.length);
  });

  it('meetings excluded from open treatment count', () => {
    const all = [
      makeIssue(1, 'Bug', 'Nouveau', 'Normal'),
      makeIssue(2, 'Réunion', 'Nouveau', 'Normal'),
      makeIssue(3, 'Anomalie', 'Fermé', 'Normal'),
    ];
    const treatments = all.filter(i => !isMeeting(i.tracker.name));
    // Open treatments: Bug only (Anomalie is Fermé)
    const isClosedStatus = (s: string) => /ferm|clotur|clos|reject|valid/.test(deAccentLocal(s));
    const openTreatments = treatments.filter(i => !isClosedStatus(i.status.name));
    expect(openTreatments).toHaveLength(1); // Only Bug
  });

  it('meetings excluded from critical count', () => {
    const isCriticalPriority = (p: string) => /critique|critical|urgent|immediat|immediate/.test(deAccentLocal(p));
    const all = [
      makeIssue(1, 'Bug', 'Nouveau', 'Critique'),
      makeIssue(2, 'Réunion', 'Nouveau', 'Critique'),
      makeIssue(3, 'Evolution', 'Nouveau', 'Normale'),
    ];
    const treatments = all.filter(i => !isMeeting(i.tracker.name));
    const criticalTreatments = treatments.filter(i => isCriticalPriority(i.priority.name));
    expect(criticalTreatments).toHaveLength(1); // Bug (Critique), not Réunion
  });

  it('venue type (Lieu) is NOT a meeting', () => {
    // "Lieu" should not match "reunion" of "point d echange"
    expect(isMeeting('Lieu')).toBe(false);
    expect(isMeeting('Support')).toBe(false);
    expect(isMeeting('Suivi')).toBe(false);
  });
});
