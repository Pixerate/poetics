// The Svelte adapter (ADR 0020): a framework plugin for the TypeScript indexer.
// Each .svelte file is turned into TypeScript by svelte2tsx, the transform
// svelte-check uses, and read by the same checker as every other file. Each
// component is one unit, hashed from its source as written.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import ts from "typescript";
import { svelte2tsx } from "svelte2tsx";
import { detectUnits, normaliseNode } from "@poetics/adapter-typescript";
import type { DetectedUnit, FrameworkPlugin, NormalTree, Signature, Transformed, TypeText } from "@poetics/adapter-typescript";
import { offsetMapper } from "./source-map.ts";

export { decodeMappings, offsetMapper } from "./source-map.ts";

export type SvelteMajor = 4 | 5;

/** `.svelte` files are components; `.svelte.ts` / `.svelte.js` are rune modules indexed as TypeScript. */
export function svelteFileKind(file: string): "component" | "rune-module" | undefined {
  if (file.endsWith(".svelte")) return "component";
  if (/\.svelte\.(ts|js)$/.test(file)) return "rune-module";
  return undefined;
}

/** The component name Svelte tooling uses: the file's basename. */
export function componentNameFromFile(file: string): string {
  const base = file.split(/[\\/]/).pop() ?? file;
  return base.replace(/\.svelte$/, "");
}

/**
 * Best-effort Svelte major for one component: `$props()` means 5; `export let`
 * or `createEventDispatcher` means 4. Mixed codebases are expected.
 */
