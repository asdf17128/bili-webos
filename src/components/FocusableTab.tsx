import React from 'react';
import { useFocusable } from '../hooks/useFocus';

type FocusableTabProps = {
  id: string;
  row: number;
  col?: number;
  group?: string;
  label: React.ReactNode;
  active?: boolean;
  onSelect?: () => void;
  variant?: string;
};

export default React.memo(function FocusableTab({
  id,
  row,
  col,
  group,
  label,
  active,
  onSelect,
  variant = 'default',
}: FocusableTabProps) {
  const { props } = useFocusable({ id, row, col, group, onSelect });
  return (
    <div
      {...props}
      className={`tab tab-focus-unified tab-${variant} ${active ? 'active' : ''}`}
    >
      {label}
    </div>
  );
});
