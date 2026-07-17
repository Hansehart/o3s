# O3S - Open Source Software Suite
A plug-and-play dev container for open-source development - built for AI agents, safe by design.

![O3S](.github/assets/o3s.png)

## Why O3S?

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>🔌 Plug & Play</h3>
      <p>As AI coding agents become part of every workflow, the environment they run in matters as much as the code they write. Clone the repo, reopen in container - done.</p>
    </td>
    <td width="50%" valign="top">
      <h3>🛡️ Safe Agent Isolation</h3>
      <p>AI agents are powerful but probabilistic - they can and will make mistakes. The firewall doesn't care. It deterministically blocks any outbound traffic not on your allowlist, no matter what the model decided to do.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🐳 Prototype to Production</h3>
      <p>Docker-in-Docker and Kubernetes built in. Don't hope your stack works in prod - spin it up, let your agent pen test it, and know before you ship.</p>
    </td>
    <td width="50%" valign="top">
      <h3>☁️ Free Cloud Compute</h3>
      <p>No GPU? No problem. Open a notebook and let Google Colab handle the heavy lifting - TPU-backed compute, for free, without leaving your workspace.</p>
    </td>
  </tr>
</table>

## Getting Started

### Prerequisites
- Install [Docker Engine/Desktop](https://docs.docker.com/engine/install/)
- Install [Visual Studio Code](https://code.visualstudio.com/download)
- Install the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) in VS Code

### Setup
1. **Clone the repository**
   ```bash
   git clone git@github.com:Hansehart/o3s.git
   ```

2. **Open the folder in VS Code**
   - Press `Ctrl+Shift+P` / `Cmd+Shift+P` and select `Dev Containers: Reopen in Container`
   - The container builds automatically (first time takes a few moments)

3. **Start developing**
   - Your projects live in `/home/codespace/projects`
   - Press `Ctrl+Shift+P` / `Cmd+Shift+P` and use `File: Open Folder` to navigate there

> [!TIP]
> Work inside `/home/codespace/projects` - your data will persist across sessions. Only work outside of it if you know what you are doing.

## Advanced

<details>
<summary>Container Startup Order</summary>

Two containers come up in order: the **gateway** boots and becomes healthy first, then the **dev container** starts and routes its traffic through it.

**Gateway container** (`o3s-gateway`): the egress firewall.

| Step | Purpose | Command | User | User determined by |
|---|---|---|---|---|
| `initializeCommand` | - | - | - | - |
| container start | Build the firewall rules and start dnsmasq | gateway/entrypoint.sh | root | - |
| health check | Signal ready once it resolves an allow-listed host and reaches it on 443 | gateway/healthcheck.sh | root | - |
| `postStartCommand` | - | - | - | - |
| connect | - | - | - | - |
| `postAttachCommand` | - | - | - | - |

**Dev container** (`o3s`): where you work.

| Step | Purpose | Command | User | User determined by |
|---|---|---|---|---|
| `initializeCommand` | Copy templates to editable files on the host before either container starts | commands/initialize.sh | host user | - |
| container start | Route egress through the gateway, then keep the container alive | `ip route replace`, `sleep infinity` | codespace | `USER` in `Dockerfile` |
| health check | - | - | - | - |
| `postStartCommand` | Start the Docker daemon and verify egress through the gateway | commands/post-start.sh | codespace + root | `remoteUser` in `devcontainer.json` |
| connect | Attach the editor | - | codespace | `remoteUser` in `devcontainer.json` |
| `postAttachCommand` | Install optional VS Code extensions from `.env` | commands/post-attach.sh | codespace | `remoteUser` in `devcontainer.json` |

</details>

<details>
<summary>Data Persistence</summary>

| Folder | Type | Survives Rebuild |
|--------|------|-----------------|
| `/home/codespace/o3s` | Host mount | ✅ |
| `/home/codespace/projects` | Docker volume | ✅ |

⚠️ Deleting the Docker volume will permanently destroy `/home/codespace/projects`.

</details>

<details>
<summary>Egress Firewall</summary>

Outbound traffic is filtered by a separate **gateway container** (`.devcontainer/gateway`). The dev container sits on a private Docker network (`cage`) that has **no host NAT of its own**, so the only working path to the internet is the gateway - a packet sent any other way leaves with a private source address and dies upstream. Even with root and `NET_ADMIN` (which Docker-in-Docker requires), nothing in o3s can manufacture its own egress: the host will not NAT the cage subnet, and the rules that enforce the allowlist live in the gateway's own network namespace, which the dev container cannot touch. So it reaches only the hosts on the allowlist.

The gateway runs `dnsmasq`, which resolves the allow-listed domains and adds their **current** IPs to an `ipset` as they are looked up, so the allowlist tracks IP changes on its own. Static IPs and CIDRs are added to the same sets directly. `iptables` then permits those addresses on their declared ports and default-denies the rest.

Add entries to `.devcontainer/allowlist.txt`, one per line as `address port...`:

- `address` — a domain (subdomains covered automatically), an IPv4 host, or an IPv4 CIDR.
- `port...` — one or more TCP ports the address may be reached on. At least one is required; there is no default.

```
github.com  443 22    # HTTPS + SSH
pypi.org    443
10.8.0.0/24 443       # a static subnet on HTTPS
```

Apply changes with: `docker restart o3s-gateway`.

</details>

<details>
<summary>GPU Support</summary>

NVIDIA GPU passthrough requires the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) installed on the Docker host. On WSL2, install it inside WSL2 (not Windows) after confirming `nvidia-smi` works on each layer.