export function detectSvelteMajor(source: string): SvelteMajor | undefined {
  if (/\$props\s*\(/.test(source)) return 5;
  if (/\bexport\s+let\b|\bcreateEventDispatcher\b/.test(source)) return 4;
  return undefined;
}

const require = createRequire(import.meta.url);
const SVELTE2TSX_VERSION = (JSON.parse(readFileSync(require.resolve("svelte2tsx/package.json"), "utf8")) as { version: string }).version;

/** Bumped when the plugin's own rules change what it records; svelte2tsx's version is added to it. */
const RULES = 3;

const SCRIPT = /<script(\s[^>]*)?>([\s\S]*?)<\/script\s*>/gi;

/** Where a component's script blocks are, and whether each is the module script. */
interface ScriptBlock {
  module: boolean;
  start: number;
  end: number;
  body: string;
}

function scriptBlocks(text: string): ScriptBlock[] {
  return [...text.matchAll(SCRIPT)].map((m) => {
    const attributes = m[1] ?? "";
    return {
      module: /\bmodule\b|context\s*=\s*["']module["']/.test(attributes),
      start: m.index!,
      end: m.index! + m[0].length,
      body: m[2] ?? "",
    };
  });
}

/**
 * The content and runtime trees of a component, from its source as written:
 * each script normalised as TypeScript, so formatting and comments never count;
 * markup and styles with comments dropped and whitespace collapsed. The
 * TypeScript svelte2tsx generates never enters them (ADR 0020).
 */
export function svelteContent(text: string): { tree: NormalTree; runtime: NormalTree } {
  const blocks = scriptBlocks(text);
  let rest = "";
  let at = 0;
  for (const block of blocks) {
    rest += text.slice(at, block.start);
    at = block.end;
  }
  rest += text.slice(at);
  const markup = rest
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(<style[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (_, open: string, css: string, close: string) => `${open}${css.replace(/\/\*[\s\S]*?\*\//g, "")}${close}`)
    .replace(/\s+/g, " ")
    // Space just inside a tag's brackets is formatting: `<p >` is `<p>`, `<br />` is `<br/>`.
    .replace(/<\s+/g, "<")
    .replace(/\s+(\/?>)/g, "$1")
    .trim();
  const script = (block: ScriptBlock, eraseTypes: boolean): NormalTree => {
    const source = ts.createSourceFile("script.ts", block.body, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    return ["Script", block.module ? "module" : "instance", normaliseNode(source, { eraseTypes })];
  };
  const tree = (eraseTypes: boolean): NormalTree => ["SvelteComponent", ...blocks.map((block) => script(block, eraseTypes)), ["Markup", markup]];
  return { tree: tree(false), runtime: tree(true) };
}

/** The component's `<!-- @component -->` comment, which Svelte tooling shows as its docs. */
export function componentDocs(text: string): string | undefined {
  const match = /<!--\s*@component\b([\s\S]*?)-->/.exec(text);
  return match?.[1]?.trim() || undefined;
}

/** What a caller reads about a component: how it takes its props, as written. */
export function componentSignatureText(text: string): string {
  const lines: string[] = [];
  for (const block of scriptBlocks(text).filter((b) => !b.module)) {
    const source = ts.createSourceFile("script.ts", block.body, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      const exported = (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      const props = statement.declarationList.declarations.some((d) => d.initializer && ts.isCallExpression(d.initializer) && d.initializer.expression.getText(source) === "$props");
      if (exported || props) lines.push(statement.getText(source));
    }
  }
  return lines.join("\n");
}

/** The Svelte version a component's project uses, which changes what svelte2tsx emits. */
function svelteVersionFor(file: string, cache: Map<string, string | undefined>): string | undefined {
  const dir = dirname(file);
  if (!cache.has(dir)) {
    let version: string | undefined;
    try {
      const path = createRequire(join(dir, "noop.js")).resolve("svelte/package.json");
      version = (JSON.parse(readFileSync(path, "utf8")) as { version: string }).version;
    } catch {
      version = undefined;
    }
    cache.set(dir, version);
  }
  return cache.get(dir);
}

/**
 * Turns a component into TypeScript with svelte2tsx. A component svelte2tsx
 * cannot read still gets a stand-in default export, so it stays one unit and
 * its source is still hashed.
 */
export function transformComponent(file: string, text: string, svelteVersion?: string): Transformed {
  try {
    const out = svelte2tsx(text, {
      filename: file,
      isTsFile: /<script[^>]*\blang\s*=\s*["']ts["']/.test(text),
      mode: "ts",
      emitOnTemplateError: true,
      ...(svelteVersion ? { version: svelteVersion } : {}),
    });
    return { code: out.code, toOriginal: offsetMapper(out.map.mappings, out.code, text) };
  } catch {
    return { code: "declare const __poetics_unreadable_component__: any;\nexport default __poetics_unreadable_component__;\n", toOriginal: () => undefined };
  }
}

/** The variable svelte2tsx exports as the component: the target of `export default`. */
function defaultExport(source: ts.SourceFile): ts.VariableDeclaration | ts.ClassDeclaration | undefined {
  // For Svelte 4, svelte2tsx exports a class instead.
  const component = source.statements.find((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && isExported(s) && (ts.getModifiers(s) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword));
  if (component) return component;
  const assignment = source.statements.find((s): s is ts.ExportAssignment => ts.isExportAssignment(s) && !s.isExportEquals);
  if (!assignment || !ts.isIdentifier(assignment.expression)) return undefined;
  const name = assignment.expression.text;
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const found = statement.declarationList.declarations.find((d) => ts.isIdentifier(d.name) && d.name.text === name);
    if (found) return found;
  }
  return undefined;
}

/**
 * A component's units: the component itself, spanning the whole file, and
 * anything its module script exports, with spans mapped back to the file.
 */
export function detectComponent(source: ts.SourceFile, file: string, original: string, transformed: Transformed): DetectedUnit[] {
  const units: DetectedUnit[] = [];
  const component = defaultExport(source);
  const name = componentNameFromFile(file);
  if (component) {
    const unit: DetectedUnit = {
      key: `${file}#${name}`,
      name,
      exportedAs: "default",
      kind: "component",
      span: { file, start: 0, end: original.length },
      declarations: [component],
      framework: "svelte",
      content: svelteContent(original),
      signatureText: componentSignatureText(original),
    };
    const docs = componentDocs(original);
    if (docs) unit.docs = docs;
    units.push(unit);
  }
  // Exports of the module script are units of their own, like any module's. Generated names are not.
  for (const unit of detectUnits(source, file)) {
    if (unit.exportedAs === "default" || unit.name.includes("__") || unit.name.startsWith("$$")) continue;
    const start = transformed.toOriginal(unit.span.start);
    const end = transformed.toOriginal(unit.span.end);
    if (start === undefined) continue;
    units.push({ ...unit, span: { file, start, end: Math.max(start, end ?? start) } });
  }
  return units;
}

/**
 * A component's interface: its props type, read from what svelte2tsx's render
 * function returns. For Svelte 5 that is the `$props()` type as written; for
 * Svelte 4, the props svelte2tsx gathers from `export let`, with the events
 * the component dispatches or forwards and its slots. Defaults are part of it.
 */
export function componentSignature(unit: DetectedUnit, checker: ts.TypeChecker): Signature | undefined {
  if (unit.kind !== "component") return undefined;
  const source = unit.declarations[0]!.getSourceFile();
  const render = source.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === "$$render");
  const returned = render?.body?.statements.find(ts.isReturnStatement)?.expression;
  const props = returned && ts.isObjectLiteralExpression(returned) ? returned.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(source) === "props") : undefined;
  const withMembers = (signature: Signature): Signature => (returned && ts.isObjectLiteralExpression(returned) && signature.kind === "component" ? { ...signature, ...legacyMembers(returned, checker) } : signature);
  if (!props) return withMembers({ kind: "component", props: null, defaults: [] });
  let written: ts.TypeNode | undefined;
  for (let expression: ts.Expression = props.initializer; ts.isAsExpression(expression); expression = expression.expression) {
    written ??= expression.type;
  }
  // svelte2tsx says a component takes no props with `Record<string, never>`.
  if (written && written.getText(source).replace(/\s/g, "") === "Record<string,never>") return withMembers({ kind: "component", props: null, defaults: [] });
  // A props type declared in the component itself is not a unit, so its structure, not its name, is the interface.
  // That covers svelte2tsx's hoisted alias for inline types (inside the render function when it inferred them)
  // and an interface the script declares without exporting it.
  let local: ts.InterfaceDeclaration | undefined;
  if (written && ts.isTypeReferenceNode(written) && ts.isIdentifier(written.typeName) && !written.typeArguments) {
    const name = written.typeName.text;
    const declared = [...source.statements, ...(render?.body?.statements ?? [])].find(
      (s): s is ts.TypeAliasDeclaration | ts.InterfaceDeclaration => (ts.isTypeAliasDeclaration(s) || ts.isInterfaceDeclaration(s)) && s.name.text === name && !isExported(s),
    );
    if (declared && ts.isTypeAliasDeclaration(declared)) written = declared.type;
    else if (declared) local = declared;
  }
  // A JavaScript component's props are typed in a JSDoc typedef, which a TypeScript file's checker ignores, so it is read as written.
  const typedef = !written ? /@typedef\s*\{([\s\S]*?)\}\s*\$\$ComponentProps\b/.exec(source.text)?.[1] : undefined;
  if (typedef !== undefined) {
    const parsed = ts.createSourceFile("props.ts", `type P = ${typedef};`, ts.ScriptTarget.Latest, true).statements[0];
    if (parsed && ts.isTypeAliasDeclaration(parsed)) written = parsed.type;
  }
  let inferred: string | undefined;
  if (!written) {
    const type = checker.getTypeAtLocation(props.initializer);
    const generated = type.aliasSymbol?.name.startsWith("$$") ?? false;
    inferred = checker.typeToString(type, generated ? undefined : props, ts.TypeFormatFlags.NoTruncation | (generated ? ts.TypeFormatFlags.InTypeAlias : 0));
  }
  return withMembers({
    kind: "component",
    // The interface's own name is left out, so renaming it is not an interface change.
    props: local ? { written: normaliseNode(local, { omit: new Set([local.name]) }) } : written ? { written: normaliseNode(written) } : { inferred: inferred! },
    defaults: render ? [...propDefaults(render), ...exportLetDefaults(render, props.initializer)].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) : [],
  });
}

/**
 * A Svelte 4 component's `export let` defaults. svelte2tsx turns each prop
 * into a plain `let` in its render function and lists the props in the object
 * it returns, so a `let` named there with a value is a prop's default.
 */
function exportLetDefaults(render: ts.FunctionDeclaration, props: ts.Expression): Array<{ name: string; value: NormalTree }> {
  let literal: ts.Expression = props;
  while (ts.isAsExpression(literal) || ts.isParenthesizedExpression(literal)) literal = literal.expression;
  if (!ts.isObjectLiteralExpression(literal)) return [];
  const names = new Set(literal.properties.flatMap((p) => (p.name && ts.isIdentifier(p.name) ? [p.name.text] : [])));
  const defaults: Array<{ name: string; value: NormalTree }> = [];
  for (const statement of render.body?.statements ?? []) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && names.has(declaration.name.text) && declaration.initializer) {
        defaults.push({ name: declaration.name.text, value: normaliseNode(declaration.initializer) });
      }
    }
  }
  return defaults;
}

