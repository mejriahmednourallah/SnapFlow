import { useState, type ReactNode } from 'react';
import { PanelLeftOpen, PanelRightOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

interface WorkflowBuilderShellProps {
  header: ReactNode;
  notices?: ReactNode;
  sidebar: ReactNode;
  canvas: ReactNode;
  inspector: ReactNode;
}

export function WorkflowBuilderShell({ header, notices, sidebar, canvas, inspector }: WorkflowBuilderShellProps) {
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  return (
    <div className="h-[calc(100dvh-5rem)] min-h-0 w-full min-w-0 overflow-hidden rounded-lg border border-border bg-background shadow-sm">
      <div className="flex h-full flex-col">
        {header}
        {notices}
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-muted/20 min-[1440px]:grid min-[1440px]:grid-cols-[280px_minmax(0,1fr)_360px]">
          <div className="relative z-10 hidden min-h-0 min-w-0 overflow-hidden border-r border-border bg-background min-[1440px]:block">
            {sidebar}
          </div>
          <div className="relative z-0 min-h-0 min-w-0 flex-1 overflow-hidden">
            <div className="absolute left-3 top-3 z-30 flex gap-2 min-[1440px]:hidden">
              <Button type="button" size="sm" variant="secondary" onClick={() => setFieldsOpen(true)}>
                <PanelLeftOpen className="mr-1.5 h-4 w-4" />
                Champs
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setInspectorOpen(true)}>
                <PanelRightOpen className="mr-1.5 h-4 w-4" />
                Inspecteur
              </Button>
            </div>
            {canvas}
          </div>
          <div className="relative z-10 hidden min-h-0 min-w-0 overflow-hidden border-l border-border bg-background min-[1440px]:block">
            {inspector}
          </div>
        </div>
      </div>

      <Sheet open={fieldsOpen} onOpenChange={setFieldsOpen}>
        <SheetContent
          side="left"
          className="h-[100dvh] w-[92vw] max-w-[420px] overflow-hidden p-0 sm:max-w-[420px]"
        >
          <SheetHeader className="border-b border-border px-5 py-4">
            <SheetTitle>Champs et scenarios</SheetTitle>
          </SheetHeader>
          <div className="h-[calc(100dvh-4rem)] min-w-0 overflow-hidden">{sidebar}</div>
        </SheetContent>
      </Sheet>

      <Sheet open={inspectorOpen} onOpenChange={setInspectorOpen}>
        <SheetContent
          side="right"
          className="h-[100dvh] w-[92vw] max-w-[520px] overflow-hidden p-0 sm:max-w-[520px]"
        >
          <SheetHeader className="border-b border-border px-5 py-4">
            <SheetTitle>Configuration et execution</SheetTitle>
          </SheetHeader>
          <div className="h-[calc(100dvh-4rem)] min-w-0 overflow-hidden">{inspector}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
