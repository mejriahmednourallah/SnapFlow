import { Buffer } from 'buffer';
import type { DashboardProject, RedmineIssue, ActivityPdfOptions } from '@/components/activity/pdf/pdfTypes';
import type { ProjectPerimeterBlock } from '@/lib/projectPerimeters';
import { resolveSiteLogoDataUrl } from '@/lib/siteLogoResolver';

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
  perimeterBlocks?: ProjectPerimeterBlock[];
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

async function resolveActivityLogoSource(project: DashboardProject): Promise<string | undefined> {
  return resolveSiteLogoDataUrl({
    siteUrl: project.url,
    storedLogoUrl: project.logo_url,
  });
}

function summarizeIssues(issues: RedmineIssue[]) {
  const statusCounts = new Map<string, number>();
  const trackerCounts = new Map<string, number>();
  const priorityCounts = new Map<string, number>();
  issues.forEach((issue) => {
    const status = issue.status?.name || '(missing status)';
    const tracker = issue.tracker?.name || '(missing tracker)';
    const priority = issue.priority?.name || '(missing priority)';
    statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
    trackerCounts.set(tracker, (trackerCounts.get(tracker) || 0) + 1);
    priorityCounts.set(priority, (priorityCounts.get(priority) || 0) + 1);
  });
  const toRecord = (map: Map<string, number>) => Object.fromEntries(Array.from(map.entries()).sort((a, b) => b[1] - a[1]));
  return {
    count: issues.length,
    sampleIds: issues.slice(0, 8).map(issue => issue.id),
    statuses: toRecord(statusCounts),
    trackers: toRecord(trackerCounts),
    priorities: toRecord(priorityCounts),
  };
}

function logActivityPdfError(phase: string, error: unknown) {
  console.error(`[Activity PDF] Failed during ${phase}`, error);
  if (error instanceof Error) {
    console.error('[Activity PDF] Error details', {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: (error as Error & { cause?: unknown }).cause,
    });
  }
}

export async function generateActivityPdf(params: GenerateActivityPdfParams): Promise<void> {
  const startedAt = performance.now();
  const logPrefix = `[Activity PDF ${new Date().toISOString()}]`;
  console.groupCollapsed(`${logPrefix} generateActivityPdf`);
  console.log('input', {
    project: {
      id: params.project.id,
      site_name: params.project.site_name,
      url: params.project.url,
      hasStoredLogo: Boolean(params.project.logo_url),
    },
    totalCount: params.totalCount,
    filters: params.filters,
    options: {
      themeId: params.options.themeId,
      pdfColor: params.options.pdfColor,
      sections: params.options.sections,
      coverKpis: params.options.coverKpis,
      brandLeft: params.options.brandLeft,
      brandRight: params.options.brandRight,
      hasContactEmail: Boolean(params.options.contactEmail),
      hasContactWeb: Boolean(params.options.contactWeb),
      hasContactWeb2: Boolean(params.options.contactWeb2),
    },
    issues: summarizeIssues(params.issues),
    perimeterBlocks: {
      count: params.perimeterBlocks?.length ?? 0,
      titles: params.perimeterBlocks?.map(block => block.title) ?? [],
    },
  });

  if (typeof globalThis.Buffer === 'undefined') {
    console.log('polyfill Buffer: installing browser Buffer shim');
    globalThis.Buffer = Buffer;
  }

  try {
    console.time('[Activity PDF] import renderer/document');
    const [{ pdf }, { ActivityDocument }] = await Promise.all([
      import('@react-pdf/renderer'),
      import('@/components/activity/pdf/ActivityDocument'),
    ]);
    console.timeEnd('[Activity PDF] import renderer/document');

    console.time('[Activity PDF] resolve logo');
    const clientLogoSrc = await resolveActivityLogoSource(params.project);
    console.timeEnd('[Activity PDF] resolve logo');
    console.log('logo result', {
      resolved: Boolean(clientLogoSrc),
      sourceKind: clientLogoSrc?.startsWith('data:') ? 'data-url' : clientLogoSrc ? 'url' : 'none',
      length: clientLogoSrc?.length ?? 0,
    });

    const project = clientLogoSrc ? { ...params.project, logo_url: clientLogoSrc } : params.project;

    console.time('[Activity PDF] render React-PDF to blob');
    const blob = await pdf(<ActivityDocument {...params} project={project} />).toBlob();
    console.timeEnd('[Activity PDF] render React-PDF to blob');
    console.log('blob result', {
      size: blob.size,
      type: blob.type,
    });

    if (!blob.size) {
      throw new Error('Generated PDF blob is empty');
    }

    const today = new Date().toISOString().slice(0, 10);
    const filename = `rapport-activite-${slugify(params.project.site_name || 'projet')}-${today}.pdf`;

    console.time('[Activity PDF] browser download');
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    console.timeEnd('[Activity PDF] browser download');
    console.log('download requested', { filename, blobSize: blob.size });
  } catch (error) {
    logActivityPdfError('generateActivityPdf', error);
    throw error;
  } finally {
    console.log('durationMs', Math.round(performance.now() - startedAt));
    console.groupEnd();
  }
}
