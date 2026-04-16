import { Buffer } from 'buffer';
import type { AuditReport } from '@/data/mockAuditData';
import type { PdfTheme } from '@/components/pdf/theme';

export interface PdfBrandingOptions {
  clientLogoUrl?: string | null;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('Unable to convert logo to data URL'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read logo blob'));
    reader.readAsDataURL(blob);
  });
}

async function resolveClientLogoSource(url?: string | null): Promise<string | undefined> {
  if (!url) return undefined;
  if (/^(data:|blob:)/i.test(url)) {
    console.log('[generateAuditPdf] Using data URL directly');
    return url;
  }

  try {
    console.log('[generateAuditPdf] Fetching logo from URL:', url);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Client logo fetch failed with status ${response.status}`);
    }
    const blob = await response.blob();
    const dataUrl = await blobToDataUrl(blob);
    console.log('[generateAuditPdf] Successfully converted logo to data URL');
    return dataUrl;
  } catch (error) {
    console.error('[generateAuditPdf] Logo fetch failed; falling back to direct URL:', error);
    // Fall back to the original URL (may still succeed if react-pdf can fetch it)
    console.log('[generateAuditPdf] Attempting with original URL as fallback:', url);
    return url;
  }
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

  const clientLogoSrc = await resolveClientLogoSource(branding?.clientLogoUrl);
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
