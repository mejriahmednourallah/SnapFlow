import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UserPlus, Trash2, Download, ExternalLink, Search, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { createUser, updateRole, deleteUser, type UserRole } from '@/services/authService';
import { fetchRedmineUsers, importRedmineUser, syncRedmineHomepages, type RedmineUser } from '@/services/redmineService';
import { getProfileDisplayName, isSyntheticRedmineEmail } from '@/lib/userDisplay';
import { ROLE_OPTIONS, roleLabel } from '@/lib/roleLabels';

interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  created_at: string;
  redmine_login?: string | null;
  redmine_display_name?: string | null;
}

interface UserRoleRow {
  user_id: string;
  role: string;
}


const AdminUsers = () => {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [roles, setRoles] = useState<UserRoleRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // Redmine import
  const [showRedmineUsers, setShowRedmineUsers] = useState(false);
  const [redmineUsers, setRedmineUsers] = useState<RedmineUser[]>([]);
  const [loadingRedmine, setLoadingRedmine] = useState(false);
  const [selectedRedmineUser, setSelectedRedmineUser] = useState<RedmineUser | null>(null);
  const [redminePassword, setRedminePassword] = useState('');
  const [redmineRole, setRedmineRole] = useState<UserRole>('charge_de_projet');
  const [importingUser, setImportingUser] = useState(false);
  const [redmineEmail, setRedmineEmail] = useState('');

  // New user form
  const [redmineSearch, setRedmineSearch] = useState('');
  const [showNewUser, setShowNewUser] = useState(false);
  const [syncingUrls, setSyncingUrls] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('charge_de_projet');
  const [creating, setCreating] = useState(false);

  // View projects sync
  const [syncingProjectsUserId, setSyncingProjectsUserId] = useState<string | null>(null);

  const fetchData = async () => {
    const [profilesRes, rolesRes, redmineIdentitiesRes] = await Promise.all([
      supabase.from('profiles').select('*'),
      supabase.from('user_roles').select('*'),
      supabase.from('redmine_user_identities').select('user_id, redmine_login, redmine_display_name'),
    ]);
    const identitiesByUser = new Map((redmineIdentitiesRes.data || []).map((identity: any) => [identity.user_id, identity]));
    setProfiles((profilesRes.data || []).map((profile: any) => ({
      ...profile,
      redmine_login: identitiesByUser.get(profile.id)?.redmine_login ?? null,
      redmine_display_name: identitiesByUser.get(profile.id)?.redmine_display_name ?? null,
    })));
    setRoles(rolesRes.data || []);
    setLoadingData(false);
  };

  useEffect(() => {
    if (user && isAdmin) fetchData();
  }, [user, isAdmin]);

  const getUserRole = (userId: string) => roles.find(r => r.user_id === userId)?.role || 'aucun';
  const getProfileContact = (profile: Profile) =>
    isSyntheticRedmineEmail(profile.email) ? getProfileDisplayName(profile) : profile.email;

  const handleFetchRedmineUsers = async () => {
    setLoadingRedmine(true);
    try {
      const users = await fetchRedmineUsers();
      setRedmineUsers(users);
      setShowRedmineUsers(true);
    } catch (err: any) {
      console.error('Redmine fetch error:', err);
      toast({ title: 'Erreur Redmine', description: err.message || 'Erreur inconnue', variant: 'destructive' });
    } finally {
      setLoadingRedmine(false);
    }
  };

  const handleSyncUrls = async () => {
    setSyncingUrls(true);
    try {
      const result = await syncRedmineHomepages();
      toast({ title: 'Synchronisation terminée', description: `${result.updated} projet(s) mis à jour sur ${result.total}.` });
    } catch (err: any) {
      toast({ title: 'Erreur', description: err.message, variant: 'destructive' });
    } finally {
      setSyncingUrls(false);
    }
  };

  const handleImportRedmineUser = async () => {
    if (!selectedRedmineUser || !redminePassword || !redmineEmail) return;
    setImportingUser(true);
    try {
      const fullName = selectedRedmineUser.name;
      await importRedmineUser({ redmineUser: selectedRedmineUser, email: redmineEmail, password: redminePassword, role: redmineRole });
      toast({ title: 'Utilisateur importé', description: `${fullName} (${redmineEmail})` });
      setShowRedmineUsers(false);
      setSelectedRedmineUser(null);
      setRedminePassword('');
      setRedmineEmail('');
      await fetchData();
    } catch (err: any) {
      console.error('Import user error:', err);
      toast({ title: 'Erreur', description: err.message || 'Erreur inconnue', variant: 'destructive' });
    } finally {
      setImportingUser(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      await createUser({ email: newEmail, password: newPassword, full_name: newName, role: newRole });
      toast({ title: 'Utilisateur créé', description: `${newEmail} a été ajouté avec le rôle ${roleLabel(newRole)}.` });
      setShowNewUser(false);
      setNewEmail(''); setNewPassword(''); setNewName('');
      await fetchData();
    } catch (err: any) {
      toast({ title: 'Erreur', description: err.message, variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteUser = async (userId: string, email: string) => {
    if (!confirm(`Supprimer l'utilisateur ${email} ?`)) return;
    try {
      await deleteUser(userId);
      toast({ title: 'Utilisateur supprimé', description: `${email} a été supprimé.` });
      await fetchData();
    } catch (err: any) {
      toast({ title: 'Erreur', description: err.message, variant: 'destructive' });
    }
  };

  const handleChangeRole = async (userId: string, newRoleValue: string) => {
    try {
      await updateRole(userId, newRoleValue);
      toast({ title: 'Rôle mis à jour' });
      await fetchData();
    } catch (err: any) {
      toast({ title: 'Erreur', description: err.message, variant: 'destructive' });
    }
  };

  const handleViewProjects = async (userId: string) => {
    // Keep this action instant; heavy Redmine sync is handled explicitly elsewhere.
    setSyncingProjectsUserId(userId);
    setSyncingProjectsUserId(null);
    navigate(`/app/projects?user=${userId}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Utilisateurs ({profiles.length})</h2>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={handleFetchRedmineUsers} disabled={loadingRedmine}>
            <Download className="w-4 h-4 mr-1.5" /> <span className="hidden sm:inline">{loadingRedmine ? 'Chargement…' : 'Importer de Redmine'}</span><span className="sm:hidden">{loadingRedmine ? '…' : 'Redmine'}</span>
          </Button>
          <Button size="sm" variant="outline" onClick={handleSyncUrls} disabled={syncingUrls}>
            <RefreshCw className={`w-4 h-4 mr-1.5 ${syncingUrls ? 'animate-spin' : ''}`} /> <span className="hidden sm:inline">{syncingUrls ? 'Sync…' : 'Sync URLs Redmine'}</span><span className="sm:hidden">{syncingUrls ? '…' : 'Sync'}</span>
          </Button>
          <Button size="sm" onClick={() => setShowNewUser(!showNewUser)}>
            <UserPlus className="w-4 h-4 mr-1.5" /> <span className="hidden sm:inline">Créer un utilisateur</span><span className="sm:hidden">Créer</span>
          </Button>
        </div>
      </div>

      {showNewUser && (
        <form onSubmit={handleCreateUser} className="glass-card p-4 grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Nom</label>
            <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nom complet" required />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Email</label>
            <Input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="email@exemple.com" required />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Mot de passe</label>
            <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="••••••••" required minLength={6} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Rôle</label>
            <select value={newRole} onChange={e => setNewRole(e.target.value as any)} className="w-full h-10 text-sm bg-secondary border border-border rounded-md px-3 text-foreground">
              {ROLE_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={creating}>{creating ? 'Création…' : 'Créer'}</Button>
        </form>
      )}

      {/* Redmine user import */}
      {showRedmineUsers && (
        <div className="glass-card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">Utilisateurs Redmine ({redmineUsers.length})</h3>
            <Button variant="ghost" size="sm" onClick={() => { setShowRedmineUsers(false); setSelectedRedmineUser(null); }}>Fermer</Button>
          </div>
          {!selectedRedmineUser ? (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Rechercher un utilisateur…"
                  value={redmineSearch}
                  onChange={e => setRedmineSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="max-h-60 overflow-y-auto space-y-1">
                {redmineUsers
                  .filter(ru => {
                    const search = redmineSearch.toLowerCase();
                    return ru.name.toLowerCase().includes(search) || String(ru.id).includes(search) || String(ru.login || '').toLowerCase().includes(search);
                  })
                  .map(ru => (
                    <button
                      key={ru.id}
                      onClick={() => {
                        setSelectedRedmineUser(ru);
                        setRedmineEmail(ru.email || ru.mail || '');
                      }}
                      className="w-full flex items-center gap-3 p-2 rounded hover:bg-muted/30 text-left text-sm"
                    >
                      <span className="font-medium">{ru.name}</span>
                      {ru.login && <span className="text-xs text-muted-foreground">@{ru.login}</span>}
                      <span className="text-xs text-muted-foreground">ID: {ru.id}</span>
                    </button>
                ))}
                {redmineUsers.filter(ru => {
                  const search = redmineSearch.toLowerCase();
                  return ru.name.toLowerCase().includes(search) || String(ru.id).includes(search) || String(ru.login || '').toLowerCase().includes(search);
                }).length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-2">Aucun utilisateur trouvé</p>
                )}
              </div>
            </>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Utilisateur</label>
                <Input value={selectedRedmineUser.name} disabled />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Email</label>
                <Input type="email" value={redmineEmail} onChange={e => setRedmineEmail(e.target.value)} placeholder="email@exemple.com" required />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Mot de passe</label>
                <Input type="password" value={redminePassword} onChange={e => setRedminePassword(e.target.value)} placeholder="••••••••" required minLength={6} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Rôle</label>
                <select value={redmineRole} onChange={e => setRedmineRole(e.target.value as any)} className="w-full h-10 text-sm bg-secondary border border-border rounded-md px-3 text-foreground">
                  {ROLE_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setSelectedRedmineUser(null)}>Retour</Button>
                <Button onClick={handleImportRedmineUser} disabled={importingUser || !redminePassword}>
                  {importingUser ? 'Import…' : 'Importer'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Desktop table */}
      <div className="glass-card overflow-hidden hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 text-muted-foreground">
                <th className="text-left p-3">Nom</th>
                <th className="text-left p-3">Email</th>
                <th className="text-center p-3">Rôle</th>
                <th className="text-center p-3">Projets</th>
                <th className="text-center p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map(p => {
                const role = getUserRole(p.id);
                const isSelf = p.id === user?.id;
                return (
                  <tr key={p.id} className="border-b border-border/30 hover:bg-muted/20">
                    <td className="p-3 font-medium">{getProfileDisplayName(p)}</td>
                    <td className="p-3 text-muted-foreground">{getProfileContact(p)}</td>
                    <td className="p-3 text-center">
                      <select
                        value={role}
                        onChange={e => handleChangeRole(p.id, e.target.value)}
                        disabled={isSelf}
                        className="text-xs bg-secondary border border-border rounded-md px-2 py-1 text-foreground"
                      >
                        {ROLE_OPTIONS.map(option => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-3 text-center">
                      <Button
                        variant="link"
                        size="sm"
                        className="text-xs text-primary"
                        onClick={() => handleViewProjects(p.id)}
                        disabled={syncingProjectsUserId === p.id}
                      >
                        <ExternalLink className="w-3 h-3 mr-1" /> {syncingProjectsUserId === p.id ? 'Sync…' : 'Voir les projets'}
                      </Button>
                    </td>
                    <td className="p-3 text-center">
                      {!isSelf && (
                        <Button variant="ghost" size="icon" onClick={() => handleDeleteUser(p.id, p.email)} className="h-8 w-8 text-destructive hover:text-destructive">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {profiles.map(p => {
          const role = getUserRole(p.id);
          const isSelf = p.id === user?.id;
          return (
            <div key={p.id} className="glass-card p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{getProfileDisplayName(p)}</div>
                  <div className="text-xs text-muted-foreground truncate">{getProfileContact(p)}</div>
                </div>
                {!isSelf && (
                  <Button variant="ghost" size="icon" onClick={() => handleDeleteUser(p.id, p.email)} className="h-8 w-8 text-destructive hover:text-destructive flex-shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <select
                  value={role}
                  onChange={e => handleChangeRole(p.id, e.target.value)}
                  disabled={isSelf}
                  className="text-xs bg-secondary border border-border rounded-md px-2 py-1.5 text-foreground"
                >
                  {ROLE_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => handleViewProjects(p.id)}
                  disabled={syncingProjectsUserId === p.id}
                >
                  <ExternalLink className="w-3 h-3 mr-1" /> {syncingProjectsUserId === p.id ? 'Sync…' : 'Projets'}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AdminUsers;
