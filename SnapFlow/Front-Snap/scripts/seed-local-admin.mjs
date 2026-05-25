import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const redmineBaseUrl = process.env.REDMINE_BASE_URL || null;
const hasRedmineApiKey = Boolean(process.env.REDMINE_API_KEY);
const hasRedmineRateLimitSalt = Boolean(process.env.REDMINE_LOGIN_RATE_LIMIT_SALT);

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontDir = path.resolve(scriptDir, '..');
const loginFile = path.join(frontDir, 'supabase', '.local-login.json');

const randomToken = randomBytes(5).toString('hex');
const email = `local-admin+${randomToken}@snapflow.local`;
const password = `SnapFlow-${randomBytes(12).toString('base64url')}!9`;
const fullName = `Local Admin ${randomToken}`;

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function createAdminUser() {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (error) throw new Error(`Failed to create local admin: ${error.message}`);
  if (!data.user?.id) throw new Error('Supabase did not return a user id.');

  return data.user.id;
}

async function grantAdminRole(userId) {
  const { error } = await supabase
    .from('user_roles')
    .upsert({ user_id: userId, role: 'admin' }, { onConflict: 'user_id,role' });

  if (error) throw new Error(`Failed to grant admin role: ${error.message}`);
}

async function createDemoProject(userId) {
  const siteName = `Local Demo ${randomToken}`;
  const siteUrl = 'https://example.com';

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .insert({ site_name: siteName, url: siteUrl })
    .select('id, site_name, url')
    .single();

  if (projectError) throw new Error(`Failed to create demo project: ${projectError.message}`);

  const { error: assignmentError } = await supabase
    .from('project_assignments')
    .upsert({ project_id: project.id, user_id: userId }, { onConflict: 'project_id,user_id' });

  if (assignmentError) {
    throw new Error(`Failed to assign demo project: ${assignmentError.message}`);
  }

  return project;
}

async function writeLoginFile(payload) {
  await mkdir(path.dirname(loginFile), { recursive: true });
  await writeFile(loginFile, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
}

try {
  const userId = await createAdminUser();
  await grantAdminRole(userId);
  const project = await createDemoProject(userId);

  const payload = {
    generated_at: new Date().toISOString(),
    supabase_url: supabaseUrl,
    email,
    password,
    role: 'admin',
    user_id: userId,
    demo_project: project,
    redmine: {
      base_url: redmineBaseUrl,
      admin_api_key_configured: hasRedmineApiKey,
      login_rate_limit_salt_configured: hasRedmineRateLimitSalt,
    },
  };

  await writeLoginFile(payload);

  console.log('');
  console.log('Local admin ready');
  console.log(`Email    : ${email}`);
  console.log(`Password : ${password}`);
  console.log(`Role     : admin`);
  console.log(`Project  : ${project.site_name} (${project.url})`);
  console.log(`Redmine  : ${redmineBaseUrl || 'not configured'} (${hasRedmineApiKey ? 'API key configured' : 'API key missing'})`);
  console.log(`Saved    : ${loginFile}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
