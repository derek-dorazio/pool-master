/**
 * Local ESLint rules for repo conventions that no off-the-shelf plugin expresses.
 *
 * These are named rules rather than `no-restricted-syntax` selectors on purpose.
 * Flat config does not merge rule OPTIONS: a second scoped block declaring its own
 * `no-restricted-syntax` array replaces the first inside that scope, silently, while
 * `npm run lint` stays green. Measured at 4 of 16 planted violations caught when five
 * scanners were layered that way.
 *
 * Distinct rule ids cannot clobber each other, so each rule composes its own
 * `files`/`ignores` exactly as its scanner's exclusion list reads. You also get a real
 * rule name in the output, per-rule `eslint-disable`, and RuleTester unit tests.
 */
import noBareEnumLiterals from './no-bare-enum-literals.mjs';
import noBareUiControls from './no-bare-ui-controls.mjs';
import noDisabledTests from './no-disabled-tests.mjs';
import noDuplicateFeatureTypes from './no-duplicate-feature-types.mjs';
import noDuplicateExtractErrorMessage from './no-duplicate-extract-error-message.mjs';
import noEnvFallbacks from './no-env-fallbacks.mjs';
import noWidenedEnumFields from './no-widened-enum-fields.mjs';
import noParallelApiTypes from './no-parallel-api-types.mjs';
import noInlineQueryKeys from './no-inline-query-keys.mjs';
import noInlineThemeStyles from './no-inline-theme-styles.mjs';
import noMockedApi from './no-mocked-api.mjs';

export default {
  meta: { name: 'poolmaster-local', version: '1.0.0' },
  rules: {
    'no-bare-enum-literals': noBareEnumLiterals,
    'no-bare-ui-controls': noBareUiControls,
    'no-disabled-tests': noDisabledTests,
    'no-duplicate-extract-error-message': noDuplicateExtractErrorMessage,
    'no-duplicate-feature-types': noDuplicateFeatureTypes,
    'no-env-fallbacks': noEnvFallbacks,
    'no-inline-query-keys': noInlineQueryKeys,
    'no-parallel-api-types': noParallelApiTypes,
    'no-widened-enum-fields': noWidenedEnumFields,
    'no-inline-theme-styles': noInlineThemeStyles,
    'no-mocked-api': noMockedApi,
  },
};
