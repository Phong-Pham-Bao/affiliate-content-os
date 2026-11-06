import { useEffect } from 'react';

export function useEscapeKey(
  onEscape: (() => void) | undefined,
  isDisabled: boolean,
  active: boolean,
): void {
  useEffect(() => {
    if (!active || !onEscape) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isDisabled) {
        e.preventDefault();
        onEscape();
      }
    };
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
    return undefined;
  }, [active, onEscape, isDisabled]);
}
