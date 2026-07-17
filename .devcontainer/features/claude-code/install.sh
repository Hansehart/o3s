#!/usr/bin/env bash
set -e

# VERSION comes from the feature options: a channel (latest|stable) or exact version.

# Install as the dev user (_REMOTE_USER) so claude lands in their home.
su - "$_REMOTE_USER" -c "curl -fsSL https://claude.ai/install.sh | bash -s -- '$VERSION'"
