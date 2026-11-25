import { describe, expect, it } from "vitest";
import {
  blankSwift,
  braceDepthAt,
  declarationLines,
  ifDepthAt,
  insertStatement,
  lineOf,
  lineStarts,
  mergeBodies,
  renameSwift,
  splitBody,
  swiftBaseName,
  swiftBody,
  swiftContainer,
  swiftDeclarations,
  swiftForwards,
  swiftLabels,
} from "./gate-swift.ts";

const CANVAS = `struct Canvas {
    var strokes: [Stroke] = []

    /// Draws every stroke.
    func draw(_ stroke: Stroke, in rect: Rect) {
        let clipped = stroke.clipped(to: rect)
        guard !clipped.isEmpty
        else { return }
        strokes.append(clipped)
        log("{drew}")
        strokes = strokes
            .filter { $0.isVisible }
    }

    func clear() {
        strokes.removeAll()
    }
}
`;

describe("blankSwift", () => {
  it("blanks comments and strings, keeping offsets and newlines", () => {
    const text = 'let a = "{" // }\n/* { /* } */ } */ let b = #"}"# + """\n{\n"""';
    const blanked = blankSwift(text);
    expect(blanked).toHaveLength(text.length);
    expect(blanked.split("\n")).toHaveLength(text.split("\n").length);
    expect(blanked).not.toMatch(/[{}]/);
    expect(blanked).toContain("let a =");
    expect(blanked).toContain("let b =");
  });
});

describe("lines", () => {
  it("finds line starts and the line of an offset", () => {
    expect(lineStarts("a\nbc\n")).toEqual([0, 0, 2, 5, 5]);
    expect(lineOf("a\nbc\n", 3)).toBe(2);
  });

  it("measures #if and brace depth outside strings", () => {
    const text = '#if os(iOS)\nfunc a() {\n  let s = "}"\n}\n#endif\nfunc b() {}\n';
    expect(ifDepthAt(text, 2)).toBe(1);
    expect(ifDepthAt(text, 6)).toBe(0);
    expect(braceDepthAt(text, text.indexOf("let"))).toBe(1);
    expect(braceDepthAt(text, text.indexOf("func b"))).toBe(0);
  });
});

describe("swiftBody", () => {
  it("finds a function's body and its top-level statements, joining continued lines", () => {
    const body = swiftBody(CANVAS, 5, 13)!;
    expect(CANVAS[body.open]).toBe("{");
    expect(CANVAS[body.close]).toBe("}");
    expect(lineOf(CANVAS, body.close)).toBe(13);
    // guard … else on two lines is one statement, and so is a chained call.
    expect(body.statements.map((start) => CANVAS.slice(start).trimStart().split("\n")[0])).toEqual([
      "let clipped = stroke.clipped(to: rect)",
      "guard !clipped.isEmpty",
      "strokes.append(clipped)",
      'log("{drew}")',
      "strokes = strokes",
    ]);
  });

  it("joins the brace of a multi-line condition, on a line of its own, to its statement", () => {
    // SwiftFormat's style in IceCubes' Router.handle(url:): a cut at one of these braces left code with no handleRest.
    const text = `func handle(url: URL) -> Result {
  guard let client else { return .none }

  if url.isTag,
    let tag = url.last
  {
    navigate(tag)
    return .handled
  } else if url.isAccount,
    let host = url.host
  {
    open(host)
    return .handled
  }
  return .none
}
`;
    const body = swiftBody(text, 1, 16)!;
    expect(body.statements.map((start) => text.slice(start).trimStart().split("\n")[0])).toEqual([
      "guard let client else { return .none }",
      "if url.isTag,",
      "return .none",
    ]);
  });

  it("counts an #if block as one statement, so a split never cuts between #if and #endif", () => {
    // As IceCubes' EditorStore.runAssistant(prompt:) is written: a cut inside left #if and #endif in two functions.
    const text = `func run(prompt: Prompt) async {
  #if !targetEnvironment(macCatalyst)
    let assistant = Assistant()
    var stream: Stream?
    switch prompt {
    case .fit: stream = await assistant.fit()
    }
    if let stream { consume(stream) }
  #else
    fallback()
  #endif
  done()
}
`;
    const body = swiftBody(text, 1, 13)!;
    expect(body.statements.map((start) => text.slice(start).trimStart().split("\n")[0])).toEqual(["#if !targetEnvironment(macCatalyst)", "done()"]);
    expect(splitBody(text, body, "runRest")).toBeUndefined();
  });

  it("is undefined for a type or a computed property", () => {
    expect(swiftBody(CANVAS, 1, 18)).toBeUndefined();
    expect(swiftBody("var area: Double {\n    func inner() {}\n    return 1\n}\n", 1, 4)).toBeUndefined();
  });
});

