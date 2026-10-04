'use client';

import type { PackTemplateView } from '@pokedrop/shared';
import { PackageOpen } from 'lucide-react';
import { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { formatCoins } from '@/lib/format';

export function ConfirmOpenDialog({
  template,
  onClose,
  onConfirm,
}: {
  template: PackTemplateView | null;
  onClose: () => void;
  onConfirm: (template: PackTemplateView) => void;
}) {
  // Held until the page navigates away, so a second click finds the dialog busy.
  const [leaving, setLeaving] = useState(false);

  return (
    <Dialog
      open={template !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      icon={PackageOpen}
      title={template ? `Open ${template.name}?` : 'Open pack?'}
      description={template ? <>{template.guarantee} This action can&rsquo;t be undone.</> : null}
      confirmLabel={template ? `Open pack · ${formatCoins(template.cost)}` : 'Open pack'}
      confirming={leaving}
      onConfirm={() => {
        if (!template || leaving) return;
        setLeaving(true);
        onConfirm(template);
      }}
    />
  );
}
