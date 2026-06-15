import { supabase } from '@/integrations/supabase/client';

interface ResolveSiteLogoOptions {
  siteUrl?: string | null;
  storedLogoUrl?: string | null;
}

interface DetectLogoResponse {
  logo_url?: string | null;
  data_url?: string | null;
  source?: string;
  confidence?: number;
}

function cleanHttpUrl(value?: string | null): string | undefined {
  const candidate = value?.trim();
  if (!candidate) return undefined;
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) return undefined;
    return parsed.href;
  } catch {
    return undefined;
  }
}

export async function resolveSiteLogoDataUrl({
  siteUrl,
  storedLogoUrl,
}: ResolveSiteLogoOptions): Promise<string | undefined> {
  const stored = storedLogoUrl?.trim();
  if (stored && /^(data:|blob:)/i.test(stored)) return stored;

  const auditedSiteUrl = cleanHttpUrl(siteUrl);
  const fallbackLogoUrl = cleanHttpUrl(storedLogoUrl);
  if (!auditedSiteUrl && !fallbackLogoUrl) return undefined;

  try {
    const { data, error } = await supabase.functions.invoke<DetectLogoResponse>('detect-logo', {
      body: {
        siteUrl: auditedSiteUrl,
        fallbackLogoUrl,
        returnDataUrl: true,
      },
    });
    if (error) {
      console.warn('[siteLogoResolver] Logo detection unavailable:', error.message);
      return undefined;
    }
    return typeof data?.data_url === 'string' && data.data_url.startsWith('data:')
      ? data.data_url
      : undefined;
  } catch (error) {
    console.warn('[siteLogoResolver] Logo detection failed:', error);
    return undefined;
  }
}
