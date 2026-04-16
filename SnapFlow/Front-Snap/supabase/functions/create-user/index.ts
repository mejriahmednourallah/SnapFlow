import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
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

  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const anonClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user: caller }, error: callerError } = await anonClient.auth.getUser()
  console.log('Caller auth result:', caller?.id, callerError?.message)
  if (!caller) {
    return new Response(JSON.stringify({ error: 'Non autorisé' }), { status: 401, headers: corsHeaders })
  }

  const { data: isAdmin } = await supabase.rpc('has_role', { _user_id: caller.id, _role: 'admin' })
  if (!isAdmin) {
    return new Response(JSON.stringify({ error: 'Accès refusé' }), { status: 403, headers: corsHeaders })
  }

  const { email, password, full_name, role } = await req.json()
  console.log('Creating user:', email, 'role:', role, 'by admin:', caller.id)

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  })

  if (error) {
    console.error('Create user error:', error.message)
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 400, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    })
  }

  console.log('User created:', data.user.id, '- assigning role:', role)
  
  // Assign role
  const { error: roleError } = await supabase.from('user_roles').insert({ user_id: data.user.id, role })
  if (roleError) {
    console.error('Role assignment error:', roleError.message)
  }

  return new Response(JSON.stringify({ success: true, user_id: data.user.id }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
