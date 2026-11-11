import { addons } from 'storybook/manager-api';
import { create } from 'storybook/theming';
import { PRODUCT_NAME } from '../../../packages/shared/domain/brand';

/** The gallery's own name in its sidebar and browser tab. */
addons.setConfig({
  theme: create({ base: 'light', brandTitle: `${PRODUCT_NAME} component gallery` }),
});
