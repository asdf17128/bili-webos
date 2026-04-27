import React, { useCallback } from 'react';
import { useFocusable } from '../hooks/useFocus';

export default React.memo(function SidebarItem({ id, row, col, label, icon, active, onSelect, group = 'nav' }) {
  const handleSelect = useCallback(() => {
    onSelect?.();
  }, [onSelect]);

  const { props, isFocused } = useFocusable({
    id, row, col, group, onSelect: handleSelect,
  });

  return (
    <div {...props} className={`top-nav-item ${active ? 'active' : ''} ${isFocused ? 'focused' : ''}`}>
      <span>{icon}</span>
      <span className="top-nav-label">{label}</span>
    </div>
  );
});
