import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type DetectResult = {
  logo_url: string | null;
  source?: string;
  confidence?: number;
  data_url?: string;
};

const COMMON_PATHS = [
  "/logo.png",
  "/logo.jpg",
  "/logo.jpeg",
  "/static/logo.png",
  "/assets/logo.png",
  "/images/logo.png",
  "/img/logo.png",
  "/favicon.png",
  "/favicons/favicon-32x32.png",
  "/favicons/favicon-192x192.png",
  "/apple-touch-icon.png",
  "/apple-touch-icon-precomposed.png",
  "/branding/logo.png",
  "/brand/logo.png",
  "/media/logo.png",
  "/favicon.ico",
  "/logo.svg",
  "/static/logo.svg",
  "/assets/logo.svg",
  "/images/logo.svg",
  "/img/logo.svg",
  "/branding/logo.svg",
  "/brand/logo.svg",
  "/media/logo.svg",
];

function absoluteUrl(src: string, base: URL): string | null {
  try {
    const parsed = new URL(src, base);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 8_000): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function isImageResponse(response: Response, url: string): boolean {
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (contentType.startsWith("image/")) return true;
  if (contentType.includes("text/html") || contentType.includes("application/json")) return false;
  return /\.(png|jpe?g|gif|webp|ico|svg)(?:[?#]|$)/i.test(url);
}

async function isReachableImage(url: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(url, {
      method: "GET",
      headers: { Accept: "image/avif,image/webp,image/png,image/svg+xml,image/*,*/*;q=0.5" },
      redirect: "follow",
    }, 5_000);
    return res.ok && isImageResponse(res, res.url || url);
  } catch {
    return false;
  }
}

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(url, {
      headers: { Accept: "image/png,image/jpeg,image/*;q=0.7,*/*;q=0.2" },
      redirect: "follow",
    }, 8_000);
    if (!res.ok || !isImageResponse(res, res.url || url)) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 5_000_000) return null;
    const rawContentType = (res.headers.get("content-type") || "").split(";")[0].toLowerCase();
    const extensionMatch = (res.url || url).match(/\.(png|jpe?g)(?:[?#]|$)/i);
    const inferredContentType = extensionMatch?.[1]?.toLowerCase() === "png" ? "image/png" : "image/jpeg";
    const ct = ["image/png", "image/jpeg"].includes(rawContentType)
      ? rawContentType
      : extensionMatch
        ? inferredContentType
        : "";
    if (!ct) return null;
    
    // Use a safer base64 encoding for large images to avoid "Maximum call stack size exceeded"
    let base64 = '';
    const chunkSize = 8192;
    for (let i = 0; i < buf.length; i += chunkSize) {
      const chunk = buf.subarray(i, i + chunkSize);
      base64 += String.fromCharCode(...chunk);
    }
    const encoded = btoa(base64);
    return `data:${ct};base64,${encoded}`;
  } catch (err) {
    console.error('[detect-logo] toDataUrl error:', err);
    return null;
  }
}

function attributesOf(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attributeRegex = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match;
  while ((match = attributeRegex.exec(tag)) !== null) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function extractSocialImages(html: string): string[] {
  const results: string[] = [];
  const tagRegex = /<meta\b[^>]*>/gi;
  let match;
  while ((match = tagRegex.exec(html)) !== null) {
    const attrs = attributesOf(match[0]);
    const key = (attrs.property || attrs.name || "").toLowerCase();
    if (["og:logo", "og:image", "twitter:image"].includes(key) && attrs.content) {
      results.push(attrs.content);
    }
  }
  return results;
}

function extractFavicons(html: string): string[] {
  const results: string[] = [];
  const linkRegex = /<link\b[^>]*>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const attrs = attributesOf(match[0]);
    const rel = (attrs.rel || "").toLowerCase();
    if (attrs.href && (rel.includes("icon") || rel.includes("apple-touch-icon") || rel.includes("mask-icon"))) {
      results.push(attrs.href);
    }
  }
  return results;
}

function extractLogoImgs(html: string): string[] {
  const results: string[] = [];
  const imgRegex = /<img\b[^>]*>/gi;
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    const attrs = attributesOf(match[0]);
    const src = attrs.src || attrs["data-src"] || attrs["data-lazy-src"];
    const identity = [src, attrs.class, attrs.id, attrs.alt, attrs["aria-label"]]
      .filter(Boolean)
      .join(" ");
    if (src && /logo|logotype|brand(?:mark)?|site-?identity/i.test(identity)) {
      results.push(src);
    }
  }
  return results;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { siteUrl, logoUrl, fallbackLogoUrl, returnDataUrl } = await req.json();
    const targetUrl = (siteUrl || logoUrl || fallbackLogoUrl) as string | undefined;

    if (!targetUrl || typeof targetUrl !== "string") {
      return new Response(JSON.stringify({ error: "siteUrl or logoUrl is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let target: URL;
    try {
      target = new URL(targetUrl);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid URL" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Explicit manual logo URLs remain supported, but report generation uses siteUrl first.
    if (logoUrl && !siteUrl) {
      const dataUrl = returnDataUrl ? await toDataUrl(logoUrl) : null;
      const payload: DetectResult = {
        logo_url: logoUrl,
        source: "provided",
        confidence: 1,
        data_url: dataUrl || undefined,
      };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["http:", "https:"].includes(target.protocol)) {
      return new Response(JSON.stringify({ error: "Only HTTP(S) URLs are supported" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let html = "";
    let documentBase = target;
    try {
      const htmlRes = await fetchWithTimeout(target.href, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
        redirect: "follow",
      }, 10_000);
      if (htmlRes.url) documentBase = new URL(htmlRes.url);
      if (htmlRes.ok) html = await htmlRes.text();
    } catch (error) {
      console.warn("[detect-logo] audited page fetch failed, continuing with fallbacks", error);
    }

    // Layer 1: logo elements from the audited page, then icons, then social images.
    const candidates: Array<{ url: string; source: string; confidence: number }> = [];

    extractLogoImgs(html).forEach((src) => {
      const url = absoluteUrl(src, documentBase);
      if (url) candidates.push({ url, source: "page-logo", confidence: 0.95 });
    });

    extractFavicons(html).forEach((src) => {
      const url = absoluteUrl(src, documentBase);
      if (url) candidates.push({ url, source: "page-icon", confidence: 0.75 });
    });

    extractSocialImages(html).forEach((src) => {
      const url = absoluteUrl(src, documentBase);
      if (url) candidates.push({ url, source: "social-image", confidence: 0.55 });
    });

    const uniqueCandidates = candidates.filter(
      (candidate, index, all) => all.findIndex((item) => item.url === candidate.url) === index,
    );
    for (const cand of uniqueCandidates) {
      const dataUrl = returnDataUrl ? await toDataUrl(cand.url) : null;
      if (dataUrl || (!returnDataUrl && await isReachableImage(cand.url))) {
        const payload: DetectResult = {
          logo_url: cand.url,
          source: cand.source,
          confidence: cand.confidence,
          data_url: dataUrl || undefined,
        };
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Layer 2: common paths
    const origin = documentBase.origin;
    const probes = await Promise.allSettled(
      COMMON_PATHS.map(async (path) => {
        const url = origin + path;
        const ok = await isReachableImage(url);
        return { url, ok };
      }),
    );

    const found = probes.find((p) => p.status === "fulfilled" && p.value.ok);
    if (found && found.status === "fulfilled" && found.value.ok) {
      const dataUrl = returnDataUrl ? await toDataUrl(found.value.url) : null;
      if (dataUrl || !returnDataUrl) {
        const payload: DetectResult = {
          logo_url: found.value.url,
          source: "common-path",
          confidence: 0.6,
          data_url: dataUrl || undefined,
        };
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const storedFallback = typeof fallbackLogoUrl === "string" ? fallbackLogoUrl.trim() : "";
    if (storedFallback) {
      const dataUrl = returnDataUrl ? await toDataUrl(storedFallback) : null;
      if (dataUrl || (!returnDataUrl && await isReachableImage(storedFallback))) {
        const fallback: DetectResult = {
          logo_url: storedFallback,
          source: "stored-fallback",
          confidence: 0.5,
          data_url: dataUrl || undefined,
        };
        return new Response(JSON.stringify(fallback), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const fallback: DetectResult = { logo_url: null, source: "not_found", confidence: 0 };
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[detect-logo] error", err);
    const fallback: DetectResult = { logo_url: null, source: "detection_failed", confidence: 0 };
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
