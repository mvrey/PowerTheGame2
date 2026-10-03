import { h } from './dom';

export interface ModalButton {
  label: string;
  primary?: boolean;
  /** Return false to keep the modal open. */
  action?: () => boolean | void;
}

export interface ModalHandle {
  el: HTMLElement;
  close(): void;
}

const open = new Set<ModalHandle>();

/** Closes every open dialog (their onClose callbacks run). */
export function closeAllModals(): void {
  for (const handle of [...open]) handle.close();
}

/** Centred dialog over a dimmed backdrop. */
export function modal(
  title: string,
  body: (Node | string)[],
  buttons: ModalButton[] = [],
  opts: { wide?: boolean; onClose?: () => void; dismissable?: boolean } = {},
): ModalHandle {
  const close = () => {
    if (!backdrop.isConnected) return;
    backdrop.remove();
    open.delete(handle);
    window.removeEventListener('keydown', onKey, true);
    opts.onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    // Only the topmost dialog reacts.
    if ([...open].pop() !== handle) return;
    if (e.key === 'Escape' && opts.dismissable !== false) {
      e.stopPropagation();
      close();
    }
  };
  const box = h(
    'div.modal',
    { class: opts.wide ? 'wide' : '', role: 'dialog', 'aria-modal': 'true' },
    h('h2', null, title),
    h('div.modal-body', null, ...body),
    buttons.length
      ? h(
          'div.modal-buttons',
          null,
          ...buttons.map((b) =>
            h(
              'button.btn',
              {
                class: b.primary ? 'primary' : '',
                onclick: () => {
                  if (b.action?.() !== false) close();
                },
              },
              b.label,
            ),
          ),
        )
      : null,
  );
  const backdrop = h(
    'div.backdrop',
    {
      onpointerdown: (e: Event) => {
        if (e.target === backdrop && opts.dismissable !== false) close();
      },
    },
    box,
  );
  document.body.append(backdrop);
  window.addEventListener('keydown', onKey, true);
  (box.querySelector('button.primary') as HTMLElement | null)?.focus();
  const handle: ModalHandle = { el: box, close };
  open.add(handle);
  return handle;
}

let toastTimer = 0;
/** Brief message at the bottom of the screen. */
export function toast(text: string): void {
  document.querySelector('.toast')?.remove();
  const el = h('div.toast', { role: 'status' }, text);
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.remove(), 2600);
}
