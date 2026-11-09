# Answer-completion notifications — design

## Intent

When a DSH agent turn succeeds, give the user a brief signal and identify the session/task that finished. The notice is local to DSH; it must not send session content to an operating-system notification or an external service.

## Goals

- Offer one setting with `off`, `popup`, `taskbar`, and `both`; default to `both`, as selected by the user.
- Show a short, dismissible, theme-aware notification at the top of the DSH Client for `popup` and `both`.
- In the popup, identify the completed session by its existing title; if no title is available, use a bounded, control-character-sanitized summary of the latest user prompt. The task label never goes to the OS.
- For `taskbar` and `both`, show a generic Windows taskbar overlay dot when a successful completion occurs while the DSH window is not focused. Clear it when the window is focused again, when notifications are disabled, and during shutdown.
- Support the popup in ordinary web DSH even when the Electron bridge is unavailable. Taskbar mode is available only in the Windows DSH Desktop shell.
- Ignore aborted, blocked, errored, max-token, interrupted, and forked turn endings.
- Keep the plugin and the DSH Desktop integration patch source in this repository; do not modify the installed `app.asar`.

## Non-goals and anti-goals

- No OS toast, sound, tray text, message preview, or task title in the taskbar icon.
- No telemetry, remote notification service, or new external runtime dependency.
- No changes to DSH session contents, title-generation policy, or model/tool behavior.
- No notification for an unsuccessful or non-completed turn.
- Do not make the plugin silently appear to support taskbar mode on web, macOS, or Linux.

## Approaches considered

1. **Plugin-only Client popup.** This uses the live `shell.overlay` slot and works in web DSH, but cannot call `BrowserWindow.setOverlayIcon`; the current Host/Client catalogs expose no taskbar bridge.
2. **Plugin plus a small Desktop Host patch — chosen.** A persistent Cordis Host/Client plugin owns completion detection and the in-app popup. A versioned DSH Desktop patch adds a typed, boolean-only Host-child-to-Electron bridge for the generic dot. This keeps the session title in DSH and makes taskbar support explicit and optional.
3. **Patch the installed application bundle directly.** Rejected: it is brittle, hard to test/rebase, and would alter the user's installed `app.asar` instead of providing maintainable source.

## Proposed architecture

### Plugin bundle

- The Host half listens to the committed `session/event` stream and registers a client-visible `sessionProjections` unit. The unit updates only for `turn/end` with `reason.kind === 'completed'`; it exposes a bounded completion marker and fallback label through `wire.view`.
- The Client half contributes one component to the inspected `shell.overlay` slot. It watches the Host projection alongside the existing session title, shows one toast for each newly observed completion, and replaces an older toast rather than stacking. The toast is localized in English and Chinese, auto-dismisses after four seconds, has a close button, uses a polite live region, and never steals focus.
- The plugin Config `mode` controls both halves. The Client receives the mode through the projection view; the Host only asks for a taskbar indicator for `taskbar` or `both`.
- Completion tracking uses the post-commit `session/event` path, not the awaited `agent/turn-stopping` boundary, so an uncommitted/failed turn cannot be announced as completed.

### Windows Desktop patch

- Target the DSH `dsh-v0.2.2-rc.1` source layout, with tests and a documented rebase check. The installed runtime reports the same DSH package version, but its embedded build-commit value does not resolve to that public source tag; therefore the patch must be verified against the exact source before applying to a rebuilt Desktop package.
- Add an optional Desktop Host capability that accepts only an enabled/disabled indicator. The Host child sends a typed IPC message to the Electron main process; the main process validates it and uses `BrowserWindow.setOverlayIcon` on Windows with an original, generic dot asset.
- The bridge carries no session ID, task title, prompt text, or other session data. It is not exposed to the renderer. On unsupported platforms or in web DSH the capability is absent and the plugin degrades without throwing.
- The taskbar overlay is one dot, not a count or title. It is set only while the Desktop window is in the background and is cleared on focus and shutdown.

### Completion label and state

- Prefer the existing session title visible in the Client session summary.
- If absent, use at most 80 characters from the latest user prompt, normalized to one line and stripped of control characters. This fallback is carried by the Host projection to the local Client for the in-app toast; it is never sent through the Desktop bridge.
- Store only the last completion marker per session in the projection. The Client compares its sequence marker to avoid replaying old notices; a later completion replaces the prior marker.

## Privacy and compatibility constraints

- The public repository must contain only generic source, tests, docs, and original artwork—never credentials, profile data, conversation logs, local paths, or personal commit metadata.
- No notification content leaves DSH. The Desktop bridge payload is a boolean indicator only; the popup label is rendered in the app.
- A static `dsh.client` bundle must not assume the dynamic-only `host.call` API. Use the supported Host projection wire for the Client view.
- The plugin remains useful without the Desktop patch: popup mode works; taskbar mode has no effect outside patched Windows Desktop.

## Acceptance and verification

- Unit tests prove only `turn/end.completed` produces a completion marker; all other end reasons are ignored.
- Host tests cover projection updates, bounded fallback labels, mode routing, missing Desktop capability, and IPC schema validation.
- Client tests cover title/fallback selection, one-toast replacement, close/timeout, localization, accessibility, and all four modes.
- Desktop tests cover Windows-only overlay creation, clearing on focus/shutdown, invalid IPC rejection, and absence of session text in bridge payloads.
- Check the patch against the DSH source tag and run the relevant package tests/build. Do not install the plugin into the current profile or edit the installed `app.asar` as part of repository implementation.
- Before any push, review the exact file list and secret/privacy scan. The target GitHub repository is public, so publishing must be confirmed after the final diff is available.

## Remaining implementation choices

- The builder may choose the smallest compatible state schema and test seams, but must preserve the behaviors and privacy boundaries above.
- If the exact DSH Desktop source used by the installed build cannot be obtained or does not match the versioned patch target, ship the plugin and patch as an explicitly version-pinned integration rather than claiming it applies cleanly to that build.
