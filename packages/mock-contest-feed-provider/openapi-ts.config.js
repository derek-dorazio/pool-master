"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const openapi_ts_1 = require("@hey-api/openapi-ts");
exports.default = (0, openapi_ts_1.defineConfig)({
    input: './generated/openapi.json',
    output: {
        path: './generated/hey-api',
    },
    client: '@hey-api/client-fetch',
});
//# sourceMappingURL=openapi-ts.config.js.map