import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');
const readSource = (relativePath: string) => readFileSync(resolve(root, relativePath), 'utf8');
const readSupabase = (relativePath: string) => readFileSync(resolve(root, '../supabase', relativePath), 'utf8');

describe('tickets 1-4 clients and project grouping', () => {
  const migration = readSupabase('migrations/20260627091000_clients_project_grouping.sql');
  const consolidationMigration = readSupabase('migrations/20260628030000_consolidate_generated_clients.sql');
  const adminProjects = readSource('pages/AdminProjects.tsx');
  const adminClients = readSource('pages/AdminClients.tsx');
  const overview = readSource('pages/Overview.tsx');
  const projectShell = readSource('pages/project/ProjectShell.tsx');
  const projectFiche = readSource('pages/project/ProjectFiche.tsx');
  const fetchRedmine = readSupabase('functions/fetch-redmine/index.ts');
  const seedUsers = readSupabase('functions/seed-users/index.ts');

  it('adds clients as unique business entities and requires projects to belong to one client', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.clients');
    expect(migration).toContain('name TEXT NOT NULL UNIQUE');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS client_id UUID');
    expect(migration).toContain('ALTER COLUMN client_id SET NOT NULL');
    expect(migration).toContain('ON DELETE RESTRICT');
    expect(migration).toContain('public.has_role(auth.uid(), \'admin\')');
    expect(migration).toContain('project_assignments');
    expect(consolidationMigration).toContain("VALUES ('A classer')");
    expect(consolidationMigration).toContain('WHERE c.name = p.site_name');
  });

  it('wires Super Admin client management and project regrouping in frontend surfaces', () => {
    expect(adminClients).toContain("from('clients')");
    expect(adminClients).toContain('placeholder="Rechercher un client..."');
    expect(adminClients).toContain('Fiche client');
    expect(adminClients).toContain('handleAttachProject');
    expect(adminClients).toContain('handleDetachProject');
    expect(adminClients).toContain("HOLDING_CLIENT_NAME = 'A classer'");
    expect(adminClients).toContain('charge_de_projet');
    expect(adminProjects).toContain("from('clients')");
    expect(adminProjects).not.toContain('handleChangeProjectClient');
    expect(adminProjects).not.toContain('client_id: newClientId');
    expect(adminProjects).toContain("HOLDING_CLIENT_NAME = 'A classer'");
    expect(adminProjects).toContain('client_id: clientId');
    expect(overview).toContain("from('clients')");
    expect(overview).toContain('clientCount');
  });

  it('shows client context on project details and keeps function project creation compatible with client_id', () => {
    expect(projectShell).toContain("from('clients')");
    expect(projectShell).toContain("client?.name === 'A classer' ? null");
    expect(projectShell).toContain('client_name');
    expect(projectFiche).toContain('Client');
    expect(projectFiche).toContain('{project.client_name &&');
    expect(projectFiche).toContain('project.client_name');
    expect(fetchRedmine).toContain('ensureClientForProject');
    expect(fetchRedmine).toContain('client_id: clientId');
    expect(seedUsers).toContain("from('clients')");
    expect(seedUsers).toContain('client_id: client!.id');
  });
});
