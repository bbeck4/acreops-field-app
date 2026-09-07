import { describe, expect, it } from "vitest";

import { getVisibleMoreTabLinks } from "./moreTabLinks";

describe("getVisibleMoreTabLinks", () => {
  it("uses nested routes under the visible More tab", () => {
    const links = getVisibleMoreTabLinks(() => true);

    expect(links).toEqual([
      expect.objectContaining({ name: "loads", href: "/more/loads" }),
      expect.objectContaining({ name: "map", href: "/more/map" }),
      expect.objectContaining({ name: "orders", href: "/more/orders" }),
    ]);
  });

  it("only exposes destinations the member may see", () => {
    const links = getVisibleMoreTabLinks((name) => name === "orders");

    expect(links).toEqual([
      expect.objectContaining({ name: "orders", href: "/more/orders" }),
    ]);
  });
});