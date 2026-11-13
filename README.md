# pi-feedback

A private improvement notebook for [Pi](https://pi.dev) and [pi-research](https://github.com/jrhuebers/pi-research). Capture something that went wrong without starting a model conversation, then triage it on a terminal board when you have time.

## Install

Requires Node.js 22+ and current official Pi (tested with Pi 1.5.0).

```sh
pi install git:github.com/jrhuebers/pi-feedback
```

Restart Pi or run `/reload`. For pi-research, both cluster profiles declare this package; after updating the distribution checkout, run `pi-research update --extensions --no-approve`, then restart or `/reload`. Install the package separately in ordinary Pi if you want it there too; the profiles do not share feedback by default.

Try a local checkout without installing:

```sh
pi -e ./src/index.ts
```

Update an installed copy with `pi update --extensions`. Git installations follow the repository's default branch; no npm publication is needed.

## Capture

```text
/feedback Reload lost my unsent draft; preserve it next time.
/feedback
```

Text after `/feedback` is saved immediately in **Inbox**. With no text, a multiline editor opens: use the first line as a title and the remaining lines for what happened, expected behavior, reproduction steps, or an improvement idea. Submitting empty text or cancelling saves nothing. Pi's editor uses its configured keys (normally Enter to submit, Shift+Enter for a newline, and Esc to cancel).

No model request is made. Notes survive `/new`, branching, restarts, and extension updates.

## Review

```text
/feedback-show
/feedback-show reload
```

The board has **Inbox**, **Planned**, and **Done** columns. Wide terminals show all three; narrow terminals show the selected column. Search matches note text, profile, cluster, and ID. All statuses are shown by default, newest first.

| Key | Action |
| --- | --- |
| ← / → or h / l | Select column |
| ↑ / ↓ or k / j | Select note; scroll in detail view |
| Enter | Open details / return to board |
| n | Capture another note |
| e | Edit the selected note |
| m | Move the selected note to another status |
| / | Search; submit empty text to clear |
| f | Cycle all / inbox / planned / done |
| s | Toggle newest / oldest first |
| r | Reload files and regenerate `BOARD.md` |
| Esc | Return from details, then close the board |

Pi's configured select up/down/confirm/cancel bindings are honored alongside these shortcuts. Editing and moving never delete a note. There is no bulk-delete command. RPC clients get standard selection/editor dialogs instead of a custom terminal board; print and JSON modes are not supported.

## Files and privacy

Data lives in `<active-agent-directory>/feedback/`, independently of the current project:

```text
feedback/
├── BOARD.md
└── items/
    ├── <uuid>.md
    └── <uuid>.md
```

Ordinary Pi normally uses `~/.pi/agent/feedback/`; pi-research normally uses `~/.pi-research/feedback/`. `PI_CODING_AGENT_DIR` is respected through Pi's `getAgentDir()` API. The save notification and board show the actual location.

Each item is readable Markdown with a one-line HTML comment containing versioned JSON metadata, followed by your text. `BOARD.md` is a generated index with links grouped by status; it is refreshed on capture, edit, move, and board opening/refresh. Edit items rather than the board if working outside Pi, preserve their metadata comment, and avoid external writes while Pi is modifying them.

Captured metadata includes the profile label, optional pi-research cluster, working directory, session ID, current session-tree entry ID when available, selected provider/model ID, Pi version, and timestamps. It does **not** copy conversation messages, prompts, tool results, logs, credentials, provider configuration, or session files. There are no model calls, network requests, automatic Git commits, GitHub issues, or uploads. Opening the board does not inject notes into the model context.

**This repository is public; your feedback is not.** New store directories use mode `0700` and files use `0600` on POSIX systems. Feedback is plaintext, not encrypted, and your own text and local paths may contain sensitive information. Keep the store outside public repositories and review/redact notes before sharing them. Removing the package leaves your feedback files untouched.

Optional process environment overrides:

| Variable | Purpose |
| --- | --- |
| `PI_FEEDBACK_DIR` | Explicit alternate store path; supports `~/`. Point multiple profiles here to share one board. |
| `PI_FEEDBACK_PROFILE` | Custom provenance label; otherwise `pi`, `pi-research`, or the custom agent directory's basename. |

When launched by pi-research, the extension reads only its nonsecret ownership manifest for the installed cluster label. Missing or malformed provenance does not block capture. It never reads project-local configuration to select a store.

## Reliability

Atomic file replacement and a bounded cross-process directory lock serialize extension writers. Edits detect stale snapshots rather than silently overwriting another session's changes. Unreadable/malformed notes are preserved and reported in `BOARD.md`; one bad note does not hide valid ones. If a generated-board write fails after a note was saved, the notification says the note is safe rather than suggesting a duplicate capture.

After a hard process crash, an empty `feedback/.lock` directory can remain. Only after checking no Pi process is writing this store, remove that empty directory with `rmdir`, then retry. Locks are never automatically stolen from a potentially active writer. Direct external edits do not participate in this locking protocol. This is a local notebook, not a distributed database or an encrypted backup service; back up the directory separately.

## Development

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run test:smoke
npm run test:tui   # Optional: POSIX + Python 3 standard library
```

The smoke test starts actual Pi processes with temporary homes/profiles, offline mode, no credentials, and no project configuration. It exercises capture, editor cancellation, board status changes, restart persistence, vanilla/research provenance, and absence of model messages. Set `PI_FEEDBACK_PI_BIN` to test a different Pi executable. Unit tests cover storage/concurrency, malformed files, permissions, profile separation, and narrow/Unicode terminal layout. The optional PTY smoke test also opens the actual board and detail view in both regular and fullscreen Pi terminal modes. Host Pi modules are peer dependencies, never bundled runtime dependencies.
