# Answer Completion Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare a downloadable DSH Host/Client bundle for successful-turn notices, plus a narrowly scoped, version-pinned Windows Desktop taskbar-dot patch.

**Architecture:** The Host folds committed `session/event` records into a `sessionProjections` view and optionally sends a boolean-only taskbar message. The Client renders one localized toast in `shell.overlay`, using the existing session title or the bounded fallback carried by the projection. A separate DSH Desktop source patch validates the Host-child IPC message and controls the generic Windows overlay icon.

**Tech Stack:** ESM JavaScript, Cordis bundle YAML, DSH Client module loader and React module, Node built-in tests, DSH Desktop TypeScript/Vitest.

**Spec:** `docs/superpowers/specs/2026-11-09-answer-completion-notifications-design.md`

## Global Constraints

- Default plugin `mode` is `both`; accepted values are `off`, `popup`, `taskbar`, and `both`.
- Notify only for committed `turn/end` events whose reason kind is `completed`; ignore `aborted`, `blocked`, `error`, `max-tokens`, `interrupted`, and `forked`.
- The popup prefers the existing session title; its fallback is at most 80 characters, single-line, and stripped of control characters.
- The popup is localized in English and Chinese, uses a polite live region, can be dismissed, auto-dismisses after 4 seconds, and never steals focus.
- The taskbar bridge message is exactly `{ type: 'dsh-taskbar-badge', enabled: boolean }`; it must never include a session ID, title, prompt, or other session data.
- Taskbar support is Windows Desktop only; the generic dot is set only while the window is unfocused and cleared on focus and shutdown. Web, macOS, Linux, and an unpatched Desktop must degrade without throwing.
- Add no new external runtime dependency; declare the DSH-shipped `zod@4.4.3` only as a peer for projection schemas, without vendoring a copy. If plugin resolution would install another copy, pause and ask before changing the dependency boundary. The static Client reads the `wire.view`; it must not use dynamic-only `host.call` or fold session events in the browser. The Host projection owns state folding; any direct `session/event` listener is only for the taskbar side effect and must not rescan logs. Do not alter session contents, title-generation policy, or model/tool behavior.
- DSH source tests/build require Node `>=24.9.0` and `pnpm@11.28.5`.
- Target only DSH source tag `dsh-v0.2.2-rc.1` (public tag commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`). The installed build's embedded commit does not resolve to this public tag, so do not claim binary compatibility without verification. Do not edit the installed `app.asar` or install this bundle into the current profile.
- The repository is public. Add no credentials, profile data, logs, local paths, personal commit metadata, or `LICENSE` file unless the owner separately chooses a license. Do not push until the owner has reviewed the final diff and explicitly confirms public publishing.

## Review Focus

- **Non-completed and replayed events:** only a newly committed `turn/end.completed` advances the marker; the Client's first snapshot establishes a baseline rather than replaying an old notice. Test in Tasks 1 and 2.
- **Long or hostile labels:** empty, multi-line, control-character, and over-80-character prompt text remains bounded and safe for the in-app toast. Test in Task 1.
- **Concurrent session completions:** multiple changed session markers in one Client update produce at most one visible toast, selecting the newest completion and replacing the previous one. Test in Task 2.
- **Missing or unsupported Desktop capability:** web mode, non-Windows platforms, and a Host without the explicit capability marker send no taskbar IPC and do not break popup behavior. Test in Tasks 1 and 3.
- **Focus and teardown races:** an active dot is cleared on focus, shutdown, plugin disable, or capability teardown; no timer/listener survives its owner. Test in Tasks 1–3.

---

### Task 1: Create the bundle and Host completion projection

**Files:**
- Create: `package.json`
- Create: `cordis.patch.yml`
- Create: `index.js`
- Create: `client.js` (copied as the inspected slot-module template; finished in Task 2)
- Create: `lib/completion-projection.js`
- Create: `lib/taskbar-bridge.js`
- Create: `locale/en.json`
- Create: `locale/zh.json`
- Create: `icon.svg`
- Create: `tests/completion-projection.test.js`
- Create: `tests/taskbar-bridge.test.js`

**Interfaces:**
- `sanitizePromptSummary(value: unknown): string` returns one line with control characters removed and no more than 80 Unicode code points.
- Projection state is `{ pendingPrompt: string | null, lastCompletion: { seq: number, time: number, fallbackLabel: string | null } | null }`; `reduceCompletion(state, event)` consumes the committed Session event envelope and returns the same state reference for ignored events. For `user/message`, extract only text blocks from the pinned DSH `UserMessage.content` schema and store the bounded summary; record a marker only for `turn/end` with `event.data.reason.kind === 'completed'`.
- Register and await one unit with key `dsh-tip/completion-notice` using the inspected `sessionProjections.register` contract: `stateSchema`, `init(header, inheritedEventCount)`, pure `apply(state, event)`, `stateVersion: 1`, and `wire: { viewSchema, view, summary: true }`. Reuse the DSH-shipped Zod 4.4.3 runtime.
- The projection's `wire.view` returns only `{ mode, lastCompletion }`, where `lastCompletion` contains the sequence marker and fallback label; the Client obtains the preferred title from the existing session summary.
- `shouldNotifyTaskbar(mode, event): boolean` is true only for `taskbar`/`both` plus `turn/end.completed`. `postTaskbarBadge(transport, enabled): boolean` sends exactly `{ type: 'dsh-taskbar-badge', enabled }` only when the explicit Desktop capability marker is `1`, the Host platform is `win32`, the child is connected, and a send function exists.
- Host Config exposes `mode` with exactly `off | popup | taskbar | both`, default `both`; the bundle row uses package/id `@local/dsh-tip-completion-notice` / `dsh-tip-completion-notice`.

- [ ] **Step 1: Write failing Host tests.** In `tests/completion-projection.test.js`, add `only completed turn/end advances marker` (`assert.equal(next.lastCompletion.seq, event.seq)` only when `event.data.reason.kind === 'completed'`), `other end reasons preserve state` (`assert.strictEqual(next, state)` for each other reason), and `prompt summary is one-line/control-free/80-code-point bounded`. In `tests/taskbar-bridge.test.js`, add `only taskbar and both request a badge`, `supported transport sends boolean-only payload` (`assert.deepEqual(messages, [{ type: 'dsh-taskbar-badge', enabled: true }])`), `unsupported transport sends nothing`, and `cleanup sends false only`.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `node --test tests/completion-projection.test.js tests/taskbar-bridge.test.js` from the bundle root. Expected: FAIL because the helpers do not exist.
- [ ] **Step 3: Copy and verify the inspected bundle templates.** Use `read` then `write` to copy `package.json`, `cordis.patch.yml`, Host `index.js`, Client `client.js`, `locale/en.json`, and `icon.svg` from the installed decoration template into this bundle; read each copy back before editing. Add `locale/zh.json`, the `zod@4.4.3` peer declaration, and `lib/*.js` to `files`; customize the package/Client-module IDs, row id with `config: { mode: 'both' }`, localized metadata, and original icon artwork.
- [ ] **Step 4: Add the minimal Host implementation.** Implement `sanitizePromptSummary`, the pure reducer and Zod-validated projection/view schemas, the four-value Config schema, `shouldNotifyTaskbar`, and the injectable boolean-only sender. Await `sessionProjections.register`; own its handle and the `session/event` listener in the plugin context; send `false` on cleanup.
- [ ] **Step 5: Re-run Host tests and syntax checks.** Run `node --test tests/completion-projection.test.js tests/taskbar-bridge.test.js` and `node --check index.js && node --check client.js && node --check lib/completion-projection.js && node --check lib/taskbar-bridge.js`. Expected: all tests pass and syntax checks exit 0.
- [ ] **Step 6: Commit the tested Host bundle.** Use a neutral per-commit author, not the machine's global identity: `git -c user.name="DSH Tip contributors" -c user.email="noreply@users.noreply.github.com" commit -am "feat: add completion projection and taskbar signal"` (stage newly created files first).

### Task 2: Add the localized global Client toast

**Files:**
- Modify: `client.js` (template copied in Task 1)
- Create: `tests/client-overlay.test.js`

**Interfaces:**
- The component registers one `shell.overlay` entry through `ctx.slots.inject` / `ctx.slots.register`, using the inspected `useSessions` and `useSessionStatus` slot hooks and `ctx.locale`.
- The Client reads projection key `dsh-tip/completion-notice` from each session summary, normalizes its `lastCompletion` to `{ sessionId, seq, completedAt: time, title, fallbackLabel }`, then returns an updated per-session seen-sequence map plus at most one new notice. A `null` prior map means “initial snapshot”: seed it without showing an old notice.
- The label is `title || fallbackLabel`; popup-eligible modes are only `popup` and `both`. The toast uses the latest changed completion, replaces rather than stacks, and has a 4-second dismiss timer owned by the mounted component.

- [ ] **Step 1: Write failing Client tests.** In `tests/client-overlay.test.js`, use a fake `window.__ModuleLoader__`, React hooks, slot registrar, locale service, and timer. Name tests `initial snapshot does not replay`, `only popup/both render`, `title precedes fallback`, `new sequence replaces and simultaneous completions yield one newest toast`, `close and 4_000ms timeout dismiss`, and `copy is localized and accessible`. Assert `role === 'status'`, `aria-live === 'polite'`, a localized close-button label, and no autofocus or focus call.
- [ ] **Step 2: Run the Client tests and confirm they fail.** Run `node --test tests/client-overlay.test.js`. Expected: FAIL because the bundle entry and component are absent.
- [ ] **Step 3: Implement the `shell.overlay` component in `client.js`.** Keep the browser module self-contained and use only the baseline React module; declare Cordis `inject: ['slots', 'locale']` and retain the template's `dsh.client` injection for the conversation UI package. Subscribe through slot hooks, seed the first snapshot as a replay baseline, register both locale dictionaries with `ctx.locale`, use theme alias tokens, render a single accessible toast, and clear the timer on replacement, dismissal, or unmount.
- [ ] **Step 4: Re-run Client tests and validate the bundle entry.** Run `node --test tests/client-overlay.test.js` and `node --check client.js`. Expected: all Client assertions pass, including mode, copy, accessibility, replacement, and timer cleanup.
- [ ] **Step 5: Commit the tested Client toast.** Stage the changed files and commit as `feat: add localized completion toast` with the same neutral per-command author.

### Task 3: Build the version-pinned Windows Desktop bridge patch

**Files:**
- Create in the DSH source work area: `apps/desktop/src/taskbar-overlay.ts`
- Modify in the DSH source work area: `apps/desktop/src/host-process.ts`
- Modify in the DSH source work area: `apps/desktop/src/main.ts`
- Create in the DSH source work area: `apps/desktop/tests/taskbar-overlay.spec.ts`
- Create in this repository: `patches/dsh-v0.2.2-rc.1.patch`

**Interfaces:**
- Extend the Desktop Host event union with strict message `{ type: 'dsh-taskbar-badge'; enabled: boolean }`; export `isDesktopHostEvent(value: unknown): value is DesktopHostEvent` and reject malformed or extra session-data fields.
- `createTaskbarOverlay(window, platform, dotIcon)` returns `{ set(enabled: boolean): void; dispose(): void }`; it is a no-op off Windows, sets the generic icon only while unfocused, clears on `focus` and `closed`, and removes listeners on disposal.
- The Desktop main process passes the boolean callback to `DesktopHostProcess`, supplies `DSH_DESKTOP_TASKBAR_API=1` only to the Windows Host child, and clears the overlay on shutdown.

- [ ] **Step 1: Write failing Desktop tests at the pinned source tag.** Add `apps/desktop/tests/taskbar-overlay.spec.ts`; import `isDesktopHostEvent` and add `accepts only strict boolean badge messages` plus `rejects title and session fields`; add overlay tests `sets only on unfocused Windows`, `does nothing on focused/non-Windows`, and `focus, close, shutdown clear and remove listeners`.
- [ ] **Step 2: Run the targeted test and confirm it fails.** From a clean checkout of `dsh-v0.2.2-rc.1`, run `pnpm exec vitest run apps/desktop/tests/taskbar-overlay.spec.ts`. Expected: FAIL because the overlay helper/event type is absent. Do not run dependency installation scripts without asking first if the source checkout lacks its dependencies.
- [ ] **Step 3: Implement the typed main-process bridge.** Add strict Host message validation and callback plumbing, create an original generic 16×16 dot image from a PNG data URL, and wire focus/close/shutdown cleanup without exposing the bridge to the renderer.
- [ ] **Step 4: Run the Desktop test and build.** Run `pnpm exec vitest run apps/desktop/tests/taskbar-overlay.spec.ts` and `pnpm --filter @deepseek-ai/dsh-desktop run build` from the DSH source root. Expected: tests pass and TypeScript/bundling completes.
- [ ] **Step 5: Export and verify the source patch.** Generate `patches/dsh-v0.2.2-rc.1.patch` from only the listed DSH files; run `git apply --check` against a fresh checkout of the pinned tag and confirm the patch contains no runtime payload beyond the boolean message. Expected: clean apply with no changes to `app.asar` or the DSH user profile.
- [ ] **Step 6: Commit the patch artifact.** Commit as `feat: add version-pinned Windows taskbar bridge` with the neutral per-command author.

### Task 4: Document download, installation, compatibility, and privacy checks

**Files:**
- Create: `README.md`
- Create: `docs/desktop-integration.md`
- Create: `tests/package-manifest.test.js`
- Modify: `package.json` (`files` adds the README, Desktop instructions, and versioned patch for a source archive)

**Interfaces:**
- README explains the four modes, default `both`, local bundle installation from a downloaded repository, the Windows-only Desktop patch, and the fact that popup-only operation needs no Desktop patch.
- Desktop instructions pin the patch to `dsh-v0.2.2-rc.1`, provide apply/check/build commands, and explicitly prohibit patching the installed `app.asar`.
- The package remains free of direct runtime dependencies and `private` to avoid accidental npm publication; its only peer is the DSH-shipped `zod@4.4.3`. Users can still download the public GitHub repository. No license is selected in this task.

- [ ] **Step 1: Write failing package-manifest tests.** Add `bundle has complete runtime exports and files` and `metadata, defaults, and dependencies match the approved contract`; assert the README, Desktop instructions, and patch are in `files`, mode defaults to `both`, both locale metadata records and the original icon are exported, `zod@4.4.3` is only a peer, and direct `dependencies` is empty.
- [ ] **Step 2: Run the manifest test and confirm it fails.** Run `node --test tests/package-manifest.test.js`. Expected: FAIL until packaging metadata is complete.
- [ ] **Step 3: Write the download and Desktop-patch instructions.** Document local installation without changing this session's profile, mode behavior and platform limits, source-tag patch procedure, and no-push/no-`app.asar` boundaries. Add `README.md`, `docs/desktop-integration.md`, and `patches/*.patch` to the package's `files` list.
- [ ] **Step 4: Run local package tests and syntax checks.** Run `node --test tests/*.test.js` and `node --check index.js && node --check client.js && node --check lib/completion-projection.js && node --check lib/taskbar-bridge.js`. Expected: all tests pass and each syntax check exits 0.
- [ ] **Step 5: Check the staged patch and whitespace.** Run `git diff --cached --check` and repeat `git apply --check` against a fresh checkout of the pinned DSH tag. Expected: no whitespace errors and clean patch application.
- [ ] **Step 6: Audit the exact staged file list for privacy.** Review the file list and scan staged content for credentials, session text/logs, profile data, absolute local paths, and personal commit metadata; remove any findings without printing sensitive values.
- [ ] **Step 7: Commit the verified package and documentation.** Commit as `docs: document bundle installation and desktop patch` with the neutral per-command author.
- [ ] **Step 8: Stop for human review.** Show the exact final diff/file list and test results. Do not push to the public `dsh-tip` repository until the owner explicitly confirms after reviewing that diff.