/**
 * A Svelte 4 component's events and slots, from the object svelte2tsx's render
 * function returns: each event a listener can receive with its type, and each
 * slot with the props it passes. Left out when there are none, as for a
 * Svelte 5 component, so its interface is unchanged.
 */
function legacyMembers(returned: ts.ObjectLiteralExpression, checker: ts.TypeChecker): { events?: Array<{ name: string; type: TypeText }>; slots?: Array<{ name: string; props: TypeText }> } {
  const member = (name: string) => returned.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText() === name);
  const byName = <T extends { name: string }>(items: T[]) => items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const typeOf = (symbol: ts.Symbol, at: ts.Node): TypeText => ({ inferred: checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, at), at, ts.TypeFormatFlags.NoTruncation) });
  const out: { events?: Array<{ name: string; type: TypeText }>; slots?: Array<{ name: string; props: TypeText }> } = {};
  const events = member("events");
  if (events) {
    const found = checker.getTypeAtLocation(events.initializer).getProperties().map((symbol) => ({ name: symbol.name, type: typeOf(symbol, events) }));
    if (found.length > 0) out.events = byName(found);
  }
  const slots = member("slots");
  if (slots) {
    const found = checker.getTypeAtLocation(slots.initializer).getProperties().map((symbol) => ({ name: symbol.name, props: typeOf(symbol, slots) }));
    if (found.length > 0) out.slots = byName(found);
  }
  return out;
}

