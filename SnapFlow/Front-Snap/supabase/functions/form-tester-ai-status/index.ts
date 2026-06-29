// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  corsHeaders,
  getAuthUserId,
  HttpError,
  toJson,
} from '../_shared/formTester.ts';

function getAiConfig() {
  const provider = Deno.env.get('FORM_TESTER_AI_PROVIDER') === 'openai_compatible'
    ? 'openai_compatible'
    : 'gemini';
  if (provider === 'openai_compatible') {
    return {
      provider,
      apiKey: Deno.env.get('FORM_TESTER_AI_API_KEY') ?? '',
      model: Deno.env.get('FORM_TESTER_AI_MODEL') || 'flash-v4',
      baseUrl: Deno.env.get('FORM_TESTER_AI_BASE_URL') || 'https://api.deepseek.com/v1/chat/completions',
      missingMessage: 'FORM_TESTER_AI_API_KEY non configuree',
    };
  }
  return {
    provider,
    apiKey: Deno.env.get('GEMINI_API_KEY') ?? '',
    model: Deno.env.get('FORM_TESTER_GEMINI_MODEL') || 'gemini-2.0-flash',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    missingMessage: 'GEMINI_API_KEY non configuree',
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const config = getAiConfig();
  try {
    await getAuthUserId(req);

    if (!config.apiKey) {
      return toJson({
        provider: config.provider,
        model: config.model,
        base_url: config.provider === 'openai_compatible' ? config.baseUrl : null,
        configured: false,
        available: false,
        fallback: 'heuristic',
        error: config.missingMessage,
      });
    }

    const response = await fetch(config.baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        max_tokens: 8,
        messages: [{ role: 'user', content: 'Reply only OK.' }],
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return toJson({
        provider: config.provider,
        model: config.model,
        base_url: config.provider === 'openai_compatible' ? config.baseUrl : null,
        configured: true,
        available: false,
        fallback: 'heuristic',
        error: `AI provider HTTP ${response.status}`,
      });
    }

    return toJson({
      provider: config.provider,
      model: config.model,
      base_url: config.provider === 'openai_compatible' ? config.baseUrl : null,
      configured: true,
      available: true,
      fallback: 'heuristic',
      error: null,
    });
  } catch (error) {
    if (error instanceof HttpError) return toJson({ error: error.message }, error.status);
    return toJson({
      provider: config.provider,
      model: config.model,
      base_url: config.provider === 'openai_compatible' ? config.baseUrl : null,
      configured: Boolean(config.apiKey),
      available: false,
      fallback: 'heuristic',
      error: error instanceof Error ? error.message : 'Diagnostic IA impossible',
    });
  }
});
