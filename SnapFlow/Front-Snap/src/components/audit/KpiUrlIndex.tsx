import { useState } from 'react';
import { ChevronDown, ExternalLink, AlertCircle } from 'lucide-react';

interface KpiUrlIndexProps {
  urls: string[];
  affectedCount: number;
}

export function KpiUrlIndex({ urls, affectedCount }: KpiUrlIndexProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (affectedCount < 10) return null;

  return (
    <div className="space-y-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80 transition-colors w-full"
      >
        <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
        <AlertCircle className="w-4 h-4" />
        Index des {affectedCount} URLs affectées
      </button>

      {isExpanded && (
        <div className="bg-muted/30 border border-border/20 rounded-lg p-3 space-y-2 max-h-96 overflow-y-auto">
          <div className="space-y-2">
            {urls.map((url, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between gap-2 p-2 rounded bg-muted/20 hover:bg-muted/40 transition-colors"
              >
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline flex-1 truncate"
                  title={url}
                >
                  {url}
                </a>
                <ExternalLink className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border/20">
            Total : {affectedCount} URL{affectedCount > 1 ? 's' : ''}
          </p>
        </div>
      )}
    </div>
  );
}
