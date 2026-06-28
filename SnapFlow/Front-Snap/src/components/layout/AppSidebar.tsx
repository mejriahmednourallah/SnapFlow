import {
  LayoutDashboard, FolderOpen, FileBarChart, CalendarClock, Building2,
  Bell, Bot, Workflow, Users, Settings,
} from 'lucide-react';
import { NavLink } from '@/components/NavLink';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import snapflowLogo from '@/assets/snapflow-logo.png';

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from '@/components/ui/sidebar';

const mainNav = [
  { title: 'Vue d\'ensemble', url: '/app', icon: LayoutDashboard },
  { title: 'Mes projets', url: '/app/projects', icon: FolderOpen },
  { title: 'Rapports & Audits', url: '/app/reports', icon: FileBarChart },
  { title: 'Planning', url: '/app/schedules', icon: CalendarClock },
  { title: 'Notifications', url: '/app/notifications', icon: Bell },
  { title: 'Assistant IA', url: '/app/assistant', icon: Bot },
  { title: 'Flux de travail', url: '/app/workflows', icon: Workflow },
];

const adminNav = [
  { title: 'Clients', url: '/app/clients', icon: Building2 },
  { title: 'Utilisateurs', url: '/app/users', icon: Users },
  { title: 'Parametres', url: '/app/settings', icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const location = useLocation();
  const { isAdmin } = useAuth();

  const isActive = (path: string) => {
    if (path === '/app') return location.pathname === '/app';
    return location.pathname.startsWith(path);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-3">
          <img src={snapflowLogo} alt="Snapflow" className="h-7 flex-shrink-0 brightness-0 invert" />
          {!collapsed && (
            <span className="text-sm font-semibold text-foreground tracking-tight">Snapflow</span>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNav.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.url)}
                    tooltip={item.title}
                  >
                    <NavLink
                      to={item.url}
                      end={item.url === '/app'}
                      className="flex items-center gap-3"
                      activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                    >
                      <item.icon className="h-4 w-4 flex-shrink-0" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Administration</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminNav.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive(item.url)}
                      tooltip={item.title}
                    >
                      <NavLink
                        to={item.url}
                        className="flex items-center gap-3"
                        activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                      >
                        <item.icon className="h-4 w-4 flex-shrink-0" />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="p-3">
        {!collapsed && (
          <p className="text-[10px] text-muted-foreground text-center">
            © 2026 Snapflow — MEDIANET
          </p>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
