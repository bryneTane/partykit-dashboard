// Boots the page: launch token, project description, environment switcher, hash router.
import { get, initToken, onLocalServerDown } from "./api.js";
import type { Ctx, ProjectInfo, ViewFn } from "./context.js";
import { h, replace } from "./dom.js";
import { buildRoute, parseRoute, type Route } from "./router.js";
import { deliveryView } from "./view-delivery.js";
import { healthView } from "./view-health.js";
import { roomView } from "./view-room.js";
import { roomsView } from "./view-rooms.js";
import { setupView } from "./view-setup.js";
import { errorBlock, loading } from "./widgets.js";

const VIEWS: Record<Route["view"], ViewFn> = {
  rooms: roomsView,
  room: roomView,
  delivery: deliveryView,
  health: healthView,
  setup: setupView,
};

const app = document.getElementById("app")!;

async function boot() {
  if (!initToken()) {
    replace(
      app,
      h(
        "main",
        { class: "center" },
        errorBlock(
          { error: "This page needs the address printed by npx partykit-dashboard (it carries a one-time token).", upstreamStatus: "local" },
          "Open the page from the command",
        ),
      ),
    );
    return;
  }
  replace(app, h("main", { class: "center" }, loading("Reading the project")));
  const r = await get<ProjectInfo>("/api/project");
  if (!r.ok) {
    replace(app, h("main", { class: "center" }, errorBlock(r.error, "Could not read the project")));
    return;
  }
  const project = r.data;
  document.title = `${project.name} · partykit-dashboard`;
  const defaultEnv = project.environments[0]!.name;

  const envSelect = h(
    "select",
    { "aria-label": "Environment", class: "mono" },
    project.environments.map((e) => h("option", { value: e.name }, `${e.name}${e.prod ? " (prod)" : ""}`)),
  );
  const nav = h("nav");
  const banner = h("div", { class: "banner", role: "alert", hidden: true }, "The local dashboard server stopped. Run npx partykit-dashboard again, then reload.");
  const main = h("main");
  replace(
    app,
    h("header", null, h("strong", { class: "mono" }, project.name), envSelect, nav, h("span", { class: "spacer" }), h("span", { class: "mono faint small" }, `partykit-dashboard ${project.packageVersion}`)),
    banner,
    main,
  );
  onLocalServerDown((down) => (banner.hidden = !down));

  let dispose: (() => void) | null = null;
  const show = () => {
    let route = parseRoute(location.hash, defaultEnv);
    let env = project.environments.find((e) => e.name === route.env);
    if (!env) {
      route = { env: defaultEnv, view: "rooms" };
      env = project.environments[0]!;
      history.replaceState(null, "", buildRoute(route));
    }
    envSelect.value = env.name;
    replace(
      nav,
      (["rooms", "health", "setup"] as const).map((v) =>
        h("a", { href: buildRoute({ env: env.name, view: v }), class: route.view === v || (v === "rooms" && (route.view === "room" || route.view === "delivery")) ? "active" : "" }, v[0]!.toUpperCase() + v.slice(1)),
      ),
    );
    dispose?.();
    const root = h("div", { class: "view" });
    replace(main, root);
    const ctx: Ctx = { project, env, route, href: buildRoute };
    dispose = VIEWS[route.view](root, ctx);
  };
  envSelect.addEventListener("change", () => {
    location.hash = buildRoute({ env: envSelect.value, view: parseRoute(location.hash, defaultEnv).view === "health" ? "health" : parseRoute(location.hash, defaultEnv).view === "setup" ? "setup" : "rooms" });
  });
  window.addEventListener("hashchange", show);
  show();
}

void boot();
