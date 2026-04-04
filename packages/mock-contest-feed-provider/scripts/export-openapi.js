"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
async function main() {
    const { buildApp } = await import('../src/app');
    const app = buildApp();
    try {
        await app.ready();
    }
    catch (error) {
        app.log.error({ error }, 'Mock contest feed app.ready() failed');
    }
    const spec = app.swagger?.();
    if (!spec) {
        console.error('swagger() not available — is @fastify/swagger registered?');
        process.exit(1);
    }
    const generatedDir = (0, node_path_1.resolve)(process.cwd(), 'generated');
    (0, node_fs_1.mkdirSync)(generatedDir, { recursive: true });
    const outPath = (0, node_path_1.resolve)(generatedDir, 'openapi.json');
    (0, node_fs_1.writeFileSync)(outPath, `${JSON.stringify(spec, null, 2)}\n`);
    console.log(`OpenAPI spec exported to ${outPath}`);
    try {
        await app.close();
    }
    catch {
        // Ignore shutdown errors in export mode.
    }
    process.exit(0);
}
main().catch((error) => {
    console.error('Failed to export OpenAPI spec:', error);
    process.exit(1);
});
//# sourceMappingURL=export-openapi.js.map