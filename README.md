# O3S - Open Source Software Suite
A simple, all-in-one dev container for developing open-source projects with quick setup.

## Getting Started

### Prerequisites
- Install [Docker Engine/Desktop](https://docs.docker.com/engine/install/)
- Install [Visual Studio Code](https://code.visualstudio.com/download)

### Setup
1. **Install the Dev Containers extension**
   - Open VS Code
   - Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
   - Type `Extensions: Install Extensions`
   - Search for `ms-vscode-remote.remote-containers` and install it

2. **Open this project in a container**
   - Clone this repository
   - Open the folder in VS Code
   - Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
   - Select `Dev Containers: Reopen in Container`
   - Wait for the container to build (first time takes a few minutes)

3. **Start developing**
   - Your projects should be stored in `/home/codespace/projects` inside the container
   - Press `Ctrl+Shift+P` and use "File: Open Folder" to navigate to `/home/codespace/projects`
   - Happy coding!

## Included Extensions

| Name | Tag | Purpose |
|------|-----|---------|
| Containers | `ms-azuretools.vscode-containers` | Container orchestration |
| Data Wrangler | `ms-toolsai.datawrangler` | Data viewing and manipulation |
| GitHub | `github.vscode-pull-request-github` | Manage git workflows without leaving our IDE |
| Jupyter | `ms-toolsai.jupyter` | Interactive coding notebooks |


## ⚠️ WARNING: Data Persistence

- **Persistent folders**: The O3S workspace (`/home/codespace/O3S`) and your projects folder (`/home/codespace/projects`) are preserved across container rebuilds
- **Docker volumes**: If you delete the volume, all data in `/home/codespace/projects` will be lost
- **Recommendation**: Regularly commit and push your work to Git repositories
