/** Thrown by every public API that is designed but not built yet. */
export class NotImplementedError extends Error {
  readonly api: string;

  constructor(api: string) {
    super(`${api} is not implemented yet. See docs/plan.md for the design.`);
    this.name = "NotImplementedError";
    this.api = api;
  }
}

export function notImplemented(api: string): never {
  throw new NotImplementedError(api);
}
