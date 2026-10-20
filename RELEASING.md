# Release process

Releases are maintainer-authorized operations. Merging a pull request, creating a tag,
or updating `main` must not publish to npm automatically.

## Prepare the release

1. Confirm the release scope and version against the [compatibility policy](./docs/compatibility.md).
   Check announced route removals and describe the migration before releasing them.
2. Confirm the release branch is clean and the version has not already been published.
3. Review changes to production dependencies, public exports, routes, error fields,
   device identity, and session persistence.
4. Update `package.json`, `package-lock.json`, and `CHANGELOG.md` in one release commit.
   Keep the API guide, API Explorer, error guide, and compatibility policy consistent.
5. Run the verification chain on the release candidate:

   ```powershell
   npm ci
   npm run lint
   npm run build
   npm test -- --runInBand
   npm run test:contracts
   npm run build:js
   npm pack --dry-run
   ```

   Use PowerShell for the full Jest suite on Windows. `npm run build` checks types;
   `npm run build:js` generates the runtime files. Packing does not rebuild them.

6. Inspect the package contents. Check `LICENSE`, `ATTRIBUTION.md`, `README.md`,
   `types`, `dist/src/app.js`, and both CommonJS and ESM Serverless/MQTT entries.
   Preserve the original MIT license, including its blank copyright-holder field.
7. Review public text for credentials, personal data, internal work labels, and
   unintended third-party issue or pull-request references. Chinese text must use
   simplified Chinese; English documents remain in English. Keep contributor credit
   consistent across the README, attribution, changelog, and release notes.

## Check integrations

Before publishing, test the candidate package with the current Folia source in an
isolated checkout. Do not change the user's installed application or login state.

- Install the built candidate package, then run Folia's relevant unit tests and type
  checks, including its QQ integration and Serverless dependency-closure checks.
- Verify Electron startup, the session repository, logger hooks, and the internal
  paths listed in the compatibility policy.
- Confirm the candidate works in Node, Docker, Vercel, and Cloudflare, including the
  relay-backed login channels where configured. Record which hosts and channels
  were actually checked; offline tests alone do not establish live compatibility.
- With authorization to contact the real upstream, run
  `npm run smoke:upstream -- --yes-call-upstream` after `npm run build:js`. It requests
  each anonymous read route once and only compares response structure with
  `scripts/smoke/expected.json`; investigate any change before publishing.
- Arrange authorized manual acceptance with the account owner for login, library,
  playback, session renewal, and writes. Read back and restore test changes where
  possible. Do not include account data or credentials in the release evidence.

Unexpected differences from the previous release must be resolved or explicitly
accepted before publishing.

## Publish

Only after explicit maintainer approval:

1. Merge through the protected `main` branch after the required `verify` check passes.
2. Create one immutable `vX.Y.Z` tag at the merged release commit.
3. Publish that version to npm once.
4. Create GitHub release notes for the same tag.
5. Notify consumers of required migrations, dependency updates, and rebuilds.

Never move an existing release tag or republish an existing npm version.

## Upgrade notice for integrators

State the released version, route removals and replacements, changed behavior, and
which validation was completed. Link to the changelog and compatibility policy.

Applications that pin an exact version must update their dependency and lockfile,
then rebuild. Folia has separate dependency and lockfile pairs at the application
root and in `deploy/docker/qq-api/`; both must be updated. Electron users receive
the package through an application update. Docker images must be rebuilt and
containers recreated; Vercel and Cloudflare deployments must also be rebuilt and
redeployed. Preserve existing state volumes and secrets during the upgrade.
