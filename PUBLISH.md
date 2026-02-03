
## Build (prod)
```bash
pnpm install
pnpm run build
```

## Build (dev)
```bash
# pnpm install
pnpm run pack
```
This build and generates packages locally in the `artifacts` directory (as `*.tgz` files) at the repo root.

## Publish
```bash
pnpm changeset
pnpm changeset version
--
pnpm install
pnpm run tsc
pnpm run build
--
# pnpm changeset publish
pnpm run publish:test
pnpm run publish
```

## References: 
- https://github.blog/changelog/2025-12-09-npm-classic-tokens-revoked-session-based-auth-and-cli-token-management-now-available/
