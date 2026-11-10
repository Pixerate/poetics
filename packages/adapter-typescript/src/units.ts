// What a unit is in plain TypeScript, what callers depend on, and what it uses.
// Detection is syntactic, so it can run on cached files; signatures and edges
// need the checker.
import ts from "typescript";
import type { EdgeKind, Framework, Span, UnitKind } from "@poetics/core";
import { normaliseNode } from "./normalise.ts";
import type { NormalTree } from "./normalise.ts";

type UnitDeclaration = ts.FunctionDeclaration | ts.VariableDeclaration | ts.InterfaceDeclaration | ts.TypeAliasDeclaration;

/** A unit found in one source file, before any checker work. */
export interface DetectedUnit {
  /** `file#name`, unique within an index; a type sharing a function's name gets `file#name:type`. */
  key: string;
  name: string;
  /** The name the module exports it as, when that differs from `name`. */
  exportedAs?: string;
  kind: UnitKind;
  span: Span;
  /** Overloads and merged interfaces give a unit more than one declaration. */
  declarations: UnitDeclaration[];
  /** The leading TSDoc comment, if any. */
  docs?: string;
  /** `none` for plain TypeScript, or the framework whose plugin claimed the unit. */
  framework: Framework;
  /** Wrapper calls the unit's function was found inside, such as `memo`, outermost first. */
  wrappers?: string[];
}

/**
 * What a framework adapter adds to this indexer, so React and Svelte units
 * resolve through the same checker as plain TypeScript: wrappers to see
 * through, units to claim as its own kinds, their interfaces, and edge kinds.
 */
export interface FrameworkPlugin {
  framework: Framework;
  /** Bumped whenever the plugin's rules change what it claims or records, so cached units made by older rules are indexed again. */
  version?: number;
  /** The function a call such as `memo(fn)` wraps, when this framework knows the wrapper. */
  unwrap?(call: ts.CallExpression): ts.Expression | undefined;
  /** The kind this framework gives a unit, or undefined to leave it as plain TypeScript. */
  claim?(unit: DetectedUnit, fn: ts.SignatureDeclaration | undefined): UnitKind | undefined;
  /** The interface of a unit it claimed, or undefined for the plain function signature. */
  signature?(unit: DetectedUnit, fn: ts.SignatureDeclaration, checker: ts.TypeChecker): Signature | undefined;
  /** The kind of a use of `target` at `node`, when the framework knows better (JSX renders a component). */
  edgeKind?(node: ts.Identifier, target: DetectedUnit): EdgeKind | undefined;
}

/** A parameter or return type as written, or as the checker infers it when nothing is written. */
export type TypeText = { written: NormalTree } | { inferred: string };

export interface ParameterSignature {
  rest: boolean;
  optional: boolean;
  type: TypeText;
  /** A default value is interface: callers that omit the argument get it. */
  default?: NormalTree;
}

export interface CallSignature {
  typeParameters: NormalTree[];
  parameters: ParameterSignature[];
  returns: TypeText;
}

/** What callers depend on: call signatures for functions and hooks, the structure for types. */
export type Signature =
  | { kind: "function"; declared?: NormalTree; overloads: CallSignature[] }
  | { kind: "type"; declaration: NormalTree }
  | {
      kind: "component";
      /** The props type, or null for a component that takes none. */
      props: TypeText | null;
      /** Default prop values: callers that omit a prop get them, so they are interface. */
      defaults: Array<{ name: string; value: NormalTree }>;
      /** The ref type, for components that forward one. */
      ref?: TypeText;
    };

/** A use of another unit, by its key. */
export interface IndexedEdge {
  to: string;
  kind: EdgeKind;
}

/** A use the checker could not resolve. Shown, never guessed. */
export interface UnresolvedUse {
  kind: EdgeKind;
  span: Span;
  reason: string;
}

const TYPE_FORMAT = ts.TypeFormatFlags.NoTruncation;

/**
 * Exported functions, hooks, interfaces and type aliases declared in `source`,
 * in source order. `plugins` see through their wrappers and claim their units.
 */
