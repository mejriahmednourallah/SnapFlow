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

    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { projectId } = await req.json();
    if (!projectId) {
      return new Response(JSON.stringify({ error: 'projectId is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Fetch project info (RLS ensures user has access)
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single();

    if (projectError || !project) {
      return new Response(JSON.stringify({ error: 'Project not found or access denied' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Create audit record with 'generating' status
    const { data: audit, error: auditError } = await supabase
      .from('audits')
      .insert({ project_id: projectId, status: 'generating' })
      .select()
      .single();

    if (auditError) {
      console.error('Audit insert error:', auditError);
      return new Response(JSON.stringify({ error: 'Failed to create audit record' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Fetch the website HTML
    let htmlContent = '';
    let fetchError = '';
    try {
      let url = project.url.trim();
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://${url}`;
      }
      console.log('Fetching URL:', url);
      const response = await fetch(url, {
        headers: { 'User-Agent': 'AuditPro Bot/1.0' },
        redirect: 'follow',
      });
      htmlContent = await response.text();
      if (htmlContent.length > 8000) {
        htmlContent = htmlContent.substring(0, 8000);
      }
      console.log('Fetched HTML length:', htmlContent.length);
    } catch (e) {
      console.error('Fetch error:', e);
      fetchError = e instanceof Error ? e.message : 'Failed to fetch website';
    }

    // Configure AI providers
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
        models: ['gemini-2.0-flash', 'gemini-2.0-flash-lite']
      });
    }

    if (providers.length === 0) {
      await supabase.from('audits').update({ status: 'error', error_message: 'No AI provider configured' }).eq('id', audit.id);
      return new Response(JSON.stringify({ error: 'Neither GROQ_API_KEY nor GEMINI_API_KEY are configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const systemPrompt = `Tu es un expert audit digital. Retourne UNIQUEMENT du JSON brut (pas de backticks). Structure:
{"globalScore":N,"maturityLevel":"Basique|Intermédiaire|Avancé","riskLevel":"high|medium|low","strategicSummary":"courte","positivePoints":["3 max"],"negativePoints":["3 max"],"opportunities":["2 max"],"criticalPoints":["2 max"],"sitemapUrl":"","sitemapFound":false,"pagesMeta":[],"imagesToOptimize":[],"newsItems":[],"axes":[{"id":"ID","name":"Nom","icon":"emoji","score":N,"maxScore":100,"description":"courte","findings":[{"id":"f1","title":"titre","description":"description détaillée du problème en 2-3 phrases","criticality":"high|medium|low","priority":"moyen-terme|long-terme","type":"bug|recommendation","recommendation":"recommandation actionnable détaillée en 2-3 phrases","risk":"description du risque ou manque à gagner si le problème n'est pas corrigé","annexes":["référence ou lien utile","norme ou bonne pratique applicable"]}]}]}
RÈGLES: 8 axes (functional,accessibility,performance,seo,content,ux-ui,eco-index,rgpd). 2-3 findings/axe. Les descriptions, recommandations et risques doivent être détaillés et actionnables (2-3 phrases chacun). Les annexes sont des références utiles (normes, bonnes pratiques, liens). pagesMeta/imagesToOptimize/newsItems: tableaux VIDES. JSON compact.`;

    const userPrompt = fetchError
      ? `Audit rapide du site "${project.site_name}" (${project.url}). Erreur fetch: ${fetchError}. Génère un JSON compact.`
      : `Audit rapide du site "${project.site_name}" (${project.url}). HTML tronqué:\n${htmlContent.substring(0, 4000)}\nJSON compact uniquement.`;

    console.log('Calling AI gateway...');
    
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
            temperature: 0.1,
            max_tokens: 8000,
          }),
        });

        if (aiResponse.ok) {
          aiData = await aiResponse.json();
          break outerLoop;
        }

        lastError = await aiResponse.text();
        console.error(`Model ${model} failed (${aiResponse.status}):`, lastError.substring(0, 200));
        
        if (aiResponse.status === 429) {
          await new Promise(r => setTimeout(r, 2000));
          continue; // retry next model or provider
        }
      }
    }

    if (!aiData) {
      await supabase.from('audits').update({ status: 'error', error_message: 'AI error' }).eq('id', audit.id);
      return new Response(JSON.stringify({ error: 'AI generation failed', details: lastError }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const content = aiData.choices?.[0]?.message?.content;
    
    if (!content) {
      await supabase.from('audits').update({ status: 'error', error_message: 'Empty AI response' }).eq('id', audit.id);
      return new Response(JSON.stringify({ error: 'Empty AI response' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Parse JSON from AI response
    let reportData;
    try {
      let jsonStr = content.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      reportData = JSON.parse(jsonStr);
    } catch (parseError) {
      // Try to salvage truncated JSON by closing open structures
      console.error('JSON parse error, attempting repair...', 'Content length:', content.length);
      try {
        let jsonStr = content.trim();
        if (jsonStr.startsWith('```')) {
          jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }
        // Truncate to last complete object/array and close remaining brackets
        const lastValidComma = Math.max(jsonStr.lastIndexOf('},'), jsonStr.lastIndexOf('],'));
        if (lastValidComma > 0) {
          jsonStr = jsonStr.substring(0, lastValidComma + 1);
          // Count open brackets and close them
          const opens = (jsonStr.match(/\[/g) || []).length - (jsonStr.match(/\]/g) || []).length;
          const openBraces = (jsonStr.match(/\{/g) || []).length - (jsonStr.match(/\}/g) || []).length;
          jsonStr += ']'.repeat(Math.max(0, opens)) + '}'.repeat(Math.max(0, openBraces));
          reportData = JSON.parse(jsonStr);
          console.log('JSON repair succeeded');
        } else {
          throw parseError;
        }
      } catch (repairError) {
        console.error('JSON repair also failed:', repairError);
        await supabase.from('audits').update({ status: 'error', error_message: 'Failed to parse AI response' }).eq('id', audit.id);
        return new Response(JSON.stringify({ error: 'Failed to parse AI response' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Add metadata
    reportData.id = audit.id;
    reportData.url = project.url;
    reportData.siteName = project.site_name;
    reportData.date = new Date().toISOString().split('T')[0];

    // Update audit record
    const { error: updateError } = await supabase
      .from('audits')
      .update({ status: 'completed', report_data: reportData, updated_at: new Date().toISOString() })
      .eq('id', audit.id);

    if (updateError) {
      console.error('Update error:', updateError);
    }

    // === AUTO NOTIFICATIONS ===
    // Notify the user who triggered the audit
    try {
      const score = reportData.globalScore ?? reportData.scoreGlobal ?? null;
      const scoreText = score !== null ? ` — Score: ${score}/100` : '';
      await serviceClient.from('notifications').insert({
        user_id: user.id,
        title: 'Audit terminé',
        message: `Le rapport d'audit pour "${project.site_name}" a été généré avec succès${scoreText}.`,
        type: 'success',
        category: 'audit',
        reference_id: audit.id,
        reference_type: 'audit',
      });

      // Also notify all assigned users (except the triggering user)
      const { data: assignments } = await serviceClient
        .from('project_assignments')
        .select('user_id')
        .eq('project_id', projectId);

      if (assignments) {
        const otherUsers = assignments.filter(a => a.user_id !== user.id);
        if (otherUsers.length > 0) {
          await serviceClient.from('notifications').insert(
            otherUsers.map(a => ({
              user_id: a.user_id,
              title: 'Nouvel audit disponible',
              message: `Un nouveau rapport d'audit est disponible pour "${project.site_name}"${scoreText}.`,
              type: 'info',
              category: 'audit',
              reference_id: audit.id,
              reference_type: 'audit',
            }))
          );
        }
      }
    } catch (notifErr) {
      console.error('Notification error (non-blocking):', notifErr);
    }

    console.log('Audit generated successfully for', project.site_name);
    return new Response(JSON.stringify({ success: true, audit: reportData }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Generate audit error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

