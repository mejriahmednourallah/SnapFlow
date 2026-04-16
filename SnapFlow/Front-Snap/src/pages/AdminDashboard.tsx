import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Zap, LogOut, UserPlus, Trash2, Globe, FileText, Users, Shield, Download, ExternalLink, Search } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { createUser, updateRole, deleteUser } from '@/services/authService';
import { fetchRedmineUsers } from '@/services/redmineService';

interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  created_at: string;
}

interface UserRole {
  user_id: string;
  role: string;
}

interface RedmineUser {
  id: number;
  name: string;
}

const AdminDashboard = () => {
  const { user, userRole, loading, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // Redmine import
  const [showRedmineUsers, setShowRedmineUsers] = useState(false);
  const [redmineUsers, setRedmineUsers] = useState<RedmineUser[]>([]);
  const [loadingRedmine, setLoadingRedmine] = useState(false);
  const [selectedRedmineUser, setSelectedRedmineUser] = useState<RedmineUser | null>(null);
  const [redminePassword, setRedminePassword] = useState('');
  const [redmineRole, setRedmineRole] = useState<'admin' | 'charge_de_projet'>('charge_de_projet');
  const [importingUser, setImportingUser] = useState(false);
  const [redmineEmail, setRedmineEmail] = useState('');

  // New user form
  const [redmineSearch, setRedmineSearch] = useState('');
  const [showNewUser, setShowNewUser] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'charge_de_projet'>('charge_de_projet');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!loading && (!user || !isAdmin)) {
      navigate(user ? '/dashboard' : '/auth');
    }
  }, [user, loading, isAdmin, navigate]);

  const fetchData = async () => {
    const [profilesRes, rolesRes] = await Promise.all([
      supabase.from('profiles').select('*'),
      supabase.from('user_roles').select('*'),
    ]);
    setProfiles(profilesRes.data || []);
    setRoles(rolesRes.data || []);
    setLoadingData(false);
  };

  useEffect(() => {
    if (user && isAdmin) fetchData();
  }, [user, isAdmin]);

  const getUserRole = (userId: string) => roles.find(r => r.user_id === userId)?.role || 'aucun';

  const handleFetchRedmineUsers = async () => {
    setLoadingRedmine(true);
    try {
      const users = await fetchRedmineUsers();
      setRedmineUsers(users.map(u => ({ id: u.id, name: u.name })));
      setShowRedmineUsers(true);
    } catch (err: any) {
      toast({ title: 'Erreur Redmine', description: err.message, variant: 'destructive' });
    } finally {
      setLoadingRedmine(false);
    }
  };

  const handleImportRedmineUser = async () => {
    if (!selectedRedmineUser || !redminePassword || !redmineEmail) return;
    setImportingUser(true);
    try {
      const fullName = selectedRedmineUser.name;
      await createUser({ email: redmineEmail, password: redminePassword, full_name: fullName, role: redmineRole });
      toast({ title: 'Utilisateur importé', description: `${fullName} (${redmineEmail})` });
      setShowRedmineUsers(false);
      setSelectedRedmineUser(null);
      setRedminePassword('');
      setRedmineEmail('');
      await fetchData();
    } catch (err: any) {
      toast({ title: 'Erreur', description: err.message, variant: 'destructive' });
    } finally {
      setImportingUser(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      await createUser({ email: newEmail, password: newPassword, full_name: newName, role: newRole });
      toast({ title: 'Utilisateur créé', description: `${newEmail} a été ajouté avec le rôle ${newRole}.` });
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

  if (loading || !user || !isAdmin) return null;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border/50 px-6 py-3 sticky top-0 bg-background/80 backdrop-blur-md z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <Zap className="w-4 h-4 text-primary" />
            </div>
            <span className="text-lg font-bold gradient-text">AuditPro</span>
            <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full ml-2">Admin</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate('/admin/projects')}>
              <Globe className="w-4 h-4 mr-1" /> Projets
            </Button>
            <span className="text-xs text-muted-foreground mr-2">{user.email}</span>
            <Button variant="ghost" size="icon" onClick={() => { signOut(); navigate('/auth'); }} className="h-9 w-9">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-8 space-y-8">
        {/* Users section */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" /> Utilisateurs ({profiles.length})
            </h2>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleFetchRedmineUsers} disabled={loadingRedmine}>
                <Download className="w-4 h-4 mr-2" /> {loadingRedmine ? 'Chargement…' : 'Importer de Redmine'}
              </Button>
              <Button size="sm" onClick={() => setShowNewUser(!showNewUser)}>
                <UserPlus className="w-4 h-4 mr-2" /> Créer un utilisateur
              </Button>
            </div>
          </div>

          {showNewUser && (
            <form onSubmit={handleCreateUser} className="glass-card p-4 mb-4 grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
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
                  <option value="charge_de_projet">Chargé de projet</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <Button type="submit" disabled={creating}>{creating ? 'Création…' : 'Créer'}</Button>
            </form>
          )}

          {/* Redmine user import */}
          {showRedmineUsers && (
            <div className="glass-card p-4 mb-4 space-y-4">
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
                      .filter(ru => ru.name.toLowerCase().includes(redmineSearch.toLowerCase()) || String(ru.id).includes(redmineSearch))
                      .map(ru => (
                      <button
                        key={ru.id}
                        onClick={() => setSelectedRedmineUser(ru)}
                        className="w-full flex items-center gap-3 p-2 rounded hover:bg-muted/30 text-left text-sm"
                      >
                        <span className="font-medium">{ru.name}</span>
                        <span className="text-xs text-muted-foreground">ID: {ru.id}</span>
                      </button>
                    ))}
                    {redmineUsers.filter(ru => ru.name.toLowerCase().includes(redmineSearch.toLowerCase()) || String(ru.id).includes(redmineSearch)).length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-2">Aucun utilisateur trouvé</p>
                    )}
                  </div>
                </>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
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
                      <option value="charge_de_projet">Chargé de projet</option>
                      <option value="admin">Admin</option>
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

          <div className="glass-card overflow-hidden">
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
                    const isSelf = p.id === user.id;
                    return (
                      <tr key={p.id} className="border-b border-border/30 hover:bg-muted/20">
                        <td className="p-3 font-medium">{p.full_name || '—'}</td>
                        <td className="p-3 text-muted-foreground">{p.email}</td>
                        <td className="p-3 text-center">
                          <select
                            value={role}
                            onChange={e => handleChangeRole(p.id, e.target.value)}
                            disabled={isSelf}
                            className="text-xs bg-secondary border border-border rounded-md px-2 py-1 text-foreground"
                          >
                            <option value="admin">Admin</option>
                            <option value="charge_de_projet">Chargé de projet</option>
                          </select>
                        </td>
                        <td className="p-3 text-center">
                          <Button
                            variant="link"
                            size="sm"
                            className="text-xs text-primary"
                            onClick={() => navigate(`/admin/projects?user=${p.id}`)}
                          >
                            <ExternalLink className="w-3 h-3 mr-1" /> Voir les projets
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
        </section>
      </main>
    </div>
  );
};

export default AdminDashboard;