export function detectUnits(source: ts.SourceFile, file: string, plugins: readonly FrameworkPlugin[] = []): DetectedUnit[] {
  const exported = exportedNames(source);
  const groups = new Map<string, { name: string; kind: UnitKind; declarations: UnitDeclaration[]; statements: ts.Node[] }>();
  const add = (name: string, kind: UnitKind, declaration: UnitDeclaration, statement: ts.Node) => {
    // Values and types live in separate namespaces, so `type X` and `function X` are two units.
    const space = kind === "type" ? "type" : "value";
    const group = groups.get(`${space}:${name}`);
    if (group) {
      group.declarations.push(declaration);
      group.statements.push(statement);
    } else {
      groups.set(`${space}:${name}`, { name, kind, declarations: [declaration], statements: [statement] });
    }
  };

  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      const name = statement.name?.text ?? "default";
      if (hasExportModifier(statement) || exported.has(name)) add(name, functionKind(name), statement, statement);
    } else if (ts.isVariableStatement(statement)) {
      const list = statement.declarationList.declarations;
      for (const declaration of list) {
        if (!ts.isIdentifier(declaration.name) || !functionOf(declaration, plugins)) continue;
        const name = declaration.name.text;
        if (hasExportModifier(statement) || exported.has(name)) add(name, functionKind(name), declaration, list.length === 1 ? statement : declaration);
      }
    } else if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      const name = statement.name.text;
      if (hasExportModifier(statement) || exported.has(name)) add(name, "type", statement, statement);
    }
  }

  const values = new Set([...groups.values()].filter((g) => g.kind !== "type").map((g) => g.name));
  return [...groups.values()].map((group) => {
    const first = group.statements[0]!;
    const last = group.statements.at(-1)!;
    const exportedAs = exported.get(group.name) ?? (hasDefaultModifier(group.declarations[0]!) ? "default" : undefined);
    const docs = docsOf(group.declarations[0]!);
    const unit: DetectedUnit = {
      key: `${file}#${group.name}${group.kind === "type" && values.has(group.name) ? ":type" : ""}`,
      name: group.name,
      kind: group.kind,
      span: { file, start: first.getStart(source), end: last.end },
      declarations: group.declarations,
      framework: "none",
    };
    if (exportedAs !== undefined && exportedAs !== group.name) unit.exportedAs = exportedAs;
    if (docs) unit.docs = docs;
    const declaration = group.declarations[0]!;
    const wrappers: string[] = [];
    const fn = ts.isFunctionDeclaration(declaration) ? declaration : ts.isVariableDeclaration(declaration) ? functionOf(declaration, plugins, wrappers) : undefined;
    if (wrappers.length > 0) unit.wrappers = wrappers;
    for (const plugin of plugins) {
      const kind = plugin.claim?.(unit, fn);
      if (kind === undefined) continue;
      unit.kind = kind;
      unit.framework = plugin.framework;
      break;
    }
    return unit;
  });
}

/** The unit's whole tree, its own name left out so a rename alone keeps the hash. */
export function contentTree(unit: DetectedUnit, eraseTypes = false): NormalTree {
  return ["Unit", ...unit.declarations.map((declaration) => declarationTree(declaration, eraseTypes))];
}

function declarationTree(declaration: UnitDeclaration, eraseTypes: boolean): NormalTree {
  const omit = new Set<ts.Node>(declaration.name ? [declaration.name] : []);
  const tree = normaliseNode(declaration, { eraseTypes, omit });
  if (!ts.isVariableDeclaration(declaration)) return tree;
  // The keyword lives on the list, shared with any sibling declarations, so it is added here.
  const list = declaration.parent;
  const keyword = list.flags & ts.NodeFlags.Const ? "const" : list.flags & ts.NodeFlags.Let ? "let" : "var";
  return ["Variable", keyword, tree];
}

/** The unit's public signature, with types the author left out inferred by `checker`. */
export function signatureOf(unit: DetectedUnit, checker: ts.TypeChecker, plugins: readonly FrameworkPlugin[] = []): Signature {
  if (unit.kind === "type") return { kind: "type", declaration: contentTree(unit) };
  const functions = unit.declarations.flatMap((declaration): Array<ts.FunctionLikeDeclaration> => {
    if (ts.isFunctionDeclaration(declaration)) return [declaration];
    const fn = ts.isVariableDeclaration(declaration) ? functionOf(declaration, plugins) : undefined;
    return fn ? [fn] : [];
  });
  const plugin = plugins.find((p) => p.framework === unit.framework);
  const own = plugin?.signature && functions[0] ? plugin.signature(unit, functions[0], checker) : undefined;
  if (own) return own;
  // With overloads, the implementation's own signature is not callable from outside.
  const overloads = functions.length > 1 ? functions.filter((fn) => !fn.body) : functions;
  const signature: Signature = { kind: "function", overloads: overloads.map((fn) => callSignature(fn, checker)) };
  const declared = unit.declarations.find(ts.isVariableDeclaration)?.type;
  if (declared) signature.declared = normaliseNode(declared);
  return signature;
}

