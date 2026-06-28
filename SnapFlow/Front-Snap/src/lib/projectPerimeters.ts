export interface ProjectPerimeterBlock {
  id?: string;
  project_id?: string;
  title: string;
  subtitle?: string | null;
  items: string[];
  display_order: number;
}

export function normalizeProjectPerimeterBlocks(rows: Array<Record<string, unknown>> | null | undefined): ProjectPerimeterBlock[] {
  return (rows ?? [])
    .map((row, index) => {
      const rawItems = Array.isArray(row.items) ? row.items : [];
      return {
        id: typeof row.id === 'string' ? row.id : undefined,
        project_id: typeof row.project_id === 'string' ? row.project_id : undefined,
        title: String(row.title ?? '').trim(),
        subtitle: typeof row.subtitle === 'string' && row.subtitle.trim() ? row.subtitle.trim() : null,
        items: rawItems.map((item) => String(item).trim()).filter(Boolean),
        display_order: Number.isFinite(row.display_order) ? Number(row.display_order) : index,
      };
    })
    .filter((block) => block.title || block.items.length > 0)
    .sort((a, b) => a.display_order - b.display_order);
}

export function hasProjectPerimeterBlocks(blocks: ProjectPerimeterBlock[] | null | undefined): boolean {
  return Boolean(blocks?.some((block) => block.title.trim() || block.items.length > 0));
}
