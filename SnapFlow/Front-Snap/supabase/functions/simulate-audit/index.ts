const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { audit } = await req.json();
    if (!audit) {
      return new Response(JSON.stringify({ error: 'audit data is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const providers = [];
    if (Deno.env.get('GROQ_API_KEY')) {
      providers.push({
        name: 'groq',
        url: 'https://api.groq.com/openai/v1/chat/completions',
        key: Deno.env.get('GROQ_API_KEY'),
        models: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768']
      });
    }
    if (Deno.env.get('GEMINI_API_KEY')) {
      providers.push({
        name: 'gemini',
        url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        key: Deno.env.get('GEMINI_API_KEY'),
        models: ['gemini-2.0-flash-lite', 'gemini-2.0-flash']
      });
    }

    if (providers.length === 0) {
      return new Response(JSON.stringify({ error: 'Neither GROQ_API_KEY nor GEMINI_API_KEY are configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Build a compact summary of audit findings for the AI
    const axesSummary = (audit.axes || []).map((a: any) => ({
      name: a.name,
      score: a.score,
      findings: (a.findings || []).map((f: any) => ({
        title: f.title,
        criticality: f.criticality,
        recommendation: f.recommendation,
      })),
    }));

    const systemPrompt = `Tu es un consultant digital senior. À partir d'un rapport d'audit, tu dois produire une SIMULATION de refonte du site qui intègre toutes les recommandations de l'audit.

Retourne UNIQUEMENT du JSON brut (pas de backticks markdown). Structure exacte:
{
  "simulatedScore": N,
  "scoreImprovement": N,
  "uxRecommendations": [
    {"title": "Titre court", "description": "Description en 1-2 phrases", "impact": "high|medium|low", "category": "UX|SEO|Performance|Accessibilité|Contenu|Technique"}
  ],
  "seoImprovements": [
    {"title": "Titre", "before": "État actuel", "after": "État après refonte", "impact": "high|medium|low"}
  ],
  "performanceGains": {
    "currentLoadTime": "Xs",
    "estimatedLoadTime": "Xs",
    "currentPageWeight": "X Mo",
    "estimatedPageWeight": "X Mo",
    "currentRequests": N,
    "estimatedRequests": N
  },
  "roiEstimation": {
    "trafficIncrease": "+X%",
    "bounceRateReduction": "-X%",
    "conversionImprovement": "+X%",
    "estimatedTimeline": "X mois"
  },
  "priorityActions": [
    {"action": "Description action", "effort": "faible|moyen|élevé", "impact": "high|medium|low", "timeline": "1 semaine|2 semaines|1 mois|3 mois"}
  ],
  "summary": "Résumé exécutif de la simulation en 2-3 phrases"
}

RÈGLES:
- 5-8 recommandations UX
- 4-6 améliorations SEO
- 5-8 actions prioritaires
- Scores et estimations réalistes basés sur l'audit
- JSON compact`;

    const userPrompt = `Simule la refonte du site "${audit.siteName}" (${audit.url}).
Score actuel: ${audit.globalScore}/100. Niveau: ${audit.maturityLevel}.

Résumé des axes:
${JSON.stringify(axesSummary).substring(0, 3000)}

Points négatifs: ${JSON.stringify(audit.negativePoints || []).substring(0, 500)}
Points critiques: ${JSON.stringify(audit.criticalPoints || []).substring(0, 500)}

Génère une simulation réaliste de refonte. JSON compact uniquement.`;

    console.log('Calling AI for simulation...');

    let aiData = null;
    let lastError = '';

    outerLoop: for (const provider of providers) {
      for (const model of provider.models) {
        console.log(`Trying ${provider.name} model: ${model}`);
        const aiResponse = await fetch(provider.url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${provider.key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.3,
            max_tokens: 3000,
          }),
        });

        if (aiResponse.ok) {
          aiData = await aiResponse.json();
          break outerLoop;
        }

        lastError = await aiResponse.text();
        console.error(`Model ${model} failed (${aiResponse.status}):`, lastError.substring(0, 200));

        if (aiResponse.status === 429) {
          return new Response(JSON.stringify({ error: 'Limite de requêtes atteinte, réessayez dans quelques instants.' }), {
            status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      }
    }

    if (!aiData) {
      return new Response(JSON.stringify({ error: 'AI generation failed', details: lastError.substring(0, 200) }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const content = aiData.choices?.[0]?.message?.content;
    if (!content) {
      return new Response(JSON.stringify({ error: 'Empty AI response' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    let simulation;
    try {
      let jsonStr = content.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      simulation = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('JSON parse error:', parseError, 'Content:', content.substring(0, 500));
      return new Response(JSON.stringify({ error: 'Failed to parse AI simulation response' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    simulation.generatedAt = new Date().toISOString();
    simulation.siteName = audit.siteName;
    simulation.originalScore = audit.globalScore;

    console.log('Simulation generated successfully');
    return new Response(JSON.stringify({ success: true, simulation }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Simulation error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
