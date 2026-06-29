import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const roots = [
  'src',
  'supabase/functions',
  '../MICROSERVICES_COMPLETE_ANALYSIS.md',
  '../PFE_REPORT.md',
].map((item) => join(process.cwd(), item));

const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.md']);
const badPatterns = [
  { name: 'latin1-accent', pattern: /Ã|Â/g },
  { name: 'replacement-char', pattern: /�/g },
  { name: 'mojibake-punctuation', pattern: /â€”|â€“|â€™|â€œ|â€/g },
];

function extensionOf(path) {
  const index = path.lastIndexOf('.');
  return index >= 0 ? path.slice(index) : '';
}

function walk(path) {
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  if (!stat.isDirectory()) return [];
  return readdirSync(path)
    .filter((entry) => !entry.startsWith('.') && entry !== 'node_modules' && entry !== 'dist')
    .flatMap((entry) => walk(join(path, entry)));
}

const offenders = [];
for (const root of roots) {
  for (const file of walk(root)) {
    if (!extensions.has(extensionOf(file))) continue;
    const text = readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, lineIndex) => {
      badPatterns.forEach(({ name, pattern }) => {
        pattern.lastIndex = 0;
        if (pattern.test(line)) {
          offenders.push(`${relative(process.cwd(), file)}:${lineIndex + 1} ${name}: ${line.trim().slice(0, 180)}`);
        }
      });
    });
  }
}

if (offenders.length > 0) {
  console.error(`Found ${offenders.length} possible mojibake offender(s):`);
  offenders.slice(0, 200).forEach((item) => console.error(item));
  if (offenders.length > 200) console.error(`...and ${offenders.length - 200} more`);
  process.exit(1);
}

console.log('No mojibake patterns found.');
