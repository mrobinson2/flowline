# Flowline - Backstage frontend plugin

A page in Backstage that renders a value stream. The
chart engine is plain DOM and React owns only the container, so this is a thin
wrapper rather than a rewrite.

## Status

The engine and the embed API in `js/embed.js` are tested and working: see
`examples/embedded.html`, which mounts the same chart into a bare page with no
application chrome, swaps profiles, views and themes, and leaves exactly one
SVG behind after repeated updates and none after destroy.

**These plugin files themselves are unverified against a real Backstage build.**
They parse, and they follow the standard plugin shape, but nobody has run them
inside a Backstage app yet. Treat them as a starting point, not a finished
plugin. The things most likely to need adjusting are listed at the bottom.

## Install

From your Backstage repo root:

```bash
yarn new --select plugin      # name it value-stream
```

Replace the generated `src/` with this one, then copy the app's `js/` and
`data/` folders to `plugins/value-stream/src/vsm/`.

Wire it into the app. In `packages/app/src/App.tsx`:

```tsx
import { ValueStreamPluginPage } from '@internal/plugin-value-stream';
// inside <FlatRoutes>
<Route path="/value-stream" element={<ValueStreamPluginPage />} />
```

And in `packages/app/src/components/Root/Root.tsx`:

```tsx
import TimelineIcon from '@material-ui/icons/Timeline';
<SidebarItem icon={TimelineIcon} to="value-stream" text="Value Stream" />
```

## Which frontend system

This targets the stable frontend system (`@backstage/core-plugin-api`,
`createPlugin` + `createRoutableExtension`), which is what most self-hosted
instances run. If you are on the new frontend system
(`@backstage/frontend-plugin-api`), the component in
`ValueStreamPage.tsx` is unchanged and only `plugin.ts` needs rewriting.

## Data

The plugin ships with the sample data compiled in. For real data you have two
choices:

1. **Let people import their own workbook.** Add a file input and call
   `chart.setData()` with the result of `vsm.import.fromWorkbook()`. The file
   is read in the browser and never reaches the Backstage server, which keeps
   a Confidential workbook out of a system a lot of people can read.
2. **Serve the data from the Backstage backend.** Fetch the JSON bundle and
   pass it to `setData()`. Simpler for viewers, but the data now lives on the
   server and inherits its classification and access review.

Option 1 unless someone decides otherwise.

## Likely to need adjusting

- Material UI version. Backstage moved from v4 to v5; the imports here are v4
  (`@material-ui/core`). On v5 change them to `@mui/material`.
- The `import './vsm/js/registry'` side-effect imports assume your bundler
  runs them in order and tolerates CommonJS. It should, but check the data
  files actually registered by logging `globalThis.VSM.data` on first render.
- `Select onChange` typing differs between MUI versions.
- If your instance sets a strict Content Security Policy, the chart needs no
  external resources at all, so nothing should trip. Worth confirming.
