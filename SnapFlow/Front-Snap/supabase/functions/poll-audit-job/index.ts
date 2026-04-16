const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  label: string,
  maxAttempts: number,
  timeoutMs: number,
): Promise<Response> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      console.log(`[poll-audit-job] ${label} attempt ${attempt}/${maxAttempts} -> ${url}`);
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      if (response.ok) return response;

      if (!RETRYABLE_STATUS.has(response.status) || attempt === maxAttempts) {
        return response;
      }

      const retryAfter = response.headers.get('retry-after');
      const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : 0;
      const backoffMs = Math.max(700 * attempt + Math.floor(Math.random() * 300), retryAfterMs);
      const bodyPreview = await response.text();
      console.warn(`[poll-audit-job] ${label} got ${response.status}; retrying in ${backoffMs}ms. body=${bodyPreview.slice(0, 180)}`);
      await sleep(backoffMs);
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      const isTimeout = error instanceof Error && error.name === 'AbortError';
      const canRetry = attempt < maxAttempts;
      console.warn(`[poll-audit-job] ${label} ${isTimeout ? 'timeout' : 'network error'} on attempt ${attempt}/${maxAttempts}:`, error);
      if (!canRetry) break;
      await sleep(700 * attempt + Math.floor(Math.random() * 300));
    }
  }

  throw new Error(`${label} failed after ${maxAttempts} attempts: ${lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown error')}`);
}

/**
 * poll-audit-job
 * Checks status, then fetches KPI payload if done.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { job_id } = body; // job_id is scanid in v3

    if (!job_id) {
      return new Response(JSON.stringify({ error: 'job_id (scanid) is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiBaseUrl = Deno.env.get('SCANNER_BASE_URL')?.trim() || Deno.env.get('AUDIT_API_URL')?.trim();
    if (!apiBaseUrl) {
      return new Response(
        JSON.stringify({ error: 'SCANNER_BASE_URL secret is not set' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const requestTimeoutMs = Number(Deno.env.get('SCANNER_POLL_TIMEOUT_MS') ?? '15000');
    const statusAttempts = Number(Deno.env.get('SCANNER_POLL_STATUS_ATTEMPTS') ?? '10');
    const resultAttempts = Number(Deno.env.get('SCANNER_POLL_RESULT_ATTEMPTS') ?? '10');

    const fetchOptions: RequestInit = {
      headers: {
        'X-Pinggy-No-Screen': '1',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/json',
      }
    };

    // 1. Check Status
    const statusUrl = `${apiBaseUrl}/scan/${job_id}/status`;
    console.log(`[poll-audit-job] GET ${statusUrl}`);

    const statusRes = await fetchWithRetry(statusUrl, fetchOptions, 'status check', statusAttempts, requestTimeoutMs);
    if (!statusRes.ok) throw new Error(`Status check failed: ${statusRes.status}`);
    const statusData = await statusRes.json();
    
    const isDone = statusData.status === 'done' || statusData.status === 'complete';
    
    console.log(`[poll-audit-job] status: ${statusData.status} | isDone: ${isDone}`);

    if (!isDone) {
      return new Response(JSON.stringify({ status: statusData.status }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Status is done -> Fetch KPI payload (canonical scanner format)
    const kpisUrl = `${apiBaseUrl}/scan/${job_id}/kpis`;
    console.log(`[poll-audit-job] status done, fetching kpis payload...`);

    const kpisRes = await fetchWithRetry(kpisUrl, fetchOptions, 'kpis fetch', resultAttempts, requestTimeoutMs);
    if (!kpisRes.ok) throw new Error(`KPI fetch failed: ${kpisRes.status}`);
    const kpisData = await kpisRes.json();

    const normalizedResponse = {
      ...kpisData,
      scan_id: kpisData?.scan_id ?? job_id,
    };

    return new Response(JSON.stringify({ status: 'done', result: normalizedResponse }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[poll-audit-job] Error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error', status: 'error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
