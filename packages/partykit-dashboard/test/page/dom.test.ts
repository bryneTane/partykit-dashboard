// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { h, replace, svg } from "../../src/page/dom";

describe("h", () => {
  it("creates elements with classes, attributes and text children", () => {
    const el = h("a", { class: "x y", href: "#/a", title: "t" }, "hello ", h("b", null, "world"));
    expect(el.outerHTML).toBe('<a class="x y" href="#/a" title="t">hello <b>world</b></a>');
  });

  it("never interprets strings as HTML", () => {
    const el = h("div", null, "<img src=x onerror=alert(1)>");
    expect(el.children.length).toBe(0);
    expect(el.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("wires event handlers and skips empty children", () => {
    const click = vi.fn();
    const el = h("button", { onclick: click }, null, false, undefined, ["a", ["b"]]);
    el.click();
    expect(click).toHaveBeenCalledOnce();
    expect(el.textContent).toBe("ab");
    expect(el.getAttribute("onclick")).toBeNull();
  });

  it("handles boolean attributes and style objects", () => {
    const el = h("button", { disabled: true, hidden: false, style: { left: "4px" } });
    expect(el.hasAttribute("disabled")).toBe(true);
    expect(el.hasAttribute("hidden")).toBe(false);
    expect(el.style.left).toBe("4px");
  });

  it("creates SVG elements in the SVG namespace", () => {
    const el = svg("svg", { width: 10 }, svg("rect", { x: 1 }));
    expect(el.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(el.firstElementChild!.namespaceURI).toBe("http://www.w3.org/2000/svg");
  });

  it("replaces a container's children", () => {
    const box = h("div", null, "old");
    replace(box, h("span", null, "new"));
    expect(box.innerHTML).toBe("<span>new</span>");
  });
});
