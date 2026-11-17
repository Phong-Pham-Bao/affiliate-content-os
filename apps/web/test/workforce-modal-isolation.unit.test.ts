import { describe, expect, it } from 'vitest';
import { isolateModalBackground } from '../src/lib/modal-background-isolation.js';

interface MockDomElement {
  tagName: string;
  inert: boolean;
  parentElement: MockDomElement | null;
  children: MockDomElement[];
  attributes: Record<string, string>;
  ownerDocument?: { body: MockDomElement | null } | undefined;
  removeAttribute: (name: string) => void;
  setAttribute: (name: string, value: string) => void;
  contains: (other: MockDomElement | null) => boolean;
}

function createMockElement(
  tagName: string,
  parent: MockDomElement | null = null,
  doc?: { body: MockDomElement | null },
): MockDomElement {
  const el: MockDomElement = {
    tagName: tagName.toUpperCase(),
    inert: false,
    parentElement: parent,
    children: [],
    attributes: {},
    ownerDocument: doc ?? parent?.ownerDocument,
    removeAttribute(name: string) {
      delete el.attributes[name];
    },
    setAttribute(name: string, value: string) {
      el.attributes[name] = value;
    },
    contains(other: MockDomElement | null): boolean {
      if (!other) return false;
      let curr: MockDomElement | null = other;
      while (curr) {
        if (curr === el) return true;
        curr = curr.parentElement;
      }
      return false;
    },
  };
  if (parent) {
    parent.children.push(el);
  }
  return el;
}

describe('isolateModalBackground unit tests (TASK-015-REMEDIATION-02 Requirement 3)', () => {
  it('safely handles null modal element without error', () => {
    const handle = isolateModalBackground(null);
    expect(handle).toBeDefined();
    expect(() => handle.restore()).not.toThrow();
  });

  it('inerts background siblings at every ancestor level while keeping modal and ancestors interactive', () => {
    // Construct DOM hierarchy:
    // body
    //   ├── header
    //   └── main
    //         ├── sidebar
    //         └── commandCenter
    //               ├── banner
    //               ├── officeView
    //               └── inspectorBackdrop
    //                     └── dialogPanel
    const mockDoc = { body: null as unknown as MockDomElement };
    const mockBody = createMockElement('body', null, mockDoc);
    mockDoc.body = mockBody;
    const header = createMockElement('header', mockBody);
    const main = createMockElement('main', mockBody);
    const sidebar = createMockElement('div', main);
    const commandCenter = createMockElement('section', main);
    const banner = createMockElement('div', commandCenter);
    const officeView = createMockElement('div', commandCenter);
    const inspectorBackdrop = createMockElement('div', commandCenter);
    const dialogPanel = createMockElement('aside', inspectorBackdrop);

    // Call isolateModalBackground on inspectorBackdrop
    const handle = isolateModalBackground(inspectorBackdrop as unknown as HTMLElement);

    // 1. Sibling elements of the modal within the same container must be inert
    expect(banner.inert).toBe(true);
    expect(officeView.inert).toBe(true);

    // 2. Siblings of ancestors up to body must be inert
    expect(sidebar.inert).toBe(true);
    expect(header.inert).toBe(true);

    // 3. Ancestors containing the dialog must NOT be inert
    expect(commandCenter.inert).toBe(false);
    expect(main.inert).toBe(false);
    expect(mockBody.inert).toBe(false);

    // 4. Modal backdrop and dialog itself must NOT be inert
    expect(inspectorBackdrop.inert).toBe(false);
    expect(dialogPanel.inert).toBe(false);

    // 5. Calling restore must reset inert on all background elements
    handle.restore();

    expect(banner.inert).toBe(false);
    expect(officeView.inert).toBe(false);
    expect(sidebar.inert).toBe(false);
    expect(header.inert).toBe(false);
  });

  it('preserves pre-existing inert state when restoring', () => {
    const mockDoc = { body: null as unknown as MockDomElement };
    const mockBody = createMockElement('body', null, mockDoc);
    mockDoc.body = mockBody;
    const backgroundWidget = createMockElement('div', mockBody);
    backgroundWidget.inert = true; // Was already inert before modal opened
    const otherWidget = createMockElement('div', mockBody);
    const modalContainer = createMockElement('div', mockBody);

    const handle = isolateModalBackground(modalContainer as unknown as HTMLElement);

    expect(backgroundWidget.inert).toBe(true);
    expect(otherWidget.inert).toBe(true);

    handle.restore();

    // Was originally inert -> remains inert
    expect(backgroundWidget.inert).toBe(true);
    // Was originally not inert -> restored to not inert
    expect(otherWidget.inert).toBe(false);
  });

  it('supports repeated open/close cycles and React StrictMode simulation without leaving app inert', () => {
    const mockDoc = { body: null as unknown as MockDomElement };
    const mockBody = createMockElement('body', null, mockDoc);
    mockDoc.body = mockBody;
    const mainContent = createMockElement('main', mockBody);
    const backgroundBtn = createMockElement('button', mainContent);
    const modal = createMockElement('aside', mainContent);

    // Simulation of React StrictMode: mount -> cleanup -> mount -> cleanup
    const cycle1 = isolateModalBackground(modal as unknown as HTMLElement);
    expect(backgroundBtn.inert).toBe(true);
    cycle1.restore();
    expect(backgroundBtn.inert).toBe(false);

    const cycle2 = isolateModalBackground(modal as unknown as HTMLElement);
    expect(backgroundBtn.inert).toBe(true);
    cycle2.restore();
    expect(backgroundBtn.inert).toBe(false);

    // Final state is completely clean and not inert
    expect(backgroundBtn.inert).toBe(false);
  });
});
