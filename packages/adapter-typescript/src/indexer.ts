// The indexer: one TypeScript program over the files in scope, reused between
// runs, and a per-file cache so unchanged files skip the checker entirely.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { computeClosureHashes, contentHash, createGraph, gitBlobHash, interfaceHash } from "@poetics/core";
import type { Edge, Framework, Hash, Span, UnitKind } from "@poetics/core";
import { fingerprint } from "./normalise.ts";
import { contentTree, detectUnits, edgesOf, signatureOf, signatureText } from "./units.ts";
import type { DetectedUnit, FrameworkPlugin, IndexedEdge, Signature, Transformed, UnresolvedUse } from "./units.ts";

export interface TypeScriptIndexerOptions {
  /** Repository root: files, spans and keys are relative to it. */
  root: string;
  /** Repo-relative POSIX paths of the files in scope. */
  files: readonly string[];
  /** A tsconfig whose compiler options the program uses. */
  tsconfig?: string;
  /** Compiler options, when there is no tsconfig to read. */
  compilerOptions?: ts.CompilerOptions;
  /** Where the per-file cache lives, e.g. `.poetics/cache/typescript.json`. Without one, nothing is kept between indexers. */
  cacheFile?: string;
  /** Framework adapters to consult, such as React's, in order. */
  plugins?: readonly FrameworkPlugin[];
}

/** One unit with everything the store needs from the indexer. */
export interface IndexedUnit {
  /** `file#name`, the target edges point at. */
  key: string;
  name: string;
  exportedAs?: string;
  kind: UnitKind;
  framework: Framework;
  span: Span;
  /** 1-based and inclusive, for people. */
  startLine: number;
  endLine: number;
  docs?: string;
  /** The normalised tree, own name excluded: formatting and comments never change it. */
  contentHash: Hash;
  /** The same tree with types erased. Equal runtime hashes with different content hashes mean a types-only change. */
  runtimeHash: Hash;
  interfaceHash: Hash;
  /** Subtree hashes of the content tree, for matching a unit that was edited as it moved. */
  fingerprint: string[];
  signature: Signature;
  /** The declaration up to its body, as written: the cheapest way to show a caller what it calls. */
  signatureText: string;
  edges: IndexedEdge[];
  unresolved: UnresolvedUse[];
}

export interface IndexResult {
  units: IndexedUnit[];
  /** Files answered from the cache, and files the checker indexed. */
  stats: { cached: number; indexed: number };
}

export interface TypeScriptIndexer {
  /** Indexes the files in scope, or `files` in their place, reusing everything unchanged. */
  index(files?: readonly string[]): IndexResult;
}

// Bump when the shape of cached units or the normalisation changes, so old caches are dropped.
const CACHE_VERSION = 5;
const LOCKFILES = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lock"];

const DEFAULT_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2024,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  jsx: ts.JsxEmit.Preserve,
  strict: true,
  skipLibCheck: true,
  allowImportingTsExtensions: true,
};

interface CachedFile {
  key: Hash;
  units: IndexedUnit[];
}

interface Cache {
  version: number;
  environment: string;
  files: Record<string, CachedFile>;
}

