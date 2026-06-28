import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const users = [
      { email: 'adminahlem@gmail.com', password: '12345678admin', role: 'admin', name: 'Admin Ahlem' },
      { email: 'rawia@auditpro.com', password: '12345678charge', role: 'charge_de_projet', name: 'Rawia' },
      { email: 'emna@auditpro.com', password: '12345678charge', role: 'charge_de_projet', name: 'Emna' },
      { email: 'rahma@auditpro.com', password: '12345678charge', role: 'charge_de_projet', name: 'Rahma' },
    ];

    const projectAssignments: Record<string, { url: string; site_name: string }[]> = {
      'rawia@auditpro.com': [
        { url: 'https://www.bnda-mali.com/fr', site_name: 'BNDA Mali' },
        { url: 'https://www.fatales.tn/', site_name: 'Fatales' },
      ],
      'emna@auditpro.com': [
        { url: 'https://www.ennakl.com/Fr/', site_name: 'Ennakl' },
        { url: 'https://www.attijarileasing.com.tn/', site_name: 'Attijari Leasing' },
      ],
      'rahma@auditpro.com': [
        { url: 'https://www.hydroprowatersolutions.com/Fr/', site_name: 'HydroPro Water Solutions' },
      ],
    };

    const results: any[] = [];

    for (const u of users) {
      const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
      const existing = existingUsers?.users?.find(eu => eu.email === u.email);

      let userId: string;

      if (existing) {
        userId = existing.id;
        results.push({ email: u.email, status: 'already exists', userId });
      } else {
        const { data, error } = await supabaseAdmin.auth.admin.createUser({
          email: u.email,
          password: u.password,
          email_confirm: true,
          user_metadata: { full_name: u.name },
        });

        if (error) {
          results.push({ email: u.email, status: 'error', error: error.message });
          continue;
        }
        userId = data.user.id;
        results.push({ email: u.email, status: 'created', userId });
      }

      // Assign role (upsert)
      await supabaseAdmin
        .from('user_roles')
        .upsert({ user_id: userId, role: u.role }, { onConflict: 'user_id,role' });

      // Create projects and assignments
      const projects = projectAssignments[u.email];
      if (projects) {
        for (const p of projects) {
          const { data: existingProject } = await supabaseAdmin
            .from('projects')
            .select('id')
            .eq('url', p.url)
            .maybeSingle();

          let projectId: string;
          if (existingProject) {
            projectId = existingProject.id;
          } else {
            const { data: client } = await supabaseAdmin
              .from('clients')
              .upsert({ name: p.site_name }, { onConflict: 'name' })
              .select('id')
              .single();

            const { data: newProject } = await supabaseAdmin
              .from('projects')
              .insert({ url: p.url, site_name: p.site_name, client_id: client!.id })
              .select('id')
              .single();
            projectId = newProject!.id;
          }

          await supabaseAdmin.from('project_assignments').upsert(
            { project_id: projectId, user_id: userId },
            { onConflict: 'project_id,user_id' }
          );
        }
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
