import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // Verify caller is admin
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Non autorisé' }), { status: 401, headers: corsHeaders })
  }

  const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!)
  const { data: { user: caller } } = await anonClient.auth.getUser(authHeader.replace('Bearer ', ''))
  if (!caller) {
    return new Response(JSON.stringify({ error: 'Non autorisé' }), { status: 401, headers: corsHeaders })
  }

  const { data: isAdmin } = await supabase.rpc('has_role', { _user_id: caller.id, _role: 'admin' })
  if (!isAdmin) {
    return new Response(JSON.stringify({ error: 'Accès refusé' }), { status: 403, headers: corsHeaders })
  }

  const { user_id, role } = await req.json()

  // Upsert role
  const { error } = await supabase
    .from('user_roles')
    .upsert({ user_id, role }, { onConflict: 'user_id,role' })

  if (error) {
    // If changing role, delete old and insert new
    await supabase.from('user_roles').delete().eq('user_id', user_id)
    const { error: insertError } = await supabase.from('user_roles').insert({ user_id, role })
    if (insertError) {
      return new Response(JSON.stringify({ error: insertError.message }), { status: 400, headers: corsHeaders })
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
