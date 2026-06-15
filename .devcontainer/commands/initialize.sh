#!/usr/bin/env bash
set -e

# Copy .env from template if it doesn't exist yet
cp -n .devcontainer/.env.template .devcontainer/.env

# Copy allowed-domains.txt from template if it doesn't exist yet
cp -n .devcontainer/allowed-domains.txt.template .devcontainer/allowed-domains.txt