/** Creates an indexer whose program and cache carry over from one `index` call to the next. */
export function createTypeScriptIndexer(options: TypeScriptIndexerOptions): TypeScriptIndexer {
  const root = resolve(options.root);
  const compilerOptions: ts.CompilerOptions = { ...compilerOptionsFor(root, options), noEmit: true };
  const resolutionCache = ts.createModuleResolutionCache(root, (name) => name, compilerOptions);
  const plugins = options.plugins ?? [];
  const sources = transformedSources(plugins);
  const resolveImport = importResolver(root, compilerOptions, resolutionCache, sources);
  const host = reusingHost(compilerOptions, sources, resolveImport);
  const ambient = [...new Set(plugins.flatMap((plugin) => plugin.ambient ?? []))];
  // A plugin changes what units are and what they use, so the frameworks and their rules' versions are part of what cached units depend on.
  const environment = gitBlobHash(JSON.stringify([CACHE_VERSION, ts.version, compilerOptions, lockfileHash(root), plugins.map((p) => [p.framework, p.version ?? 0])]));
  let cache = readCache(options.cacheFile, environment);
  let program: ts.Program | undefined;

  const absolute = (file: string) => join(root, file);
  const relativeTo = (path: string) => relative(root, path).split(sep).join("/");
  // A transformed file is read by the checker under a name of its own, so `X.svelte` and `X.svelte.ts` never collide.
  const programPath = (file: string) => (sources.pluginFor(file) ? virtualPath(absolute(file)) : absolute(file));

  return {
    index(files = options.files) {
      const scope = [...new Set(files)];
      const keys = fileKeys(scope, root, (path) => sources.code(path), resolveImport, relativeTo);
      const misses = scope.filter((file) => cache.files[file]?.key !== keys.get(file));
      const next: Record<string, CachedFile> = {};

      if (misses.length > 0) {
        program = ts.createProgram({ rootNames: [...scope.map(programPath), ...ambient], options: compilerOptions, host, ...(program ? { oldProgram: program } : {}) });
        const checker = program.getTypeChecker();
        const detected = new Map<string, { source: ts.SourceFile; units: DetectedUnit[]; original?: { text: string; transformed: Transformed } }>();
        const byDeclaration = new Map<ts.Node, DetectedUnit>();
        for (const file of scope) {
          const source = program.getSourceFile(programPath(file));
          if (!source) continue;
          const plugin = sources.pluginFor(file);
          const original = plugin ? sources.get(absolute(file)) : undefined;
          const units = plugin?.detect && original ? plugin.detect(source, file, original.text, original.transformed) : detectUnits(source, file, plugins);
          detected.set(file, { source, units, ...(original ? { original } : {}) });
          for (const unit of units) for (const declaration of unit.declarations) byDeclaration.set(declaration, unit);
        }
        const unitAt = (declaration: ts.Declaration) => byDeclaration.get(declaration);
        for (const file of misses) {
          const found = detected.get(file);
          const units = found ? found.units.map((unit) => indexUnit(unit, found.source, checker, unitAt, plugins, found.original)) : [];
          next[file] = { key: keys.get(file)!, units };
        }
      }
      for (const file of scope) next[file] ??= cache.files[file]!;

      cache = { version: CACHE_VERSION, environment, files: next };
      if (options.cacheFile) writeCache(options.cacheFile, cache);
      return {
        units: scope.flatMap((file) => next[file]!.units),
        stats: { cached: scope.length - misses.length, indexed: misses.length },
      };
    },
  };
}

function indexUnit(
  unit: DetectedUnit,
  source: ts.SourceFile,
  checker: ts.TypeChecker,
  unitAt: (d: ts.Declaration) => DetectedUnit | undefined,
  plugins: readonly FrameworkPlugin[],
  original?: { text: string; transformed: Transformed },
): IndexedUnit {
  const signature = signatureOf(unit, checker, plugins);
  const found = edgesOf(unit, checker, unitAt, plugins);
  // In a transformed file, a use the author did not write has no place to show, so it is left out.
  const unresolved = original
    ? found.unresolved.flatMap((use) => {
        const start = original.transformed.toOriginal(use.span.start);
        const end = original.transformed.toOriginal(use.span.end);
        return start === undefined ? [] : [{ ...use, span: { ...use.span, start, end: Math.max(start, end ?? start) } }];
      })
    : found.unresolved;
  const lineOf = original ? (offset: number) => original.text.slice(0, offset).split("\n").length : (offset: number) => source.getLineAndCharacterOfPosition(offset).line + 1;
  const tree = contentTree(unit);
  const indexed: IndexedUnit = {
    key: unit.key,
    name: unit.name,
    kind: unit.kind,
    framework: unit.framework,
    span: unit.span,
    startLine: lineOf(unit.span.start),
    endLine: lineOf(unit.span.end),
    contentHash: contentHash(tree),
    runtimeHash: contentHash(contentTree(unit, true)),
    interfaceHash: interfaceHash(signature),
    fingerprint: fingerprint(tree),
    signature,
    signatureText: signatureText(unit, source, plugins),
    edges: found.edges,
    unresolved,
  };
  if (unit.exportedAs !== undefined) indexed.exportedAs = unit.exportedAs;
  if (unit.docs !== undefined) indexed.docs = unit.docs;
  return indexed;
}

/** The suffix a transformed file is read under: `Button.svelte` is checked as `Button.svelte.tsx`. */
const VIRTUAL_SUFFIX = ".tsx";

