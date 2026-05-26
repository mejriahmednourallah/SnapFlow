import { Buffer } from 'buffer';
import type { DashboardProject, RedmineIssue, ActivityPdfOptions } from '@/components/activity/pdf/pdfTypes';

export interface GenerateActivityPdfParams {
  project: DashboardProject;
  issues: RedmineIssue[];
  totalCount: number;
  filters?: {
    status?: string;
    tracker?: string;
    dateFrom?: string;
    dateTo?: string;
    statusLabel?: string;
    trackerLabel?: string;
  };
  options: ActivityPdfOptions;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function generateActivityPdf(params: GenerateActivityPdfParams): Promise<void> {
  if (typeof globalThis.Buffer === 'undefined') {
    globalThis.Buffer = Buffer;
  }

  const [{ pdf }, { ActivityDocument }] = await Promise.all([
    import('@react-pdf/renderer'),
    import('@/components/activity/pdf/ActivityDocument'),
  ]);

  const blob = await pdf(<ActivityDocument {...params} />).toBlob();
  const today = new Date().toISOString().slice(0, 10);
  const filename = `rapport-activite-${slugify(params.project.site_name || 'projet')}-${today}.pdf`;

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
