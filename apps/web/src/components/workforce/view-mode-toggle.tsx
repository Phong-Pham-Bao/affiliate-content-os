'use client';

import { useEffect, useState, type ReactElement } from 'react';

export type WorkforceViewMode = 'office' | 'board';

interface ViewModeToggleProps {
  readonly mode: WorkforceViewMode;
  readonly onChange: (mode: WorkforceViewMode) => void;
}

const STORAGE_KEY = 'acos_workforce_view_mode';

export function useViewModePreference(): [WorkforceViewMode, (mode: WorkforceViewMode) => void] {
  const [mode, setMode] = useState<WorkforceViewMode>('office');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'office' || saved === 'board') {
        setMode(saved);
      }
    } catch {
      // localStorage unavailable in private mode or sandbox
    }
  }, []);

  const setViewMode = (newMode: WorkforceViewMode) => {
    setMode(newMode);
    try {
      localStorage.setItem(STORAGE_KEY, newMode);
    } catch {
      // ignore
    }
  };

  return [mode, setViewMode];
}

export function ViewModeToggle({ mode, onChange }: ViewModeToggleProps): ReactElement {
  return (
    <div
      className="view-mode-toggle btn-group"
      role="group"
      aria-label="Workforce View Mode Switcher"
    >
      <button
        type="button"
        id="view-toggle-office"
        className={`btn btn-sm ${mode === 'office' ? 'btn-primary' : 'btn-outline-secondary'}`}
        aria-pressed={mode === 'office'}
        onClick={() => onChange('office')}
      >
        <span aria-hidden="true" className="me-1">
          🏢
        </span>
        Office View
      </button>
      <button
        type="button"
        id="view-toggle-board"
        className={`btn btn-sm ${mode === 'board' ? 'btn-primary' : 'btn-outline-secondary'}`}
        aria-pressed={mode === 'board'}
        onClick={() => onChange('board')}
      >
        <span aria-hidden="true" className="me-1">
          📋
        </span>
        Board View
      </button>
    </div>
  );
}
