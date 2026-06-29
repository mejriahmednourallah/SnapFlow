import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

interface ProjectOption {
  id: string;
  site_name: string;
  url?: string | null;
}

interface ProjectSearchSelectProps {
  value: string | null;
  onChange: (projectId: string | null) => void;
  emptyLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function ProjectSearchSelect({
  value,
  onChange,
  emptyLabel = 'Workflow global',
  placeholder = 'Rechercher un projet...',
  disabled,
  className,
}: ProjectSearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectOption[]>([]);

  useEffect(() => {
    let mounted = true;
    supabase
      .from('projects')
      .select('id, site_name, url')
      .order('site_name', { ascending: true })
      .then(({ data }) => {
        if (!mounted) return;
        setProjects((data as ProjectOption[] | null) ?? []);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === value) ?? null,
    [projects, value],
  );

  const label = selectedProject?.site_name ?? (value ? 'Projet sélectionné' : emptyLabel);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('h-9 justify-between overflow-hidden px-3 text-sm font-normal', className)}
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(28rem,calc(100vw-2rem))] p-0" align="start">
        <Command>
          <CommandInput placeholder={placeholder} />
          <CommandList>
            <CommandEmpty>Aucun projet trouvé.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value={`__global__ ${emptyLabel}`}
                onSelect={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                <Check className={cn('mr-2 h-4 w-4', value === null ? 'opacity-100' : 'opacity-0')} />
                <div className="min-w-0">
                  <p className="truncate">{emptyLabel}</p>
                  <p className="truncate text-xs text-muted-foreground">Disponible sans projet lié</p>
                </div>
              </CommandItem>
              {projects.map((project) => (
                <CommandItem
                  key={project.id}
                  value={`${project.site_name} ${project.url ?? ''}`}
                  onSelect={() => {
                    onChange(project.id);
                    setOpen(false);
                  }}
                >
                  <Check className={cn('mr-2 h-4 w-4', value === project.id ? 'opacity-100' : 'opacity-0')} />
                  <div className="min-w-0">
                    <p className="truncate">{project.site_name}</p>
                    {project.url ? <p className="truncate text-xs text-muted-foreground">{project.url}</p> : null}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
