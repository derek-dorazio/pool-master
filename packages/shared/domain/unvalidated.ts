/**
 * Untrusted data (stored or parsed JSON, router state) read as the shape `T` it should
 * have, its values not yet checked. Naming the keys means a reader asking for a key `T`
 * does not have fails to compile; leaving every value `unknown` means the reader still
 * checks what it takes.
 */
export type Unvalidated<T> = { readonly [K in keyof T]?: unknown };
