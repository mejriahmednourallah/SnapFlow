import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: {
      invoke,
    },
  },
}));

import { resolveSiteLogoDataUrl } from '@/lib/siteLogoResolver';

describe('site logo resolution for PDF reports', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('detects the logo from the audited website and only uses the stored logo as fallback', async () => {
    invoke.mockResolvedValue({
      data: {
        logo_url: 'https://client.example/assets/logo.png',
        data_url: 'data:image/png;base64,AAAA',
        source: 'page-logo',
      },
      error: null,
    });

    const result = await resolveSiteLogoDataUrl({
      siteUrl: 'https://client.example/contact',
      storedLogoUrl: 'https://cdn.example/old-logo.png',
    });

    expect(result).toBe('data:image/png;base64,AAAA');
    expect(invoke).toHaveBeenCalledWith('detect-logo', {
      body: {
        siteUrl: 'https://client.example/contact',
        fallbackLogoUrl: 'https://cdn.example/old-logo.png',
        returnDataUrl: true,
      },
    });
  });

  it('never returns a remote URL that would reintroduce browser CORS failures', async () => {
    invoke.mockResolvedValue({
      data: {
        logo_url: 'https://client.example/logo.png',
        data_url: null,
      },
      error: null,
    });

    await expect(resolveSiteLogoDataUrl({
      siteUrl: 'https://client.example',
    })).resolves.toBeUndefined();
  });

  it('does not call detection when no audited site or stored logo exists', async () => {
    await expect(resolveSiteLogoDataUrl({})).resolves.toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
  });
});
