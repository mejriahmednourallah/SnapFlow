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

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('Unable to convert activity logo to data URL'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read activity logo blob'));
    reader.readAsDataURL(blob);
  });
}

async function fetchLogoAsDataUrl(url?: string | null, fallbackToDirect = true): Promise<string | undefined> {
  if (!url) return undefined;
  if (/^(data:|blob:)/i.test(url)) return url;

  try {
    const response = await fetch(url);
    if (!response.ok) return fallbackToDirect ? url : undefined;
    return await blobToDataUrl(await response.blob());
  } catch {
    return fallbackToDirect ? url : undefined;
  }
}

async function resolveActivityLogoSource(project: DashboardProject): Promise<string | undefined> {
  const storedLogo = project.logo_url?.trim();
  if (storedLogo) return fetchLogoAsDataUrl(storedLogo);
  return undefined;
}

export async function generateActivityPdf(params: GenerateActivityPdfParams): Promise<void> {
  if (typeof globalThis.Buffer === 'undefined') {
    globalThis.Buffer = Buffer;
  }

  const [{ pdf }, { ActivityDocument }] = await Promise.all([
    import('@react-pdf/renderer'),
    import('@/components/activity/pdf/ActivityDocument'),
  ]);

  const clientLogoSrc = await resolveActivityLogoSource(params.project);
  const project = clientLogoSrc ? { ...params.project, logo_url: clientLogoSrc } : params.project;
  const blob = await pdf(<ActivityDocument {...params} project={project} />).toBlob();
  const today = new Date().toISOString().slice(0, 10);
  const filename = `rapport-activite-${slugify(params.project.site_name || 'projet')}-${today}.pdf`;

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
