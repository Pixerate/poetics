import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SiteData } from "../site/src/lib/types.ts";
import { exportSiteData } from "./export-site-data.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("scripts/export-site-data.ts", () => {
  it("exports this repository's units, notes, coverage and decisions", async () => {
    const out = join(await mkdtemp(join(tmpdir(), "poetics-site-")), "data.json");
    await exportSiteData(REPO_ROOT, out);
    const data = JSON.parse(await readFile(out, "utf8")) as SiteData;
    expect(data.repo.url).toBe("https://github.com/Pixerate/poetics");
    expect(data.repo.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(data.units.length).toBeGreaterThan(100);
    expect(data.units.find((u) => u.name === "checkStore")?.source).toContain("export async function checkStore");
    expect(data.notes.length).toBeGreaterThan(0);
    expect(data.decisions.map((d) => d.id)).toContain("0007");
    expect(data.coverage.overall.tracked.total).toBeGreaterThan(0);
  });
});
