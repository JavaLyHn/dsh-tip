# Windows Desktop taskbar integration

The taskbar dot is an optional Electron main-process capability. This repository carries a patch for the DSH source tag `dsh-v0.2.2-rc.1`, commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`. It is not a patch for an installed application binary, and it must not be applied to a different source revision without retargeting and testing it.

The installed DSH build's embedded commit has not been verified against this public source tag, so compatibility with that installed build is unknown. Popup mode works without this patch. On Web, macOS, Linux, or an unpatched Desktop, taskbar mode is unavailable; `both` still shows the in-app notice.

## Apply to the pinned source checkout

1. In a clean DSH source checkout, select the pinned tag and verify its commit:

   ```sh
   git checkout --detach dsh-v0.2.2-rc.1
   git rev-parse HEAD
   ```

   The commit must be `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`. This source tag requires Node `>=24.9.0` and pnpm `11.28.5`; install dependencies according to the DSH source project's setup instructions before testing or building.

2. From the DSH source repository root, set the patch path to the copy downloaded from this repository, then check and apply it:

   ```powershell
   $patchFile = 'path\to\dsh-tip\patches\dsh-v0.2.2-rc.1.patch'
   git apply --check $patchFile
   git apply $patchFile
   ```

   Replace the example path with the patch's actual location. If the check fails, stop. Do not force-apply the patch or adapt it to another revision without a new compatibility review.

3. Run the focused Desktop test and build from the DSH source root:

   ```sh
   pnpm exec vitest run apps/desktop/tests/taskbar-overlay.spec.ts
   pnpm --filter @deepseek-ai/dsh-desktop run build
   ```

4. Package and install a rebuilt Desktop using the DSH project's normal release or local-build process. The patch does not change the bundle or installation steps for the DSH Web app.

## Behavior and privacy

The patch validates the Host child's taskbar message as exactly `{ type: 'dsh-taskbar-badge', enabled: boolean }`. The Electron main process receives no session identifier, session title, prompt, or other session content. It displays only a generic 16×16 dot while the primary window is unfocused, and clears it on focus, window destruction, and shutdown. The capability marker is passed only to the Windows Host child; other platforms remain unchanged.

Do not edit, extract, or repack `resources/app.asar` to enable this feature. The patch is intended for a clean source checkout and a rebuilt Desktop application only.
