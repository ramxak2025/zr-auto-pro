/** Real React/DOM regression: run Vite, then open /tests/dialog-focus.html. No API calls. */
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import Modal from '../src/components/Modal';
import { Drawer } from '../src/ui/Drawer';

function Fixture({ kind, autoFocus = false }: { kind: 'Modal' | 'Drawer'; autoFocus?: boolean }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [closedWith, setClosedWith] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // Intentionally recreated on every keystroke, exactly like callers in real forms.
  const onClose = () => {
    setClosedWith(value);
    setOpen(false);
  };
  const children = (
    <input ref={inputRef} id="field" value={value} autoFocus={autoFocus} onChange={(e) => setValue(e.target.value)} />
  );
  return (
    <>
      <button id="open" onClick={() => setOpen(true)}>
        Open
      </button>
      <output id="value">{value}</output>
      <output id="closed">{closedWith}</output>
      {kind === 'Modal' ? (
        <Modal isOpen={open} onClose={onClose} title="Test modal">
          {children}
        </Modal>
      ) : (
        <Drawer open={open} onClose={onClose} title="Test drawer" initialFocusRef={inputRef}>
          {children}
        </Drawer>
      )}
    </>
  );
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const results: string[] = [];
const root = createRoot(document.getElementById('fixture')!);
async function run() {
  for (const kind of ['Modal', 'Drawer'] as const) {
    flushSync(() => root.render(<Fixture key={kind} kind={kind} />));
    const trigger = document.getElementById('open') as HTMLButtonElement;
    trigger.focus();
    flushSync(() => trigger.click());
    await pause(80);
    const input = document.getElementById('field') as HTMLInputElement;
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    for (const value of ['Б', 'Ба', 'Бал', 'Баллон']) {
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await pause(60);
      assert(document.getElementById('value')?.textContent === value, `${kind}: React state failed to update`);
      assert(document.getElementById('field') === input, `${kind}: field remounted`);
      assert(document.activeElement === input, `${kind}: focus lost after typing ${value}`);
      assert(document.body.style.overflow === 'hidden', `${kind}: scroll unlocked while typing`);
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await pause(250);
    assert(document.getElementById('closed')?.textContent === 'Баллон', `${kind}: Escape used stale callback`);
    assert(document.activeElement === trigger, `${kind}: trigger focus not restored`);
    assert(document.body.style.overflow !== 'hidden', `${kind}: scroll lock not released`);
    results.push(`PASS ${kind}: continuous typing, stable DOM, latest Escape callback, focus restore, scroll lock`);

    flushSync(() => root.render(<Fixture key={`${kind}-autofocus`} kind={kind} autoFocus />));
    flushSync(() => document.getElementById('open')!.click());
    await pause(80);
    assert(document.activeElement === document.getElementById('field'), `${kind}: opening timer stole autofocus`);
    flushSync(() => root.render(null));
    await pause(250);
    results.push(`PASS ${kind}: existing input autofocus preserved`);
  }
  document.body.dataset.result = 'pass';
}
run()
  .catch((error) => {
    document.body.dataset.result = 'fail';
    results.push(`FAIL ${String(error)}`);
  })
  .finally(() => {
    document.getElementById('results')!.textContent = results.join('\n');
  });
