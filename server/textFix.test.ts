import { describe, expect, it } from "vitest";
import { foldKey, preferCanonicalOrgName, repairMojibake } from "./textFix.js";

describe("textFix", () => {
  it("foldKey ignora acento", () => {
    expect(foldKey("Ecommtábil")).toBe(foldKey("Ecommtabil"));
  });

  it("repara Ecommtábil quebrado", () => {
    expect(repairMojibake(`Ecommt${"\uFFFD"}bil`)).toBe("Ecommtábil");
  });

  it("escolhe nome canônico na fusão", () => {
    expect(preferCanonicalOrgName(["Ecommt\uFFFDbil", "Ecommtábil"])).toBe("Ecommtábil");
  });
});