function virtualPath(path: string): string {
  return `${path}${VIRTUAL_SUFFIX}`;
}

interface TransformedSources {
  /** The plugin that transforms `file`, by its extension. */
  pluginFor(file: string): FrameworkPlugin | undefined;
  /** The original text of an absolute path and its transform, read once per text. */
  get(path: string): { text: string; transformed: Transformed } | undefined;
  /** The original path a virtual path stands for. */
  originalOf(path: string): string | undefined;
  /** What the checker reads at a real path: the transformed code for a transformed file. */
  code(path: string): string;
}

function transformedSources(plugins: readonly FrameworkPlugin[]): TransformedSources {
  const memo = new Map<string, { text: string; transformed: Transformed }>();
  const pluginFor = (file: string) => plugins.find((plugin) => plugin.transform && plugin.extensions?.some((ext) => file.endsWith(ext)));
  const get = (path: string) => {
    const plugin = pluginFor(path);
    if (!plugin || !existsSync(path)) return undefined;
    const text = readFileSync(path, "utf8");
    const known = memo.get(path);
    if (known?.text === text) return known;
    const entry = { text, transformed: plugin.transform!(path, text) };
    memo.set(path, entry);
    return entry;
  };
  return {
    pluginFor,
    get,
    originalOf(path) {
      if (!path.endsWith(VIRTUAL_SUFFIX)) return undefined;
      const original = path.slice(0, -VIRTUAL_SUFFIX.length);
      return pluginFor(original) && existsSync(original) ? original : undefined;
    },
    code(path) {
      if (pluginFor(path)) return get(path)?.transformed.code ?? "";
      return existsSync(path) ? readFileSync(path, "utf8") : "";
    },
  };
}

type ImportResolver = (specifier: string, containingFile: string, mode?: ts.ResolutionMode) => ts.ResolvedModuleWithFailedLookupLocations;

/**
 * Module resolution that also finds transformed files: `./Button.svelte` resolves
 * to the virtual `Button.svelte.tsx`, directly or through `paths`. Everything
 * else resolves as TypeScript would.
 */
function importResolver(root: string, options: ts.CompilerOptions, cache: ts.ModuleResolutionCache, sources: TransformedSources): ImportResolver {
  const transformedAt = (path: string): ts.ResolvedModuleWithFailedLookupLocations | undefined =>
    sources.pluginFor(path) && existsSync(path) ? { resolvedModule: { resolvedFileName: virtualPath(path), extension: ts.Extension.Tsx, isExternalLibraryImport: false } } : undefined;
  return (specifier, containingFile, mode) => {
    if (sources.pluginFor(specifier)) {
      if (specifier.startsWith(".") || isAbsolute(specifier)) {
        const found = transformedAt(resolve(dirname(containingFile), specifier));
        if (found) return found;
      }
      for (const candidate of pathCandidates(specifier, options, root)) {
        const found = transformedAt(candidate);
        if (found) return found;
      }
    }
    return ts.resolveModuleName(specifier, containingFile, options, ts.sys, cache, undefined, mode);
  };
}

/** Where `paths` in the compiler options would send `specifier`, most specific pattern first. */
function pathCandidates(specifier: string, options: ts.CompilerOptions, root: string): string[] {
  const base = (options.pathsBasePath as string | undefined) ?? options.baseUrl ?? root;
  const out: string[] = [];
  const patterns = Object.entries(options.paths ?? {}).sort(([a], [b]) => b.length - a.length);
  for (const [pattern, targets] of patterns) {
    const star = pattern.indexOf("*");
    let rest: string | undefined;
    if (star === -1) rest = pattern === specifier ? "" : undefined;
    else if (specifier.startsWith(pattern.slice(0, star)) && specifier.endsWith(pattern.slice(star + 1)) && specifier.length >= pattern.length - 1) {
      rest = specifier.slice(star, specifier.length - (pattern.length - star - 1));
    }
    if (rest === undefined) continue;
    for (const target of targets) out.push(resolve(base, target.replace("*", rest)));
  }
  return out;
}

/**
 * A cache key per file in scope: a Merkle hash of its path, text and whether it
 * is in scope, over every project file it imports, directly or not. A file's
 * signatures and edges can only depend on what it imports, so an unchanged key
 * means its cached units still hold. A transformed file's imports are read from
 * the code it is transformed into.
 */
