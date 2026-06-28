import { supabase } from '@/integrations/supabase/client';

export const ACTIVITY_PDF_BRAND_DEFAULTS = {
  left: 'MEDIANET RUN SERVICES',
  right: 'SNAPFLOW',
};

const ACTIVITY_PDF_BRAND_LEFT = 'activity_pdf_brand_left';
const ACTIVITY_PDF_BRAND_RIGHT = 'activity_pdf_brand_right';

type SettingRow = {
  key: string;
  value: string;
};

export async function fetchActivityPdfBrandDefaults() {
  const { data, error } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', [ACTIVITY_PDF_BRAND_LEFT, ACTIVITY_PDF_BRAND_RIGHT]);

  if (error) throw error;

  const rows = (data ?? []) as SettingRow[];
  const map = new Map(rows.map((row) => [row.key, row.value]));
  return {
    left: map.get(ACTIVITY_PDF_BRAND_LEFT) || ACTIVITY_PDF_BRAND_DEFAULTS.left,
    right: map.get(ACTIVITY_PDF_BRAND_RIGHT) || ACTIVITY_PDF_BRAND_DEFAULTS.right,
  };
}

export async function saveActivityPdfBrandDefaults(values: { left: string; right: string }, userId: string) {
  const rows = [
    { key: ACTIVITY_PDF_BRAND_LEFT, value: values.left.trim() || ACTIVITY_PDF_BRAND_DEFAULTS.left, updated_by: userId },
    { key: ACTIVITY_PDF_BRAND_RIGHT, value: values.right.trim() || ACTIVITY_PDF_BRAND_DEFAULTS.right, updated_by: userId },
  ];

  const { error } = await supabase
    .from('app_settings')
    .upsert(rows, { onConflict: 'key' });

  if (error) throw error;
}
