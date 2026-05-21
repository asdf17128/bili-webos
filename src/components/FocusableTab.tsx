// @ts-nocheck
import React from 'react';
import { useFocusable } from '../hooks/useFocus';

export default React.memo(function FocusableTab({
  id,
  row,
  col,
  group,
  label,
  active,
  onSelect,
  variant = 'default',
}) {
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