/** A type as written at `node`, or as the checker infers it there when nothing is written. */
export function typeText(written: ts.TypeNode | undefined, node: ts.Node, checker: ts.TypeChecker): TypeText {
  return written ? { written: normaliseNode(written) } : { inferred: checker.typeToString(checker.getTypeAtLocation(node), node, TYPE_FORMAT) };
}

function callSignature(fn: ts.SignatureDeclaration, checker: ts.TypeChecker): CallSignature {
  const parameters = fn.parameters.map((parameter): ParameterSignature => {
    const out: ParameterSignature = {
      rest: parameter.dotDotDotToken !== undefined,
      optional: parameter.questionToken !== undefined || parameter.initializer !== undefined,
      type: typeText(parameter.type, parameter, checker),
    };
    if (parameter.initializer) out.default = normaliseNode(parameter.initializer);
    return out;
  });
  let returns: TypeText;
  if (fn.type) {
    returns = { written: normaliseNode(fn.type) };
  } else {
    const resolved = checker.getSignatureFromDeclaration(fn);
    returns = { inferred: resolved ? checker.typeToString(checker.getReturnTypeOfSignature(resolved), fn, TYPE_FORMAT) : "unknown" };
  }
  return { typeParameters: (fn.typeParameters ?? []).map((parameter) => normaliseNode(parameter)), parameters, returns };
}

/**
 * What a caller reads: each declaration up to its body, as written. Types are
 * their whole declaration, since their structure is the interface; with
 * overloads, only the overload signatures.
 */
export function signatureText(unit: DetectedUnit, source: ts.SourceFile, plugins: readonly FrameworkPlugin[] = []): string {
  const texts = unit.declarations.flatMap((declaration) => {
    const list = ts.isVariableDeclaration(declaration) ? declaration.parent : undefined;
    const statement = list && ts.isVariableDeclarationList(list) && list.declarations.length === 1 ? list.parent : declaration;
    const start = statement.getStart(source);
    if (unit.kind === "type") return [source.text.slice(start, statement.end)];
    const fn = ts.isFunctionDeclaration(declaration) ? declaration : functionOf(declaration as ts.VariableDeclaration, plugins);
    if (!fn?.body) return [source.text.slice(start, statement.end)];
    if (ts.isFunctionDeclaration(fn) && unit.declarations.length > 1) return [];
    return [source.text.slice(start, fn.body.getStart(source)).trimEnd()];
  });
  return texts.join("\n");
}

/**
 * The units `unit` uses, found by resolving every identifier in it through the
 * checker, aliases followed. `unitAt` maps a declaration to the unit it belongs
 * to, or `undefined` for declarations Poetics does not track.
 */
export function edgesOf(
  unit: DetectedUnit,
  checker: ts.TypeChecker,
  unitAt: (declaration: ts.Declaration) => DetectedUnit | undefined,
  plugins: readonly FrameworkPlugin[] = [],
): { edges: IndexedEdge[]; unresolved: UnresolvedUse[] } {
  const edges = new Map<string, IndexedEdge>();
  const unresolved: UnresolvedUse[] = [];
  const own = new Set(unit.declarations.map((declaration) => declaration.name).filter((name) => name !== undefined));

  const source = unit.declarations[0]!.getSourceFile();
  const helpers = new Set<ts.Node>();
  const visit = (node: ts.Node, root: ts.Node) => {
    if (ts.isIdentifier(node) && !own.has(node)) {
      const symbol = resolve(node, checker);
      const targets = new Set((symbol?.declarations ?? []).map(unitAt).filter((target) => target !== undefined));
      for (const target of targets) {
        if (target === unit) continue;
        const framework = plugins.map((plugin) => plugin.edgeKind?.(node, target)).find((kind) => kind !== undefined);
        const kind: EdgeKind =
          framework ?? (target.kind === "type" || inTypePosition(node, root) ? "references-type" : target.kind === "hook" ? "uses-hook" : "calls");
        edges.set(`${target.key}\0${kind}`, { to: target.key, kind });
      }
      // A private helper in the same file is not a unit, so what it uses is used by whoever calls it.
      if (targets.size === 0) {
        for (const declaration of symbol?.declarations ?? []) {
          const helper = privateHelper(declaration, source, plugins);
          if (helper && !helpers.has(helper)) {
            helpers.add(helper);
            visit(helper, helper);
          }
        }
      }
      const call = node.parent;
      if (!symbol && ts.isCallExpression(call) && call.expression === node) {
        unresolved.push({
          kind: "calls",
          span: { file: unit.span.file, start: call.getStart(source), end: call.end },
          reason: `${node.text} does not resolve to a declaration`,
        });
      }
    }
    node.forEachChild((child) => visit(child, root));
  };
  for (const declaration of unit.declarations) visit(declaration, declaration);

  const sorted = [...edges.values()].sort((a, b) => (a.to === b.to ? a.kind.localeCompare(b.kind) : a.to < b.to ? -1 : 1));
  return { edges: sorted, unresolved };
}

