import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const REDMINE_BASE = "https://maintenance.medianet.tn";
const REDMINE_KEY = Deno.env.get("REDMINE_API_KEY") || "";

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

    if (type === "projects") {
      const projects = await fetchAllRedmineProjects();
      return new Response(JSON.stringify({ projects, total_count: projects.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (type === "users") {
      // Alternative approach: extract unique users from issues (assigned_to, author)
      // since /users.json requires admin privileges
      const usersMap = new Map<number, { id: number; name: string }>();
      let offset = 0;
      const batchLimit = 100;
      const maxPages = 5; // Cap at 500 issues to avoid timeout

      for (let page = 0; page < maxPages; page++) {
        const res = await fetch(
          `${REDMINE_BASE}/issues.json?key=${REDMINE_KEY}&limit=${batchLimit}&offset=${offset}&status_id=*&sort=updated_on:desc`
        );
        const data = await safeJson(res, { issues: [], total_count: 0 });
        if (!data.issues || data.issues.length === 0) break;

        for (const issue of data.issues) {
          if (issue.assigned_to?.id && !usersMap.has(issue.assigned_to.id)) {
            usersMap.set(issue.assigned_to.id, { id: issue.assigned_to.id, name: issue.assigned_to.name });
          }
          if (issue.author?.id && !usersMap.has(issue.author.id)) {
            usersMap.set(issue.author.id, { id: issue.author.id, name: issue.author.name });
          }
        }

        offset += batchLimit;
        if (offset >= data.total_count) break;
      }

      const users = Array.from(usersMap.values()).sort((a, b) => a.name.localeCompare(b.name));
      console.log('Extracted users from issues:', users.length);

      return new Response(JSON.stringify({ users }), {
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

      // First, resolve numeric project id from identifier if needed
      let projectId: number | string = project_identifier;
      
      // If project_identifier is a string (not a number), look up the numeric id
      if (typeof project_identifier === 'string' && isNaN(Number(project_identifier))) {
        try {
          const projRes = await fetch(
            `${REDMINE_BASE}/projects/${project_identifier}.json?key=${REDMINE_KEY}`
          );
          if (projRes.ok) {
            const projData = await projRes.json();
            projectId = projData.project?.id || project_identifier;
          }
        } catch (e) {
          console.error("Error fetching project id:", e);
        }
      }

      // Default custom fields required by this Redmine instance
      const defaultCustomFields = [
        { id: 18, value: [] },        // Type d'intervention
        { id: 12, value: "Client" },   // Source
        { id: 5, value: "" },          // CMS / Framework
        { id: 8, value: "DEV" },       // Equipe Affectée
        { id: 17, value: "" },         // Nature
      ];

      const issueData: any = {
        issue: {
          project_id: projectId,
          subject,
          description: description || "",
          tracker_id: tracker_id ? Number(tracker_id) : 2, // Default to "Feature" tracker
          custom_fields: custom_fields || defaultCustomFields,
        },
      };
      if (priority_id) issueData.issue.priority_id = Number(priority_id);
      if (assigned_to_id) issueData.issue.assigned_to_id = Number(assigned_to_id);

      console.log("Creating issue with payload:", JSON.stringify(issueData));

      const res = await fetch(`${REDMINE_BASE}/issues.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Redmine-API-Key": REDMINE_KEY,
        },
        body: JSON.stringify(issueData),
      });
      const data = await res.json();
      console.log("Redmine response status:", res.status, "body:", JSON.stringify(data));
      if (!res.ok) {
        return new Response(JSON.stringify({ error: "Erreur Redmine", details: data, success: false }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ...data, success: true }), {
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
