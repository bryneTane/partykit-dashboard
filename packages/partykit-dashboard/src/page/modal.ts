// In-page confirmation modal (never window.confirm). Resolves true when confirmed.
import { h } from "./dom.js";
import { button } from "./widgets.js";

export function confirmModal(opts: { title: string; body: HTMLElement | string; confirmLabel: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    const restore = document.activeElement as HTMLElement | null;
    const cancel = button("Cancel");
    const confirm = button(opts.confirmLabel, { class: `btn ${opts.danger ? "danger" : "primary"}` });
    const panel = h(
      "div",
      { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": opts.title },
      h("div", { class: "modal-head" }, opts.title),
      h("div", { class: "modal-body" }, opts.body),
      h("div", { class: "modal-foot" }, cancel, confirm),
    );
    const backdrop = h("div", { class: "backdrop" }, panel);
    const close = (result: boolean) => {
      document.removeEventListener("keydown", onKey);
      backdrop.remove();
      restore?.focus?.();
      resolve(result);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
      } else if (e.key === "Tab") {
        const items = [cancel, confirm];
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        e.preventDefault();
        items[(i + (e.shiftKey ? items.length - 1 : 1)) % items.length]!.focus();
      }
    };
    cancel.addEventListener("click", () => close(false));
    confirm.addEventListener("click", () => close(true));
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) close(false);
    });
    document.addEventListener("keydown", onKey);
    document.body.append(backdrop);
    cancel.focus();
  });
}
