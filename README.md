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

> [!WARNING]
> Your projects live in `/home/codespace/projects` and survive container rebuilds, but not volume deletion. Commit and push regularly.

## Advanced

<details>
<summary>Container Startup Order</summary>

| Step | Command | User | User determined by | When |
|---|---|---|---|---|
| `initializeCommand` | `cp -n .env.template .env && cp -n allowed-domains.txt.template allowed-domains.txt` | host user | host OS | before container starts |
| container start | `sleep infinity` | codespace | `USER` in `Dockerfile` | container boot |
| `postCreateCommand` | `.devcontainer/init.sh` | codespace | `remoteUser` in `devcontainer.json` | first create only |
| `postStartCommand` | `sudo docker-init.sh && sudo firewall.sh allowed-domains.txt` | codespace + root | `remoteUser` + `sudo` | every start |
| VS Code connects | - | codespace | `remoteUser` in `devcontainer.json` | after postStartCommand |

</details>

<details>
<summary>Data Persistence</summary>

- **Persistent folders**: The O3S workspace (`/home/codespace/O3S`) and your projects folder (`/home/codespace/projects`) are preserved across container rebuilds
- **Docker volumes**: If you delete the volume, all data in `/home/codespace/projects` will be lost
- **Recommendation**: Regularly commit and push your work to Git repositories

</details>

<details>
<summary>Included Extensions</summary>

| Name | Tag | Purpose |
|------|-----|---------|
| Containers | `ms-azuretools.vscode-containers` | Container orchestration |
| Data Wrangler | `ms-toolsai.datawrangler` | Data viewing and manipulation |
| GitHub | `github.vscode-pull-request-github` | Manage PRs and issues without leaving the IDE |
| Google Colab | `google.colab` | Remote notebook execution with GPU support |
| Jupyter | `ms-toolsai.jupyter` | Interactive coding notebooks |
| LaTeX Workshop | `james-yu.latex-workshop` | LaTeX editing, preview, and compilation |
| Python | `ms-python.python` | Python language support and debugging |

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

3. **`.devcontainer/allowed-domains.txt`** - copied from `allowed-domains.txt.template` on first start. Lists domains the firewall permits outbound HTTPS access to. Add any additional hosts your projects need.

</details>
