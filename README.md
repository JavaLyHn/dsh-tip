# DSH answer completion notice

A local DSH Host/Client bundle that signals a successfully completed agent turn. It can show a localized in-app notice, a generic Windows taskbar dot when paired with the optional Desktop source patch, or both.

## Modes

The default is `both`.

- `off` disables completion notices.
- `popup` shows the in-app notice only. It works in Web and Desktop without a Desktop patch.
- `taskbar` requests only the generic Windows taskbar dot while the DSH window is unfocused; focus clears it. It requires a rebuilt Windows Desktop using the version-pinned patch in [`docs/desktop-integration.md`](docs/desktop-integration.md); on Web, macOS, Linux, or an unpatched Desktop it has no effect.
- `both` shows the in-app notice and requests the taskbar dot where the patched Windows Desktop supports it. Without that patch, the in-app notice still works.

Only committed successful turn completions trigger a notice; aborted, blocked, failed, token-limited, interrupted, and forked turns are ignored. The in-app notice prefers the session's existing title. If no title is available, it uses a one-line, control-character-free summary of the latest user prompt when available, bounded to 80 Unicode code points; otherwise it shows a localized generic label. That label stays inside DSH; the taskbar IPC carries only its fixed message type and an enabled/disabled boolean, and the icon itself is a generic dot. The plugin does not create an OS toast, play a sound, or send notification content to an external service.

## Download and install

1. Download the repository from [GitHub](https://github.com/JavaLyHn/dsh-tip) or clone it, then keep the extracted checkout at a stable path.
2. From the repository root, use the DSH CLI for the profile you want to update. Replace `YOUR_PROFILE` with that profile's name:

   ```sh
   dsh plugin --profile YOUR_PROFILE add .
   ```

   This installs the local bundle checkout and adds its bundle row. The standard DSH CLI forwards the command to `pnpm`, which must be on `PATH`. No build step is required. The package is private and is not published to npm.
3. Restart the target profile if it is already running. In DSH's Plugins page, set the bundle's `mode` to `off`, `popup`, `taskbar`, or `both`; the initial value is `both`.

A local checkout is linked by the profile package manager, so keep the directory in place. To remove it later, run:

```sh
dsh plugin --profile YOUR_PROFILE remove @local/dsh-tip-completion-notice
```

The taskbar dot is optional; use `popup` if you do not want to rebuild Desktop.

## Desktop patch

The taskbar integration is source-pinned to DSH `dsh-v0.2.2-rc.1`. Read [`docs/desktop-integration.md`](docs/desktop-integration.md) before applying it. The installed DSH build has not been verified against that source tag; do not assume the patch is binary-compatible with an existing installation.
