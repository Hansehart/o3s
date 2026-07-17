FROM ubuntu:24.04

# Predictable UTF-8 locale
ENV LANG=C.UTF-8
# Claude Code installs into ~/.local/bin — put it on PATH.
ENV PATH=/home/ubuntu/.local/bin:${PATH}

# Base packages
RUN apt-get update && apt-get install -y --no-install-recommends \
      sudo \
      iproute2 \
      ca-certificates \
      curl \
      ripgrep \
  && rm -rf /var/lib/apt/lists/*

# Grants root for exactly the two commands that need it at runtime.
#   /usr/sbin/ip                     docker-compose command sets the default route to the gateway
#   /usr/local/share/docker-init.sh  post-start.sh starts the Docker daemon
RUN echo 'ubuntu ALL=(root) NOPASSWD: /usr/sbin/ip, /usr/local/share/docker-init.sh' > /etc/sudoers.d/ubuntu \
  && chmod 0440 /etc/sudoers.d/ubuntu

# Run as the built-in non-root user
USER ubuntu
