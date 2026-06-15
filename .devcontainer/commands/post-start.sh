#!/usr/bin/env bash
set -e

sudo /usr/local/share/docker-init.sh
sudo /usr/local/bin/firewall.py .devcontainer/allowed-domains.txt
sudo service cron start
