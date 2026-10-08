/**
 * Applies the DTO's string normalisations to a request before Fastify validates it (#500).
 *
 * `zodToJsonSchema` records a Zod `.trim()` / `.toLowerCase()` / `.toUpperCase()` under the
 * `x-transform` keyword. This teaches Fastify's Ajv that keyword: it rewrites the value in the
 * request body, query or params, then the rest of the schema (`format: email`, a no-spaces
 * `pattern`, `minLength`) judges the normalised value. So `" Derek@X.com "` arrives at the
 * handler as `"derek@x.com"`, which is what the DTO always said it would be.
 *
 * Every Fastify instance that compiles route schemas needs this plugin, because Ajv refuses a
 * schema with a keyword it does not know. Build one with `FASTIFY_AJV_OPTIONS`.
 */
import type { FastifyServerOptions } from 'fastify';
import {
  STRING_TRANSFORM_KEYWORD,
  StringTransform,
} from '@poolmaster/shared/dto/json-schema';

/**
 * Ajv is Fastify's dependency (through `@fastify/ajv-compiler`), not ours, so its type is taken
 * from the plugin signature Fastify accepts rather than imported.
 */
type FastifyAjvPlugin = Extract<
  NonNullable<NonNullable<FastifyServerOptions['ajv']>['plugins']>[number],
  (...args: never[]) => unknown
>;
type Ajv = Parameters<FastifyAjvPlugin>[0];

const APPLY: Record<StringTransform, (value: string) => string> = {
  [StringTransform.TRIM]: (value) => value.trim(),
  [StringTransform.TO_LOWER_CASE]: (value) => value.toLowerCase(),
  [StringTransform.TO_UPPER_CASE]: (value) => value.toUpperCase(),
};

function isStringTransform(value: unknown): value is StringTransform {
  return typeof value === 'string' && Object.hasOwn(APPLY, value);
}

export function stringTransformsAjvPlugin(ajv: Ajv): Ajv {
  ajv.addKeyword({
    keyword: STRING_TRANSFORM_KEYWORD,
    type: 'string',
    schemaType: 'array',
    modifying: true,
    // Ajv runs a type's keywords in definition order; the value must be normalised before
    // any of them reads it.
    before: 'maxLength',
    compile(transforms: unknown[]) {
      const steps = transforms.map((transform) => {
        if (!isStringTransform(transform)) {
          throw new Error(`Unknown ${STRING_TRANSFORM_KEYWORD} step: ${String(transform)}`);
        }
        return APPLY[transform];
      });
      return (data: string, dataCxt) => {
        // A schema's root value has no parent to write back to; route schemas are objects.
        if (dataCxt === undefined) return true;
        const parent = dataCxt.parentData as Record<string | number, unknown>;
        parent[dataCxt.parentDataProperty] = steps.reduce((value, step) => step(value), data);
        return true;
      };
    },
  });
  return ajv;
}

/** The `ajv` option for `Fastify({ ajv })`, so every app validates requests the same way. */
export const FASTIFY_AJV_OPTIONS: FastifyServerOptions['ajv'] = { plugins: [stringTransformsAjvPlugin] };