/** A module-level function in `source` that is not exported: its body, to walk as part of its caller's. */
function privateHelper(declaration: ts.Declaration, source: ts.SourceFile, plugins: readonly FrameworkPlugin[]): ts.Node | undefined {
  if (declaration.getSourceFile() !== source) return undefined;
  if (ts.isFunctionDeclaration(declaration) && declaration.body && ts.isSourceFile(declaration.parent)) return declaration;
  if (ts.isVariableDeclaration(declaration) && functionOf(declaration, plugins) && ts.isSourceFile(declaration.parent.parent.parent)) return declaration;
  return undefined;
}

function resolve(node: ts.Identifier, checker: ts.TypeChecker): ts.Symbol | undefined {
  // `{ formatPrice }` names the property; the value it copies is what is used.
  const parent = node.parent;
  let symbol = ts.isShorthandPropertyAssignment(parent) && parent.name === node ? checker.getShorthandAssignmentValueSymbol(parent) : checker.getSymbolAtLocation(node);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  return symbol;
}

function inTypePosition(node: ts.Node, root: ts.Node): boolean {
  for (let current = node.parent; current && current !== root; current = current.parent) {
    if (ts.isTypeNode(current)) return true;
  }
  return false;
}

/** Local names the module exports through `export { a, b as c }` or `export default a`, mapped to the exported name. */
function exportedNames(source: ts.SourceFile): Map<string, string> {
  const names = new Map<string, string>();
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const specifier of statement.exportClause.elements) {
        names.set((specifier.propertyName ?? specifier.name).text, specifier.name.text);
      }
    } else if (ts.isExportAssignment(statement) && !statement.isExportEquals && ts.isIdentifier(statement.expression)) {
      names.set(statement.expression.text, "default");
    }
  }
  return names;
}

/** The function a variable holds, seeing through parentheses, casts and any wrapper call a plugin knows. Wrapper names go into `wrappers`. */
function functionOf(declaration: ts.VariableDeclaration, plugins: readonly FrameworkPlugin[] = [], wrappers: string[] = []): ts.ArrowFunction | ts.FunctionExpression | undefined {
  let initializer = declaration.initializer;
  while (initializer) {
    if (ts.isParenthesizedExpression(initializer) || ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer)) {
      initializer = initializer.expression;
      continue;
    }
    if (ts.isCallExpression(initializer)) {
      const call = initializer;
      const inner = plugins.map((plugin) => plugin.unwrap?.(call)).find((expression) => expression !== undefined);
      if (!inner) break;
      wrappers.push(call.expression.getText());
      initializer = inner;
      continue;
    }
    break;
  }
  return initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) ? initializer : undefined;
}

// The same rule the day-one declaration scan and the React adapter use.
function functionKind(name: string): UnitKind {
  return /^use[A-Z0-9]/.test(name) ? "hook" : "function";
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function hasDefaultModifier(declaration: UnitDeclaration): boolean {
  const node = ts.isVariableDeclaration(declaration) ? declaration.parent.parent : declaration;
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
}

function docsOf(declaration: UnitDeclaration): string | undefined {
  const host = ts.isVariableDeclaration(declaration) ? declaration.parent.parent : declaration;
  const doc = ts.getJSDocCommentsAndTags(host).find(ts.isJSDoc);
  const text = doc ? ts.getTextOfJSDocComment(doc.comment) : undefined;
  return text?.trim() || undefined;
}
