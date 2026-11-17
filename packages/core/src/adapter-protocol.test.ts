import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ADAPTER_PROTOCOL, checkAdapterResponse } from "./adapter-protocol.ts";
import type { AdapterRequest, AdapterResponse, AdapterUnit } from "./adapter-protocol.ts";
import type { Hash } from "./types.ts";

const FIXTURES = join(import.meta.dirname, "../../../schemas/fixtures/adapter");
const fixture = async (name: string) => ({
  request: JSON.parse(await readFile(join(FIXTURES, name, "request.json"), "utf8")) as AdapterRequest,
  response: JSON.parse(await readFile(join(FIXTURES, name, "response.json"), "utf8")) as AdapterResponse,
});

const HASH = `b3:${"a".repeat(64)}` as Hash;
const unit = (key: string, extra: Partial<AdapterUnit> = {}): AdapterUnit => ({
  key,
  name: key.split("#")[1]!,
  kind: "function",
  framework: "none",
  startLine: 1,
  endLine: 2,
  contentHash: HASH,
  interfaceHash: HASH,
  fingerprint: [],
  signatureText: "func f()",
  edges: [],
  unresolved: [],
  ...extra,
});
const request: AdapterRequest = { protocol: ADAPTER_PROTOCOL, root: "/r", files: [{ path: "a.swift" }, { path: "b.swift" }] };
const respond = (files: AdapterResponse["files"]): AdapterResponse => ({ protocol: ADAPTER_PROTOCOL, adapter: { name: "swift", version: "0.1.0", rules: 1 }, files });

describe("checkAdapterResponse", () => {
  it("accepts the swift-basic fixture, with the file it could not read reported as not read", async () => {
    const { request, response } = await fixture("swift-basic");
    expect(checkAdapterResponse(request, response)).toEqual({ errors: [], notRead: ["Sources/Paint/Generated.swift"] });
  });

  it("counts a requested path with no entry as not read, not as an error", () => {
    expect(checkAdapterResponse(request, respond([{ path: "a.swift", units: [] }]))).toEqual({ errors: [], notRead: ["b.swift"] });
  });

  it("rejects paths that were not requested or are answered twice", () => {
    const { errors } = checkAdapterResponse(request, respond([{ path: "a.swift", units: [] }, { path: "a.swift", units: [] }, { path: "c.swift", units: [] }]));
    expect(errors).toEqual(["a.swift: answered more than once", "c.swift: not requested"]);
  });

  it("rejects duplicate keys, keys outside their file and backwards line ranges", () => {
    const { errors } = checkAdapterResponse(
      request,
      respond([
        { path: "a.swift", units: [unit("a.swift#f()"), unit("a.swift#f()"), unit("b.swift#g()"), unit("a.swift#h()", { startLine: 5, endLine: 4 })] },
      ]),
    );
    expect(errors).toEqual([
      "a.swift#f(): key is not unique in the batch",
      "b.swift#g(): key does not start with its file, a.swift#",
      "a.swift#h(): ends at line 4, before it starts at 5",
    ]);
  });

  it("accepts owners and edge targets in other files of the batch", () => {
    const response = respond([
      { path: "a.swift", units: [unit("a.swift#T", { kind: "type" })] },
      { path: "b.swift", units: [unit("b.swift#T.m()", { owner: "a.swift#T", edges: [{ to: "a.swift#T", kind: "references-type", resolution: "name" }] })] },
    ]);
    expect(checkAdapterResponse(request, response).errors).toEqual([]);
  });

  it("rejects owners and edge targets that are not units in the batch, and a unit that owns itself", () => {
    const response = respond([
      {
        path: "a.swift",
        units: [
          unit("a.swift#f()", { owner: "a.swift#Missing", edges: [{ to: "z.swift#g()", kind: "calls", resolution: "exact" }] }),
          unit("a.swift#g()", { owner: "a.swift#g()" }),
        ],
      },
    ]);
    expect(checkAdapterResponse(request, response).errors).toEqual([
      "a.swift#f(): owner a.swift#Missing is not a unit in the batch",
      "a.swift#f(): calls edge to z.swift#g(), which is not a unit in the batch",
      "a.swift#g(): owns itself",
    ]);
  });

  it("does not count edges into a file the adapter could not read as resolved", () => {
    const response = respond([
      { path: "a.swift", units: [unit("a.swift#f()", { edges: [{ to: "b.swift#g()", kind: "calls", resolution: "name" }] })] },
      { path: "b.swift", error: "unreadable" },
    ]);
    expect(checkAdapterResponse(request, response)).toEqual({ errors: ["a.swift#f(): calls edge to b.swift#g(), which is not a unit in the batch"], notRead: ["b.swift"] });
  });
});
