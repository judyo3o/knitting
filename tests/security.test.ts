import { describe, expect, it } from "vitest";
import { expand, newPattern, normalize, sideOf } from "../src/model";

describe("untrusted pattern data", () => {
  it("rejects row numbers whose increment would never advance", () => {
    expect(() => expand([{ name: "body", rows: [{ from: 2 ** 53, to: 2 ** 53, text: "knit" }] }])).toThrow();
    expect(() => expand([{ name: "body", rows: [{ from: 1, to: 2 ** 53, text: "knit" }] }])).toThrow();
  });

  it("keeps special section names from changing unrelated section settings", () => {
    const result = expand([
      { name: "__proto__", round: true, rows: [{ from: 1, to: 1, text: "knit" }] },
      { name: "body", round: false, rows: [{ from: 2, to: 2, text: "purl" }] },
      { name: "constructor", rows: [{ from: 1, to: 1, text: "knit" }] },
    ]);
    expect(Object.hasOwn(Object.prototype, "round")).toBe(false);
    expect(Object.hasOwn(Object.prototype, "odd")).toBe(false);
    expect(result.secs.body.round).toBe(false);
    expect(Object.hasOwn(result.secs, "constructor")).toBe(true);
  });

  it("normalizes imported dictionaries without inherited section settings", () => {
    const input = JSON.parse('{"id":"x","rows":[{"s":"__proto__","n":1,"t":"knit"}],"secs":{}}');
    const p = normalize(input);
    expect(Object.getPrototypeOf(p.secs)).toBe(null);
    expect(Object.hasOwn(p.secs, "__proto__")).toBe(true);
    expect(Object.hasOwn(Object.prototype, "odd")).toBe(false);
    const restored = normalize(JSON.parse(JSON.stringify(p)));
    expect(restored.secs["__proto__"].odd).toBe("RS");
    expect(sideOf(restored, restored.rows[0])).toBe("RS");
  });

  it("stores arbitrary drawing names as ordinary keys", () => {
    const p = newPattern({ id: "x", name: "test" });
    p.draw["__proto__"] = { w: 1, h: 1, start: 1, cells: "0" };
    expect(Object.getPrototypeOf(p.draw)).toBe(null);
    expect(Object.hasOwn(p.draw, "__proto__")).toBe(true);
  });
});
