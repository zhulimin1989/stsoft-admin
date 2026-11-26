import type { ReactNode } from 'react';
import { Button, Tooltip } from 'antd';

export function BillActionButton({
  label,
  reason,
  onClick,
  icon,
}: {
  label: string;
  reason: string | null;
  onClick: () => void;
  icon?: ReactNode;
}) {
  const button = (
    <Button size="small" disabled={Boolean(reason)} icon={icon} onClick={onClick}>
      {label}
    </Button>
  );
  if (!reason) return button;
  return <Tooltip title={reason}>{button}</Tooltip>;
}
