# Maintenance

This is a standalone Pi extension package, not a runtime agent directory. Never commit feedback notes, session data, credentials, logs, provider configuration, or machine-specific paths. Feedback stays private outside this checkout.

Host-provided Pi modules belong in `peerDependencies`, never `dependencies`. Keep the extension dependency-light and compatible with current official Pi. No model calls, transcript collection, network requests, or publishing side effects belong in capture/board commands.

Run `npm run typecheck`, `npm test`, and `npm run test:smoke` before publishing changes. Use temporary isolated profiles without credentials for integration tests. Test terminal rendering at narrow and wide widths, with Unicode and both terminal modes. Do not add dependencies or change privacy behavior without reviewing and documenting the effects.

Keep Markdown paragraphs and list items on one physical line. Notes in `items/` are authoritative; `BOARD.md` is derived. Preserve malformed user files, cross-process locking, atomic writes, and fail-safe stale edit detection.
