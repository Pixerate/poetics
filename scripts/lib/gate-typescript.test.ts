import { describe, expect, it } from "vitest";
import { textOnlyWords } from "./gate-typescript.ts";

describe("textOnlyWords", () => {
  it("finds words in strings, template literals and after a dot", () => {
    const words = textOnlyWords([
      `export function submit() { return find('[data-testid="submit"]'); }`,
      "const label = `total ${count}`; form.reset(); user?.profile;",
    ]);
    // `$` and `count` come from the template's `${count}`, read as string.
    expect([...words].sort()).toEqual(["$", "count", "data", "profile", "reset", "submit", "testid", "total"]);
  });

  it("leaves out declarations, calls and spreads", () => {
    const words = textOnlyWords(["export function compute(input: number) { return helper(...rest, input); }"]);
    expect(words.size).toBe(0);
  });

  it("reads markup attribute values as strings", () => {
    expect(textOnlyWords([`<button data-testid="submit" onclick={submit}>Send</button>`]).has("submit")).toBe(true);
    expect(textOnlyWords([`<button onclick={submit}>Send</button>`]).has("submit")).toBe(false);
  });
});
