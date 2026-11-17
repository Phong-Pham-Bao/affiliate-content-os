import { useCallback, useState, type KeyboardEvent } from 'react';
import type { AgentRoleKey } from '../../types/workforce.js';
import { ORDERED_ROLES } from '../../lib/workforce-view-model-roles.js';

export function useRosterKeyboardNav(
  onInspectEmployee: (roleKey: AgentRoleKey) => void,
  initialRoleKey: AgentRoleKey = ORDERED_ROLES[0]!,
) {
  const [activeRoleKey, setActiveRoleKey] = useState<AgentRoleKey>(initialRoleKey);

  const getTabIndex = useCallback(
    (roleKey: AgentRoleKey): number => {
      return roleKey === activeRoleKey ? 0 : -1;
    },
    [activeRoleKey],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>, currentRoleKey: AgentRoleKey) => {
      const idx = ORDERED_ROLES.indexOf(currentRoleKey);
      if (idx === -1) return;

      let targetIndex: number;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          targetIndex = (idx + 1) % ORDERED_ROLES.length;
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          targetIndex = (idx - 1 + ORDERED_ROLES.length) % ORDERED_ROLES.length;
          break;
        case 'Home':
          targetIndex = 0;
          break;
        case 'End':
          targetIndex = ORDERED_ROLES.length - 1;
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          onInspectEmployee(currentRoleKey);
          return;
        default:
          return;
      }

      e.preventDefault();
      const targetRole = ORDERED_ROLES[targetIndex]!;
      setActiveRoleKey(targetRole);

      // Focus the target element in the active view
      const stationEl = document.getElementById(`station-${targetRole}`);
      const boardEl = document.getElementById(`board-${targetRole}`);
      if (stationEl && document.contains(stationEl)) {
        stationEl.focus();
      } else if (boardEl && document.contains(boardEl)) {
        boardEl.focus();
      }
    },
    [onInspectEmployee],
  );

  return { activeRoleKey, setActiveRoleKey, getTabIndex, handleKeyDown };
}
