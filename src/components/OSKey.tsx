import React from 'react';
import { useFocusable } from '../hooks/useFocus';

type OSKeyProps = {
  id: string;
  row: number;
  col?: number;
  group?: string;
  label: React.ReactNode;
  isAction?: boolean;
  onPress?: () => void;
};

export default React.memo(function OSKey({
  id,
  row,
  col,
  group,
  label,
  isAction,
  onPress,
}: OSKeyProps) {
  const { props } = useFocusable({ id, row, col, group, onSelect: onPress });
  return (
    <div {...props} className={`osk-key ${isAction ? 'wide' : ''}`}>
      {label}
    </div>
  );
});
