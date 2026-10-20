import type { LegacyHttpTransport } from '../transport/httpClientTypes';

// Composition-root seam for the legacy catalog HTTP path.
//
// This module holds a module-local registration slot and nothing else. It must never import a
// runtime module: `src/serverless` bundles it, and the M0 spike proved that a single value import
// here would drag `axios`, `colors` and the filesystem-backed config manager into that bundle.
// The interface comes from `transport/httpClientTypes.ts` and is type-only.
//
// The seam owns request *defaults* as well as request execution. Reading them from `src/config`
// inside the catalog services is what pulls `config/manager.ts` — and therefore `node:fs` — into
// the serverless dependency graph, so each transport supplies the defaults its runtime can serve.

export type {
  LegacyHttpTransport,
  LegacyRequestDefaults,
  LegacyRequestTarget,
} from '../transport/httpClientTypes';

const MISSING_TRANSPORT_MESSAGE =
  'Legacy QQ HTTP transport is not registered. Register one in the composition root before ' +
  'calling a catalog service: Node, Electron and Docker load `src/app.ts`, which calls ' +
  '`setLegacyHttpTransport(createAxiosLegacyTransport())`; the serverless runtime registers its ' +
  'fetch transport from `src/serverless`. Tests register the axios transport in `tests/setup.ts`.';

let registered: LegacyHttpTransport | null = null;

export const setLegacyHttpTransport = (transport: LegacyHttpTransport): void => {
  registered = transport;
};

export const getLegacyHttpTransport = (): LegacyHttpTransport => {
  if (!registered) throw new Error(MISSING_TRANSPORT_MESSAGE);
  return registered;
};

/** Test hook: restores the unregistered state so the failure message stays covered. */
export const clearLegacyHttpTransport = (): void => {
  registered = null;
};
