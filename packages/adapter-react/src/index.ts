import ts from "typescript";
import { createTypeScriptAdapter, normaliseNode, typeText } from "@poetics/adapter-typescript";
import type { DetectedUnit, FrameworkPlugin, Signature, TypeScriptIndexerOptions } from "@poetics/adapter-typescript";
import type { FrameworkAdapter } from "@poetics/core";

/** Wrappers whose argument is still a component. */
export const COMPONENT_WRAPPERS = ["memo", "forwardRef", "lazy"] as const;

/** What a component returns, named bare, as `React.X`, or `JSX.Element`. */
const ELEMENT_TYPES = new Set(["ReactElement", "ReactNode", "ReactPortal", "JSX.Element", "React.JSX.Element"]);
/** Types a variable holding a component is annotated with. */
const COMPONENT_TYPES = new Set(["FC", "FunctionComponent", "VFC", "VoidFunctionComponent", "ComponentType", "ExoticComponent", "NamedExoticComponent"]);
/** Base classes a class component extends, bare or as `React.X`. */
const COMPONENT_CLASSES = new Set(["Component", "PureComponent"]);
/** Calls that make an element without JSX. */
const ELEMENT_FACTORIES = new Set(["createElement", "cloneElement", "createPortal"]);

/** `use` followed by a capital letter, per the Rules of Hooks. */
export function isHookName(name: string): boolean {
  return /^use[A-Z0-9]/.test(name);
}

/** PascalCase names are component candidates; the adapter still checks they render (`rendersElement`). */
export function isComponentName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name);
}

/**
 * React's part of the TypeScript indexer: it sees through `memo`, `forwardRef`
 * and `lazy`, claims PascalCase functions that render (or are wrapped) and
 * classes that extend `Component` or `PureComponent` as components,
 * `createContext` values as contexts and `use*` functions as hooks, gives components their props as
 * an interface, and records a JSX tag as a `renders` edge and any use of a
 * context (`useContext`, `use`, a provider) as `uses-context`.
 */
export function reactPlugin(): FrameworkPlugin {
  return {
    framework: "react",
    // 2: components that render without JSX (React return types, FC annotations, casts, createElement).
    // 3: class components. 4: contexts and uses-context edges.
    version: 4,
    unwrap(call) {
      const wrapper = wrapperName(call);
      return wrapper && call.arguments[0] ? call.arguments[0] : undefined;
    },
    value(declaration) {
      return contextCall(declaration) ? "context" : undefined;
    },
    claim(unit, fn) {
      if (unit.kind === "type") return undefined;
      const declaration = unit.declarations[0]!;
      if (ts.isClassDeclaration(declaration)) return componentBase(declaration) ? "component" : undefined;
      if (isHookName(unit.name)) return "hook";
      if (!isComponentName(unit.name)) return undefined;
      if ((unit.wrappers ?? []).some((name) => COMPONENT_WRAPPERS.some((wrapper) => name === wrapper || name.endsWith(`.${wrapper}`)))) return "component";
      return fn && rendersElement(fn) ? "component" : undefined;
    },
    signature(unit, fn, checker) {
      if (unit.kind === "context") return contextSignature(unit, checker);
      if (unit.kind !== "component") return undefined;
      const declaration = unit.declarations[0]!;
      if (ts.isClassDeclaration(declaration)) return classSignature(declaration);
      return fn ? componentSignature(unit, fn, checker) : undefined;
    },
    edgeKind(node, target) {
      // Providers and consumers alike depend on the context: its value type is what they agree on.
      if (target.kind === "context") return "uses-context";
      return target.kind === "component" && isJsxTag(node) ? "renders" : undefined;
    },
  };
}

/**
 * The props type from the first parameter, default prop values from its
 * destructuring, and the ref type for `forwardRef`: what a caller depends on.
 */
function componentSignature(unit: DetectedUnit, fn: ts.SignatureDeclaration, checker: ts.TypeChecker): Signature {
  const [props, ref] = fn.parameters;
  const defaults: Array<{ name: string; value: ts.Expression }> = [];
  if (props && ts.isObjectBindingPattern(props.name)) {
    for (const element of props.name.elements) {
      const name = (element.propertyName ?? element.name).getText();
      if (element.initializer) defaults.push({ name, value: element.initializer });
    }
  }
  const signature: Signature = {
    kind: "component",
    props: props ? typeText(props.type, props, checker) : null,
    defaults: defaults.sort((a, b) => (a.name < b.name ? -1 : 1)).map(({ name, value }) => ({ name, value: normaliseNode(value) })),
  };
  if (ref && (unit.wrappers ?? []).some((name) => name === "forwardRef" || name.endsWith(".forwardRef"))) signature.ref = typeText(ref.type, ref, checker);
  return signature;
}

