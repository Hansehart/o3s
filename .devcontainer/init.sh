#!/bin/bash

# Fix permissions for the host mounts
# sudo chown -R codespace:codespace /home/codespace

# Configure Git identity
git config --global user.name "$GIT_AUTHOR_NAME"
git config --global user.email "$GIT_AUTHOR_EMAIL"
