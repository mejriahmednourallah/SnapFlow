import { useLocation, Link } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

const routeLabels: Record<string, string> = {
  app: 'Accueil',
  projects: 'Mes projets',
  reports: 'Rapports & Audits',
  schedules: 'Planning',
  notifications: 'Notifications',
  assistant: 'Assistant IA',
  users: 'Utilisateurs',
  activity: 'Rapport d\'activité',
};

export function Breadcrumbs() {
  const location = useLocation();
  const segments = location.pathname.split('/').filter(Boolean);

  // Build breadcrumb items
  const crumbs = segments.map((seg, i) => {
    const path = '/' + segments.slice(0, i + 1).join('/');
    const label = routeLabels[seg] || seg;
    const isLast = i === segments.length - 1;
    return { path, label, isLast };
  });

  if (crumbs.length <= 1) return null;

  return (
    <nav className="flex items-center gap-1 text-sm">
      <Link to="/app" className="text-muted-foreground hover:text-foreground transition-colors">
        <Home className="w-3.5 h-3.5" />
      </Link>
      {crumbs.slice(1).map((crumb, i) => (
        <div key={crumb.path} className="flex items-center gap-1">
          <ChevronRight className="w-3 h-3 text-muted-foreground" />
          {crumb.isLast ? (
            <span className="text-foreground font-medium text-xs">{crumb.label}</span>
          ) : (
            <Link to={crumb.path} className="text-muted-foreground hover:text-foreground transition-colors text-xs">
              {crumb.label}
            </Link>
          )}
        </div>
      ))}
    </nav>
  );
}
