import { useEffect } from 'react';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { LogOut, Globe, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import snapflowLogo from '@/assets/snapflow-logo.png';
import Footer from '@/components/Footer';

import { CalendarClock } from 'lucide-react';

const navItems = [
  { label: 'Projets', path: '/admin/projects', icon: Globe },
  { label: 'Utilisateurs', path: '/admin/users', icon: Users },
  { label: 'Planification', path: '/admin/schedules', icon: CalendarClock },
];

const AdminLayout = () => {
  const { user, loading, isAdmin, displayName, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!loading && (!user || !isAdmin)) {
      navigate(user ? '/dashboard' : '/auth');
    }
  }, [user, loading, isAdmin, navigate]);

  if (loading || !user || !isAdmin) return null;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border/50 px-6 py-3 sticky top-0 bg-background/80 backdrop-blur-md z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img src={snapflowLogo} alt="Snapflow" className="h-7" />
            <nav className="flex items-center gap-1 ml-4">
              {navItems.map(item => {
                const isActive = location.pathname.startsWith(item.path);
                return (
                  <button
                    key={item.path}
                    onClick={() => navigate(item.path)}
                    className={cn(
                      'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200',
                      isActive
                        ? 'bg-primary/15 text-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    )}
                  >
                    <item.icon className="w-4 h-4" />
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground mr-2">{displayName}</span>
            <Button variant="ghost" size="icon" onClick={() => { signOut(); navigate('/auth'); }} className="h-9 w-9">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-8">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
};

export default AdminLayout;
