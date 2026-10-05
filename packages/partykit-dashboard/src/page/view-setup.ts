// How this project and environment are set up: local configuration and what the project reports.
import type { ProjectSetupReport } from "../types.js";
import { get } from "./api.js";
import type { ViewFn } from "./context.js";
import { h, replace } from "./dom.js";
import { badge, errorBlock, loading, stamp } from "./widgets.js";

const row = (label: string, ...value: (Node | string | null)[]) => h("div", { class: "kv" }, h("dt", null, label), h("dd", { class: "mono" }, ...value));

export const setupView: ViewFn = (root, ctx) => {
  const { project, env } = ctx;
  const report = h("div", null, loading(`Reading ${env.host}`));
  replace(
    root,
    h("h2", null, "Setup"),
    h(
      "div",
      { class: "split even" },
      h(
        "section",
        { class: "panel" },
        h("div", { class: "panel-head" }, "this computer"),
        h(
          "dl",
          { class: "pad" },
          row("project", project.name),
          row("config file", project.configPath ?? "none (defaults: local at localhost:1999)"),
          row("environment", env.name, env.prod ? badge("prod", "danger") : null),
          row("host", env.host),
          row("read secret", `${env.secretEnv} `, badge(env.secretSet ? "set" : "not set", env.secretSet ? "ok" : "danger")),
          row(
            "publish secret",
            env.publishSecretEnv === env.secretEnv ? "same as read secret" : `${env.publishSecretEnv} `,
            env.publishSecretEnv === env.secretEnv ? null : badge(env.publishSecretSet ? "set" : "not set", env.publishSecretSet ? "ok" : "danger"),
          ),
          row("default party", project.party),
          row("registry party", project.registryParty),
          row("parties in partykit.json", project.parties.join(", ")),
          row("presets", project.presets.length ? project.presets.map((p) => p.name).join(", ") : "none"),
          row("labels", project.hasLabels ? "configured" : "none"),
          row("dashboard version", project.packageVersion),
        ),
        h("p", { class: "note pad" }, "Secret values are never shown, only whether each variable is set in your environment or env files."),
      ),
      h("section", { class: "panel" }, h("div", { class: "panel-head" }, "reported by the project"), h("div", { class: "pad" }, report)),
    ),
  );
  let cancelled = false;
  void get<ProjectSetupReport>(`/api/env/${encodeURIComponent(env.name)}/registry?view=config`).then((r) => {
    if (cancelled) return;
    if (!r.ok) {
      replace(report, errorBlock(r.error, "Setup report unavailable", `${env.host} registry`));
      return;
    }
    const c = r.data;
    replace(
      report,
      h(
        "dl",
        null,
        row("package version", c.packageVersion, c.packageVersion !== project.packageVersion ? badge(`local page is ${project.packageVersion}`, "warn") : null),
        row("registry expiry", `${Math.round(c.idleExpiryMs / 3_600_000)} h idle`),
        row("parties", c.parties.length ? c.parties.join(", ") : "none visible"),
        row("history sizes", Object.keys(c.historySizes).length ? Object.entries(c.historySizes).map(([p, n]) => `${p}: ${n}`).join(", ") : "no room has reported yet"),
        row("env variable names", c.envNames.length ? c.envNames.join(", ") : "none"),
        row("first report", c.firstSeenAt ? new Date(c.firstSeenAt).toISOString() : "never"),
      ),
      stamp(`${env.host} registry`, c.readAt),
    );
  });
  return () => {
    cancelled = true;
  };
};
