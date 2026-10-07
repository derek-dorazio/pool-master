/**
 * #193, #292 — every route that addresses something by a path parameter declares its
 * authorization, or says where it lives.
 *
 * The global auth guard proves only that the caller is logged in. A route whose path carries a
 * parameter — a by-id route (`/api/v1/contests/:contestId`) or a route under a nested mount
 * (`/api/v1/leagues/:id/squads/...`) — reaches data someone owns, so it must decide who may
 * reach it. #193 found four contest routes that decided nowhere: no hook on the route, no actor
 * read in the handler, a service that never received one. It covered by-id mounts only, on the
 * theory that a nested mount "carries the league id"; #292 found that carrying the id is not
 * checking it, and extended the rule to every mount.
 *
 * THE RULE. Each route whose full path has a parameter must either declare a `preHandler` or
 * `onRequest` hook — on the route, through a spread options object, or through a module-wide
 * `addHook` — or appear in `route-authorization-opt-outs.mjs` with a one-line reason. Neither is
 * satisfiable by accident: a route that authorizes nowhere fails here instead of passing
 * silently, and the opt-out list is the complete, reviewable set of such routes that authorize
 * somewhere other than a hook. An opt-out that names no route, or a route that now declares a
 * hook, fails too, so the list cannot drift from the code.
 *
 * WHAT IT DOES NOT PROVE. A declared hook is not a correct hook: the check makes the decision
 * visible, and the reviewer judges it. Routes with no path parameter (`GET /api/v1/leagues`)
 * are not checked; they address no one's resource by id. The model is in
 * docs/DOMAIN-OPERATIONS.md (A12) and rules/service-rules.md §3 *Route Authorization*.
 *
 * Mounts are read from the API entry point's `app.register(module, { prefix })` calls, so a new
 * module is covered without being listed anywhere. A mount or route the scanner cannot
 * read — a non-literal prefix or path, a module it cannot find — is a finding, not a skip.
 * A hook installed by a registered plugin (`fastify.register(someAuthPlugin)`) is not seen: the
 * scanner cannot tell a gate plugin from any other, so it fails closed. Declare the hook with
 * `addHook` in the module function, or on the route, where a reader can see it too.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

import { parseRuleCheckArgs, reportFindings } from './rule-check-utils.mjs';
import { ROUTE_AUTHORIZATION_OPT_OUTS } from './route-authorization-opt-outs.mjs';

export const API_ENTRY = 'packages/core-api/src/index.ts';
const ROUTE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
const GATE_HOOKS = new Set(['preHandler', 'onRequest']);

function parse(fileName, text) {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function stringValue(node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : null;
}

function propertyName(property) {
  const { name } = property;
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return null;
}

/** `true` when a path has a parameter segment (`/:contestId`). */
export function hasPathParameter(path) {
  return /(^|\/):[^/]+/.test(path);
}

export function joinPath(prefix, path) {
  if (path === '/' || path === '') return prefix;
  return `${prefix.replace(/\/$/, '')}${path.startsWith('/') ? '' : '/'}${path}`;
}

/**
 * The `app.register(module, { prefix })` mounts in the API entry point, with each module
 * identifier resolved to the file it is imported from.
 */
