"""Additional cleaned text/Markdown evidence; never replaces source HTML."""
from datetime import datetime, timezone
import hashlib

# Some CDP engines implement innerText as textContent. Walk the light DOM
# explicitly so CSS/script bytes cannot masquerade as page or consent text.
# Shadow content is collected separately by discovery, avoiding slot duplication.
VISIBLE_TEXT_HELPER_JS = r"""
    const visibleLightText = (root) => {
        const suppressed = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
        const blocks = new Set(['P','DIV','SECTION','ARTICLE','MAIN','HEADER','FOOTER','NAV',
            'UL','OL','LI','TABLE','TR','TD','TH','BLOCKQUOTE','PRE','BR','HR',
            'H1','H2','H3','H4','H5','H6']);
        function walk(node) {
            if (!node) return '';
            if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
            if (node.nodeType !== Node.ELEMENT_NODE) return '';
            if (suppressed.has(node.tagName) || node.hidden || node.getAttribute('aria-hidden') === 'true') return '';
            const css = getComputedStyle(node);
            if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse' || css.opacity === '0') return '';
            const text = Array.from(node.childNodes).map(walk).join('');
            const block = blocks.has(node.tagName) || ['block','flex','grid','list-item','table-row','table-cell'].includes(css.display);
            return block ? '\n' + text + '\n' : text;
        }
        return walk(root).replace(/\s+/g, ' ').trim();
    };
"""

PROJECTION_JS = r"""() => {
    const seen = new Set();
    const shadowRoots = new Set();
    const clean = text => String(text || '').replace(/\s+/g, ' ').trim();
    const escape = text => clean(text).replace(/[\\`*_\[\]<>|]/g, '\\$&');
    const suppressed = new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','NAV','FOOTER']);
    const hidden = el => {
        if (el.hidden || el.getAttribute('aria-hidden') === 'true') return true;
        const css = getComputedStyle(el);
        return css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse';
    };
    const absolute = value => {
        try { const u = new URL(value, document.baseURI);
              return ['http:','https:','mailto:','tel:'].includes(u.protocol) ? u.href : ''; }
        catch { return ''; }
    };
    function render(node) {
        if (!node || seen.has(node)) return '';
        seen.add(node);
        if (node.nodeType === Node.TEXT_NODE) return node.textContent.replace(/\s+/g, ' ');
        if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return '';
        if (node.nodeType === Node.ELEMENT_NODE && (suppressed.has(node.tagName) || hidden(node))) return '';
        if (node.shadowRoot) {
            shadowRoots.add(node.shadowRoot);
            return render(node.shadowRoot);
        }
        if (node.tagName === 'SLOT') {
            const assigned = node.assignedNodes({flatten: true});
            if (assigned.length) return assigned.map(render).join('');
        }
        const tag = node.tagName || '';
        if (tag === 'TABLE') {
            const rows = Array.from(node.querySelectorAll('tr')).filter(row => row.closest('table') === node);
            const matrix = rows.map(row => Array.from(row.children)
                .filter(cell => ['TH','TD'].includes(cell.tagName))
                .map(cell => clean(Array.from(cell.childNodes).map(render).join('')).replace(/\|/g, '\\|')));
            const width = matrix.reduce((value, row) => Math.max(value, row.length), 0);
            if (!width) return '';
            const hasHeader = rows.length && Array.from(rows[0].children).some(cell => cell.tagName === 'TH');
            const header = hasHeader ? matrix.shift() : Array(width).fill('');
            const line = row => '| ' + Array.from({length:width}, (_, index) => row[index] || '').join(' | ') + ' |';
            return '\n\n' + [line(header), line(Array(width).fill('---')), ...matrix.map(line)].join('\n') + '\n\n';
        }
        const content = Array.from(node.childNodes).map(render).join('');
        if (/^H[1-6]$/.test(tag)) return '\n\n' + '#'.repeat(Number(tag[1])) + ' ' + clean(content) + '\n\n';
        if (tag === 'BR') return '\n';
        if (tag === 'LI') return '\n- ' + clean(content) + '\n';
        if (tag === 'A') {
            const href = absolute(node.getAttribute('href'));
            return href && clean(content) ? '[' + escape(content) + '](' + href.replace(/[()]/g, encodeURIComponent) + ')' : content;
        }
        if (tag === 'IMG') return node.alt ? escape(node.alt) : '';
        if (tag === 'PRE') return '\n\n```\n' + node.textContent.trim() + '\n```\n\n';
        if (tag === 'CODE') return '`' + clean(content).replace(/`/g, '\\`') + '`';
        if (tag === 'TR') return '\n' + clean(content) + '\n';
        if (tag === 'TH' || tag === 'TD') return escape(content) + ' | ';
        if (['P','DIV','SECTION','ARTICLE','MAIN','UL','OL','TABLE','BLOCKQUOTE'].includes(tag)) return '\n\n' + content.trim() + '\n\n';
        return content;
    }
    const root = document.querySelector('main, article, [role="main"]') || document.body;
    let markdown = render(root);
    // Preserve visible open-shadow content outside the selected main block.
    function collect(node, ancestorHidden=false) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
        const excluded = ancestorHidden || suppressed.has(node.tagName) || hidden(node);
        if (excluded) return;
        if (node.shadowRoot) {
            if (!shadowRoots.has(node.shadowRoot)) {
                shadowRoots.add(node.shadowRoot);
                markdown += '\n\n' + render(node.shadowRoot);
            }
            Array.from(node.shadowRoot.children).forEach(child => collect(child));
        }
        Array.from(node.children).forEach(child => collect(child));
    }
    collect(document.body);
    markdown = markdown.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return {markdown, selection: root && root.tagName.toLowerCase(),
            shadow_roots_preserved: shadowRoots.size, format: 'markdown', version: 2,
            scope: 'main content plus visible open shadow roots; HTML retains other evidence'};
}"""


