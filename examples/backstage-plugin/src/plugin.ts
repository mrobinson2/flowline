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
