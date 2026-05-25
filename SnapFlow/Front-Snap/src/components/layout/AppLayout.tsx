import { useEffect } from 'react';
import { useNavigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from './AppSidebar';
import { Breadcrumbs } from './Breadcrumbs';
import { NotificationBell } from '../notifications/NotificationBell';
import { AIChatBubble } from '../ai/AIChatBubble';
import { Button } from '@/components/ui/button';
import { LogOut } from 'lucide-react';
import snapflowLogo from '@/assets/snapflow-logo.png';

const AppLayout = () => {
  const { user, loading, isAdmin, displayName, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate('/auth');
  }, [user, loading, navigate]);

  if (loading || !user) return null;

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <header className="h-14 border-b border-border/50 px-4 flex items-center justify-between sticky top-0 bg-background/80 backdrop-blur-md z-50">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="h-8 w-8" />
              <div className="hidden md:block">
                <Breadcrumbs />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <NotificationBell />
              <div className="h-5 w-px bg-border" />
              <span className="text-xs text-muted-foreground hidden sm:inline">
                {displayName}
              </span>
              <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium hidden sm:inline">
                {isAdmin ? 'Admin' : 'Chargé'}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => { signOut(); navigate('/auth'); }}
                title="Déconnexion"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          </header>

          {/* Main content */}
          <main className="flex-1 p-6">
            <div className="max-w-7xl mx-auto">
              <Outlet />
            </div>
          </main>
        </div>

        {/* AI Chat Bubble */}
        <AIChatBubble />
      </div>
    </SidebarProvider>
  );
};

export default AppLayout;