export function readMounts(entryText, entryFileName = API_ENTRY) {
  const sourceFile = parse(entryFileName, entryText);
  const imports = new Map();
  const mounts = [];
  const unreadable = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const from = stringValue(statement.moduleSpecifier);
    const bindings = statement.importClause?.namedBindings;
    if (!from || !bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      imports.set(element.name.text, { from, exportName: (element.propertyName ?? element.name).text });
    }
  }

  function visit(node) {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'register'
      && node.arguments.length >= 2
      && ts.isIdentifier(node.arguments[0])
      && ts.isObjectLiteralExpression(node.arguments[1])
    ) {
      const prefixProperty = node.arguments[1].properties.find(
        (property) => ts.isPropertyAssignment(property) && propertyName(property) === 'prefix',
      );
      if (prefixProperty) {
        const moduleName = node.arguments[0].text;
        const prefix = stringValue(prefixProperty.initializer);
        const imported = imports.get(moduleName);
        const line = lineOf(sourceFile, node);
        if (prefix === null || !imported) {
          unreadable.push({ moduleName, line, reason: prefix === null ? 'non-literal prefix' : 'module is not a named import' });
        } else {
          mounts.push({ moduleName, exportName: imported.exportName, from: imported.from, prefix, line });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  return { mounts, unreadable };
}

function objectHasGate(objectLiteral, resolveIdentifier) {
  for (const property of objectLiteral.properties) {
    if (
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property))
      && GATE_HOOKS.has(propertyName(property))
    ) {
      return true;
    }
    if (ts.isSpreadAssignment(property) && ts.isIdentifier(property.expression)) {
      const spread = resolveIdentifier(property.expression.text);
      if (spread && objectHasGate(spread, resolveIdentifier)) return true;
    }
  }
  return false;
}

/**
 * The routes one exported module function registers. Each route is
 * `{ method, path, gated, line }`; `gated` is true when the route, a spread options object or a
 * module-wide `addHook` declares a `preHandler` or `onRequest` hook. `unreadable` lists route
 * registrations the scanner could not read, which the caller reports rather than skips.
 */
