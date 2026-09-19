export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Build an element from trusted template HTML. Escape any user data with escapeHtml first. */
export function el<T extends HTMLElement = HTMLElement>(html: string): T {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
}

export function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

/** Wire every [data-act] button inside root to a handler. */
export function bindActions(root: HTMLElement, handlers: Record<string, () => void>, onClick?: () => void) {
  root.querySelectorAll<HTMLElement>("[data-act]").forEach((b) => {
    const fn = handlers[b.dataset.act!];
    if (fn)
      b.addEventListener("click", () => {
        onClick?.();
        fn();
      });
  });
}
