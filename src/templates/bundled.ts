import { concentricTemplate } from './concentric';
import { ellipsesTemplate } from './ellipses';
import { sCurvesTemplate } from './s-curves';
import { hairlinesTemplate } from './hairlines';
import { blobTemplate } from './blob';
import type { TraceTemplate } from './types';

/** Order shown in the picker. */
export const BUNDLED_TEMPLATES: readonly TraceTemplate[] = [
  concentricTemplate,
  ellipsesTemplate,
  sCurvesTemplate,
  hairlinesTemplate,
  blobTemplate,
];

const TEMPLATE_INDEX = new Map<string, TraceTemplate>(
  BUNDLED_TEMPLATES.map(t => [t.id, t]),
);

/** Resolve a templateId (e.g. 'bundle:concentric') to its TraceTemplate. */
export function getBundledTemplate(id: string): TraceTemplate | undefined {
  return TEMPLATE_INDEX.get(id);
}
