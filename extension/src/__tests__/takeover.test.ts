// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { compareVersions, displaceOlderCopy, VERSION_ATTR } from "../content/takeover";

const IDS = { tab: "usm-tab", panel: "usm-panel", launcher: "usm-launcher" };

function mountCopy(version: string | null) {
  document.head.innerHTML = `<style id="usm-tab-style"></style>`;
  document.body.innerHTML = `<ul><li id="usm-tab"><a>myScheduleMaker</a></li></ul><div id="usm-panel"></div>`;
  if (version) for (const id of ["usm-tab", "usm-panel", "usm-tab-style"]) document.getElementById(id)!.setAttribute(VERSION_ATTR, version);
}

describe("compareVersions", () => {
  it("compares numerically per part", () => {
    expect(compareVersions("0.1.10", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("0.1.0", "0.1.1")).toBeLessThan(0);
    expect(compareVersions("0.1", "0.1.0")).toBe(0);
  });
});

describe("displaceOlderCopy", () => {
  beforeEach(() => document.documentElement.style.removeProperty("overflow"));

  it("removes an unstamped (pre-0.1.1) copy's tab, style and panel", () => {
    mountCopy(null);
    document.documentElement.style.overflow = "hidden";
    displaceOlderCopy(document, IDS, "0.1.1");
    for (const id of ["usm-tab", "usm-tab-style", "usm-panel"]) expect(document.getElementById(id)).toBeNull();
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("removes an older stamped copy", () => {
    mountCopy("0.1.1");
    displaceOlderCopy(document, IDS, "0.1.2");
    expect(document.getElementById("usm-tab")).toBeNull();
  });

  it("keeps a same-version or newer copy", () => {
    mountCopy("0.1.1");
    displaceOlderCopy(document, IDS, "0.1.1");
    expect(document.getElementById("usm-tab")).not.toBeNull();
    mountCopy("0.2.0");
    displaceOlderCopy(document, IDS, "0.1.1");
    expect(document.getElementById("usm-panel")).not.toBeNull();
  });

  it("handles an older copy that fell back to the launcher", () => {
    document.body.innerHTML = `<button id="usm-launcher"></button>`;
    displaceOlderCopy(document, IDS, "0.1.1");
    expect(document.getElementById("usm-launcher")).toBeNull();
  });
});
