import { Settings, Eye, Zap, Search, FileText, Palette, Leaf, Shield, Lock, Server, Wrench, Bot } from 'lucide-react';

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  functional: Settings,
  technique: Wrench,
  accessibility: Eye,
  performance: Zap,
  seo: Search,
  'ai-friendly': Bot,
  content: FileText,
  'ux-ui': Palette,
  'eco-index': Leaf,
  rgpd: Shield,
  security: Lock,
  infrastructure: Server,
};

interface AxisIconProps {
  id: string;
  className?: string;
}

export function AxisIcon({ id, className = 'w-5 h-5' }: AxisIconProps) {
  const Icon = iconMap[id] ?? Settings;
  return <Icon className={className} />;
}