function isExported(statement: ts.Statement): boolean {
  return ts.canHaveModifiers(statement) && (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/**
 * The default value of each prop that has one, from the `$props()` destructure:
 * a caller that leaves the prop out gets it, so it is interface. A
 * `$bindable(…)` default is kept whole, since whether a prop binds is
 * interface too.
 */
function propDefaults(render: ts.FunctionDeclaration): Array<{ name: string; value: NormalTree }> {
  const defaults: Array<{ name: string; value: NormalTree }> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer) && ts.isIdentifier(node.initializer.expression) && node.initializer.expression.text === "$props" && ts.isObjectBindingPattern(node.name)) {
      for (const element of node.name.elements) {
        if (!element.initializer || element.dotDotDotToken) continue;
        const name = element.propertyName && !ts.isComputedPropertyName(element.propertyName) ? element.propertyName.getText() : element.name.getText();
        defaults.push({ name: name.replace(/^["']|["']$/g, ""), value: normaliseNode(element.initializer) });
      }
      return;
    }
    // Nested functions are the component's own code, not its props.
    if (ts.isFunctionLike(node) && node !== render) return;
    node.forEachChild(visit);
  };
  visit(render);
  return defaults.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The svelte2tsx shims the generated code is typed against. */
function shims(): string[] {
  return ["svelte2tsx/svelte-shims-v4.d.ts", "svelte2tsx/svelte-jsx-v4.d.ts"].map((path) => require.resolve(path));
}

/**
 * The Svelte plugin for the TypeScript indexer: `.svelte` files, read through
 * svelte2tsx (ADR 0020). svelte2tsx's output depends on the Svelte version, read
 * from each component's project unless `svelteVersion` says otherwise.
 */
export function sveltePlugin(options: { svelteVersion?: string } = {}): FrameworkPlugin {
  const versions = new Map<string, string | undefined>();
  return {
    framework: "svelte",
    version: `${RULES}+svelte2tsx@${SVELTE2TSX_VERSION}`,
    extensions: [".svelte"],
    ambient: shims(),
    transform(file, text) {
      return transformComponent(file, text, options.svelteVersion ?? svelteVersionFor(file, versions));
    },
    detect: detectComponent,
    signature(unit, _fn, checker) {
      return unit.framework === "svelte" ? componentSignature(unit, checker) : undefined;
    },
    edgeKind(node, target) {
      if (target.framework !== "svelte" || target.kind !== "component") return undefined;
      // svelte2tsx turns `<PriceTag … />` into `__sveltets_2_ensureComponent(PriceTag)`, and a closing `</PriceTag>` into a bare `PriceTag;`.
      const parent = node.parent;
      if (ts.isCallExpression(parent) && parent.arguments[0] === node && /^__sveltets_\d+_ensureComponent$/.test(parent.expression.getText())) return "renders";
      if (ts.isExpressionStatement(parent) && parent.expression === node) return "renders";
      return undefined;
    },
  };
}
