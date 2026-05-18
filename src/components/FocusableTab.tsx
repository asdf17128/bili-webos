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
}) {
  const { props } = useFocusable({ id, row, col, group, onSelect });
  return (
    <div {...props} className={`tab ${active ? 'active' : ''}`}>
      {label}
    </div>
  );
});
