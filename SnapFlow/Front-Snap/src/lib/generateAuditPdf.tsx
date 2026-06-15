import { Buffer } from 'buffer';
import type { AuditReport } from '@/data/mockAuditData';
import type { PdfTheme } from '@/components/pdf/theme';
import { resolveSiteLogoDataUrl } from '@/lib/siteLogoResolver';

export interface PdfBrandingOptions {
  clientLogoUrl?: string | null;
  siteUrl?: string | null;
}

export async function generateAuditPdf(
  audit: AuditReport,
  theme?: PdfTheme,
  branding?: PdfBrandingOptions,
): Promise<void> {
  if (typeof globalThis.Buffer === 'undefined') {
    globalThis.Buffer = Buffer;
  }

  const [{ pdf }, { AuditDocument }] = await Promise.all([
    import('@react-pdf/renderer'),
    import('@/components/pdf/AuditDocument'),
  ]);

  const clientLogoSrc = await resolveSiteLogoDataUrl({
    siteUrl: branding?.siteUrl ?? audit.url,
    storedLogoUrl: branding?.clientLogoUrl,
  });
  const blob = await pdf(<AuditDocument audit={audit} theme={theme} clientLogoSrc={clientLogoSrc} />).toBlob();

  const filename = `audit-${audit.siteName
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')}-${audit.date}.pdf`;

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
