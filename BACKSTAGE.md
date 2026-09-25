# Flowline as a Backstage plugin

This is the install and configuration guide for running Flowline inside [Backstage](https://backstage.io) as a frontend plugin. For what Flowline is and what the chart shows, see [README.md](README.md).

## Status, before you start

The chart engine and the embed API (`js/embed.js`) are tested and working. `examples/embedded.html` mounts the same chart into a bare page with no application chrome, swaps profiles, views and themes, and leaves exactly one SVG behind after repeated updates and none after destroy.

**The plugin files themselves have not been run inside a real Backstage build.** They parse, they follow the standard plugin shape, and the component is a thin wrapper around an API that does work. But nobody has stood them up in a Backstage app yet, so treat this as a working starting point rather than a published plugin. [Known gaps](#known-gaps) lists the specific things most likely to need a change for your instance.

If you do get it running, a pull request correcting anything in this file would be welcome.

## How it fits together

Flowline is plain DOM. It does not use React, it does not own any application state, and it makes no network requests. The integration is therefore small on purpose:

```
Backstage page (React)
  └── <div ref={hostRef} />          React owns this element and nothing inside it
        └── VSM.embed.create(el, …)  plain DOM: builds an SVG and appends it
```

React mounts the chart on first render, calls `update()` when a control changes, and calls `destroy()` on unmount. No React state lives inside the chart and no chart state leaks into React. That is the whole integration, and it is about fifteen lines.

## Prerequisites

* A Backstage app you can add a plugin to (`yarn new` available at the repo root)
* Node 18 or newer, which Backstage already requires
* Nothing else. Flowline has no dependencies and pulls nothing from a CDN.

## Install

### 1. Scaffold the plugin

From your Backstage repo root:

```bash
yarn new --select plugin
# name it: value-stream
```

That creates `plugins/value-stream/` with the standard layout and wires the workspace.

### 2. Copy the plugin source

Replace the generated `plugins/value-stream/src/` with the contents of `examples/backstage-plugin/src/` from this repository:

```
plugins/value-stream/src/
├── index.ts                                      exports the plugin and the page
├── plugin.ts                                     createPlugin + createRoutableExtension
├── routes.ts                                     the route ref
├── engine.ts                                     imports the engine, types the handle
└── components/ValueStreamPage/ValueStreamPage.tsx  the page itself
```

### 3. Copy the engine

Copy this repository's `js/` and `data/` folders into `plugins/value-stream/src/vsm/`:

```bash
mkdir -p plugins/value-stream/src/vsm
cp -r /path/to/flowline/js   plugins/value-stream/src/vsm/
cp -r /path/to/flowline/data plugins/value-stream/src/vsm/
```

`engine.ts` imports those files for their side effects, in dependency order:

```ts
import './vsm/js/registry';      // must be first: it creates the namespace
import './vsm/js/units';
import './vsm/js/schema';
import './vsm/data/taxonomy.data';   // the data files call VSM.register(...)
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

export const vsm = (globalThis as any).VSM as Vsm;
```

Each file is an IIFE that attaches itself to `globalThis` and ends with a CommonJS export, so any bundler executes them happily. Order matters only in that `registry` comes first and the data files come after it.

Once this stops changing weekly, publishing `js/` and `data/` as an internal npm package and importing that instead is tidier than copying folders.

### 4. Add the route

In `packages/app/src/App.tsx`:

```tsx
import { ValueStreamPluginPage } from '@internal/plugin-value-stream';

// inside <FlatRoutes>
<Route path="/value-stream" element={<ValueStreamPluginPage />} />
```

### 5. Add the sidebar item

In `packages/app/src/components/Root/Root.tsx`:

```tsx
import TimelineIcon from '@material-ui/icons/Timeline';

// inside <SidebarGroup>
<SidebarItem icon={TimelineIcon} to="value-stream" text="Value Stream" />
```

On Material UI v5, that import is `@mui/icons-material/Timeline`.

### 6. Run it

```bash
yarn dev
```

Open `/value-stream`. You should get the shipped sample value stream with a Scenario dropdown and a View dropdown in the page header.

## Which frontend system

`plugin.ts` targets the **stable frontend system** (`@backstage/core-plugin-api`, `createPlugin` + `createRoutableExtension`), which is what most self-hosted instances run:

```ts
import { createPlugin, createRoutableExtension } from '@backstage/core-plugin-api';
import { rootRouteRef } from './routes';

export const valueStreamPlugin = createPlugin({
  id: 'value-stream',
  routes: { root: rootRouteRef },
});

export const ValueStreamPluginPage = valueStreamPlugin.provide(
  createRoutableExtension({
    name: 'ValueStreamPluginPage',
    component: () => import('./components/ValueStreamPage/ValueStreamPage').then(m => m.ValueStreamPage),
    mountPoint: rootRouteRef,
  }),
);
```

If you are on the **new frontend system** (`@backstage/frontend-plugin-api`), `ValueStreamPage.tsx` is unchanged and only `plugin.ts` needs rewriting into `createFrontendPlugin` with a `PageBlueprint`. The component has no dependency on either system.

## Getting real data in

The plugin ships with the sample data compiled in. For your own, you have two choices, and they have different security properties.

### Option 1: let people import their own workbook (recommended)

Add a file input to the page and hand the result to `setData()`:

```tsx
const onFile = async (file: File) => {
  const result = await vsm.import.fromWorkbook(await file.arrayBuffer(), { source: file.name });
  if (result.report.errors.length) { setError(new Error(result.report.errors[0])); return; }
  chartRef.current?.setData({
    process: result.process,
    taxonomy: result.taxonomy,
    scenario: result.scenario,
  });
};
```

The file is read in the browser and never reaches the Backstage server. That keeps a Confidential workbook out of a system a lot of people can read, which is usually the deciding factor.

`setData()` runs the same validation gate the standalone app uses and throws with the first error, so broken data is reported rather than rendered as an empty box.

### Option 2: serve the data from the Backstage backend

Fetch a JSON bundle and pass it to `setData()`:

```tsx
const { fetch } = useApi(fetchApiRef);
const res = await fetch(`${await discovery.getBaseUrl('value-stream')}/data`);
chartRef.current?.setData(await res.json());
```

Simpler for viewers, but the data now lives on the server and inherits its classification and its access review. Pick this only when someone has decided that is acceptable.

Export a bundle from the standalone app with **Export ▾ → JSON bundle (process, taxonomy, scenario)**. The shape is `{ "process": {...}, "taxonomy": {...}, "scenario": {...} }`.

## Configuration reference

Everything passed to `vsm.embed.create(element, options)`. Every option can also be changed later with `chart.update({ ... })`; anything you leave out keeps its current value.

| Option | Default | What it does |
|---|---|---|
| `data` | the shipped sample | `{ process, taxonomy, scenario }`. Validated on the way in. |
| `profile` | none | A preset id from `scenario.presets`, for example `build-paved`. |
| `scenario` | `{}` | Toggle overrides laid on top of the profile, for example `{ aiWorkload: true }`. |
| `view` | `"current"` | `current`, `opportunity`, `waste`, `optimal` or `tracker` (the project-status composition; reads the activities' optional `status` fields). |
| `theme` | `"dark"` | `dark` or `light`. |
| `density` | `"normal"` | `comfortable`, `normal` or `compact`. Row height. |
| `width` | container width | Pixel width. Falls back to `container.clientWidth`, then 1200. |
| `zoom` | `1` | Multiplies the width. |
| `columns` | `true` | The owner column on the left and the duration column on the right. |
| `rowNumbers` | `true` | Row numbers in the left column. |
| `phases` | `true` | Phase bands and their rotated labels. |
| `links` | `"all"` | `all`, `handoffs` or `none`. |
| `critical` | `false` | Mark the critical path. |
| `search` | `""` | Dim rows that do not match. |
| `presentation` | `false` | Use the fixed 1920x1080 composition instead of the flowing one. |
| `metrics` | `true` | The metrics strip, in presentation mode only. |
| `onSelect` | none | `(activity, node) => void`, called when a bar is clicked. |

The handle `create()` returns:

| Method | What it does |
|---|---|
| `update(patch)` | Merge options and redraw. Returns the new model. |
| `setData(next)` | Swap the whole data set. Validates first and throws on error. |
| `getModel()` | The scheduled model: nodes, links, metrics, warnings. |
| `getSvg()` | The `<svg>` element currently mounted. |
| `getScenarioOptions()` | `{ profiles, attributes }`, for building your own controls. |
| `analyze()` | Critical chain, parallelism, lead vs cycle along the path. |
| `destroy()` | Empty the container and drop the references. Call this on unmount. |

## Matching the Backstage theme

The chart takes `theme: 'dark' | 'light'`. To follow the user's Backstage theme rather than hard-coding one:

```tsx
import { useTheme } from '@material-ui/core/styles';

const theme = useTheme();
const mode = theme.palette.type === 'dark' ? 'dark' : 'light';   // MUI v5: theme.palette.mode

useEffect(() => { chartRef.current?.update({ theme: mode }); }, [mode]);
```

To match your own brand colors rather than Flowline's, edit the `families` hex pairs in `data/taxonomy.data.js`. Every family is a pair: a solid shade for necessary time and a lighter shade for removable time, which is always drawn hatched on top.

## Resizing

The chart draws at the width it is given and does not watch its container. If your page can change width (a sidebar collapsing, a window resize), tell it:

```tsx
useEffect(() => {
  if (!hostRef.current) return undefined;
  const ro = new ResizeObserver(() => chartRef.current?.update({ width: hostRef.current!.clientWidth }));
  ro.observe(hostRef.current);
  return () => ro.disconnect();
}, []);
```

Debounce it if your layout animates.

## Content Security Policy

Flowline loads no external scripts, stylesheets, fonts or images, and makes no network requests. There is nothing for a CSP to block, and no directive you need to relax. The one thing worth confirming on a strict policy is inline `style` attributes on the SVG, which the renderer writes so that the exported file keeps its appearance outside the page.

## Troubleshooting

**The page renders but the chart area is empty.** The engine imports probably did not run. Log `globalThis.VSM.data` on first render: you should see `process`, `taxonomy` and `scenario`. If it is empty, your bundler is tree-shaking the side-effect imports in `engine.ts`. Mark the package as having side effects, or import something from each file.

**`Invalid data: ...` thrown on mount.** That is the validation gate doing its job, and the message names the activity and the problem. The same data will fail the same way in the standalone app, which is an easier place to fix it.

**Every bar is grey and the codes are missing.** The taxonomy did not load, so the renderer fell back to neutral. Check the `data/taxonomy.data.js` import path.

**The chart draws once and never updates.** Check that the `useEffect` that calls `update()` has the controls in its dependency array, and that you are not calling `create()` again on each render. Creating twice leaves two SVGs in the container.

**Nothing renders and the console mentions `document is not defined`.** Something is server-side rendering the page. The engine modules are safe to import server-side, but `render.js` and `embed.js` need a DOM. Load them client-side only.

## Known gaps

These are the things most likely to need a change in your instance:

* **Material UI version.** Backstage moved from v4 to v5. The imports in `ValueStreamPage.tsx` are v4 (`@material-ui/core`). On v5, change them to `@mui/material` and `theme.palette.type` to `theme.palette.mode`.
* **`Select onChange` typing** differs between MUI versions. On v5 the cast is `e.target.value as string` on a `SelectChangeEvent`.
* **The default profile is hard-coded** to `build-paved` in `ValueStreamPage.tsx`. That id exists in the shipped sample data. Change it, or drop the default, when you load your own.
* **Side-effect import order** in `engine.ts` assumes your bundler runs them in order and tolerates CommonJS. It should. Confirm it once, as described under Troubleshooting.
* **No entity integration.** This is a standalone page. Rendering a value stream for the entity you are looking at, driven by an annotation, would be a natural next step and is not written.
* **No permissions integration.** The page is visible to anyone who can reach the route.

## License

MIT, same as the rest of the repository. See [LICENSE](LICENSE).
