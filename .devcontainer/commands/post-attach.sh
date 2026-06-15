#!/usr/bin/env bash
set -e

# Add VS Code remote CLI to PATH and IPC socket (not available by default in postAttachCommand)
PATH="$PATH:$(find /vscode -name "remote-cli" -type d 2>/dev/null | head -1)"
export VSCODE_IPC_HOOK_CLI=$(ls /tmp/vscode-ipc-*.sock 2>/dev/null | head -1)

# Source user config
if [ -f .devcontainer/.env ]; then
    set -a
    source .devcontainer/.env
    set +a
fi

_ext() { code --install-extension "$1" || true; }

[ "${EXT_COLAB:-false}"        = "true" ] && _ext "google.colab"
[ "${EXT_CONTAINERS:-false}"   = "true" ] && _ext "ms-azuretools.vscode-containers"
[ "${EXT_DATAWRANGLER:-false}" = "true" ] && _ext "ms-toolsai.datawrangler"
[ "${EXT_JUPYTER:-false}"      = "true" ] && _ext "ms-toolsai.jupyter"
[ "${EXT_LATEX:-false}"        = "true" ] && _ext "james-yu.latex-workshop"
if [ "${EXT_PYTHON:-false}" = "true" ]; then
    _ext "ms-python.python"
    _ext "ms-python.mypy-type-checker"
fi
