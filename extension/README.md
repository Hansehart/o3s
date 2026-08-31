# o3s

A feature store for dev containers, in the sidebar.

Browse every feature a provider publishes, switch the ones you want on, set their options,
and the extension writes them into your `.devcontainer/devcontainer.json`.

## How it works

`devcontainer.json` is the source of truth. The extension reads it to know what is already
installed and edits it in place when you press Generate, so its comments, its header and
every key the sidebar does not manage stay exactly as you left them.

The catalog itself is not bundled. It is read live from the OCI registries listed in
`o3s.featureProviders`, plus any collection your `devcontainer.json` already references —
so opening someone else's checkout offers their providers without configuring anything.

Any collection published to the [features distribution spec][spec] works. Add one with the
field at the bottom of the sidebar, or by editing the setting.

## Settings

| Setting | What it does |
| --- | --- |
| `o3s.featureProviders` | The collections to browse, each `registry/namespace`. Defaults to `ghcr.io/devcontainers/features` and `ghcr.io/hansehart/devcontainer-features`. |

## Requirements

The [Dev Containers][devcontainers] extension, to actually build what you select.

[spec]: https://containers.dev/implementors/features-distribution/
[devcontainers]: https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers
