import { describe, expect, it } from "vitest";
import { openIndex, rebuildIndex } from "./index-db.ts";
import { storePaths } from "./paths.ts";
import { resolveUnit } from "./resolve.ts";
import { UID_A, UID_B, UID_C, makeRepo, makeUnit } from "./test-helpers.ts";

async function store() {
  const paths = storePaths(
    await makeRepo([
      makeUnit(UID_A, { name: "formatPrice" }),
      makeUnit(UID_B, { name: "render", location: { file: "src/a.ts" } }),
      makeUnit(UID_C, { name: "render", location: { file: "src/b.ts" } }),
    ]),
  );
  const db = openIndex(":memory:");
  await rebuildIndex(paths, db);
  return { paths, db };
}

describe("resolveUnit", () => {
  it("accepts a uid, a unique name, or file#name", async () => {
    const { paths, db } = await store();
    expect((await resolveUnit(paths, db, UID_A)).name).toBe("formatPrice");
    expect((await resolveUnit(paths, db, "formatPrice")).uid).toBe(UID_A);
    expect((await resolveUnit(paths, db, "src/b.ts#render")).uid).toBe(UID_C);
  });

  it("refuses an ambiguous name with its candidates, and an unknown one", async () => {
    const { paths, db } = await store();
    await expect(resolveUnit(paths, db, "render")).rejects.toThrow(
      `render is ambiguous: ${UID_B} (src/a.ts#render), ${UID_C} (src/b.ts#render). Pass a uid or file#name`,
    );
    await expect(resolveUnit(paths, db, "nothing")).rejects.toThrow("No unit matches nothing");
    await expect(resolveUnit(paths, db, "src/c.ts#render")).rejects.toThrow("No unit matches src/c.ts#render");
  });
});
