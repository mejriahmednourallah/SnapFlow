import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const REDMINE_BASE = "https://maintenance.medianet.tn";
const REDMINE_KEY = Deno.env.get("REDMINE_API_KEY") || "";

const previewText = (value: string, maxLength = 1200): string => {
  if (!value) return "";
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
};

if (!REDMINE_KEY) {
  console.warn("[fetch-redmine] REDMINE_API_KEY is empty; create_issue calls will fail against Redmine.");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { type } = body;

    // Verify auth (with a constrained bypass for cron bulk sync)
    const authHeader = req.headers.get("Authorization");
    const apiKeyHeader = req.headers.get("apikey");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const isBulkSyncCronRequest = type === "sync_account_projects_bulk";
    const isServiceRoleApiKey = Boolean(apiKeyHeader && serviceRoleKey && apiKeyHeader === serviceRoleKey);

    let callerClaims: { sub: string; role: string } | null = null;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const decodeJwtPayload = (jwt: string): Record<string, unknown> | null => {
      try {
        const parts = jwt.split(".");
        if (parts.length !== 3) return null;

        const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
        const json = atob(padded);
        return JSON.parse(json) as Record<string, unknown>;
      } catch {
        return null;
      }
    };

    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      if (serviceRoleKey && token === serviceRoleKey) {
        // Allow direct service-role bearer key (common in pg_net cron calls).
        callerClaims = { sub: "service_role", role: "service_role" };
      } else {
        const supabase = createClient(supabaseUrl, supabaseKey, {
          global: { headers: { Authorization: authHeader } },
        });

        const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
        let tokenRole = String(claimsData?.claims?.role || "");
        let tokenSub =
          typeof claimsData?.claims?.sub === "string" && claimsData.claims.sub.length > 0
            ? String(claimsData.claims.sub)
            : tokenRole === "service_role"
              ? "service_role"
              : "";

        // pg_net cron requests may carry valid service-role JWTs that fail getClaims in this path.
        // For bulk sync only, accept decoded service_role payload as a constrained fallback.
        if (claimsError || !tokenRole || !tokenSub) {
          const decodedPayload = decodeJwtPayload(token);
          const decodedRole = String(decodedPayload?.role || "");
          const decodedSub =
            typeof decodedPayload?.sub === "string" && decodedPayload.sub.length > 0
              ? String(decodedPayload.sub)
              : decodedRole === "service_role"
                ? "service_role"
                : "";

          const allowCronFallback = isBulkSyncCronRequest && decodedRole === "service_role" && Boolean(decodedSub);
          if (allowCronFallback) {
            console.warn("[fetch-redmine] Using decoded JWT fallback for cron bulk sync auth.");
            tokenRole = decodedRole;
            tokenSub = decodedSub;
          }
        }

        if (claimsError || !tokenRole || !tokenSub) {
          return new Response(JSON.stringify({ error: "Non autorisé" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        callerClaims = {
          sub: tokenSub,
          role: tokenRole,
        };
      }
    } else if (isBulkSyncCronRequest && isServiceRoleApiKey) {
      console.log("[fetch-redmine] Cron bulk sync accepted with service-role apikey.");
      callerClaims = { sub: "cron", role: "service_role" };
    } else {
      return new Response(JSON.stringify({ error: "Non autorisé" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Helper to safely parse JSON from Redmine responses
    const safeJson = async (res: Response, fallback: any = {}) => {
      if (!res.ok) {
        console.error(`Redmine HTTP error: ${res.status} ${res.statusText} for ${res.url}`);
        return fallback;
      }
      const text = await res.text();
      if (!text || text.trim() === '') {
        console.error('Redmine returned empty response for', res.url);
        return fallback;
      }
      try {
        return JSON.parse(text);
      } catch (e) {
        console.error('Redmine JSON parse error:', e.message, 'body preview:', text.substring(0, 200));
        return fallback;
      }
    };

    // Helper to extract Redmine project identifier from URL
    // Example: "https://maintenance.medianet.tn/projects/my-project" → "my-project"
    const extractRedmineProjectId = (url: string): string | null => {
      const match = url?.match(/\/projects\/([a-zA-Z0-9_-]+)/);
      return match ? match[1] : null;
    };

    const isRedmineProjectUrl = (url: string | null | undefined): boolean => {
      const raw = String(url || "").trim();
      if (!raw) return false;
      try {
        const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
        const host = parsed.hostname.toLowerCase();
        const path = parsed.pathname.toLowerCase();
        const isKnownRedmineHost = host.includes("redmine") || host === "maintenance.medianet.tn";
        return isKnownRedmineHost && /^\/projects\/[^/]+(?:\/.*)?$/.test(path);
      } catch {
        const lowered = raw.toLowerCase();
        return (
          (lowered.includes("redmine") || lowered.includes("maintenance.medianet.tn")) &&
          /\/projects\/[a-z0-9_-]+(?:\/.*)?$/.test(lowered)
        );
      }
    };

    // Helper to normalize identity (email or name) for Redmine matching.
    // Handles: trim, lowercase, accent removal (NFD), and space normalization.
    const normalizeIdentity = (value: unknown): string => {
      if (value === null || value === undefined) return "";
      const asString = typeof value === "string" ? value : String(value);
      const normalized = asString
        .trim()
        .toLowerCase()
        .normalize("NFD") // Decompose accents
        .replace(/[\u0300-\u036f]/g, "") // Remove diacritical marks
        .replace(/\s+/g, " "); // Normalize multiple spaces to single space
      
      if (asString !== normalized) {
        console.log("[normalizeIdentity] Normalization applied:", {
          original: asString,
          normalized,
        });
      }
      
      return normalized;
    };

    const isAccountRole = (role: any): boolean => {
      const roleName = normalizeIdentity(role?.name);
      const isAccount = roleName.includes("account") || role?.id === 9 || role?.id === 10;
      console.log("[isAccountRole] Role check:", {
        rawRoleName: role?.name,
        normalizedRoleName: roleName,
        roleId: role?.id,
        isAccountRole: isAccount,
        reasons: {
          nameIncludes: roleName.includes("account"),
          idIs9: role?.id === 9,
          idIs10: role?.id === 10,
        },
      });
      return isAccount;
    };

    const isAccountFieldName = (fieldName: unknown): boolean => {
      const normalizedName = normalizeIdentity(fieldName);
      const isAccount =
        normalizedName.includes("account") ||
        normalizedName.includes("charge") ||
        normalizedName.includes("owner") ||
        normalizedName.includes("proprietaire");
      console.log("[isAccountFieldName] Field name check:", {
        rawFieldName: fieldName,
        normalizedFieldName: normalizedName,
        isAccountField: isAccount,
        reasons: {
          includesAccount: normalizedName.includes("account"),
          includesCharge: normalizedName.includes("charge"),
          includesOwner: normalizedName.includes("owner"),
          includesPropietaire: normalizedName.includes("proprietaire"),
        },
      });
      return isAccount;
    };

    // Redmine custom field values can be string/array/object payloads depending on field type.
    const extractIdentityCandidates = (input: unknown): string[] => {
      const values: string[] = [];

      const visit = (node: unknown): void => {
        if (node === null || node === undefined) return;

        if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
          const normalized = normalizeIdentity(node);
          if (normalized) values.push(normalized);
          return;
        }

        if (Array.isArray(node)) {
          for (const item of node) visit(item);
          return;
        }

        if (typeof node === "object") {
          const obj = node as Record<string, unknown>;

          // Common Redmine payload shapes: {name}, {value}, {label}, {mail}
          for (const key of ["name", "value", "label", "mail", "email", "firstname", "lastname"]) {
            if (key in obj) visit(obj[key]);
          }

          // Fallback: walk all values to avoid missing custom structures.
          for (const val of Object.values(obj)) visit(val);
        }
      };

      visit(input);
      return Array.from(new Set(values));
    };

    const extractDisplayCandidates = (input: unknown): string[] => {
      const values: string[] = [];

      const visit = (node: unknown): void => {
        if (node === null || node === undefined) return;

        if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
          const displayValue = String(node).trim();
          if (displayValue) values.push(displayValue);
          return;
        }

        if (Array.isArray(node)) {
          for (const item of node) visit(item);
          return;
        }

        if (typeof node === "object") {
          const obj = node as Record<string, unknown>;
          for (const key of ["name", "value", "label", "mail", "email", "firstname", "lastname"]) {
            if (key in obj) visit(obj[key]);
          }
          for (const value of Object.values(obj)) visit(value);
        }
      };

      visit(input);
      return Array.from(new Set(values));
    };

    const mapWithConcurrency = async <T, R>(
      items: T[],
      concurrency: number,
      worker: (item: T) => Promise<R>
    ): Promise<R[]> => {
      if (items.length === 0) return [];

      const results: R[] = new Array(items.length);
      let index = 0;

      const runWorker = async (): Promise<void> => {
        while (index < items.length) {
          const currentIndex = index;
          index += 1;
          results[currentIndex] = await worker(items[currentIndex]);
        }
      };

      const workerCount = Math.max(1, Math.min(concurrency, items.length));
      await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
      return results;
    };

    // Helper to fetch project account information from Redmine
    // Returns: { memberships, customFields, accountMembers, accountFields }
    const fetchProjectAccountInfo = async (identifier: string) => {
      try {
        console.log("[fetchProjectAccountInfo] Fetching for identifier:", identifier);

        const projRes = await fetch(
          `${REDMINE_BASE}/projects/${identifier}.json?key=${REDMINE_KEY}&include=custom_fields`
        );
        const projData = await safeJson(projRes, { project: null });

        const membersRes = await fetch(
          `${REDMINE_BASE}/projects/${identifier}/memberships.json?key=${REDMINE_KEY}&limit=100`
        );
        const membersData = await safeJson(membersRes, { memberships: [] });

        if (!projData.project) {
          console.warn("[fetchProjectAccountInfo] Project not found for identifier:", identifier);
          return { memberships: [], customFields: [], accountMembers: [], accountFields: [] };
        }

        const memberships = membersData.memberships || [];
        const customFields = projData.project.custom_fields || [];

        console.log("[fetchProjectAccountInfo] Raw data for identifier:", {
          identifier,
          totalMemberships: memberships.length,
          totalCustomFields: customFields.length,
          membershipsDetail: memberships.map((m: any) => ({
            id: m.id,
            userName: m.user?.name,
            roles: m.roles?.map((r: any) => ({ id: r.id, name: r.name })),
          })),
          customFieldsDetail: customFields.map((cf: any) => ({
            id: cf.id,
            name: cf.name,
            value: cf.value,
          })),
        });

        // Strategy 1: Filter memberships for Account-like roles
        const accountMembers = memberships.filter((m: any) => {
          const hasAccountRole = m.roles && m.roles.some((r: any) => isAccountRole(r));
          console.log("[fetchProjectAccountInfo] Membership filter check:", {
            memberName: m.user?.name,
            roles: m.roles?.map((r: any) => ({ id: r.id, name: r.name })),
            hasAccountRole,
          });
          return hasAccountRole;
        });

        // Strategy 2: Filter custom fields for account-like field names
        const accountFields = customFields.filter((cf: any) => {
          const isAccount = isAccountFieldName(cf.name);
          console.log("[fetchProjectAccountInfo] Custom field filter check:", {
            fieldName: cf.name,
            fieldValue: cf.value,
            isAccountField: isAccount,
          });
          return isAccount;
        });

        console.log("[fetchProjectAccountInfo] Filtered results for identifier:", {
          identifier,
          accountMembersCount: accountMembers.length,
          accountFieldsCount: accountFields.length,
        });

        return { memberships, customFields, accountMembers, accountFields };
      } catch (e) {
        console.error(`[fetchProjectAccountInfo] Error fetching ${identifier}:`, e);
        return { memberships: [], customFields: [], accountMembers: [], accountFields: [] };
      }
    };

    // Helper to match user against Redmine Account data
    // Returns: { matched: boolean, matchType: 'membership' | 'custom_field' | 'none', count: number }
    const matchUserToAccount = (
      userEmail: string,
      userFullName: string,
      accountMembers: any[],
      accountFields: any[]
    ) => {
      const normEmail = normalizeIdentity(userEmail);
      const normName = normalizeIdentity(userFullName);
      const targets = [normEmail, normName].filter((v) => Boolean(v));

      console.log("[matchUserToAccount] Starting match with targets:", {
        normEmail,
        normName,
        targets,
        accountMembersCount: accountMembers.length,
        accountFieldsCount: accountFields.length,
      });

      if (targets.length === 0) {
        console.warn("[matchUserToAccount] No targets to match (empty email and name)");
        return { matched: false, matchType: 'none' as const, count: 0 };
      }

      // Try membership match
      console.log("[matchUserToAccount] Checking membership matches:");
      for (const member of accountMembers) {
        const memberName = normalizeIdentity(member.user?.name || "");
        console.log("[matchUserToAccount] Comparing member:", {
          rawName: member.user?.name,
          normalizedName: memberName,
          targetMatch: targets.includes(memberName),
        });
        if (memberName && targets.includes(memberName)) {
          console.log("[matchUserToAccount] MEMBERSHIP MATCH FOUND!");
          return { matched: true, matchType: 'membership' as const, count: 1 };
        }
      }

      // Try custom field match
      console.log("[matchUserToAccount] Checking custom field matches:");
      let customFieldMatches = 0;
      for (const field of accountFields) {
        const fieldValues = extractIdentityCandidates(field.value);
        const match = fieldValues.some((value) => targets.includes(value));
        console.log("[matchUserToAccount] Custom field check:", {
          fieldName: field.name,
          fieldValue: field.value,
          extractedValues: fieldValues,
          targetMatch: match,
        });
        if (match) {
          customFieldMatches += 1;
        }
      }

      if (customFieldMatches === 1) {
        console.log("[matchUserToAccount] CUSTOM FIELD MATCH FOUND (single match)!");
        return { matched: true, matchType: 'custom_field' as const, count: 1 };
      } else if (customFieldMatches > 1) {
        console.warn("[matchUserToAccount] AMBIGUOUS - multiple custom field matches:", customFieldMatches);
        return { matched: false, matchType: 'none' as const, count: customFieldMatches };
      }

      console.log("[matchUserToAccount] NO MATCH FOUND");
      return { matched: false, matchType: 'none' as const, count: 0 };
    };

    const getServiceClient = () => {
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      return createClient(supabaseUrl, serviceKey);
    };

    const isCallerAdmin = async (serviceClient: ReturnType<typeof createClient>) => {
      // Cron jobs call edge functions with service_role JWTs, which should bypass user_roles lookup.
      if (callerClaims?.role === "service_role") {
        return true;
      }

      const { data: callerRole } = await serviceClient
        .from("user_roles")
        .select("role")
        .eq("user_id", callerClaims!.sub)
        .maybeSingle();
      return callerRole?.role === "admin";
    };

    const fetchAllRedmineProjects = async () => {
      const allProjects: Array<{ id: number; name: string; identifier: string; homepage?: string }> = [];
      const limit = 100;
      let offset = 0;

      while (true) {
        const res = await fetch(
          `${REDMINE_BASE}/projects.json?key=${REDMINE_KEY}&limit=${limit}&offset=${offset}`
        );
        const data = await safeJson(res, { projects: [], total_count: 0 });
        const batch = data.projects || [];

        if (batch.length === 0) break;
        allProjects.push(...batch);

        offset += limit;
        if (data.total_count && offset >= data.total_count) break;
      }

      return allProjects;
    };

    const buildRedmineUserName = (user: any): string => {
      const first = String(user?.firstname || "").trim();
      const last = String(user?.lastname || "").trim();
      const full = `${first} ${last}`.trim();
      return full || String(user?.name || user?.login || `Redmine #${user?.id || ""}`).trim();
    };

    const normalizeAppRole = (role: unknown): "admin" | "charge_de_projet" | "testeur" | "rapporteur" => {
      const normalized = String(role || "").trim().toLowerCase();
      if (normalized === "admin") return "admin";
      if (normalized === "testeur") return "testeur";
      if (normalized === "rapporteur" || normalized === "reporter") return "rapporteur";
      if (normalized === "account" || normalized === "account 3") return "charge_de_projet";
      return "charge_de_projet";
    };

    const fetchAllRedmineUsers = async () => {
      if (!REDMINE_KEY) {
        throw new Error("REDMINE_API_KEY is required to fetch Redmine users.");
      }

      const allUsers: any[] = [];
      const limit = 100;
      let offset = 0;

      while (true) {
        const res = await fetch(`${REDMINE_BASE}/users.json?key=${REDMINE_KEY}&limit=${limit}&offset=${offset}&status=1`);
        const data = await safeJson(res, { users: [], total_count: 0 });
        const batch = Array.isArray(data?.users) ? data.users : [];
        if (batch.length === 0) break;

        allUsers.push(...batch);
        offset += limit;
        if (data.total_count && offset >= data.total_count) break;
      }

      return allUsers
        .map((user: any) => {
          const email = String(user?.mail || user?.email || "").trim();
          return {
            id: Number(user?.id || 0),
            login: String(user?.login || "").trim(),
            mail: email,
            email,
            firstname: String(user?.firstname || "").trim(),
            lastname: String(user?.lastname || "").trim(),
            name: buildRedmineUserName(user),
          };
        })
        .filter((user) => user.id > 0)
        .sort((a, b) => a.name.localeCompare(b.name));
    };

    const fetchRedmineUserDetail = async (redmineUserId: number) => {
      const res = await fetch(`${REDMINE_BASE}/users/${redmineUserId}.json?key=${REDMINE_KEY}&include=groups,memberships`);
      const data = await safeJson(res, { user: null });
      return data?.user || null;
    };

    const findAuthUserByEmail = async (serviceClient: ReturnType<typeof createClient>, email: string) => {
      const wanted = email.trim().toLowerCase();
      if (!wanted) return null;
      for (let page = 1; page <= 20; page += 1) {
        const { data, error } = await serviceClient.auth.admin.listUsers({ page, perPage: 100 });
        if (error) throw error;
        const users = data?.users || [];
        const found = users.find((authUser: any) => String(authUser?.email || "").toLowerCase() === wanted);
        if (found) return found;
        if (users.length < 100) break;
      }
      return null;
    };

    const importOrLinkRedmineUser = async (
      serviceClient: ReturnType<typeof createClient>,
      params: {
        redmineUserId: number;
        email: string;
        password?: string;
        role: "admin" | "charge_de_projet" | "testeur" | "rapporteur";
        fallbackName?: string;
      }
    ) => {
      const detail = await fetchRedmineUserDetail(params.redmineUserId);
      if (!detail?.id) {
        throw new Error("Utilisateur Redmine introuvable ou inaccessible.");
      }

      const redmineEmail = String(detail?.mail || detail?.email || "").trim();
      const email = String(params.email || redmineEmail || "").trim().toLowerCase();
      if (!email) {
        throw new Error("Email requis pour creer ou lier un utilisateur Redmine.");
      }

      const fullName = buildRedmineUserName(detail) || params.fallbackName || email;
      const redmineLogin = String(detail?.login || "").trim();
      let userId = "";

      const { data: existingProfile, error: profileLookupErr } = await serviceClient
        .from("profiles")
        .select("id")
        .eq("email", email)
        .maybeSingle();
      if (profileLookupErr) throw profileLookupErr;

      if (existingProfile?.id) {
        userId = existingProfile.id;
      } else {
        const existingAuthUser = await findAuthUserByEmail(serviceClient, email);
        if (existingAuthUser?.id) {
          userId = existingAuthUser.id;
        } else {
          if (!params.password || String(params.password).length < 6) {
            throw new Error("Mot de passe requis pour creer un nouvel utilisateur.");
          }
          const { data: created, error: createErr } = await serviceClient.auth.admin.createUser({
            email,
            password: params.password,
            email_confirm: true,
            user_metadata: { full_name: fullName, redmine_user_id: detail.id, redmine_login: redmineLogin },
          });
          if (createErr) throw createErr;
          userId = created.user?.id || "";
        }
      }

      if (!userId) {
        throw new Error("Impossible de creer ou retrouver l'utilisateur Supabase.");
      }

      const { error: profileErr } = await serviceClient
        .from("profiles")
        .upsert({ id: userId, email, full_name: fullName }, { onConflict: "id" });
      if (profileErr) throw profileErr;

      const { error: deleteRoleErr } = await serviceClient
        .from("user_roles")
        .delete()
        .eq("user_id", userId);
      if (deleteRoleErr) throw deleteRoleErr;

      const { error: roleErr } = await serviceClient
        .from("user_roles")
        .insert({ user_id: userId, role: params.role });
      if (roleErr) throw roleErr;

      const { error: deleteIdentityByUserErr } = await serviceClient
        .from("redmine_user_identities")
        .delete()
        .eq("user_id", userId);
      if (deleteIdentityByUserErr) throw deleteIdentityByUserErr;

      const { error: deleteIdentityByRedmineErr } = await serviceClient
        .from("redmine_user_identities")
        .delete()
        .eq("redmine_user_id", Number(detail.id));
      if (deleteIdentityByRedmineErr) throw deleteIdentityByRedmineErr;

      if (redmineLogin) {
        const { error: deleteIdentityByLoginErr } = await serviceClient
          .from("redmine_user_identities")
          .delete()
          .eq("redmine_login", redmineLogin);
        if (deleteIdentityByLoginErr) throw deleteIdentityByLoginErr;
      }

      const { error: identityErr } = await serviceClient
        .from("redmine_user_identities")
        .insert({
          user_id: userId,
          redmine_user_id: Number(detail.id),
          redmine_login: redmineLogin,
          redmine_email: redmineEmail || email,
          redmine_display_name: fullName,
          last_login_at: new Date().toISOString(),
        });
      if (identityErr) throw identityErr;

      return {
        user_id: userId,
        email,
        full_name: fullName,
        role: params.role,
        redmine_user_id: Number(detail.id),
        redmine_login: redmineLogin,
      };
    };

    const syncCachedAccountDataFromRedmine = async (serviceClient: ReturnType<typeof createClient>) => {
      const redmineProjects = await fetchAllRedmineProjects();
      const concurrency = 6;

      const cacheRows = await mapWithConcurrency(redmineProjects, concurrency, async (project) => {
        const { accountMembers, accountFields } = await fetchProjectAccountInfo(project.identifier);

        const identities = new Set<string>();
        const displayNames = new Set<string>();

        for (const member of accountMembers) {
          const rawName = String(member?.user?.name || "").trim();
          const normName = normalizeIdentity(rawName);
          if (rawName) displayNames.add(rawName);
          if (normName) identities.add(normName);
        }

        for (const field of accountFields) {
          for (const identity of extractIdentityCandidates(field?.value)) {
            identities.add(identity);
          }
          for (const display of extractDisplayCandidates(field?.value)) {
            displayNames.add(display);
          }
        }

        return {
          project_identifier: project.identifier,
          project_name: project.name,
          account_identities: Array.from(identities),
          account_display_names: Array.from(displayNames),
          has_account_data: identities.size > 0,
          fetched_at: new Date().toISOString(),
        };
      });

      if (cacheRows.length > 0) {
        const { error: cacheErr } = await serviceClient
          .from("redmine_project_account_cache")
          .upsert(cacheRows, { onConflict: "project_identifier" });

        if (cacheErr) throw cacheErr;
      }

      return {
        redmineProjectsCount: redmineProjects.length,
        cacheRows,
      };
    };

    const ensureCacheTableReady = async (serviceClient: ReturnType<typeof createClient>) => {
      const { error } = await serviceClient
        .from("redmine_project_account_cache")
        .select("project_identifier")
        .limit(1);

      if (!error) return;

      const errMsg = String((error as any)?.message || "");
      const errCode = String((error as any)?.code || "");
      const isMissingTable = errCode === "42P01" || /redmine_project_account_cache/i.test(errMsg);

      if (isMissingTable) {
        throw new Error(
          "Missing table redmine_project_account_cache. Run migration 20260327153000_add_redmine_account_cache.sql."
        );
      }

      throw new Error(`Cache table check failed: ${errMsg || "unknown error"}`);
    };

    const syncAssignmentsFromCache = async (
      serviceClient: ReturnType<typeof createClient>,
      targetUserId?: string
    ) => {
      const { data: profiles, error: profilesErr } = await serviceClient
        .from("profiles")
        .select("id, email, full_name")
        .order("created_at", { ascending: true });
      if (profilesErr) throw profilesErr;

      const relevantProfiles = (profiles || []).filter((profile) => {
        if (!targetUserId) return true;
        return profile.id === targetUserId;
      });

      const { data: projects, error: projectsErr } = await serviceClient
        .from("projects")
        .select("id, url, redmine_url");
      if (projectsErr) throw projectsErr;

      const { data: cacheRows, error: cacheErr } = await serviceClient
        .from("redmine_project_account_cache")
        .select("project_identifier, account_identities");
      if (cacheErr) throw cacheErr;

      const cacheByIdentifier = new Map<string, string[]>();
      for (const row of cacheRows || []) {
        cacheByIdentifier.set(row.project_identifier, row.account_identities || []);
      }

      const assignmentRows: Array<{ project_id: string; user_id: string }> = [];
      const details: Array<{ user_id: string; matched: number }> = [];

      for (const profile of relevantProfiles) {
        const targets = [normalizeIdentity(profile.email || ""), normalizeIdentity(profile.full_name || "")].filter(Boolean);
        let matched = 0;

        if (targets.length > 0) {
          for (const project of projects || []) {
            const identifier = extractRedmineProjectId((project as any).redmine_url || project.url || "");
            if (!identifier) continue;
            const cachedIdentities = cacheByIdentifier.get(identifier) || [];
            const isMatch = cachedIdentities.some((identity) => targets.includes(identity));
            if (!isMatch) continue;

            matched += 1;
            assignmentRows.push({
              project_id: project.id,
              user_id: profile.id,
            });
          }
        }

        details.push({ user_id: profile.id, matched });
      }

      if (assignmentRows.length > 0) {
        const { error: upsertErr } = await serviceClient
          .from("project_assignments")
          .upsert(assignmentRows, { onConflict: "project_id,user_id" });
        if (upsertErr) throw upsertErr;
      }

      return {
        assignmentRowsInserted: assignmentRows.length,
        details,
      };
    };

    const fetchRedmineUserGroups = async (redmineUserId: number): Promise<number[]> => {
      if (!REDMINE_KEY || !redmineUserId) return [];
      try {
        const res = await fetch(`${REDMINE_BASE}/users/${redmineUserId}.json?key=${REDMINE_KEY}&include=groups,memberships`);
        const data = await safeJson(res, { user: { groups: [] } });
        const groups = Array.isArray(data?.user?.groups) ? data.user.groups : [];
        return groups.map((group: any) => Number(group?.id || 0)).filter(Boolean);
      } catch (error) {
        console.warn("[fetch-redmine] Could not fetch Redmine user groups", {
          redmineUserId,
          message: error instanceof Error ? error.message : String(error),
        });
        return [];
      }
    };

    const syncMembershipProjectsForUser = async (
      serviceClient: ReturnType<typeof createClient>,
      userId: string,
      options: { identifiers?: string[]; dryRun?: boolean; revokeMissing?: boolean } = {}
    ) => {
      if (!REDMINE_KEY) {
        throw new Error("REDMINE_API_KEY is required for Redmine project import.");
      }

      const requestedIdentifiers = new Set(
        (options.identifiers || [])
          .map((identifier) => String(identifier || "").trim())
          .filter(Boolean)
      );
      const restrictToIdentifiers = requestedIdentifiers.size > 0;
      const dryRun = options.dryRun === true;

      const { data: identity, error: identityErr } = await serviceClient
        .from("redmine_user_identities")
        .select("redmine_user_id, redmine_login, redmine_display_name")
        .eq("user_id", userId)
        .maybeSingle();
      if (identityErr) throw identityErr;
      if (!identity?.redmine_user_id) {
        return {
          imported: 0,
          revoked: 0,
          projects: [],
          message: "Aucune identite Redmine n'est liee a cet utilisateur.",
          linked_redmine_user_id: null,
          matched_memberships_count: 0,
          matched_role_names: [],
          filtered_out_reason: "no_linked_redmine_identity",
        };
      }

      const redmineUserId = Number(identity.redmine_user_id);
      const redmineGroupIds = await fetchRedmineUserGroups(redmineUserId);
      const redmineProjects = await fetchAllRedmineProjects();

      const { data: mappings, error: mappingErr } = await serviceClient
        .from("redmine_role_mappings")
        .select("redmine_role_id, access_level, can_import");
      if (mappingErr) throw mappingErr;

      const mappingByRoleId = new Map<number, any>();
      for (const mapping of mappings || []) {
        mappingByRoleId.set(Number(mapping.redmine_role_id), mapping);
      }

      const { data: localProjects, error: localProjectsErr } = await serviceClient
        .from("projects")
        .select("id, url, redmine_url, redmine_identifier, audit_url_needs_review");
      if (localProjectsErr) throw localProjectsErr;

      const projectByIdentifier = new Map<string, any>();
      for (const project of localProjects || []) {
        const identifier =
          (project as any).redmine_identifier ||
          extractRedmineProjectId((project as any).redmine_url || "") ||
          extractRedmineProjectId((project as any).url || "");
        if (identifier) projectByIdentifier.set(identifier, project);
      }

      const { data: existingAssignments, error: existingAssignmentsErr } = await serviceClient
        .from("project_assignments")
        .select("project_id, source")
        .eq("user_id", userId);
      if (existingAssignmentsErr) throw existingAssignmentsErr;

      const existingAssignmentByProject = new Map<string, any>();
      for (const assignment of existingAssignments || []) {
        existingAssignmentByProject.set((assignment as any).project_id, assignment);
      }

      const matchedProjects: any[] = [];
      const assignmentRows: any[] = [];
      let matchedMembershipsCount = 0;
      const matchedRoleNames = new Set<string>();
      const filteredOutCounts: Record<string, number> = {};
      const markFiltered = (reason: string) => {
        filteredOutCounts[reason] = (filteredOutCounts[reason] || 0) + 1;
      };
      const concurrency = 6;

      await mapWithConcurrency(redmineProjects, concurrency, async (project) => {
        if (restrictToIdentifiers && !requestedIdentifiers.has(project.identifier)) return null;

        const { memberships } = await fetchProjectAccountInfo(project.identifier);
        const matchingMemberships = (memberships || []).filter((membership: any) => {
          const memberUserId = Number(membership?.user?.id || 0);
          const memberGroupId = Number(membership?.group?.id || 0);
          return memberUserId === redmineUserId || (memberGroupId && redmineGroupIds.includes(memberGroupId));
        });

        if (matchingMemberships.length === 0) {
          markFiltered("no_redmine_membership");
          return null;
        }
        matchedMembershipsCount += matchingMemberships.length;

        const roleIds = new Set<number>();
        const roleNames = new Set<string>();
        const groupIds = new Set<number>();

        for (const membership of matchingMemberships) {
          const memberGroupId = Number(membership?.group?.id || 0);
          if (memberGroupId) groupIds.add(memberGroupId);
          for (const role of membership?.roles || []) {
            const roleId = Number(role?.id || 0);
            if (roleId) roleIds.add(roleId);
            if (role?.name) roleNames.add(String(role.name));
          }
        }

        const importableRoleIds = Array.from(roleIds).filter((roleId) => {
          const mapping = mappingByRoleId.get(roleId);
          return mapping ? mapping.can_import !== false : false;
        });
        if (roleIds.size === 0) {
          markFiltered("no_redmine_roles");
          return null;
        }
        if (importableRoleIds.length === 0 && roleIds.size > 0) {
          markFiltered("role_mapping_blocked_import");
          return null;
        }
        for (const roleName of roleNames) matchedRoleNames.add(roleName);

        const accessLevel = Array.from(roleIds).some((roleId) => mappingByRoleId.get(roleId)?.access_level === "full")
          ? "full"
          : "read_only";

        const redmineUrl = `${REDMINE_BASE}/projects/${project.identifier}`;
        const homepage = String(project.homepage || "").trim();
        const siteUrl = homepage || redmineUrl;
        let localProject = projectByIdentifier.get(project.identifier);
        const roleIdList = Array.from(roleIds);
        const roleNameList = Array.from(roleNames);
        const groupIdList = Array.from(groupIds);
        const existingAssignment = localProject ? existingAssignmentByProject.get(localProject.id) : null;

        if (dryRun) {
          matchedProjects.push({
            id: project.id,
            local_project_id: localProject?.id || null,
            redmine_project_id: project.id,
            site_name: project.name,
            redmine_identifier: project.identifier,
            redmine_url: redmineUrl,
            url: siteUrl,
            existing: Boolean(localProject),
            access_level: accessLevel,
            assignment_source: existingAssignmentByProject.get(localProject?.id || "")?.source || null,
            redmine_role_ids: roleIdList,
            redmine_role_names: roleNameList,
            redmine_group_ids: groupIdList,
            audit_url_needs_review: !homepage,
            homepage: homepage || null,
          });
          return null;
        }

        if (!localProject) {
          const { data: created, error: createErr } = await serviceClient
            .from("projects")
            .insert({
              site_name: project.name,
              url: siteUrl,
              redmine_url: redmineUrl,
              redmine_identifier: project.identifier,
              audit_url_needs_review: !homepage,
            })
            .select("id, url, redmine_url, redmine_identifier, audit_url_needs_review")
            .single();
          if (createErr) throw createErr;
          localProject = created;
          projectByIdentifier.set(project.identifier, created);
        } else {
          const patch: Record<string, unknown> = {};
          if (!(localProject as any).redmine_identifier) patch.redmine_identifier = project.identifier;
          if (!(localProject as any).redmine_url) patch.redmine_url = redmineUrl;
          if (homepage && (!(localProject as any).url || isRedmineProjectUrl((localProject as any).url))) {
            patch.url = homepage;
            patch.audit_url_needs_review = false;
          }
          if (homepage && (localProject as any).audit_url_needs_review) patch.audit_url_needs_review = false;
          if (!homepage && !(localProject as any).audit_url_needs_review) patch.audit_url_needs_review = true;
          if (Object.keys(patch).length > 0) {
            await serviceClient.from("projects").update(patch).eq("id", localProject.id);
          }
        }

        if (existingAssignment?.source !== "manual") {
          assignmentRows.push({
            project_id: localProject.id,
            user_id: userId,
            source: "redmine",
            redmine_role_ids: roleIdList,
            redmine_role_names: roleNameList,
            redmine_group_ids: groupIdList,
            access_level: accessLevel,
            redmine_synced_at: new Date().toISOString(),
          });
        }

        matchedProjects.push({
          id: localProject.id,
          site_name: project.name,
          redmine_identifier: project.identifier,
          redmine_url: redmineUrl,
          url: siteUrl,
          access_level: existingAssignment?.source === "manual" ? "full" : accessLevel,
          assignment_source: existingAssignment?.source || "redmine",
          redmine_role_ids: roleIdList,
          redmine_role_names: roleNameList,
          redmine_group_ids: groupIdList,
          audit_url_needs_review: !homepage,
        });

        return null;
      });

      if (assignmentRows.length > 0) {
        const { error: upsertErr } = await serviceClient
          .from("project_assignments")
          .upsert(assignmentRows, { onConflict: "project_id,user_id" });
        if (upsertErr) throw upsertErr;
      }

      let staleProjectIds: string[] = [];
      const shouldRevokeMissing = options.revokeMissing !== false && !restrictToIdentifiers && !dryRun;
      if (shouldRevokeMissing) {
        const currentProjectIds = new Set(assignmentRows.map((row) => row.project_id));
        const { data: existingRedmineAssignments, error: existingErr } = await serviceClient
          .from("project_assignments")
          .select("project_id")
          .eq("user_id", userId)
          .eq("source", "redmine");
        if (existingErr) throw existingErr;

        staleProjectIds = (existingRedmineAssignments || [])
          .map((row: any) => row.project_id)
          .filter((projectId: string) => !currentProjectIds.has(projectId));

        if (staleProjectIds.length > 0) {
          const { error: deleteErr } = await serviceClient
            .from("project_assignments")
            .delete()
            .eq("user_id", userId)
            .eq("source", "redmine")
            .in("project_id", staleProjectIds);
          if (deleteErr) throw deleteErr;
        }
      }

      let filteredOutReason: string | null = null;
      if (matchedMembershipsCount === 0) {
        filteredOutReason = "no_redmine_memberships";
      } else if (matchedProjects.length === 0 && filteredOutCounts.role_mapping_blocked_import) {
        filteredOutReason = "role_mapping_blocked_import";
      } else if (matchedProjects.length === 0) {
        filteredOutReason = "no_importable_redmine_projects";
      }

      return {
        imported: assignmentRows.length,
        revoked: staleProjectIds.length,
        projects: matchedProjects,
        message: filteredOutReason === "no_redmine_memberships"
          ? "Aucune appartenance Redmine ne correspond a cet utilisateur ou a ses groupes."
          : filteredOutReason === "role_mapping_blocked_import"
            ? "Les appartenances Redmine existent, mais le parametrage des roles bloque l'import."
            : filteredOutReason === "no_importable_redmine_projects"
              ? "Aucun projet Redmine importable n'a ete trouve pour cet utilisateur."
              : null,
        linked_redmine_user_id: redmineUserId,
        matched_memberships_count: matchedMembershipsCount,
        matched_role_names: Array.from(matchedRoleNames),
        filtered_out_reason: filteredOutReason,
        filtered_out_counts: filteredOutCounts,
      };
    };

    if (type === "projects") {
      const serviceClient = getServiceClient();
      const callerIsAdmin = await isCallerAdmin(serviceClient);
      if (!callerIsAdmin) {
        return new Response(JSON.stringify({ error: "Admin access required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const projects = await fetchAllRedmineProjects();
      return new Response(JSON.stringify({ projects, total_count: projects.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (type === "users") {
      const serviceClient = getServiceClient();
      const callerIsAdmin = await isCallerAdmin(serviceClient);
      if (!callerIsAdmin) {
        return new Response(JSON.stringify({ error: "Admin access required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const users = await fetchAllRedmineUsers();
      console.log("Fetched Redmine users via admin API:", users.length);

      return new Response(JSON.stringify({ users }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (type === "import_redmine_user") {
      const serviceClient = getServiceClient();
      const callerIsAdmin = await isCallerAdmin(serviceClient);
      if (!callerIsAdmin) {
        return new Response(JSON.stringify({ error: "Admin access required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const redmineUserId = Number(body?.redmine_user_id || body?.redmineUserId || body?.redmine_user?.id || 0);
      if (!redmineUserId) {
        return new Response(JSON.stringify({ error: "redmine_user_id is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const imported = await importOrLinkRedmineUser(serviceClient, {
        redmineUserId,
        email: String(body?.email || body?.redmine_user?.email || body?.redmine_user?.mail || "").trim(),
        password: String(body?.password || ""),
        role: normalizeAppRole(body?.role),
        fallbackName: String(body?.full_name || body?.redmine_user?.name || "").trim(),
      });

      return new Response(JSON.stringify({ success: true, user: imported }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (type === "issues") {
      const { project_identifier, status_id, tracker_id, assigned_to_id, created_on_from, created_on_to, limit: issueLimit, offset: issueOffset } = body;

      // Require project_identifier — never return global issue list across all projects
      if (!project_identifier) {
        return new Response(JSON.stringify({ error: "project_identifier is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let url = `${REDMINE_BASE}/issues.json?key=${REDMINE_KEY}&limit=${issueLimit || 100}&offset=${issueOffset || 0}&sort=created_on:desc`;

      url += `&project_id=${project_identifier}`;
      // Default to status_id=* (all statuses including closed) — Redmine defaults to open-only without this
      url += `&status_id=${status_id || '*'}`;
      if (tracker_id) url += `&tracker_id=${tracker_id}`;
      if (assigned_to_id) url += `&assigned_to_id=${assigned_to_id}`;
      // Use Redmine's range operator (><) when both bounds are provided.
      // Appending two separate created_on= params causes Redmine to ignore the first one.
      if (created_on_from && created_on_to) {
        url += `&created_on=><${created_on_from}|${created_on_to}`;
      } else if (created_on_from) {
        url += `&created_on=>=${created_on_from}`;
      } else if (created_on_to) {
        url += `&created_on=<=${created_on_to}`;
      }

      const res = await fetch(url);
      const data = await safeJson(res, { issues: [] });
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch trackers for filter options
    if (type === "trackers") {
      const res = await fetch(`${REDMINE_BASE}/trackers.json?key=${REDMINE_KEY}`);
      const data = await safeJson(res, { trackers: [] });
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch issue statuses for filter options
    if (type === "issue_statuses") {
      const res = await fetch(`${REDMINE_BASE}/issue_statuses.json?key=${REDMINE_KEY}`);
      const data = await safeJson(res, { issue_statuses: [] });
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Search issues by subject to check for duplicates
    if (type === "search_issues") {
      const { project_identifier, subject } = body;
      try {
        let url = `${REDMINE_BASE}/issues.json?key=${REDMINE_KEY}&limit=10&sort=created_on:desc`;
        if (project_identifier) url += `&project_id=${project_identifier}`;
        url += `&subject=~${encodeURIComponent(subject)}`;
        const res = await fetch(url);
        const data = await res.json();
        // Always return 200 to avoid invoke error
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e) {
        // If search fails, return empty issues so creation can proceed
        return new Response(JSON.stringify({ issues: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Create an issue on Redmine
    if (type === "create_issue") {
      const { project_identifier, subject, description, tracker_id, priority_id, custom_fields, assigned_to_id } = body;

      console.log("[fetch-redmine][create_issue] incoming request", {
        project_identifier,
        subject,
        tracker_id: tracker_id ?? null,
        priority_id: priority_id ?? null,
        assigned_to_id: assigned_to_id ?? null,
        description_length: typeof description === "string" ? description.length : 0,
        custom_fields_count: Array.isArray(custom_fields) ? custom_fields.length : 0,
        has_redmine_key: Boolean(REDMINE_KEY),
      });

      // Resolve project_id to Redmine numeric id only (never local UUIDs).
      let projectId: number | null = null;
      let resolvedProjectIdentifier: string | null = null;
      let projectLookupStatus: number | null = null;
      let projectLookupPreview = "";

      const asTrimmedString = typeof project_identifier === "string" ? project_identifier.trim() : "";
      const isUuidLike = (value: string): boolean =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

      if (asTrimmedString && isUuidLike(asTrimmedString)) {
        const serviceClient = getServiceClient();
        const callerIsAdmin = await isCallerAdmin(serviceClient);
        if (!callerIsAdmin) {
          const { data: assignment } = await serviceClient
            .from("project_assignments")
            .select("access_level")
            .eq("project_id", asTrimmedString)
            .eq("user_id", callerClaims!.sub)
            .maybeSingle();

          if (assignment?.access_level !== "full") {
            return new Response(JSON.stringify({ error: "Accès insuffisant pour créer un ticket Redmine." }), {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }
      }

      if (typeof project_identifier === "number" || (asTrimmedString && !isNaN(Number(asTrimmedString)))) {
        projectId = Number(project_identifier);
      } else if (asTrimmedString) {
        // 1) Accept full Redmine project URL and extract identifier.
        let identifierCandidate = extractRedmineProjectId(asTrimmedString);

        // 2) If caller passed local DB UUID, map it to project.redmine_url/url then extract identifier.
        if (!identifierCandidate && isUuidLike(asTrimmedString)) {
          try {
            const serviceClient = getServiceClient();
            const { data: localProject, error: localProjectError } = await serviceClient
              .from("projects")
              .select("id, redmine_url, url")
              .eq("id", asTrimmedString)
              .maybeSingle();

            if (localProjectError) {
              console.warn("[fetch-redmine][create_issue] local project lookup failed", {
                local_project_id: asTrimmedString,
                error: localProjectError.message,
              });
            } else if (localProject) {
              identifierCandidate =
                extractRedmineProjectId(localProject.redmine_url || "") ||
                extractRedmineProjectId(localProject.url || "") ||
                null;

              console.log("[fetch-redmine][create_issue] local project mapped to Redmine identifier", {
                local_project_id: asTrimmedString,
                mapped_identifier: identifierCandidate,
                redmine_url: localProject.redmine_url || null,
              });
            }
          } catch (e) {
            console.error("[fetch-redmine][create_issue] local project UUID mapping error", e);
          }
        }

        // 3) Fallback: treat raw string as Redmine identifier.
        if (!identifierCandidate) {
          identifierCandidate = asTrimmedString;
        }
        resolvedProjectIdentifier = identifierCandidate;

        // 4) Resolve Redmine identifier to strict numeric project id.
        try {
          const projRes = await fetch(
            `${REDMINE_BASE}/projects/${identifierCandidate}.json?key=${REDMINE_KEY}`
          );
          projectLookupStatus = projRes.status;
          console.log("[fetch-redmine][create_issue] project lookup response", {
            project_identifier,
            identifier_candidate: identifierCandidate,
            status: projRes.status,
            ok: projRes.ok,
          });

          const lookupText = await projRes.text();
          projectLookupPreview = previewText(lookupText);

          if (projRes.ok) {
            try {
              const projData = lookupText ? JSON.parse(lookupText) : {};
              const resolvedProjectId = Number(projData?.project?.id);
              const resolvedIdentifier = typeof projData?.project?.identifier === "string"
                ? projData.project.identifier
                : null;

              if (resolvedIdentifier) {
                resolvedProjectIdentifier = resolvedIdentifier;
              }

              if (Number.isFinite(resolvedProjectId) && resolvedProjectId > 0) {
                projectId = resolvedProjectId;
              }
            } catch (parseErr) {
              console.warn("[fetch-redmine][create_issue] project lookup JSON parse failed", {
                project_identifier,
                parse_error: parseErr instanceof Error ? parseErr.message : String(parseErr),
                body_preview: projectLookupPreview,
              });
            }
          } else {
            console.warn("[fetch-redmine][create_issue] project lookup failed", {
              project_identifier,
              identifier_candidate: identifierCandidate,
              status: projRes.status,
              body_preview: projectLookupPreview,
            });
          }
        } catch (e) {
          console.error("[fetch-redmine][create_issue] error fetching project id", e);
        }
      }

      console.log("[fetch-redmine][create_issue] resolved project mapping", {
        incoming_project_identifier: project_identifier,
        resolved_project_identifier: resolvedProjectIdentifier,
        resolved_project_id: projectId,
      });

      if (!Number.isFinite(projectId) || (projectId as number) <= 0) {
        console.error("[fetch-redmine][create_issue] unresolved numeric project id", {
          project_identifier,
          projectLookupStatus,
          projectLookupPreview,
        });
        return new Response(JSON.stringify({
          error: "Projet Redmine introuvable ou inaccessible",
          details: {
            project_identifier,
            lookup_status: projectLookupStatus,
            lookup_response_preview: projectLookupPreview || null,
            reason: "Impossible de resoudre un project_id numerique pour Redmine",
          },
          response_preview: projectLookupPreview || null,
          redmine_status: projectLookupStatus,
          success: false,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Default custom fields required by this Redmine instance
      const defaultCustomFields = [
        { id: 18, value: [] },        // Type d'intervention
        { id: 12, value: "Client" },   // Source
        { id: 5, value: "" },          // CMS / Framework
        { id: 8, value: "DEV" },       // Equipe Affectée
        { id: 17, value: "" },         // Nature
      ];

      // Some Redmine setups require a numeric field for project id.
      // Detect any "ID PROJET" variants and enforce numeric value.
      // Strategy: try project-scoped endpoint first; if it returns no matching
      // fields, fall back to the global /custom_fields.json endpoint.
      const projectIdCustomFieldIds = new Set<number>();

      const isProjectIdFieldName = (fieldName: unknown): boolean => {
        const normalizedName = normalizeIdentity(fieldName);
        return (
          /id.*projet/.test(normalizedName) ||
          /projet.*id/.test(normalizedName) ||
          /id.*project/.test(normalizedName) ||
          /project.*id/.test(normalizedName) ||
          /identifiant.*projet/.test(normalizedName) ||
          /projet.*identifiant/.test(normalizedName) ||
          /numero.*projet/.test(normalizedName) ||
          /no.*projet/.test(normalizedName) ||
          /ref.*projet/.test(normalizedName)
        );
      };

      try {
        const projectLookupKey = resolvedProjectIdentifier || String(projectId);
        const projectMetaRes = await fetch(
          `${REDMINE_BASE}/projects/${projectLookupKey}.json?key=${REDMINE_KEY}&include=trackers,enabled_modules,issue_custom_fields,custom_fields`
        );
        const projectMeta = await safeJson(projectMetaRes, { project: null });
        const issueCustomFields = Array.isArray(projectMeta?.project?.issue_custom_fields)
          ? projectMeta.project.issue_custom_fields
          : [];
        const genericCustomFields = Array.isArray(projectMeta?.project?.custom_fields)
          ? projectMeta.project.custom_fields
          : [];
        const allProjectCustomFields = [...issueCustomFields, ...genericCustomFields];

        for (const field of allProjectCustomFields) {
          if (field?.id && isProjectIdFieldName(field?.name)) {
            projectIdCustomFieldIds.add(Number(field.id));
          }
        }

        console.log("[fetch-redmine][create_issue] project custom fields analysis (project-scoped)", {
          total_issue_custom_fields: issueCustomFields.length,
          total_generic_custom_fields: genericCustomFields.length,
          project_id_custom_field_ids: Array.from(projectIdCustomFieldIds),
          all_field_names: allProjectCustomFields.map((f: any) => ({ id: f?.id, name: f?.name })),
        });

        // Fallback: if the project-scoped endpoint didn't expose "ID PROJET"-like
        // fields, query the global /custom_fields.json (requires Redmine admin or
        // manager role — silently skipped on 403/404).
        if (projectIdCustomFieldIds.size === 0) {
          try {
            const globalCfRes = await fetch(
              `${REDMINE_BASE}/custom_fields.json?key=${REDMINE_KEY}`
            );
            if (globalCfRes.ok) {
              const globalCfData = await safeJson(globalCfRes, { custom_fields: [] });
              const globalFields: any[] = Array.isArray(globalCfData?.custom_fields)
                ? globalCfData.custom_fields
                : [];
              for (const field of globalFields) {
                if (field?.id && isProjectIdFieldName(field?.name)) {
                  projectIdCustomFieldIds.add(Number(field.id));
                }
              }
              console.log("[fetch-redmine][create_issue] global custom_fields.json fallback", {
                total_global_fields: globalFields.length,
                project_id_custom_field_ids_after_fallback: Array.from(projectIdCustomFieldIds),
                matching_fields: globalFields
                  .filter((f: any) => isProjectIdFieldName(f?.name))
                  .map((f: any) => ({ id: f?.id, name: f?.name })),
              });
            } else {
              console.warn("[fetch-redmine][create_issue] global custom_fields.json not accessible", {
                status: globalCfRes.status,
              });
            }
          } catch (fallbackErr) {
            console.warn("[fetch-redmine][create_issue] global custom_fields.json fetch failed", {
              error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
            });
          }
        }
      } catch (e) {
        console.warn("[fetch-redmine][create_issue] unable to inspect issue custom fields", {
          error: e instanceof Error ? e.message : String(e),
        });
      }

      const effectiveCustomFields = Array.isArray(custom_fields)
        ? [...custom_fields]
        : [...defaultCustomFields];

      if (projectIdCustomFieldIds.size > 0) {
        const projectValue = Number(projectId);

        for (let i = 0; i < effectiveCustomFields.length; i += 1) {
          const currentId = Number((effectiveCustomFields[i] as any)?.id);
          if (projectIdCustomFieldIds.has(currentId)) {
            effectiveCustomFields[i] = {
              ...(effectiveCustomFields[i] as any),
              value: projectValue,
            };
          }
        }

        for (const projectFieldId of projectIdCustomFieldIds) {
          const alreadyPresent = effectiveCustomFields.some((field: any) => Number(field?.id) === projectFieldId);
          if (!alreadyPresent) {
            effectiveCustomFields.push({ id: projectFieldId, value: projectValue });
          }
        }
      }

      const issueData: any = {
        issue: {
          project_id: projectId,
          subject,
          description: description || "",
          tracker_id: tracker_id ? Number(tracker_id) : 2, // Default to "Feature" tracker
          custom_fields: effectiveCustomFields,
        },
      };
      if (priority_id) issueData.issue.priority_id = Number(priority_id);
      if (assigned_to_id) issueData.issue.assigned_to_id = Number(assigned_to_id);

      console.log("Creating issue with payload:", JSON.stringify(issueData));
      console.log("[fetch-redmine][create_issue] payload type check", {
        project_id: issueData?.issue?.project_id,
        project_id_type: typeof issueData?.issue?.project_id,
        project_id_custom_field_ids: Array.from(projectIdCustomFieldIds),
        sent_custom_fields: Array.isArray(issueData?.issue?.custom_fields)
          ? issueData.issue.custom_fields.map((field: any) => ({ id: field?.id, value: field?.value, value_type: typeof field?.value }))
          : [],
      });

      const res = await fetch(`${REDMINE_BASE}/issues.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Redmine-API-Key": REDMINE_KEY,
        },
        body: JSON.stringify(issueData),
      });
      const responseText = await res.text();
      let data: unknown = null;
      try {
        data = responseText ? JSON.parse(responseText) : null;
      } catch (parseErr) {
        console.warn("[fetch-redmine][create_issue] Redmine returned non-JSON body", {
          status: res.status,
          statusText: res.statusText,
          parse_error: parseErr instanceof Error ? parseErr.message : String(parseErr),
          body_preview: previewText(responseText),
        });
      }

      console.log("[fetch-redmine][create_issue] Redmine response", {
        status: res.status,
        statusText: res.statusText,
        contentType: res.headers.get("content-type"),
        body_preview: previewText(responseText),
      });

      if (!res.ok) {
        console.error("[fetch-redmine][create_issue] issue creation rejected by Redmine", {
          project_identifier,
          projectId,
          subject,
          tracker_id: tracker_id ?? null,
          priority_id: priority_id ?? null,
          assigned_to_id: assigned_to_id ?? null,
          resolved_project_identifier: resolvedProjectIdentifier,
          project_id_custom_field_ids: Array.from(projectIdCustomFieldIds),
          response_preview: previewText(responseText),
          parsed_details: data,
        });

        // ── Retry-on-422: resolve numeric custom-field values ──────────────────
        // When Redmine rejects with "<field> n'est pas un nombre" it means a
        // required integer custom field was missing or non-numeric. We look up
        // the field by name and retry once with the corrected payload.
        if (res.status === 422 && typeof data === "object" && data !== null) {
          const errors422: string[] = Array.isArray((data as any).errors)
            ? (data as any).errors
            : [];
          const numericFieldErrors = errors422.filter((e: string) =>
            /n[''`]est pas un nombre/i.test(e) || /is not a number/i.test(e)
          );

          if (numericFieldErrors.length > 0) {
            // Extract the field label from the error string.
            // French: "ID PROJET n'est pas un nombre" → "ID PROJET"
            const extractFieldLabel = (msg: string): string | null => {
              const m =
                msg.match(/^(.+?)\s+n[''`]est pas/i) ||
                msg.match(/^(.+?)\s+is not/i);
              return m ? m[1].trim() : null;
            };
            const errorFieldLabels = numericFieldErrors
              .map(extractFieldLabel)
              .filter((n): n is string => Boolean(n));

            console.log("[fetch-redmine][create_issue] 422 numeric field errors — attempting patched retry", {
              errorFieldLabels,
              numericFieldErrors,
            });

            try {
              const lookupKey = resolvedProjectIdentifier || String(projectId);
              const cfRes = await fetch(
                `${REDMINE_BASE}/projects/${lookupKey}.json?key=${REDMINE_KEY}&include=issue_custom_fields`
              );
              const cfData = await safeJson(cfRes, { project: null });
              let allCFs: any[] = Array.isArray(cfData?.project?.issue_custom_fields)
                ? cfData.project.issue_custom_fields
                : [];

              // If project-scoped lookup didn't return any fields, try the global endpoint.
              if (allCFs.length === 0) {
                try {
                  const globalCfRes = await fetch(`${REDMINE_BASE}/custom_fields.json?key=${REDMINE_KEY}`);
                  if (globalCfRes.ok) {
                    const globalCfData = await safeJson(globalCfRes, { custom_fields: [] });
                    allCFs = Array.isArray(globalCfData?.custom_fields) ? globalCfData.custom_fields : [];
                    console.log("[fetch-redmine][create_issue] retry using global custom_fields fallback", {
                      total: allCFs.length,
                    });
                  }
                } catch { /* silently ignore */ }
              }

              const retryCustomFields: any[] = issueData.issue.custom_fields
                ? [...issueData.issue.custom_fields]
                : [...effectiveCustomFields];
              let patchCount = 0;

              for (const label of errorFieldLabels) {
                const normalizedLabel = normalizeIdentity(label);
                const matchedCF = allCFs.find(
                  (cf: any) => normalizeIdentity(cf?.name) === normalizedLabel
                );
                if (matchedCF?.id) {
                  const cfId = Number(matchedCF.id);
                  const numericValue = Number(projectId);
                  const existingIdx = retryCustomFields.findIndex(
                    (f: any) => Number(f?.id) === cfId
                  );
                  if (existingIdx >= 0) {
                    retryCustomFields[existingIdx] = {
                      ...retryCustomFields[existingIdx],
                      value: numericValue,
                    };
                  } else {
                    retryCustomFields.push({ id: cfId, value: numericValue });
                  }
                  patchCount += 1;
                  console.log("[fetch-redmine][create_issue] patched custom field for retry", {
                    label,
                    cfId,
                    numericValue,
                  });
                } else {
                  console.warn(
                    "[fetch-redmine][create_issue] could not resolve custom field id for error label",
                    {
                      label,
                      availableCFs: allCFs.map((cf: any) => ({ id: cf?.id, name: cf?.name })),
                    }
                  );
                }
              }

              if (patchCount > 0) {
                const retryPayload = {
                  issue: { ...issueData.issue, custom_fields: retryCustomFields },
                };
                console.log(
                  "[fetch-redmine][create_issue] retrying POST with patched custom fields",
                  JSON.stringify(retryPayload)
                );
                const retryRes = await fetch(`${REDMINE_BASE}/issues.json`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "X-Redmine-API-Key": REDMINE_KEY,
                  },
                  body: JSON.stringify(retryPayload),
                });
                const retryText = await retryRes.text();
                let retryData: unknown = null;
                try {
                  retryData = retryText ? JSON.parse(retryText) : null;
                } catch { /* non-JSON body */ }

                console.log("[fetch-redmine][create_issue] retry result", {
                  status: retryRes.status,
                  ok: retryRes.ok,
                  preview: previewText(retryText),
                });

                if (retryRes.ok) {
                  return new Response(
                    JSON.stringify({
                      ...(typeof retryData === "object" && retryData !== null ? retryData : {}),
                      success: true,
                      redmine_status: retryRes.status,
                    }),
                    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
                  );
                }

                // Retry also failed — surface the retry error.
                return new Response(
                  JSON.stringify({
                    error: `Erreur Redmine (${retryRes.status})`,
                    details: retryData ?? { raw_response: retryText },
                    response_preview: previewText(retryText),
                    redmine_status: retryRes.status,
                    success: false,
                  }),
                  { headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
              }
            } catch (retryErr) {
              console.error(
                "[fetch-redmine][create_issue] retry attempt threw an exception",
                { error: retryErr instanceof Error ? retryErr.message : String(retryErr) }
              );
            }
          }
        }
        // ── End retry-on-422 ───────────────────────────────────────────────────

        return new Response(JSON.stringify({
          error: `Erreur Redmine (${res.status})`,
          details: data ?? { raw_response: responseText },
          response_preview: previewText(responseText),
          redmine_status: res.status,
          success: false,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ ...(typeof data === "object" && data !== null ? data : {}), success: true, redmine_status: res.status }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch project details (description, etc.)
    if (type === "project_detail") {
      const { project_identifier } = body;

      // Fetch project details
      const projectRes = await fetch(
        `${REDMINE_BASE}/projects/${project_identifier}.json?key=${REDMINE_KEY}&include=trackers,enabled_modules,issue_custom_fields,custom_fields`
      );
      const projectData = await safeJson(projectRes, { project: null });

      // Use shared helper so all pages see consistent account membership/custom field data.
      const { memberships, accountMembers, accountFields } = await fetchProjectAccountInfo(project_identifier);

      // Merge memberships into the project object
      if (projectData.project) {
        projectData.project.memberships = memberships;
        projectData.project.account_memberships = accountMembers;
        projectData.project.account_fields = accountFields;
      }

      return new Response(JSON.stringify(projectData), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }// Fetch project documents with their attachments
    if (type === "documents") {
      const { project_identifier } = body;
      try {
        const res = await fetch(
          `${REDMINE_BASE}/projects/${project_identifier}/documents.json`,
          { headers: { "X-Redmine-API-Key": REDMINE_KEY, "Content-Type": "application/json" } }
        );
        console.log("Documents response status:", res.status, "for project:", project_identifier);
        if (!res.ok) {
          console.error("Documents fetch failed:", res.status, res.statusText);
          return new Response(JSON.stringify({ documents: [] }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const text = await res.text();
        if (!text || text.trim() === '') {
          return new Response(JSON.stringify({ documents: [] }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          console.error("Documents response is not valid JSON:", text.substring(0, 200));
          return new Response(JSON.stringify({ documents: [] }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        
        // Enrich each document with its attachments
        if (data.documents && data.documents.length > 0) {
          const enriched = await Promise.all(
            data.documents.map(async (doc: any) => {
              try {
                const detailRes = await fetch(
                  `${REDMINE_BASE}/documents/${doc.id}.json`,
                  { headers: { "X-Redmine-API-Key": REDMINE_KEY, "Content-Type": "application/json" } }
                );
                if (detailRes.ok) {
                  const detailText = await detailRes.text();
                  if (detailText && detailText.trim() !== '') {
                    try {
                      const detailData = JSON.parse(detailText);
                      return { ...doc, attachments: detailData.document?.attachments || [] };
                    } catch {
                      // ignore parse error
                    }
                  }
                }
              } catch (e) {
                console.error(`Error fetching attachments for doc ${doc.id}:`, e);
              }
              return { ...doc, attachments: [] };
            })
          );
          data.documents = enriched;
        }
        
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e) {
        console.error("Documents error:", e);

        return new Response(JSON.stringify({ documents: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Sync homepage URLs from Redmine to local projects table
    // After migration: url = actual site URL, redmine_url = Redmine project URL
    if (type === "sync_homepages") {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const serviceClient = createClient(supabaseUrl, serviceKey);

      // Get all local projects including the new redmine_url column
      const { data: projects, error: projErr } = await serviceClient.from('projects').select('id, site_name, url, redmine_url');
      if (projErr || !projects) {
        return new Response(JSON.stringify({ error: "Failed to fetch local projects", details: projErr }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const results: { id: string; site_name: string; old_url: string; new_url: string | null; status: string }[] = [];

      for (const proj of projects) {
        // Prefer redmine_url for identifier extraction; fall back to url (legacy projects where url = Redmine URL)
        const redmineSource: string = (proj as any).redmine_url || proj.url || '';
        const match = redmineSource.match(/\/projects\/([a-zA-Z0-9_-]+)/);
        if (!match) {
          results.push({ id: proj.id, site_name: proj.site_name, old_url: proj.url, new_url: null, status: 'skipped_no_redmine_url' });
          continue;
        }
        const identifier = match[1];
        const canonicalRedmineUrl = `${REDMINE_BASE}/projects/${identifier}`;
        try {
          const res = await fetch(`${REDMINE_BASE}/projects/${identifier}.json?key=${REDMINE_KEY}`);
          const data = await safeJson(res, { project: {} });
          const homepage = data.project?.homepage;
          const currentRedmineUrl: string | null = (proj as any).redmine_url;

          if (homepage && (homepage !== proj.url || !currentRedmineUrl)) {
            // Update url → homepage AND ensure redmine_url is set
            await serviceClient.from('projects').update({
              url: homepage,
              redmine_url: canonicalRedmineUrl,
            }).eq('id', proj.id);
            results.push({ id: proj.id, site_name: proj.site_name, old_url: proj.url, new_url: homepage, status: 'updated' });
          } else if (!homepage) {
            // No homepage in Redmine, but still ensure redmine_url is stored
            if (!currentRedmineUrl) {
              await serviceClient.from('projects').update({ redmine_url: canonicalRedmineUrl }).eq('id', proj.id);
            }
            results.push({ id: proj.id, site_name: proj.site_name, old_url: proj.url, new_url: null, status: 'no_homepage_in_redmine' });
          } else {
            // url is already the homepage; make sure redmine_url is persisted
            if (!currentRedmineUrl) {
              await serviceClient.from('projects').update({ redmine_url: canonicalRedmineUrl }).eq('id', proj.id);
            }
            results.push({ id: proj.id, site_name: proj.site_name, old_url: proj.url, new_url: homepage, status: 'already_correct' });
          }
        } catch (e) {
          results.push({ id: proj.id, site_name: proj.site_name, old_url: proj.url, new_url: null, status: `error: ${e.message}` });
        }
      }

      const updated = results.filter(r => r.status === 'updated').length;
      console.log(`Sync homepages: ${updated} updated out of ${projects.length} projects`);
      return new Response(JSON.stringify({ success: true, total: projects.length, updated, results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build/refresh Redmine account cache and synchronize project assignments in bulk (admin-only)
    if (type === "sync_account_projects_bulk") {
      const serviceClient = getServiceClient();
      const callerIsAdmin = await isCallerAdmin(serviceClient);
      if (!callerIsAdmin) {
        return new Response(JSON.stringify({ error: "Admin access required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const targetUserId = body?.user_id as string | undefined;

      await ensureCacheTableReady(serviceClient);

      const cacheSync = await syncCachedAccountDataFromRedmine(serviceClient);
      const assignmentSync = await syncAssignmentsFromCache(serviceClient, targetUserId);

      return new Response(
        JSON.stringify({
          success: true,
          mode: targetUserId ? "single-user" : "bulk",
          user_id: targetUserId || null,
          redmine_projects_processed: cacheSync.redmineProjectsCount,
          cache_rows_upserted: cacheSync.cacheRows.length,
          assignment_rows_upserted: assignmentSync.assignmentRowsInserted,
          assignment_details: assignmentSync.details,
          synced_at: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Fast user-specific lookup from cached Redmine account mappings
    if (type === "get_cached_redmine_projects_for_user") {
      const serviceClient = getServiceClient();
      const requestedUserId = (body?.user_id as string | undefined) || callerClaims!.sub;
      const callerIsAdmin = await isCallerAdmin(serviceClient);

      await ensureCacheTableReady(serviceClient);

      if (requestedUserId !== callerClaims!.sub && !callerIsAdmin) {
        return new Response(JSON.stringify({ error: "Admin access required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: profile, error: profileErr } = await serviceClient
        .from("profiles")
        .select("id, email, full_name")
        .eq("id", requestedUserId)
        .maybeSingle();

      if (profileErr || !profile) {
        return new Response(JSON.stringify({ error: "User not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const targets = [normalizeIdentity(profile.email || ""), normalizeIdentity(profile.full_name || "")].filter(Boolean);

      const { data: cacheRows, error: cacheErr } = await serviceClient
        .from("redmine_project_account_cache")
        .select("project_identifier, project_name, account_identities, account_display_names, fetched_at, has_account_data");

      if (cacheErr) {
        return new Response(JSON.stringify({ error: "Failed to read cache", details: cacheErr.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const matchedRows = (cacheRows || []).filter((row: any) => {
        const identities: string[] = row.account_identities || [];
        return targets.length > 0 && identities.some((identity) => targets.includes(identity));
      });

      return new Response(
        JSON.stringify({
          success: true,
          user_id: requestedUserId,
          targets,
          matched_count: matchedRows.length,
          identifiers: matchedRows.map((row: any) => row.project_identifier),
          projects: matchedRows,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Sync user's account assignments from Redmine memberships to project_assignments
    // This is the canonical sync path: caller authenticated → loads projects → matches Redmine Account role → upserts assignments
    if (type === "sync_my_account_projects") {
      const serviceClient = getServiceClient();

      await ensureCacheTableReady(serviceClient);

      const { data: cacheProbe, error: probeErr } = await serviceClient
        .from("redmine_project_account_cache")
        .select("project_identifier")
        .limit(1);
      if (probeErr) {
        return new Response(JSON.stringify({ error: "Failed to read cache", details: probeErr.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Bootstrap cache once when empty; future calls are cache-only and fast.
      if (!cacheProbe || cacheProbe.length === 0) {
        await syncCachedAccountDataFromRedmine(serviceClient);
      }

      const assignmentSync = await syncAssignmentsFromCache(serviceClient, callerClaims!.sub);

      return new Response(JSON.stringify({
        success: true,
        user_id: callerClaims!.sub,
        matched: assignmentSync.details[0]?.matched || 0,
        assignment_rows_upserted: assignmentSync.assignmentRowsInserted,
        details: assignmentSync.details,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // List importable projects for the caller's linked Redmine identity without writing rows.
    if (type === "my_redmine_projects_for_import") {
      const serviceClient = getServiceClient();
      const result = await syncMembershipProjectsForUser(serviceClient, callerClaims!.sub, { dryRun: true });

      return new Response(JSON.stringify({
        success: true,
        user_id: callerClaims!.sub,
        projects: result.projects,
        total_count: result.projects.length,
        message: result.message || null,
        linked_redmine_user_id: result.linked_redmine_user_id || null,
        matched_memberships_count: result.matched_memberships_count || 0,
        matched_role_names: result.matched_role_names || [],
        filtered_out_reason: result.filtered_out_reason || null,
        filtered_out_counts: result.filtered_out_counts || {},
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Import only selected Redmine projects for the caller.
    if (type === "import_my_redmine_projects") {
      const identifiers = Array.isArray(body?.identifiers)
        ? body.identifiers.map((identifier: unknown) => String(identifier || "").trim()).filter(Boolean)
        : [];
      if (identifiers.length === 0) {
        return new Response(JSON.stringify({ error: "identifiers is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const serviceClient = getServiceClient();
      const result = await syncMembershipProjectsForUser(serviceClient, callerClaims!.sub, {
        identifiers,
        revokeMissing: false,
      });

      return new Response(JSON.stringify({
        success: true,
        user_id: callerClaims!.sub,
        imported: result.imported,
        projects: result.projects,
        message: result.message || null,
        linked_redmine_user_id: result.linked_redmine_user_id || null,
        matched_memberships_count: result.matched_memberships_count || 0,
        matched_role_names: result.matched_role_names || [],
        filtered_out_reason: result.filtered_out_reason || null,
        synced_at: new Date().toISOString(),
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Import/synchronize projects using the caller's linked Redmine identity.
    // This preserves manual assignments and only revokes source='redmine' rows.
    if (type === "sync_my_redmine_projects") {
      const serviceClient = getServiceClient();
      const result = await syncMembershipProjectsForUser(serviceClient, callerClaims!.sub);

      return new Response(JSON.stringify({
        success: true,
        user_id: callerClaims!.sub,
        imported: result.imported,
        revoked: result.revoked,
        projects: result.projects,
        message: result.message || null,
        linked_redmine_user_id: result.linked_redmine_user_id || null,
        matched_memberships_count: result.matched_memberships_count || 0,
        matched_role_names: result.matched_role_names || [],
        filtered_out_reason: result.filtered_out_reason || null,
        filtered_out_counts: result.filtered_out_counts || {},
        synced_at: new Date().toISOString(),
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Sync account assignments for a specific user (admin-only)
    // Requires: user_id in body, caller authenticated as admin
    if (type === "sync_account_projects_for_user") {
      const serviceClient = getServiceClient();

      const callerIsAdmin = await isCallerAdmin(serviceClient);
      if (!callerIsAdmin) {
        return new Response(JSON.stringify({ error: "Admin access required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { user_id: targetUserId } = body;
      if (!targetUserId) {
        return new Response(JSON.stringify({ error: "user_id is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await ensureCacheTableReady(serviceClient);

      const { data: cacheProbe, error: probeErr } = await serviceClient
        .from("redmine_project_account_cache")
        .select("project_identifier")
        .limit(1);
      if (probeErr) {
        return new Response(JSON.stringify({ error: "Failed to read cache", details: probeErr.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!cacheProbe || cacheProbe.length === 0) {
        await syncCachedAccountDataFromRedmine(serviceClient);
      }

      const assignmentSync = await syncAssignmentsFromCache(serviceClient, targetUserId);

      return new Response(JSON.stringify({
        success: true,
        user_id: targetUserId,
        matched: assignmentSync.details[0]?.matched || 0,
        assignment_rows_upserted: assignmentSync.assignmentRowsInserted,
        details: assignmentSync.details,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch full ticket detail + journals (history) — intentionally NOT cached
    if (type === "issue_detail") {
      const { issue_id } = body;
      if (!issue_id) {
        return new Response(JSON.stringify({ error: "issue_id is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // include=journals gives the full change history
      // include=attachments gives file attachments
      // include=watchers gives watchers list
      const url = `${REDMINE_BASE}/issues/${issue_id}.json?key=${REDMINE_KEY}&include=journals,attachments,watchers`;
      const res = await fetch(url);
      const data = await safeJson(res, { issue: null });
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Type invalide" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    let message = "Unknown error";
    let details = null;

    if (err instanceof Error) {
      message = err.message;
      details = err.stack;
    } else if (typeof err === "object" && err !== null) {
      if ("message" in err) {
        message = String((err as any).message);
      }
      details = (err as any);
    } else {
      message = String(err);
    }

    console.error("[fetch-redmine] Uncaught error:", { message, details });

    return new Response(JSON.stringify({ error: message, details }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
