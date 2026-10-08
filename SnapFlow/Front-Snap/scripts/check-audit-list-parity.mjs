// Input stays in memory; print only aggregate results, never report/user contents.
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';

const rows = JSON.parse(readFileSync(0, 'utf8'));
const server = await createServer({ server: { middlewareMode: true, watch: null }, appType: 'custom' });
try {
  const { getAuditScoreFromAny, normalizeAuditForRead } = await server.ssrLoadModule('/src/lib/auditReadUtils.ts');
  let mismatches = 0;
  let legacy = 0;
  // The legacy mapper can log findings; suppress those during private comparisons.
  const previous = { log: console.log, warn: console.warn };
  console.log = console.warn = () => {};
  try {
    for (const row of rows) {
      if (row.requires_report) { legacy++; continue; }
      const score = getAuditScoreFromAny(row.report_data, row.id, row);
      const axes = normalizeAuditForRead(row.report_data, row.id, row)?.axes.length ?? null;
      if (score !== row.score || axes !== row.axis_count) mismatches++;
    }
  } finally { Object.assign(console, previous); }
  process.stdout.write(JSON.stringify({ reports: rows.length, compared: rows.length - legacy, legacy, mismatches }) + '\n');
  if (mismatches) process.exitCode = 1;
} finally { await server.close(); }