The `docker-compose.yml` already includes the GPU reservation block, just uncomment it:

```yaml
reservations:
  devices:
    - driver: nvidia
      count: all
      capabilities: [gpu]
```

</details>

<details>
<summary>Selectable Extensions</summary>

Enable in `.devcontainer/.env` before rebuilding:

| Name | `.env` key | Tag | Purpose |
|------|-----------|-----|---------|
| Google Colab | `EXT_COLAB` | `google.colab` | Remote notebook execution with GPU support |
| Containers | `EXT_CONTAINERS` | `ms-azuretools.vscode-containers` | Container orchestration |
| Data Wrangler | `EXT_DATAWRANGLER` | `ms-toolsai.datawrangler` | Data viewing and manipulation |
| Jupyter | `EXT_JUPYTER` | `ms-toolsai.jupyter` | Interactive coding notebooks |
| LaTeX Workshop | `EXT_LATEX` | `james-yu.latex-workshop` | LaTeX editing, preview, and compilation |
| Python | `EXT_PYTHON` | `ms-python.python` | Python language support and debugging |

</details>

<details>
<summary>Selectable Tools</summary>

Enable in `.devcontainer/.env` before rebuilding:

| Name | `.env` key | Purpose |
|------|-----------|---------|
| Chrome | `INSTALL_CHROME` | Browser MCP |
| Claude Code | `INSTALL_CLAUDE` | Claude Code CLI |
| Codex | `INSTALL_CODEX` | Codex CLI |
| LaTeX | `INSTALL_LATEX` | Paper Writing |
| uv | `INSTALL_UV` | Python Package Manager |

</details>

<details>
<summary>Recommended Customization</summary>

1. **Git identity** - the Dev Containers extension forwards your host `~/.gitconfig` into the container automatically. Make sure it exists on your Docker host:
   ```bash
   git config --global user.name "Your Name"
   git config --global user.email "your@email.com"
   ```

2. **`.devcontainer/.env`** - copied from `.env.template` on first start. Fill in your values:
   - **Resource limits**: `MEMORY_LIMIT`, `CPU_LIMIT` - cap container resource usage
   - **Provider API keys**: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `MISTRAL_API_KEY`
   - **Selectable tools**: `INSTALL_CHROME`, `INSTALL_CLAUDE`, `INSTALL_CODEX`, `INSTALL_LATEX`, `INSTALL_UV`
   - **Selectable extensions**: `EXT_COLAB`, `EXT_CONTAINERS`, `EXT_DATAWRANGLER`, `EXT_JUPYTER`, `EXT_LATEX`, `EXT_PYTHON`

3. **`.devcontainer/allowlist.txt`** - copied from `allowlist.txt.template` on first start. Lists the addresses (domains, IPs, CIDRs) and ports the firewall permits outbound access to, one `address port...` per line. Add any additional hosts your projects need.

</details>

<details>