function fileKeys(
  scope: readonly string[],
  root: string,
  codeAt: (path: string) => string,
  resolveImport: ImportResolver,
  relativeTo: (path: string) => string,
): Map<string, Hash> {
  const inScope = new Set(scope);
  const own = new Map<string, Hash>();
  const edges: Edge[] = [];
  const queue = [...scope];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (own.has(file)) continue;
    const path = join(root, file);
    const text = existsSync(path) ? readFileSync(path, "utf8") : "";
    own.set(file, gitBlobHash(`${file}\0${inScope.has(file) ? "scope" : "dependency"}\0${text}`));
    for (const { fileName } of ts.preProcessFile(codeAt(path), true, true).importedFiles) {
      const resolved = resolveImport(fileName, path).resolvedModule;
      // Packages are covered by the lockfile in the cache's environment.
      if (!resolved || resolved.isExternalLibraryImport) continue;
      // A transformed file is keyed by its own path, not the virtual one it is read under.
      const resolvedPath = resolved.resolvedFileName;
      const real = resolvedPath.endsWith(VIRTUAL_SUFFIX) && !existsSync(resolvedPath) ? resolvedPath.slice(0, -VIRTUAL_SUFFIX.length) : resolvedPath;
      const target = relativeTo(real);
      if (target.startsWith("../") || isAbsolute(target)) continue;
      edges.push({ from: file, to: target, kind: "references-type" });
      queue.push(target);
    }
  }
  return computeClosureHashes(createGraph(edges), own);
}

/**
 * A compiler host that hands back the same SourceFile for unchanged text, so
 * `oldProgram` reuse works, and that serves transformed files under their
 * virtual names and resolves imports of them.
 */
function reusingHost(options: ts.CompilerOptions, transformed: TransformedSources, resolveImport: ImportResolver): ts.CompilerHost {
  const host = ts.createCompilerHost(options, true);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  host.fileExists = (path) => transformed.originalOf(path) !== undefined || fileExists(path);
  host.readFile = (path) => {
    const original = transformed.originalOf(path);
    return original ? transformed.get(original)?.transformed.code : readFile(path);
  };
  const sources = new Map<string, { text: string; file: ts.SourceFile }>();
  host.getSourceFile = (fileName, languageVersion) => {
    const text = host.readFile(fileName);
    if (text === undefined) return undefined;
    const known = sources.get(fileName);
    if (known?.text === text) return known.file;
    const file = ts.createSourceFile(fileName, text, languageVersion, true);
    sources.set(fileName, { text, file });
    return file;
  };
  host.resolveModuleNameLiterals = (literals, containingFile, _redirected, compilerOptions, containingSource) =>
    literals.map((literal) => resolveImport(literal.text, containingFile, ts.getModeForUsageLocation(containingSource, literal, compilerOptions)));
  return host;
}

function compilerOptionsFor(root: string, options: TypeScriptIndexerOptions): ts.CompilerOptions {
  if (!options.tsconfig) return options.compilerOptions ?? DEFAULT_OPTIONS;
  const path = resolve(root, options.tsconfig);
  const read = ts.readConfigFile(path, ts.sys.readFile);
  if (read.error) throw new Error(`Cannot read ${options.tsconfig}: ${ts.flattenDiagnosticMessageText(read.error.messageText, "\n")}`);
  return { ...ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(path)).options, ...options.compilerOptions };
}

function lockfileHash(root: string): string | null {
  for (const name of LOCKFILES) {
    const path = join(root, name);
    if (existsSync(path)) return gitBlobHash(readFileSync(path, "utf8"));
  }
  return null;
}

function readCache(file: string | undefined, environment: string): Cache {
  const empty: Cache = { version: CACHE_VERSION, environment, files: {} };
  if (!file || !existsSync(file)) return empty;
  try {
    const cache = JSON.parse(readFileSync(file, "utf8")) as Cache;
    return cache.version === CACHE_VERSION && cache.environment === environment ? cache : empty;
  } catch {
    // The cache is disposable: a torn or hand-edited file just means a full index.
    return empty;
  }
}

function writeCache(file: string, cache: Cache): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(cache));
  renameSync(temp, file);
}
