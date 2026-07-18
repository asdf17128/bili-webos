import React, { useCallback } from 'react';
import { useFocusable, getCurrentFocusId } from '../hooks/useFocus';

export default React.memo(function SidebarItem({ id, row, label, icon, active, onSelect }) {
  const handleSelect = useCallback(() => {
    onSelect?.();
  }, [onSelect]);

  const { props } = useFocusable({
    id, row, col: 0, group: 'sidebar', onSelect: handleSelect,
  });

  // Include the focus state in the RENDERED className. Navigating the sidebar
  // previews (setPage) the focused item → its `active` prop flips → React
  // re-renders it and rewrites className, which would wipe the `.focused` class
  // that applyFocus set via direct DOM (box flashed then vanished, owner). At
  // this render currentFocusId is already the new item, so we re-assert it.
  const focused = getCurrentFocusId() === id;

  return (
    <div {...props} className={`sidebar-item ${active ? 'active' : ''} ${focused ? 'focused' : ''}`}>
      <span>{icon}</span>
      <span className="sidebar-label">{label}</span>
    </div>
  );
});