export function readModuleRoutes(moduleText, exportName, fileName = 'module.ts') {
  const sourceFile = parse(fileName, moduleText);
  const fn = sourceFile.statements.find(
    (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === exportName,
  );
  if (!fn || !fn.body) return null;

  const instanceName = fn.parameters[0] && ts.isIdentifier(fn.parameters[0].name)
    ? fn.parameters[0].name.text
    : null;

  // Object literals bound to a const — in the module function or at file scope — so a route
  // spreading `...write` resolves to whatever `write` declares.
  const objectBindings = new Map();
  function collectBindings(node) {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
      && ts.isObjectLiteralExpression(node.initializer)
    ) {
      objectBindings.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collectBindings);
  }
  collectBindings(sourceFile);
  const resolveIdentifier = (name) => objectBindings.get(name) ?? null;

  const routes = [];
  const unreadable = [];
  let moduleGated = false;

  function isInstanceCall(node, methodNames) {
    return ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === instanceName
      && methodNames.has(node.expression.name.text);
  }

  function visit(node) {
    if (isInstanceCall(node, new Set(['addHook'])) && GATE_HOOKS.has(stringValue(node.arguments[0]))) {
      moduleGated = true;
    }
    if (isInstanceCall(node, new Set(['route']))) {
      unreadable.push({ line: lineOf(sourceFile, node), reason: `${instanceName}.route() is not read; use the method form` });
    }
    if (isInstanceCall(node, ROUTE_METHODS)) {
      const method = node.expression.name.text.toUpperCase();
      const path = stringValue(node.arguments[0]);
      const options = node.arguments[1];
      const line = lineOf(sourceFile, node);
      if (path === null) {
        unreadable.push({ line, reason: 'non-literal route path' });
      } else {
        const gated = Boolean(options && ts.isObjectLiteralExpression(options) && objectHasGate(options, resolveIdentifier));
        routes.push({ method, path, gated, line });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(fn.body);

  return {
    routes: routes.map((route) => ({ ...route, gated: route.gated || moduleGated })),
    unreadable,
  };
}

export function routeKey(method, fullPath) {
  return `${method} ${fullPath}`;
}

/**
 * The findings for a set of parameterized routes against the opt-out list. Each route is
 * `{ method, fullPath, gated, location }`; each opt-out is `{ route: 'METHOD /full/path', reason }`.
 */
export function evaluateRoutes({ routes, optOuts }) {
  const findings = [];
  const optOutByKey = new Map();
  for (const optOut of optOuts) {
    if (optOutByKey.has(optOut.route)) {
      findings.push({ location: 'scripts/route-authorization-opt-outs.mjs', message: `\`${optOut.route}\` is listed twice.` });
    }
    optOutByKey.set(optOut.route, optOut);
    if (typeof optOut.reason !== 'string' || optOut.reason.trim() === '' || optOut.reason.includes('\n')) {
      findings.push({
        location: 'scripts/route-authorization-opt-outs.mjs',
        message: `\`${optOut.route}\` needs a one-line reason saying where the route authorizes.`,
      });
    }
  }

  const seen = new Set();
  for (const route of routes) {
    const key = routeKey(route.method, route.fullPath);
    seen.add(key);
    const optOut = optOutByKey.get(key);
    if (route.gated && optOut) {
      findings.push({
        location: route.location,
        message: `\`${key}\` declares a hook and is also on the opt-out list; remove the opt-out.`,
      });
    }
    if (!route.gated && !optOut) {
      findings.push({
        location: route.location,
        message: `\`${key}\` authorizes nowhere visible: declare a preHandler (requireMemberOfLeague, requireMemberOfSquad, requireCommissionerForContest, ...) or add it to scripts/route-authorization-opt-outs.mjs with the reason it authorizes elsewhere.`,
      });
    }
  }

  for (const key of optOutByKey.keys()) {
    if (!seen.has(key)) {
      findings.push({
        location: 'scripts/route-authorization-opt-outs.mjs',
        message: `\`${key}\` matches no route with a path parameter; remove it.`,
      });
    }
  }

  return findings;
}

function resolveModuleFile(entryFile, from) {
  const base = resolve(dirname(entryFile), from);
  return base.endsWith('.ts') ? base : `${base}.ts`;
}

/**
 * Every route with a path parameter in the tree rooted at `root`, under any mount, plus findings
 * for what could not be read.
 */
export function collectParameterizedRoutes(root = process.cwd()) {
  const entryFile = join(root, API_ENTRY);
  const { mounts, unreadable: unreadableMounts } = readMounts(readFileSync(entryFile, 'utf8'), entryFile);
  const findings = unreadableMounts.map(({ moduleName, line, reason }) => ({
    location: `${API_ENTRY}:${line}`,
    message: `Cannot read the mount for \`${moduleName}\` (${reason}).`,
  }));
  const routes = [];

  for (const mount of mounts) {
    if (!mount.from.startsWith('.')) continue;
    const moduleFile = resolveModuleFile(entryFile, mount.from);
    const relativeFile = relative(root, moduleFile);
    let text;
    try {
      text = readFileSync(moduleFile, 'utf8');
    } catch {
      findings.push({ location: `${API_ENTRY}:${mount.line}`, message: `Cannot read ${relativeFile} for \`${mount.moduleName}\`.` });
      continue;
    }
    const result = readModuleRoutes(text, mount.exportName, moduleFile);
    if (!result) {
      findings.push({
        location: `${API_ENTRY}:${mount.line}`,
        message: `\`${mount.exportName}\` is not a function declaration in ${relativeFile}.`,
      });
      continue;
    }
    for (const { line, reason } of result.unreadable) {
      findings.push({ location: `${relativeFile}:${line}`, message: `Cannot read this route (${reason}).` });
    }
    for (const route of result.routes) {
      const fullPath = joinPath(mount.prefix, route.path);
      if (!hasPathParameter(fullPath)) continue;
      routes.push({
        method: route.method,
        fullPath,
        gated: route.gated,
        location: `${relativeFile}:${route.line}`,
      });
    }
  }

  return { routes, findings };
}

function main() {
  const { warnOnly } = parseRuleCheckArgs();
  const { routes, findings } = collectParameterizedRoutes();
  findings.push(...evaluateRoutes({ routes, optOuts: ROUTE_AUTHORIZATION_OPT_OUTS }));
  const gated = routes.filter((route) => route.gated).length;
  reportFindings({
    title: 'Route authorization scan',
    findings,
    warnOnly,
    emptyMessage: `Route authorization scan OK (${routes.length} routes with a path parameter: ${gated} hooked, ${routes.length - gated} on the opt-out list).`,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
