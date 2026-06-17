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
  reason?: string;
  candidates?: LogoCandidate[];
  detection_errors?: string[];
};

type LogoCandidate = {
  url: string;
  source: string;
  confidence: number;
  reason?: string;
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

function isSvgUrl(url: string): boolean {
  return /\.svg(?:[?#]|$)/i.test(url);
}

function isImageResponse(response: Response, url: string): boolean {
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (contentType.startsWith("image/")) return true;
  if (contentType.includes("svg")) return true;
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

function bytesToBase64(buf: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < buf.length; i += chunkSize) {
    const chunk = buf.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(url, {
      headers: { Accept: "image/svg+xml,image/png,image/jpeg,image/*;q=0.7,*/*;q=0.2" },
      redirect: "follow",
    }, 8_000);
    if (!res.ok || !isImageResponse(res, res.url || url)) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 5_000_000) return null;
    const rawContentType = (res.headers.get("content-type") || "").split(";")[0].toLowerCase();
    const finalUrl = res.url || url;
    if (rawContentType.includes("svg") || isSvgUrl(finalUrl)) {
      const svg = new TextDecoder().decode(buf);
      if (!/<svg[\s>]/i.test(svg)) return null;
      return `data:image/svg+xml;base64,${bytesToBase64(buf)}`;
    }
    const extensionMatch = (res.url || url).match(/\.(png|jpe?g)(?:[?#]|$)/i);
    const inferredContentType = extensionMatch?.[1]?.toLowerCase() === "png" ? "image/png" : "image/jpeg";
    const ct = ["image/png", "image/jpeg"].includes(rawContentType)
      ? rawContentType
      : extensionMatch
        ? inferredContentType
        : "";
    if (!ct) return null;
    
    const encoded = bytesToBase64(buf);
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

function extractSrcsetCandidates(srcset?: string): string[] {
  if (!srcset) return [];
  return srcset
    .split(",")
    .map((item) => item.trim().split(/\s+/)[0])
    .filter(Boolean);
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

function extractImageSrcLinks(html: string): string[] {
  const results: string[] = [];
  const linkRegex = /<link\b[^>]*>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const attrs = attributesOf(match[0]);
    const rel = (attrs.rel || "").toLowerCase();
    if (attrs.href && rel.includes("image_src")) results.push(attrs.href);
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

function extractJsonLdLogos(html: string): string[] {
  const results: string[] = [];
  const scriptRegex = /<script\b[^>]*type\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json'|application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const stack = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (stack.length) {
        const item = stack.shift();
        if (!item || typeof item !== "object") continue;
        const logo = (item as Record<string, unknown>).logo;
        if (typeof logo === "string") results.push(logo);
        if (logo && typeof logo === "object") {
          const url = (logo as Record<string, unknown>).url || (logo as Record<string, unknown>)["@id"];
          if (typeof url === "string") results.push(url);
        }
        for (const value of Object.values(item as Record<string, unknown>)) {
          if (Array.isArray(value)) stack.push(...value);
          else if (value && typeof value === "object") stack.push(value);
        }
      }
    } catch {
      // Invalid JSON-LD is common and should not block logo detection.
    }
  }
  return results;
}

function extractBackgroundImages(html: string): Array<{ src: string; identity: string }> {
  const results: Array<{ src: string; identity: string }> = [];
  const styleRegex = /<([a-z0-9-]+)\b[^>]*style\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi;
  let match;
  while ((match = styleRegex.exec(html)) !== null) {
    const tag = match[0];
    const attrs = attributesOf(tag);
    const style = match[2] ?? match[3] ?? "";
    const urlMatch = style.match(/background(?:-image)?\s*:\s*[^;]*url\((['"]?)(.*?)\1\)/i);
    const src = urlMatch?.[2]?.trim();
    if (!src) continue;
    results.push({
      src,
      identity: [src, attrs.class, attrs.id, attrs.role, attrs["aria-label"], attrs.title].filter(Boolean).join(" "),
    });
  }
  return results;
}

function extractLogoImgs(html: string): Array<{ src: string; source: string; confidence: number; reason: string }> {
  const results: Array<{ src: string; source: string; confidence: number; reason: string }> = [];
  const noscriptHtml = Array.from(html.matchAll(/<noscript\b[^>]*>([\s\S]*?)<\/noscript>/gi))
    .map((match) => match[1])
    .join("\n");
  const combinedHtml = `${html}\n${noscriptHtml}`;
  const imgRegex = /<img\b[^>]*>/gi;
  let match;
  while ((match = imgRegex.exec(combinedHtml)) !== null) {
    const attrs = attributesOf(match[0]);
    const sources = [
      attrs.src,
      attrs["data-src"],
      attrs["data-original"],
      attrs["data-lazy"],
      attrs["data-lazy-src"],
      attrs["data-ll-status"] ? undefined : attrs["data-srcset"],
      ...extractSrcsetCandidates(attrs.srcset),
      ...extractSrcsetCandidates(attrs["data-srcset"]),
    ].filter(Boolean) as string[];
    const identity = [attrs.src, attrs.srcset, attrs["data-src"], attrs["data-srcset"], attrs.class, attrs.id, attrs.alt, attrs["aria-label"]]
      .filter(Boolean)
      .join(" ");
    const inHeader = /<(?:header|nav)\b[\s\S]{0,2500}$/i.test(combinedHtml.slice(0, match.index));
    const looksLikeLogo = /logo|logotype|brand(?:mark)?|site-?identity|identity|marque/i.test(identity);
    for (const src of sources) {
      if (!src) continue;
      if (looksLikeLogo) {
        results.push({
          src,
          source: "page-logo",
          confidence: inHeader ? 0.98 : 0.94,
          reason: inHeader ? "logo image in header/nav" : "logo identity on image element",
        });
      } else if (inHeader && /\.(svg|png|jpe?g|webp)(?:[?#]|$)/i.test(src)) {
        results.push({
          src,
          source: "header-image",
          confidence: 0.78,
          reason: "image inside header/nav",
        });
      }
    }
  }

  const sourceRegex = /<source\b[^>]*>/gi;
  while ((match = sourceRegex.exec(combinedHtml)) !== null) {
    const attrs = attributesOf(match[0]);
    const identity = [attrs.srcset, attrs.media, attrs.type, attrs.class, attrs.id].filter(Boolean).join(" ");
    if (!/logo|brand|svg|png|webp|jpeg/i.test(identity)) continue;
    for (const src of extractSrcsetCandidates(attrs.srcset)) {
      results.push({ src, source: "picture-source", confidence: 0.72, reason: "picture/source candidate" });
    }
  }

  for (const bg of extractBackgroundImages(combinedHtml)) {
    if (/logo|brand|identity|header|nav/i.test(bg.identity)) {
      results.push({ src: bg.src, source: "background-logo", confidence: 0.82, reason: "background image with logo context" });
    }
  }

  return results;
}

function publicCandidates(candidates: LogoCandidate[]): LogoCandidate[] {
  return candidates
    .slice(0, 12)
    .map((candidate) => ({
      url: candidate.url,
      source: candidate.source,
      confidence: Number(candidate.confidence.toFixed(2)),
      reason: candidate.reason,
    }));
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

    // Layer 1: strong page evidence, then weaker icon/social fallbacks.
    const candidates: LogoCandidate[] = [];
    const detectionErrors: string[] = [];

    extractLogoImgs(html).forEach((item) => {
      const url = absoluteUrl(item.src, documentBase);
      if (url) candidates.push({ url, source: item.source, confidence: item.confidence, reason: item.reason });
    });

    extractJsonLdLogos(html).forEach((src) => {
      const url = absoluteUrl(src, documentBase);
      if (url) candidates.push({ url, source: "jsonld-logo", confidence: 0.9, reason: "JSON-LD logo field" });
    });

    extractImageSrcLinks(html).forEach((src) => {
      const url = absoluteUrl(src, documentBase);
      if (url) candidates.push({ url, source: "image-src", confidence: 0.62, reason: "link rel=image_src" });
    });

    extractFavicons(html).forEach((src) => {
      const url = absoluteUrl(src, documentBase);
      if (url) candidates.push({ url, source: "page-icon", confidence: 0.48, reason: "favicon/apple icon fallback" });
    });

    extractSocialImages(html).forEach((src) => {
      const url = absoluteUrl(src, documentBase);
      if (url) candidates.push({ url, source: "social-image", confidence: 0.4, reason: "social image fallback" });
    });

    const uniqueCandidates = candidates
      .filter(
      (candidate, index, all) => all.findIndex((item) => item.url === candidate.url) === index,
      )
      .sort((a, b) => b.confidence - a.confidence);
    for (const cand of uniqueCandidates) {
      const dataUrl = returnDataUrl ? await toDataUrl(cand.url) : null;
      if (dataUrl || (!returnDataUrl && await isReachableImage(cand.url))) {
        const payload: DetectResult = {
          logo_url: cand.url,
          source: cand.source,
          confidence: cand.confidence,
          reason: cand.reason,
          candidates: publicCandidates(uniqueCandidates),
          detection_errors: detectionErrors,
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
          reason: "common logo path fallback",
          candidates: publicCandidates(uniqueCandidates),
          detection_errors: detectionErrors,
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
          reason: "stored manual logo fallback",
          candidates: publicCandidates(uniqueCandidates),
          detection_errors: detectionErrors,
          data_url: dataUrl || undefined,
        };
        return new Response(JSON.stringify(fallback), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const fallback: DetectResult = {
      logo_url: null,
      source: "not_found",
      confidence: 0,
      candidates: publicCandidates(uniqueCandidates),
      detection_errors: detectionErrors,
    };
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
