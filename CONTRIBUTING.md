# Contributing

## Before changing code

1. Read `docs/ARCHITECTURE.md` and `docs/THREAT_MODEL.md`.
2. Keep user data unchanged unless the selected output format necessarily requires encoding/escaping.
3. Keep browser APIs behind small boundaries where practical.
4. Never add silent fallbacks that can return a result with a different format or weaker security properties.
5. Update tests and documentation in the same change.

## Local setup

```bash
npm install
npm run dev
```

Commit the generated `package-lock.json`; CI uses `npm ci` and intentionally fails without a lock file.

## Validation before a pull request

```bash
npm run manifest:write
npm run format
npm run check
npm run build
npx playwright install chromium firefox webkit
npm run test:e2e
npm run audit
npm run manifest:write
npm run manifest:check
```

Review the manifest diff and the dependency lockfile. Do not commit `node_modules`, `dist`, Playwright output, test videos, local files or user documents.

## Architecture rules

- `core/`: deterministic policies, types, validation, error contracts and browser-independent helpers.
- `engines/`: use-case logic and format processing; no UI access.
- `workers/`: background execution and message protocol adapters.
- `ui/`: DOM, state presentation and user interaction; no file-format parsing beyond presentation.
- `tests/`: deterministic unit/integration fixtures.
- `e2e/`: browser-visible workflows, real download behavior and automated accessibility checks.

Use focused modules. `main.ts` must remain a small composition root.
