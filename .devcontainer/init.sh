#!/bin/bash

# Fix permissions for the host mounts
sudo chown -R codespace:codespace /home/codespace

# Install TexLive for LaTeX compilation
sudo apt-get update && sudo apt-get install -y texlive-latex-extra latexmk

# Install Claude CLI
curl -fsSL https://claude.ai/install.sh | bash

# Configure Git identity
git config --global user.name "$GIT_AUTHOR_NAME"
git config --global user.email "$GIT_AUTHOR_EMAIL"
