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
  "/logo.svg",
  "/logo.png",
  "/logo.jpg",
  "/logo.jpeg",
  "/static/logo.png",
  "/static/logo.svg",
  "/assets/logo.png",
  "/assets/logo.svg",
  "/images/logo.png",
  "/images/logo.svg",
  "/img/logo.png",
  "/img/logo.svg",
  "/favicon.png",
  "/favicon.ico",
  "/favicons/favicon-32x32.png",
  "/favicons/favicon-192x192.png",
  "/apple-touch-icon.png",
  "/apple-touch-icon-precomposed.png",
  "/branding/logo.png",
  "/branding/logo.svg",
  "/brand/logo.png",
  "/brand/logo.svg",
  "/media/logo.png",
  "/media/logo.svg",
];

function absoluteUrl(src: string, base: URL): string | null {
  try {
    return new URL(src, base).href;
  } catch {
    return null;
  }
}

async function isReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    if (res.ok) return true;
    // fallback GET for servers that block HEAD
    if (res.status === 405 || res.status === 501) {
      const getRes = await fetch(url, { method: "GET" });
      return getRes.ok;
    }
    return false;
  } catch {
    return false;
  }
}

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    const ct = res.headers.get("content-type") || "image/png";
    
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

function extractOgImage(html: string): string | null {
  const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
  if (ogMatch?.[1]) return ogMatch[1];
  const twitterMatch = html.match(/<meta[^>]+name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i);
  return twitterMatch?.[1] ?? null;
}

function extractFavicons(html: string): string[] {
  const results: string[] = [];
  const linkRegex = /<link[^>]+rel=["']([^"']*)["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const rel = match[1].toLowerCase();
    if (rel.includes("icon") || rel.includes("apple-touch-icon") || rel.includes("mask-icon")) {
      results.push(match[2]);
    }
  }
  return results;
}

function extractLogoImgs(html: string): string[] {
  const results: string[] = [];
  const imgRegex = /<img[^>]*src=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    const src = match[1];
    if (/logo|brand|logotype|mark/i.test(src)) {
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
    const { siteUrl, logoUrl, returnDataUrl } = await req.json();
    const targetUrl = (logoUrl || siteUrl) as string | undefined;

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

    // If logoUrl provided, short-circuit to data fetch/return
    if (logoUrl) {
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

    const htmlRes = await fetch(target.href, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    const html = htmlRes.ok ? await htmlRes.text() : "";

    // Layer 1: OG / logo-ish tags / favicons
    const candidates: Array<{ url: string; source: string; confidence: number }> = [];

    const og = extractOgImage(html);
    if (og) {
      const url = absoluteUrl(og, target);
      if (url) candidates.push({ url, source: "og:image", confidence: 0.9 });
    }

    extractLogoImgs(html).forEach((src) => {
      const url = absoluteUrl(src, target);
      if (url) candidates.push({ url, source: "img[logo]", confidence: 0.8 });
    });

    extractFavicons(html).forEach((src) => {
      const url = absoluteUrl(src, target);
      if (url) candidates.push({ url, source: "link[icon]", confidence: 0.7 });
    });

    for (const cand of candidates) {
      if (await isReachable(cand.url)) {
        const dataUrl = returnDataUrl ? await toDataUrl(cand.url) : null;
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
    const origin = `${target.protocol}//${target.host}`;
    const probes = await Promise.allSettled(
      COMMON_PATHS.map(async (path) => {
        const url = origin + path;
        const ok = await isReachable(url);
        return { url, ok };
      }),
    );

    const found = probes.find((p) => p.status === "fulfilled" && p.value.ok);
    if (found && found.status === "fulfilled" && found.value.ok) {
      const dataUrl = returnDataUrl ? await toDataUrl(found.value.url) : null;
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

    const fallback: DetectResult = { logo_url: null, source: "not_found", confidence: 0 };
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[detect-logo] error", err);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