/** The `createContext(…)` call a variable is initialised with, bare or as `React.createContext`. */
function contextCall(declaration: ts.VariableDeclaration): ts.CallExpression | undefined {
  let value = declaration.initializer;
  while (value && (ts.isAsExpression(value) || ts.isSatisfiesExpression(value) || ts.isParenthesizedExpression(value))) value = value.expression;
  if (!value || !ts.isCallExpression(value)) return undefined;
  const callee = value.expression;
  const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
  return name === "createContext" ? value : undefined;
}

/**
 * A context's interface: the value type providers give and consumers read
 * (as written in `createContext<T>`, else as the checker infers it from the
 * default), and the default value consumers get with no provider above them.
 */
function contextSignature(unit: DetectedUnit, checker: ts.TypeChecker): Signature | undefined {
  const declaration = unit.declarations[0]!;
  const call = ts.isVariableDeclaration(declaration) ? contextCall(declaration) : undefined;
  if (!call) return undefined;
  const [fallback] = call.arguments;
  const written = call.typeArguments?.[0];
  return {
    kind: "context",
    value: written ? typeText(written, call, checker) : { inferred: contextValueType(declaration, checker) },
    default: fallback ? normaliseNode(fallback) : null,
  };
}

/** The `T` in the context's `Context<T>`, as the checker infers it: `createContext("light")` is a `Context<string>`. */
function contextValueType(declaration: ts.Declaration, checker: ts.TypeChecker): string {
  const type = checker.getTypeAtLocation(declaration);
  const reference = type.flags & ts.TypeFlags.Object && (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference ? (type as ts.TypeReference) : undefined;
  const [value] = reference ? checker.getTypeArguments(reference) : [];
  return value ? checker.typeToString(value, declaration, ts.TypeFormatFlags.NoTruncation) : checker.typeToString(type, declaration, ts.TypeFormatFlags.NoTruncation);
}

/** The `extends Component<…>` clause of a class component, or undefined for any other class. */
function componentBase(declaration: ts.ClassDeclaration): ts.ExpressionWithTypeArguments | undefined {
  const base = declaration.heritageClauses?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)?.types[0];
  if (!base) return undefined;
  const name = ts.isIdentifier(base.expression) ? base.expression.text : ts.isPropertyAccessExpression(base.expression) ? base.expression.name.text : undefined;
  return name !== undefined && COMPONENT_CLASSES.has(name) ? base : undefined;
}

/**
 * A class component's props from `Component<Props, State>`, and its default
 * prop values from `static defaultProps = { … }`: state is its own business.
 */
function classSignature(declaration: ts.ClassDeclaration): Signature {
  const props = componentBase(declaration)?.typeArguments?.[0];
  const defaults: Array<{ name: string; value: ts.Expression }> = [];
  for (const member of declaration.members) {
    const isStatic = ts.canHaveModifiers(member) && (ts.getModifiers(member) ?? []).some((m) => m.kind === ts.SyntaxKind.StaticKeyword);
    if (!isStatic || !ts.isPropertyDeclaration(member) || member.name.getText() !== "defaultProps") continue;
    let value = member.initializer;
    while (value && (ts.isAsExpression(value) || ts.isSatisfiesExpression(value) || ts.isParenthesizedExpression(value))) value = value.expression;
    if (!value || !ts.isObjectLiteralExpression(value)) continue;
    for (const property of value.properties) {
      if (ts.isPropertyAssignment(property)) defaults.push({ name: property.name.getText(), value: property.initializer });
      else if (ts.isShorthandPropertyAssignment(property)) defaults.push({ name: property.name.text, value: property.name });
    }
  }
  return {
    kind: "component",
    props: props ? { written: normaliseNode(props) } : null,
    defaults: defaults.sort((a, b) => (a.name < b.name ? -1 : 1)).map(({ name, value }) => ({ name, value: normaliseNode(value) })),
  };
}

