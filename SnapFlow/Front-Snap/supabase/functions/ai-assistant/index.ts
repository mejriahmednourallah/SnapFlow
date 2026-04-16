import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const { messages, userId } = await req.json();
    let apiUrl = "";
    let apiKey = "";
    let modelName = "";

    if (Deno.env.get("GROQ_API_KEY")) {
      apiUrl = "https://api.groq.com/openai/v1/chat/completions";
      apiKey = Deno.env.get("GROQ_API_KEY")!;
      modelName = "llama-3.3-70b-versatile"; // Excellent for large context and fast interactions
    } else if (Deno.env.get("GEMINI_API_KEY")) {
      apiUrl = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
      apiKey = Deno.env.get("GEMINI_API_KEY")!;
      modelName = "gemini-2.0-flash";
    } else {
      throw new Error("No AI provider configured (missing GROQ_API_KEY or GEMINI_API_KEY)");
    }

    // Fetch user context from DB
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    // Check user role
    const { data: roleData } = await sb
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();

    const isAdmin = roleData?.role === "admin";

    // Get projects the user has access to
    let projectContext = "";
    if (isAdmin) {
      const { data: projects } = await sb.from("projects").select("id, site_name, url");
      projectContext = `L'utilisateur est ADMINISTRATEUR. Il a accès à TOUS les projets.\nProjets:\n${(projects || []).map((p: any) => `- ${p.site_name} (${p.url})`).join("\n")}`;
    } else {
      const { data: assignments } = await sb
        .from("project_assignments")
        .select("project_id")
        .eq("user_id", userId);
      const projectIds = (assignments || []).map((a: any) => a.project_id);
      if (projectIds.length > 0) {
        const { data: projects } = await sb
          .from("projects")
          .select("id, site_name, url")
          .in("id", projectIds);
        projectContext = `L'utilisateur est CHARGÉ DE PROJET. Il a accès UNIQUEMENT aux projets suivants:\n${(projects || []).map((p: any) => `- ${p.site_name} (${p.url})`).join("\n")}\nNe répondez JAMAIS sur des projets auxquels il n'a pas accès.`;
      } else {
        projectContext = "L'utilisateur est CHARGÉ DE PROJET mais n'a aucun projet assigné.";
      }
    }

    // Get recent audits for accessible projects
    let auditContext = "";
    const auditQuery = sb
      .from("audits")
      .select("project_id, status, created_at, report_data")
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(10);

    if (!isAdmin) {
      const { data: assignments } = await sb
        .from("project_assignments")
        .select("project_id")
        .eq("user_id", userId);
      const ids = (assignments || []).map((a: any) => a.project_id);
      if (ids.length > 0) {
        auditQuery.in("project_id", ids);
      }
    }
    const { data: audits } = await auditQuery;
    if (audits && audits.length > 0) {
      // Get project names
      const projIds = [...new Set(audits.map((a: any) => a.project_id))];
      const { data: projs } = await sb.from("projects").select("id, site_name").in("id", projIds);
      const projMap = new Map((projs || []).map((p: any) => [p.id, p.site_name]));
      
      auditContext = `\n\nDerniers audits:\n${audits.map((a: any) => {
        const rd = a.report_data as any;
        const score = rd?.globalScore ?? rd?.scoreGlobal ?? "N/A";
        return `- ${projMap.get(a.project_id) || "?"}: Score ${score}/100 (${new Date(a.created_at).toLocaleDateString("fr-FR")})`;
      }).join("\n")}`;
    }

    // Get active schedules
    let scheduleContext = "";
    const schedQuery = sb
      .from("report_schedules")
      .select("project_id, report_type, frequency, next_run_at, is_active")
      .eq("is_active", true)
      .order("next_run_at", { ascending: true })
      .limit(10);

    const { data: scheds } = await schedQuery;
    if (scheds && scheds.length > 0) {
      const projIds = [...new Set(scheds.map((s: any) => s.project_id))];
      const { data: projs } = await sb.from("projects").select("id, site_name").in("id", projIds);
      const projMap = new Map((projs || []).map((p: any) => [p.id, p.site_name]));
      
      scheduleContext = `\n\nPlanifications actives:\n${scheds.map((s: any) => {
        return `- ${projMap.get(s.project_id) || "?"}: ${s.report_type} (${s.frequency}), prochaine: ${new Date(s.next_run_at).toLocaleDateString("fr-FR")}`;
      }).join("\n")}`;
    }

    const systemPrompt = `Tu es l'assistant IA de Snapflow, une plateforme d'audit et de suivi de projets web pour les professionnels et les entreprises.

Contexte utilisateur:
${projectContext}
${auditContext}
${scheduleContext}

Instructions:
- Réponds toujours en français
- Sois concis, professionnel et précis
- Si on te pose une question sur un projet auquel l'utilisateur n'a pas accès, refuse poliment
- Tu peux aider à analyser les scores d'audit, proposer des améliorations, expliquer les métriques
- Si tu ne connais pas la réponse, dis-le honnêtement
- Formate tes réponses de manière claire et lisible`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Limite de requêtes atteinte, réessayez dans quelques instants." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const t = await response.text();
      console.error("AI API error:", response.status, t);
      return new Response(
        JSON.stringify({ error: "Erreur du service IA" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("ai-assistant error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erreur inconnue" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
