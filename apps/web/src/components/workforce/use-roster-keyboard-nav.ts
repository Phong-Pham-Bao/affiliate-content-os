import { useCallback, type KeyboardEvent } from 'react';
import type { AgentRoleKey } from '../../types/workforce.js';
import { ORDERED_ROLES } from '../../lib/workforce-view-model-roles.js';

export function useRosterKeyboardNav(onInspectEmployee: (roleKey: AgentRoleKey) => void) {
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
      const stationEl = document.getElementById(`station-${targetRole}`);
      const boardEl = document.getElementById(`board-${targetRole}`);
      if (stationEl) {
        stationEl.focus();
      } else if (boardEl) {
        boardEl.focus();
      }
    },
    [onInspectEmployee],
  );

  return { handleKeyDown };
}