describe("edits", () => {
  it("inserts a statement at the top of a body", () => {
    const edited = insertStatement(CANVAS, swiftBody(CANVAS, 15, 17)!);
    expect(edited).toContain("func clear() {\n        _ = 0\n        strokes.removeAll()");
  });

  it("splits a body at its middle statement into a new function in the same scope", () => {
    const split = splitBody(CANVAS, swiftBody(CANVAS, 5, 13)!, "drawRest")!;
    expect(split).toContain("        else { return }\n    }\n\n    func drawRest() {\n        strokes.append(clipped)");
    expect(swiftBody(split, lineOf(split, split.indexOf("func drawRest")), 30)!.statements).toHaveLength(3);
    expect(splitBody(CANVAS, swiftBody(CANVAS, 15, 17)!, "clearRest")).toBeUndefined();
  });

  it("merges one body into another and deletes the second with its doc comment", () => {
    const text = "struct A {\n    func one() {\n        a()\n    }\n\n    /// Two.\n    func two() {\n        b()\n    }\n}\n";
    const merged = mergeBodies(text, swiftBody(text, 2, 4)!, swiftBody(text, 7, 9)!, declarationLines(text, 7, 9));
    expect(merged).toBe("struct A {\n    func one() {\n        a()\n    \n        b()\n    }\n\n}\n");
  });
});

describe("names", () => {
  it("splits a qualified name and renames its base", () => {
    expect(swiftBaseName("Canvas.draw(_:in:)")).toBe("draw");
    expect(swiftBaseName("Canvas.Layer")).toBe("Layer");
    expect(swiftContainer("Canvas.draw(_:in:)")).toBe("Canvas.");
    expect(swiftContainer("clamp(_:)")).toBe("");
    expect(renameSwift("Canvas.draw(_:in:)", "drawGate")).toBe("Canvas.drawGate(_:in:)");
    expect(renameSwift("Canvas", "CanvasGate")).toBe("CanvasGate");
  });

  it("counts every declaration of a name, units or not, outside comments", () => {
    const counts = swiftDeclarations([CANVAS, "enum Mode { case draw }\n// func clear()\nprivate let strokes = 1\n"]);
    expect(counts.get("draw")).toBe(2);
    expect(counts.get("clear")).toBe(1);
    expect(counts.get("strokes")).toBe(2);
    expect(counts.get("Canvas")).toBe(1);
  });
});

describe("swiftLabels", () => {
  it("collects argument labels and parameter names at calls and declarations, outside comments", () => {
    const labels = swiftLabels(["func index(after i: Int) -> Int { headers.index(before: i) }\n// f(skipped: 1)\n", "let d = [1: 2]\nlet t = a ? b : c\n"]);
    expect([...labels].sort()).toEqual(["after", "before", "i"]);
  });

  it("collects a parameter's internal name as well as its label", () => {
    // Alamofire's `SecPolicy.af.hostname(_:)` takes `_ hostname`, so renaming the function by text renamed its parameter.
    expect(swiftLabels(["static func hostname(_ hostname: String) -> SecPolicy { make(hostname) }"]).has("hostname")).toBe(true);
  });
});

describe("swiftForwards", () => {
  const text = [
    "struct Headers {",
    "  var startIndex: Int { headers.startIndex }",
    "  mutating func sort() {",
    "    headers.sort { $0 < $1 }",
    "  }",
    "  func sorted() -> Headers { self.sort(); return self }",
    "  func label() -> String { \"x.label\" }",
    "}",
  ].join("\n");

  it("finds a member that forwards to another's member of the same name", () => {
    expect(swiftForwards(text, 2, 2, "startIndex")).toBe(true);
    expect(swiftForwards(text, 3, 5, "sort")).toBe(true);
  });

  it("ignores its own calls through self and the name inside strings", () => {
    expect(swiftForwards(text, 6, 6, "sort")).toBe(false);
    expect(swiftForwards(text, 7, 7, "label")).toBe(false);
  });
});
