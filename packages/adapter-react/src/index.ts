import ts from "typescript";
import { createTypeScriptAdapter, normaliseNode, typeText } from "@poetics/adapter-typescript";
import type { DetectedUnit, FrameworkPlugin, Signature, TypeScriptIndexerOptions } from "@poetics/adapter-typescript";
import type { FrameworkAdapter } from "@poetics/core";

/** Wrappers whose argument is still a component. */
export const COMPONENT_WRAPPERS = ["memo", "forwardRef", "lazy"] as const;

/** `use` followed by a capital letter, per the Rules of Hooks. */
export function isHookName(name: string): boolean {
  return /^use[A-Z0-9]/.test(name);
}

/** PascalCase names are component candidates; the adapter still checks they return JSX. */
export function isComponentName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name);
}

/**
 * React's part of the TypeScript indexer: it sees through `memo`, `forwardRef`
 * and `lazy`, claims PascalCase functions that return JSX (or are wrapped) as
 * components and `use*` functions as hooks, gives components their props as
 * an interface, and records a JSX tag as a `renders` edge.
 */
export function reactPlugin(): FrameworkPlugin {
  return {
    framework: "react",
    unwrap(call) {
      const wrapper = wrapperName(call);
      return wrapper && call.arguments[0] ? call.arguments[0] : undefined;
    },
    claim(unit, fn) {
      if (unit.kind === "type") return undefined;
      if (isHookName(unit.name)) return "hook";
      if (!isComponentName(unit.name)) return undefined;
      if ((unit.wrappers ?? []).some((name) => COMPONENT_WRAPPERS.some((wrapper) => name === wrapper || name.endsWith(`.${wrapper}`)))) return "component";
      return fn && returnsJsx(fn) ? "component" : undefined;
    },
    signature(unit, fn, checker) {
      if (unit.kind !== "component") return undefined;
      return componentSignature(unit, fn, checker);
    },
    edgeKind(node, target) {
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

/** `memo`, `forwardRef` or `lazy`, called bare or as `React.memo`. */
function wrapperName(call: ts.CallExpression): string | undefined {
  const callee = call.expression;
  const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
  return name && (COMPONENT_WRAPPERS as readonly string[]).includes(name) ? name : undefined;
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
