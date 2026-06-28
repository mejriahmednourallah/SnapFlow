import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { normalizeProjectPerimeterBlocks, type ProjectPerimeterBlock } from '@/lib/projectPerimeters';

interface ProjectPerimeterEditorProps {
  projectId: string;
}

function emptyBlock(order: number): ProjectPerimeterBlock {
  return {
    title: '',
    subtitle: '',
    items: [''],
    display_order: order,
  };
}

export function ProjectPerimeterEditor({ projectId }: ProjectPerimeterEditorProps) {
  const { toast } = useToast();
  const [blocks, setBlocks] = useState<ProjectPerimeterBlock[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('project_perimeter_blocks')
        .select('*')
        .eq('project_id', projectId)
        .order('display_order', { ascending: true });

      if (!mounted) return;
      if (error) {
        toast({ title: 'Erreur', description: 'Impossible de charger les perimetres.', variant: 'destructive' });
        setBlocks([]);
      } else {
        setBlocks(normalizeProjectPerimeterBlocks(data as Array<Record<string, unknown>> | null));
      }
      setIsLoading(false);
    };
    void load();
    return () => { mounted = false; };
  }, [projectId, toast]);

  const updateBlock = (index: number, patch: Partial<ProjectPerimeterBlock>) => {
    setBlocks((current) => current.map((block, i) => (i === index ? { ...block, ...patch } : block)));
  };

  const moveBlock = (index: number, direction: -1 | 1) => {
    setBlocks((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((block, display_order) => ({ ...block, display_order }));
    });
  };

  const updateItem = (blockIndex: number, itemIndex: number, value: string) => {
    setBlocks((current) => current.map((block, i) => {
      if (i !== blockIndex) return block;
      return {
        ...block,
        items: block.items.map((item, j) => (j === itemIndex ? value : item)),
      };
    }));
  };

  const removeItem = (blockIndex: number, itemIndex: number) => {
    setBlocks((current) => current.map((block, i) => {
      if (i !== blockIndex) return block;
      const items = block.items.filter((_, j) => j !== itemIndex);
      return { ...block, items: items.length ? items : [''] };
    }));
  };

  const save = async () => {
    setIsSaving(true);
    try {
      const payload = blocks
        .map((block, display_order) => ({
          id: block.id,
          project_id: projectId,
          title: block.title.trim(),
          subtitle: block.subtitle?.trim() || null,
          items: block.items.map((item) => item.trim()).filter(Boolean),
          display_order,
        }))
        .filter((block) => block.title || block.items.length > 0);

      const keptIds = payload.map((block) => block.id).filter(Boolean) as string[];
      let deleteQuery = supabase.from('project_perimeter_blocks').delete().eq('project_id', projectId);
      if (keptIds.length > 0) {
        deleteQuery = deleteQuery.not('id', 'in', `(${keptIds.join(',')})`);
      }
      const { error: deleteError } = await deleteQuery;
      if (deleteError) throw deleteError;

      if (payload.length > 0) {
        const { data, error } = await supabase
          .from('project_perimeter_blocks')
          .upsert(payload, { onConflict: 'id' })
          .select('*')
          .order('display_order', { ascending: true });
        if (error) throw error;
        setBlocks(normalizeProjectPerimeterBlocks(data as Array<Record<string, unknown>> | null));
      } else {
        setBlocks([]);
      }

      toast({ title: 'Perimetres enregistres' });
    } catch (err) {
      toast({
        title: 'Erreur',
        description: err instanceof Error ? err.message : 'Impossible d enregistrer les perimetres.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="glass-card p-4 space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold">Perimetres du rapport d'activite</h3>
          <p className="text-xs text-muted-foreground">Configure les blocs affiches dans le PDF d'activite.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setBlocks((current) => [...current, emptyBlock(current.length)])}>
            <Plus className="mr-1 h-4 w-4" />
            Bloc
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={isSaving}>
            <Save className="mr-1 h-4 w-4" />
            {isSaving ? 'Enregistrement...' : 'Enregistrer'}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement...</p>
      ) : blocks.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          Aucun perimetre configure. La page perimetre sera masquee dans le PDF.
        </p>
      ) : (
        <div className="space-y-3">
          {blocks.map((block, blockIndex) => (
            <div key={block.id ?? blockIndex} className="rounded-md border border-border p-3 space-y-3">
              <div className="flex items-start gap-2">
                <div className="grid flex-1 gap-2 sm:grid-cols-2">
                  <Input value={block.title} onChange={(event) => updateBlock(blockIndex, { title: event.target.value })} placeholder="Titre du bloc" />
                  <Input value={block.subtitle ?? ''} onChange={(event) => updateBlock(blockIndex, { subtitle: event.target.value })} placeholder="Sous-titre optionnel" />
                </div>
                <Button variant="ghost" size="icon" onClick={() => moveBlock(blockIndex, -1)} disabled={blockIndex === 0}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => moveBlock(blockIndex, 1)} disabled={blockIndex === blocks.length - 1}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setBlocks((current) => current.filter((_, i) => i !== blockIndex))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-2">
                {block.items.map((item, itemIndex) => (
                  <div key={itemIndex} className="flex items-center gap-2">
                    <Input value={item} onChange={(event) => updateItem(blockIndex, itemIndex, event.target.value)} placeholder="Element du perimetre" />
                    <Button variant="ghost" size="icon" onClick={() => removeItem(blockIndex, itemIndex)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => updateBlock(blockIndex, { items: [...block.items, ''] })}>
                  <Plus className="mr-1 h-4 w-4" />
                  Element
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
