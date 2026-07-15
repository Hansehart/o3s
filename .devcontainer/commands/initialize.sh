#!/usr/bin/env bash
set -e

# Seed the editable config files from their templates on first run
cp -n .devcontainer/.env.template .devcontainer/.env
cp -n .devcontainer/allowed-ssh.txt.template .devcontainer/allowed-ssh.txt
cp -n .devcontainer/allowed-domains.txt.template .devcontainer/allowed-domains.txt
