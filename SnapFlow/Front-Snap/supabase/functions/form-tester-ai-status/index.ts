// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  corsHeaders,
  getAuthUserId,
  HttpError,
  toJson,
} from '../_shared/formTester.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    await getAuthUserId(req);
    const apiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
    const model = Deno.env.get('FORM_TESTER_GEMINI_MODEL') || 'gemini-2.0-flash';

    if (!apiKey) {
      return toJson({
        provider: 'gemini',
        model,
        configured: false,
        available: false,
        fallback: 'heuristic',
        error: 'GEMINI_API_KEY non configuree',
      });
    }

    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 8,
        messages: [{ role: 'user', content: 'Reply only OK.' }],
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return toJson({
        provider: 'gemini',
        model,
        configured: true,
        available: false,
        fallback: 'heuristic',
        error: `Gemini HTTP ${response.status}`,
      });
    }

    return toJson({
      provider: 'gemini',
      model,
      configured: true,
      available: true,
      fallback: 'heuristic',
      error: null,
    });
  } catch (error) {
    if (error instanceof HttpError) return toJson({ error: error.message }, error.status);
    return toJson({
      provider: 'gemini',
      model: Deno.env.get('FORM_TESTER_GEMINI_MODEL') || 'gemini-2.0-flash',
      configured: Boolean(Deno.env.get('GEMINI_API_KEY')),
      available: false,
      fallback: 'heuristic',
      error: error instanceof Error ? error.message : 'Diagnostic Gemini impossible',
    });
  }
});
