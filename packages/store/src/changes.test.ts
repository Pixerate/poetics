import { describe, expect, it } from "vitest";
import { NotImplementedError } from "@poetics/core";
import { changesBetween } from "./changes.ts";
import { storePaths } from "./paths.ts";

describe("changesBetween", () => {
  it("is a stub until the indexer lands", () => {
    expect(() => changesBetween(storePaths("."), { from: "main" })).toThrow(NotImplementedError);
  });
});
