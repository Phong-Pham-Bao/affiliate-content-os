/**
 * Isolates the background of an open modal by applying HTML `inert`
 * to sibling elements across the ancestor chain up to `document.body`.
 *
 * Ensures the modal dialog and all its ancestors remain interactive (not inert).
 * Restores previous inert state cleanly on close/unmount, supporting React StrictMode
 * and repeated opens without leaving any element stranded as inert.
 */

export interface BackgroundIsolationHandle {
  restore: () => void;
}

export function isolateModalBackground(
  modalElement: HTMLElement | null,
): BackgroundIsolationHandle {
  if (!modalElement) {
    return { restore: () => {} };
  }

  const doc = modalElement.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
  if (!doc) {
    return { restore: () => {} };
  }

  const targetBody = doc.body;

  // Store elements that we modified and whether they were already inert
  const modifiedElements = new Map<HTMLElement, boolean>();

  let current: HTMLElement | null = modalElement;
  while (current && current.parentElement && current !== targetBody) {
    const parentNode: HTMLElement = current.parentElement;
    const children = parentNode.children;
    for (let i = 0; i < children.length; i++) {
      const sibling = children[i] as HTMLElement;
      if (
        sibling &&
        sibling !== current &&
        !sibling.contains(modalElement) &&
        !modifiedElements.has(sibling)
      ) {
        const wasInert = Boolean(sibling.inert);
        modifiedElements.set(sibling, wasInert);
        sibling.inert = true;
      }
    }
    current = parentNode;
  }

  return {
    restore: () => {
      for (const [element, wasInert] of modifiedElements.entries()) {
        if (wasInert) {
          element.inert = true;
        } else {
          element.inert = false;
          element.removeAttribute?.('inert');
        }
      }
      modifiedElements.clear();
    },
  };
}
