## Summary

Describe the problem and the smallest change that solves it.

## Package and API impact

- Public/runtime API impact, including routes, fields, exports, and host limitations:
- Migration or compatibility notes, if needed:
- [ ] No package version or release change
- [ ] Runtime dependency changes are listed and justified below

## Verification

- [ ] `npm ci`
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm test`
- [ ] `npm run test:contracts`
- [ ] `npm run build:js`
- [ ] `npm pack --dry-run`

State which checks were run and disclose any test that contacted a live QQ Music endpoint.

## Security and legal

- [ ] No credentials, cookies, QR/session values, personal data, auth-state files, or `.env` data are included
- [ ] The original MIT license and contributor attribution remain intact
- [ ] Public behavior changes are reflected in the API guide, changelog, API Explorer, and error guide
- [ ] No unauthorized third-party issue or pull-request cross-references are included