async def capture_text_projection(page, engine):
    projection = await page.evaluate(PROJECTION_JS)
    projection.update(source_url=page.url, engine=engine,
                      captured_at=datetime.now(timezone.utc).isoformat(),
                      sha256=hashlib.sha256(projection['markdown'].encode()).hexdigest())
    return projection

SHADOW_OBSERVATION_HELPER_JS = r"""
const collectShadowObservation = (selectorFor) => {
const clean = value => String(value || "").replace(/\s+/g, " ").trim();
const short = (value, max) => clean(value).slice(0, max);
                    const shadow = {host_count: 0, text: "", links: [], forms: [], aria_roles: [],
                      text_source: "visible_open_shadow_dom",
                      text_scope: "shadow children; assigned light DOM remains in rendered_html"};
                    const excludedShadowNode = (node) => {
                      for (let el = node; el; el = el.parentElement || (el.getRootNode && el.getRootNode().host)) {
                        if (!el.tagName) continue;
                        if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(el.tagName) ||
                            el.hidden || el.getAttribute("aria-hidden") === "true") return true;
                        const style = getComputedStyle(el);
                        if (style.display === "none" || style.visibility === "hidden" ||
                            style.visibility === "collapse" || style.opacity === "0") return true;
                      }
                      return false;
                    };
                    const shadowText = (node) => {
                      if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
                      if (node.nodeType === Node.ELEMENT_NODE && excludedShadowNode(node)) return "";
                      // Nested open roots are collected separately below, once each.
                      if (node.shadowRoot) return "";
                      if (node.tagName === "SLOT") {
                        const assigned = node.assignedNodes({flatten: true});
                        // Assigned light DOM is already in rendered_html. Do not
                        // count it again in the additional shadow observation.
                        if (assigned.length) return "";
                      }
                      const text = Array.from(node.childNodes).map(shadowText).join("");
                      if (node.tagName === "BR") return " ";
                      const block = /^H[1-6]$/.test(node.tagName || "") ||
                        ["P", "DIV", "SECTION", "ARTICLE", "MAIN", "LI", "TR", "TH", "TD", "BLOCKQUOTE"].includes(node.tagName);
                      return block ? " " + text + " " : text;
                    };
                    const visitShadowRoots = (root) => {
                      Array.from(root.querySelectorAll("*")).forEach((el) => {
                        if (!el.shadowRoot || excludedShadowNode(el)) return;
                        shadow.host_count += 1;
                        shadow.text += "\n" + clean(shadowText(el.shadowRoot));
                        Array.from(el.shadowRoot.querySelectorAll("a[href]")).forEach((a) => shadow.links.push(a.href));
                        Array.from(el.shadowRoot.querySelectorAll("form")).forEach((form) => shadow.forms.push({
                          selector: selectorFor(form),
                          action: form.getAttribute("action") || "",
                          method: String(form.getAttribute("method") || "get").toUpperCase(),
                          text: short(form.innerText || "", 220),
                        }));
                        Array.from(el.shadowRoot.querySelectorAll("[role], [aria-label], [aria-expanded], [aria-controls]")).forEach((node) => shadow.aria_roles.push({
                          role: node.getAttribute("role") || "",
                          aria_label: node.getAttribute("aria-label") || "",
                          aria_expanded: node.getAttribute("aria-expanded") || "",
                          selector: selectorFor(node),
                        }));
                        visitShadowRoots(el.shadowRoot);
                      });
                    };
                    visitShadowRoots(document);
                    shadow.text = short(shadow.text, 8000);
                    shadow.links = Array.from(new Set(shadow.links)).slice(0, 80);
                    shadow.forms = shadow.forms.slice(0, 30);
                    shadow.aria_roles = shadow.aria_roles.slice(0, 80);
return shadow;
};
"""
