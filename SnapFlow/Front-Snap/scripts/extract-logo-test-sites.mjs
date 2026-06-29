import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inputPath = resolve(root, 'tmp/redmine_projects_full_dump.json');
const outputPath = resolve(root, 'tmp/logo-detection-sites.json');

function normalizeHttpUrl(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^\/\//.test(trimmed)) return `https:${trimmed}`;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return '';
}

function readDump() {
  const raw = readFileSync(inputPath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

const projects = readDump();
const sites = projects
  .map((project) => ({
    redmine_id: project.id,
    name: project.name,
    identifier: project.identifier,
    homepage_raw: project.homepage,
    site_url: normalizeHttpUrl(project.homepage),
  }))
  .filter((project) => project.site_url);

const uniqueSites = Array.from(
  new Map(sites.map((project) => [project.site_url.replace(/\/$/, ''), project])).values(),
).sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'));

const shouldWrite = process.argv.includes('--write');
if (shouldWrite) {
  writeFileSync(outputPath, `${JSON.stringify(uniqueSites, null, 2)}\n`, 'utf8');
}

console.log(JSON.stringify({
  source: inputPath,
  total_projects: Array.isArray(projects) ? projects.length : 0,
  sites_with_homepage: sites.length,
  unique_sites: uniqueSites.length,
  output: shouldWrite ? outputPath : null,
  sample: uniqueSites.slice(0, 10),
}, null, 2));
