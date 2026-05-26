import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const REDMINE_BASE = Deno.env.get("REDMINE_BASE_URL") || "https://maintenance.medianet.tn";
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const normalizeLogin = (value: unknown): string => String(value || "").trim().toLowerCase();

const encodeBasicAuth = (login: string, password: string): string => {
  const bytes = new TextEncoder().encode(`${login}:${password}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const randomPassword = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

const hashValue = async (value: string): Promise<string> => {
  const salt = Deno.env.get("REDMINE_LOGIN_RATE_LIMIT_SALT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "snapflow";
  const data = new TextEncoder().encode(`${salt}:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
};

const clientIp = (req: Request): string => {
  const forwarded = req.headers.get("x-forwarded-for") || "";
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "unknown";
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Méthode non autorisée" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let loginHash = "";
  let ipHash = "";

  const recordAttempt = async (
    success: boolean,
    reason: string,
    userId: string | null = null,
    redmineUserId: number | null = null
  ) => {
    if (!loginHash || !ipHash) return;
    await supabase.from("redmine_login_attempts").insert({
      login_hash: loginHash,
      ip_hash: ipHash,
      success,
      failure_reason: success ? null : reason,
    });
    await supabase.from("redmine_auth_events").insert({
      user_id: userId,
      redmine_user_id: redmineUserId,
      login_hash: loginHash,
      ip_hash: ipHash,
      event_type: success ? "redmine_login_success" : "redmine_login_failure",
      reason,
    });
  };

  try {
    const body = await req.json().catch(() => ({}));
    const login = String(body?.login || "").trim();
    const normalizedLogin = normalizeLogin(login);
    const password = String(body?.password || "");
    const redirectTo = typeof body?.redirect_to === "string" ? String(body.redirect_to) : undefined;

    loginHash = await hashValue(normalizedLogin);
    ipHash = await hashValue(clientIp(req));

    if (!login || !password) {
      await recordAttempt(false, "missing_credentials");
      return json({ error: "Identifiants invalides" }, 400);
    }

    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    const { count } = await supabase
      .from("redmine_login_attempts")
      .select("id", { count: "exact", head: true })
      .eq("login_hash", loginHash)
      .eq("ip_hash", ipHash)
      .eq("success", false)
      .gte("created_at", since);

    if ((count || 0) >= MAX_FAILURES) {
      await recordAttempt(false, "rate_limited");
      return json({ error: "Trop de tentatives. Réessayez plus tard." }, 429);
    }

    if (normalizedLogin.includes("@")) {
      const { data: existingProfile } = await supabase
        .from("profiles")
        .select("id")
        .ilike("email", normalizedLogin)
        .maybeSingle();

      if (existingProfile?.id) {
        const { data: linkedIdentity } = await supabase
          .from("redmine_user_identities")
          .select("user_id")
          .eq("user_id", existingProfile.id)
          .maybeSingle();

        if (!linkedIdentity) {
          await recordAttempt(false, "manual_account_exists", existingProfile.id);
          return json({ error: "Ce compte doit utiliser la connexion SnapFlow.", manual_account_exists: true }, 409);
        }
      }
    }

    const authHeader = `Basic ${encodeBasicAuth(login, password)}`;
    const redmineRes = await fetch(`${REDMINE_BASE}/users/current.json?include=memberships,groups`, {
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
    });

    if (!redmineRes.ok) {
      await recordAttempt(false, `redmine_http_${redmineRes.status}`);
      return json({ error: "Identifiants invalides" }, 401);
    }

    const redmineData = await redmineRes.json().catch(() => null);
    const redmineUser = redmineData?.user;
    const redmineUserId = Number(redmineUser?.id || 0);
    const redmineLogin = String(redmineUser?.login || login).trim();
    const redmineEmail = String(redmineUser?.mail || "").trim().toLowerCase();
    const displayName =
      [redmineUser?.firstname, redmineUser?.lastname].filter(Boolean).join(" ").trim() ||
      String(redmineUser?.name || redmineLogin).trim();
    const authEmail = redmineEmail || `redmine-${redmineUserId}@snapflow.local`;

    if (!redmineUserId || !redmineLogin) {
      await recordAttempt(false, "redmine_missing_identity");
      return json({ error: "Identifiants invalides" }, 401);
    }

    let userId: string | null = null;
    let sessionEmail = authEmail;

    const { data: existingIdentity } = await supabase
      .from("redmine_user_identities")
      .select("user_id")
      .eq("redmine_user_id", redmineUserId)
      .maybeSingle();

    if (existingIdentity?.user_id) {
      userId = existingIdentity.user_id;
      const { data: authUserData } = await supabase.auth.admin.getUserById(userId);
      sessionEmail = authUserData?.user?.email || authEmail;
    } else {
      const { data: profileByEmail } = await supabase
        .from("profiles")
        .select("id")
        .ilike("email", authEmail)
        .maybeSingle();

      if (profileByEmail?.id) {
        await recordAttempt(false, "manual_account_exists_after_redmine", profileByEmail.id, redmineUserId);
        return json({ error: "Ce compte doit utiliser la connexion SnapFlow.", manual_account_exists: true }, 409);
      }

      const { data: created, error: createError } = await supabase.auth.admin.createUser({
        email: authEmail,
        password: randomPassword(),
        email_confirm: true,
        user_metadata: {
          full_name: displayName,
          name: displayName,
          auth_provider: "redmine",
          redmine_user_id: redmineUserId,
          redmine_login: redmineLogin,
          redmine_display_name: displayName,
        },
      });

      if (createError || !created.user?.id) {
        await recordAttempt(false, "supabase_create_failed", null, redmineUserId);
        return json({ error: "Connexion indisponible pour le moment" }, 500);
      }

      userId = created.user.id;
      sessionEmail = created.user.email || authEmail;
    }

    const { data: currentAuthUser } = await supabase.auth.admin.getUserById(userId);
    const currentMetadata = currentAuthUser?.user?.user_metadata || {};
    await supabase.auth.admin.updateUserById(userId, {
      user_metadata: {
        ...currentMetadata,
        full_name: displayName,
        name: displayName,
        auth_provider: "redmine",
        redmine_user_id: redmineUserId,
        redmine_login: redmineLogin,
        redmine_display_name: displayName,
      },
    });

    await supabase.from("profiles").upsert({
      id: userId,
      email: sessionEmail,
      full_name: displayName,
    });

    const { data: existingRole } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (!existingRole?.role) {
      await supabase.from("user_roles").insert({ user_id: userId, role: "charge_de_projet" });
    }

    await supabase.from("redmine_user_identities").upsert(
      {
        user_id: userId,
        redmine_user_id: redmineUserId,
        redmine_login: redmineLogin,
        redmine_email: redmineEmail || null,
        redmine_display_name: displayName || null,
        last_login_at: new Date().toISOString(),
      },
      { onConflict: "redmine_user_id" }
    );

    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: sessionEmail,
      options: redirectTo ? { redirectTo } : undefined,
    });

    if (linkError) {
      await recordAttempt(false, "magic_link_failed", userId, redmineUserId);
      return json({ error: "Connexion indisponible pour le moment" }, 500);
    }

    await recordAttempt(true, "ok", userId, redmineUserId);

    return json({
      success: true,
      email: sessionEmail,
      token: linkData?.properties?.email_otp || null,
      action_link: linkData?.properties?.action_link || null,
      user_id: userId,
      redmine_user_id: redmineUserId,
      redmine_login: redmineLogin,
      redmine_display_name: displayName,
    });
  } catch (error) {
    console.error("[redmine-login] unexpected error", error instanceof Error ? error.message : String(error));
    await recordAttempt(false, "unexpected_error");
    return json({ error: "Connexion indisponible pour le moment" }, 500);
  }
});
