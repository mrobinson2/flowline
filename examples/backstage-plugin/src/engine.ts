/* The engine, imported for its side effects and handed back as a typed handle.
 *
 * Each of these files is an IIFE that attaches itself to globalThis, and each
 * ends with a CommonJS export, so a bundler executes them happily. Order
 * matters only in that registry must come first (it creates the namespace) and
 * the data files must come after it (they call VSM.register).
 *
 * Copy the app's js/ and data/ folders into src/vsm/ alongside this file, or
 * publish them as an internal npm package and import that instead. The second
 * is better once this stops changing weekly. */
import './vsm/js/registry';
import './vsm/js/units';
import './vsm/js/schema';
import './vsm/data/taxonomy.data';
import './vsm/data/scenario.data';
import './vsm/data/process.data';
import './vsm/js/validate';
import './vsm/js/rules';
import './vsm/js/schedule';
import './vsm/js/layout';
import './vsm/js/render';
import './vsm/js/analyze';
import './vsm/js/table';
import './vsm/js/import';
import './vsm/js/embed';

export type VsmChart = {
  update(patch: Record<string, unknown>): unknown;
  setData(next: { process: unknown; taxonomy: unknown; scenario: unknown }): unknown;
  getModel(): any;
  getScenarioOptions(): {
    profiles: Array<{ id: string; label: string; description?: string }>;
    attributes: Array<any>;
  };
  analyze(): any;
  destroy(): void;
};

export type Vsm = {
  embed: { create(el: HTMLElement, opts: Record<string, unknown>): VsmChart };
  import: { fromWorkbook(buf: ArrayBuffer, opts?: any): Promise<any> };
  data: { process: any; taxonomy: any; scenario: any };
};

export const vsm = (globalThis as any).VSM as Vsm;