/** `memo`, `forwardRef` or `lazy`, called bare or as `React.memo`. */
function wrapperName(call: ts.CallExpression): string | undefined {
  const callee = call.expression;
  const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
  return name && (COMPONENT_WRAPPERS as readonly string[]).includes(name) ? name : undefined;
}

/**
 * Whether a function renders: it contains JSX, says it returns a React element
 * (its return type, or an `FC`-style annotation on its variable), returns a
 * value cast to one, or returns `createElement`, `cloneElement` or `createPortal`.
 * A provider that returns `children as React.ReactElement` has no JSX at all.
 */
function rendersElement(fn: ts.SignatureDeclaration): boolean {
  if (returnsJsx(fn) || (fn.type && isElementType(fn.type))) return true;
  const holder = variableOf(fn);
  if (holder?.type && isComponentType(holder.type)) return true;
  return ownReturns(fn).some(isElementExpression);
}

/** `ReactElement`, `React.ReactNode | null`, `JSX.Element`, or `Promise<…>` of one, as an async server component returns. */
function isElementType(type: ts.TypeNode): boolean {
  if (ts.isParenthesizedTypeNode(type)) return isElementType(type.type);
  if (ts.isUnionTypeNode(type)) return type.types.some(isElementType);
  if (!ts.isTypeReferenceNode(type)) return false;
  const name = type.typeName.getText();
  if (name === "Promise" && type.typeArguments?.length === 1) return isElementType(type.typeArguments[0]!);
  return ELEMENT_TYPES.has(name) || ELEMENT_TYPES.has(name.replace(/^React\./, ""));
}

function isComponentType(type: ts.TypeNode): boolean {
  if (!ts.isTypeReferenceNode(type)) return false;
  return COMPONENT_TYPES.has(type.typeName.getText().replace(/^React\./, ""));
}

/** `children as ReactElement`, `<JSX.Element>x`, `x satisfies ReactNode`, or a call to an element factory. */
function isElementExpression(expression: ts.Expression): boolean {
  let node: ts.Expression = expression;
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node)) return isElementType(node.type);
  if (ts.isConditionalExpression(node)) return isElementExpression(node.whenTrue) || isElementExpression(node.whenFalse);
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
  return name !== undefined && ELEMENT_FACTORIES.has(name);
}

/** The variable a function is assigned to, through any wrapper calls: `const X: FC = memo(() => …)`. */
function variableOf(fn: ts.SignatureDeclaration): ts.VariableDeclaration | undefined {
  let node: ts.Node = fn;
  while (ts.isCallExpression(node.parent) || ts.isParenthesizedExpression(node.parent)) node = node.parent;
  return ts.isVariableDeclaration(node.parent) && node.parent.initializer === node ? node.parent : undefined;
}

/** What the function itself returns, not functions nested in it: an arrow's expression body, or its own return statements. */
function ownReturns(fn: ts.SignatureDeclaration): ts.Expression[] {
  const body = (fn as ts.FunctionLikeDeclarationBase).body;
  if (!body) return [];
  if (!ts.isBlock(body)) return [body];
  const out: ts.Expression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression) out.push(node.expression);
    node.forEachChild(visit);
  };
  body.forEachChild(visit);
  return out;
}

function returnsJsx(fn: ts.SignatureDeclaration): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) found = true;
    else node.forEachChild(visit);
  };
  fn.forEachChild(visit);
  return found;
}

/** Whether `node` names the element in a JSX tag, as `<PriceTag>` or `<ui.PriceTag>` does. */
function isJsxTag(node: ts.Identifier): boolean {
  let tag: ts.Node = node;
  while (ts.isPropertyAccessExpression(tag.parent) && tag.parent.name === tag) tag = tag.parent;
  const parent = tag.parent;
  return (ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)) && parent.tagName === tag;
}

/** Detects components, hooks and functions in `.ts` and `.tsx` through the TypeScript indexer with React's plugin. */
export function createReactAdapter(options: TypeScriptIndexerOptions): FrameworkAdapter {
  const adapter = createTypeScriptAdapter({ ...options, plugins: [reactPlugin(), ...(options.plugins ?? [])] });
  return { ...adapter, framework: "react", extensions: [".ts", ".tsx"] };
}
