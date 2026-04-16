const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * fetch-audit-api
 * Calls the external SnapFlow audit backend.
 *
 * Sync mode  (async_mode = false, default):
 *   POST /api/v3/analyze — waits for full results, returns them (≤30 s)
 *
 * Async mode (async_mode = true):
 *   POST /api/v3/analyze — backend answers immediately with { job_id }
 *   Returns { job_id }   — caller must poll poll-audit-job for results
 *
 * Request body:
 *   url        : string   — target URL to audit (required)
 *   kpis       : string[] — specific KPI ids (optional)
 *   axes       : string[] — specific axes (optional)
 *   timeout    : number   — seconds passed to backend, default 25
 *   async_mode : boolean  — true = fire-and-forget, default false
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let body;
    try {
      body = await req.json();
    } catch (parseErr) {
      console.error('[parse] Failed to parse request body:', parseErr);
      return new Response(JSON.stringify({ error: 'Invalid JSON in request body', detail: parseErr instanceof Error ? parseErr.message : 'Unknown parse error' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { url, kpis, axes, timeout = 25, async_mode = false, max_pages = 100 } = body || {};

    if (!url) {
      return new Response(JSON.stringify({ error: 'url is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiBaseUrl = Deno.env.get('SCANNER_BASE_URL')?.trim() || Deno.env.get('AUDIT_API_URL')?.trim();
    const apiUrl = apiBaseUrl ? `${apiBaseUrl}/scan` : null;

    console.log(`[env] SCANNER_BASE_URL = ${apiBaseUrl === undefined ? '(NOT SET)' : `"${apiBaseUrl}"`}`);

    if (!apiUrl) {
      console.error('[env] SCANNER_BASE_URL secret is not configured — cannot call audit API');
      return new Response(
        JSON.stringify({ error: 'SCANNER_BASE_URL secret is not set in Supabase Edge Function settings' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[fetch] Resolved URL: ${apiUrl}`);

    // Async mode only needs the scan to be accepted and a scan_id returned.
    // Use a slightly larger timeout + retry to tolerate transient tunnel/network closes.
    const asyncAbortTimeout = Number(Deno.env.get('SCANNER_ASYNC_TIMEOUT_MS') ?? '20000');
    const abortTimeout = async_mode ? asyncAbortTimeout : Math.min((timeout + 5) * 1000, 35_000);
    const maxAttempts = async_mode ? 3 : 2;
    console.log(`[fetch] Target site: ${url} | async_mode: ${async_mode} | abortTimeout: ${abortTimeout}ms`);

    const requestPayload: Record<string, unknown> = { url, timeout, max_pages };
    if (kpis && kpis.length > 0) requestPayload.kpis = kpis;
    if (axes && axes.length > 0) requestPayload.axes = axes;
    // Tell the backend to run asynchronously and return scan_id immediately
    if (async_mode) requestPayload.async = true;
    const baseHeaders = {
      'Content-Type': 'application/json',
      'X-Tenant': 'demo',
      'X-Pinggy-No-Screen': '1',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'application/json',
    };

    let apiResponse: Response | null = null;
    let lastFetchError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), abortTimeout);

      try {
        console.log(`[fetch] Attempt ${attempt}/${maxAttempts} -> ${apiUrl}`);
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: baseHeaders,
          body: JSON.stringify(requestPayload),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (response.ok) {
          apiResponse = response;
          break;
        }

        if (!RETRYABLE_STATUS.has(response.status) || attempt === maxAttempts) {
          apiResponse = response;
          break;
        }

        const retryAfter = response.headers.get('retry-after');
        const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : 0;
        const backoffMs = Math.max(800 * attempt + Math.floor(Math.random() * 300), retryAfterMs);
        const bodyPreview = await response.text();
        console.warn(`[fetch] Upstream ${response.status}, retrying in ${backoffMs}ms. body=${bodyPreview.slice(0, 180)}`);
        await sleep(backoffMs);
      } catch (fetchErr) {
        clearTimeout(timer);
        lastFetchError = fetchErr;
        const isTimeout = fetchErr instanceof Error && fetchErr.name === 'AbortError';
        const canRetry = attempt < maxAttempts;
        console.warn(`[fetch] ${isTimeout ? 'Timeout' : 'Network error'} on attempt ${attempt}/${maxAttempts}:`, fetchErr);
        if (!canRetry) break;
        const backoffMs = 800 * attempt + Math.floor(Math.random() * 300);
        await sleep(backoffMs);
      }
    }

    if (!apiResponse) {
      const isTimeout = lastFetchError instanceof Error && lastFetchError.name === 'AbortError';
      return new Response(
        JSON.stringify({
          error: isTimeout
            ? `Backend timed out after ${abortTimeout / 1000}s (after ${maxAttempts} attempt${maxAttempts > 1 ? 's' : ''})`
            : `Unable to reach scanner backend after ${maxAttempts} attempt${maxAttempts > 1 ? 's' : ''}`,
          detail: lastFetchError instanceof Error ? lastFetchError.message : String(lastFetchError ?? 'Unknown network error'),
        }),
        { status: isTimeout ? 504 : 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!apiResponse.ok) {
      const errText = await apiResponse.text();
      console.error(`API error ${apiResponse.status}: ${errText}`);
      return new Response(
        JSON.stringify({ error: `Audit API returned ${apiResponse.status}`, detail: errText }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await apiResponse.json();
    const scanId = data.scan_id || data.job_id;

    console.log('[fetch-audit-api] response:', JSON.stringify(data).substring(0, 500));
    console.log(`[fetch-audit-api] mode: ${async_mode ? 'async → scan_id=' + scanId : 'sync → success'}`);

    // Return scan_id as job_id for frontend compatibility
    return new Response(JSON.stringify({ ...data, job_id: scanId }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('fetch-audit-api error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
