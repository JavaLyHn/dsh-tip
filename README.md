# DSH answer completion notice

A local DSH Host/Client bundle that signals a successfully completed agent turn. It can show a localized in-app notice, a generic Windows taskbar dot when paired with the optional Desktop source patch, or both.

## Modes

The default is `both`.

- `off` disables completion notices.
- `popup` shows the in-app notice only. It works in Web and Desktop without a Desktop patch.
- `taskbar` requests a generic Windows taskbar dot while the DSH window is unfocused; focus clears it. It only works when the Windows Desktop build includes the `dsh-taskbar-badge` bridge; otherwise it has no effect.
- `both` shows the in-app notice and requests the taskbar dot when supported. Without the Desktop bridge, the in-app notice still works.

Only committed successful turn completions trigger a notice; aborted, blocked, failed, token-limited, interrupted, and forked turns are ignored. The in-app notice appears near the top center with a brief DSH-window edge pulse. Its collapsed state shows only a completion mark and localized heading; the navigation hint and arrow are omitted. Hover or keyboard focus expands it to show the session title and a sanitized request preview bounded to 80 Unicode code points. On touch devices, the first tap expands the card and the next tap opens the session. The expanded card includes a text-only follow-up composer: Enter sends, Shift+Enter inserts a line break, and submissions are queued on the completed session. Clicking the heading still opens that session; composer interactions do not navigate. The timeout pauses while the card is hovered or focused, a draft is present, or a submission is in progress, and the card respects reduced-motion preferences. The taskbar IPC carries only its fixed message type and an enabled/disabled boolean, and the icon itself is a generic dot. The plugin does not create an OS toast, play a sound, or send notification content to an external service.

## Download and install

1. Download the repository from [GitHub](https://github.com/JavaLyHn/dsh-tip) or clone it, then keep the extracted checkout at a stable path.
2. From the repository root, install the bundle's runtime modules:

   ```sh
   pnpm install --ignore-scripts
   ```

   The bundle pins DSH's published `@deepseek-ai/schemastery` at `3.19.0` for its Config schema. The DSH package manager links a local checkout and does not install that checkout's dependencies, so keep its `node_modules` directory in place.
3. From the repository root, use the DSH CLI for the profile you want to update. Replace `YOUR_PROFILE` with that profile's name:

   ```sh
   dsh plugin --profile YOUR_PROFILE add .
   ```

   This adds the bundle row. The standard DSH CLI forwards the command to `pnpm`, which must be on `PATH`. No build step is required. The bundle itself is private and is not published to npm.
4. Restart the target profile if it is already running. In DSH's Plugins page, set the bundle's `mode` to `off`, `popup`, `taskbar`, or `both`; the initial value is `both`.

A local checkout is linked by the profile package manager, so keep the directory and its installed `node_modules` in place. To remove the bundle later, run:

```sh
dsh plugin --profile YOUR_PROFILE remove @local/dsh-tip-completion-notice
```

The taskbar dot is optional; use `popup` if you do not want to rebuild Desktop.

## Taskbar support

The optional taskbar dot requires a Windows DSH Desktop build with the `dsh-taskbar-badge` bridge. Installing this bundle alone does not add that Desktop capability. The `popup` mode works without it, and `both` still shows the in-app notice.
