// ─── Shared types + palette for PDF report slides ────────────────────────────

import type { PdfTheme } from '@/components/pdf/theme';

export const BRAND   = '#0e9fb0';
export const GREEN   = '#16a34a';
export const RED     = '#dc2626';
export const AMBER   = '#d97706';
export const BLUE    = '#2563eb';
export const STONE   = '#78716c';
export const STONE_L = '#d6d3d1';
export const GOLD    = '#b45309';
export const GOLD_BG = '#fef3c7';
export const GOLD_BD = '#fde68a';

export const TRACKER_COLORS = [BRAND, '#0284c7', '#0369a1', '#0891b2', STONE];

export type InsightLevel = 'positive' | 'negative' | 'warning' | 'info';

export interface Insight {
  level: InsightLevel;
  title: string;
  text: string;
}

export interface RadarAxisData {
  axis: string;
  value: number;
  detail: string;
}

export interface RedmineIssue {
  id: number;
  subject: string;
  status: { id: number; name: string };
  tracker: { id: number; name: string };
  priority: { id: number; name: string };
  assigned_to?: { id: number; name: string };
  author: { id: number; name: string };
  created_on: string;
  updated_on: string;
  done_ratio: number;
  estimated_hours?: number;
  spent_hours?: number;
}

export interface DashboardProject {
  id: string;
  site_name: string;
  url: string;
  redmine_url?: string | null;
}

export interface PdfConfig {
  pdfColor: string;
  pdfSections: Record<string, boolean>;
  coverKpis: Record<string, boolean>;
  pdfBrandLeft: string;
  pdfBrandRight: string;
  pdfContactEmail: string;
  pdfContactWeb: string;
  pdfContactWeb2: string;
}

export interface ActivityPdfOptions {
  theme?: PdfTheme;
  themeId: string;
  pdfColor: string;
  sections: Record<string, boolean>;
  coverKpis: Record<string, boolean>;
  brandLeft: string;
  brandRight: string;
  contactEmail: string;
  contactWeb: string;
  contactWeb2: string;
}

export interface PdfData {
  project: DashboardProject;
  dateFrom?: string;
  dateTo?: string;
  dataMinDate: Date | null;
  dataMaxDate: Date | null;

  // KPI scalars
  totalCount: number;
  total: number;
  open: number;
  resolved: number;
  critical: number;
  blocked: number;
  avgResolutionDays: number | null;
  avgClosureDays: number | null;
  avgDaysOpen: number | null;

  // Chart datasets
  statusData: { name: string; count: number }[];
  timelineData: { week: string; count: number }[];
  trackerData: { name: string; count: number }[];
  priorityData: { name: string; count: number; color: string }[];
  radarData: RadarAxisData[];

  // Raw issues for tables
  filteredIssues: RedmineIssue[];

  // Auto-generated narrative
  insights: Insight[];

  // Helpers passed from parent (avoid re-implementing)
  statusColorOf: (name: string, idx: number) => string;
  countByFn: <T>(arr: T[], key: (item: T) => string) => { name: string; count: number }[];
}
