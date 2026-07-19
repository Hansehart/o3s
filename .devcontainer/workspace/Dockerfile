FROM ubuntu:24.04@sha256:4fbb8e6a8395de5a7550b33509421a2bafbc0aab6c06ba2cef9ebffbc7092d90

# Predictable UTF-8 locale
ENV LANG=C.UTF-8

# Base packages
RUN apt-get update && apt-get install -y --no-install-recommends \
      iproute2 \
      ca-certificates \
      curl \
      ripgrep \
      openssh-client \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /home/ubuntu/config /home/ubuntu/projects \
 && chown -R ubuntu:ubuntu /home/ubuntu
