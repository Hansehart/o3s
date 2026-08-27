#!/bin/sh
set -e

# The unprivileged user that owns the rootless daemon (persisted by install.sh).
RUSER="$(cat /usr/local/share/docker-in-docker/rootless-user 2>/dev/null || echo root)"
RUID="$(id -u "$RUSER")"
RHOME="$(getent passwd "$RUSER" | cut -d: -f6)"
RUNTIME_DIR="/run/user/${RUID}"

# The daemon runs as the remote user, and dockerd-rootless.sh refuses to start as root.
if [ "$RUSER" = "root" ]; then
  echo "docker-in-docker: needs a non-root remoteUser, the daemon stays down" >&2
  exec "$@"
fi

# Trust the proxy CA FIRST, before any docker work. The agent's API calls must verify the mitmproxy
# cert regardless of when the daemon or start.sh come up, so this must not depend on either.
# (cage/start.sh re-runs update-ca-certificates later; harmless.)
update-ca-certificates >/dev/null 2>&1 || true

# Match the iptables backend to the host kernel we share.
if type iptables-legacy > /dev/null 2>&1 \
   && { grep -qE '^ip_tables\b' /proc/modules || [ -d /sys/module/ip_tables ]; } \
   && update-alternatives --list iptables 2>/dev/null | grep -q '/usr/sbin/iptables-legacy'; then
  # Select legacy when /proc/modules shows ip_tables loaded, reflecting the kernel without a modprobe.
  update-alternatives --set iptables  /usr/sbin/iptables-legacy  || true
  update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy || true
elif type iptables-nft > /dev/null 2>&1 \
     && update-alternatives --list iptables 2>/dev/null | grep -q '/usr/sbin/iptables-nft'; then
  # Select nft when the module is absent.
  update-alternatives --set iptables  /usr/sbin/iptables-nft  || true
  update-alternatives --set ip6tables /usr/sbin/ip6tables-nft || true
fi

export container=docker

# Mount securityfs for AppArmor detection and a private tmpfs on /tmp.
if [ -d /sys/kernel/security ] && ! mountpoint -q /sys/kernel/security; then
  mount -t securityfs none /sys/kernel/security || true
fi
mountpoint -q /tmp || mount -t tmpfs none /tmp || true

# Best-effort cgroup v2 nesting. In the unprivileged cage /sys/fs/cgroup is read-only (no
# CAP_SYS_ADMIN), so every step is guarded and must never abort the script under `set -e`.
# Delegating a writable subtree to the rootless user is not possible here (read-only cgroupfs) —
# rootless dockerd runs without cgroup limits, and cluster-in-cage (minikube) needs outer cgroup
# delegation the cage cannot grant itself.
if [ -f /sys/fs/cgroup/cgroup.controllers ] && mkdir -p /sys/fs/cgroup/init 2>/dev/null; then
  cg_tries=0
  until xargs -rn1 < /sys/fs/cgroup/cgroup.procs > /sys/fs/cgroup/init/cgroup.procs 2>/dev/null \
        || [ "$cg_tries" -ge 5 ]; do
    sleep 1
    cg_tries=$((cg_tries + 1))
  done
  sed -e 's/ / +/g' -e 's/^/+/' < /sys/fs/cgroup/cgroup.controllers \
    > /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null || true
fi

# slirp4netns builds the rootless tap on /dev/net/tun, which the unprivileged cage lacks (host
# devices are gone with privileged). Create it here; CAP_MKNOD is in the default bounding set.
if [ ! -c /dev/net/tun ]; then
  mkdir -p /dev/net
  mknod /dev/net/tun c 10 200 2>/dev/null || true
  chmod 0666 /dev/net/tun 2>/dev/null || true
fi

# Prepare the rootless runtime dir and data dir owned by the remote user.
mkdir -p "$RUNTIME_DIR" "${RHOME}/.local/share/docker"
chown "$RUSER":"$RUSER" "$RUNTIME_DIR" "${RHOME}/.local/share/docker" 2>/dev/null || true

# Install the requested daemon settings where the rootless daemon reads them. Doing it here rather
# than at build time keeps the file in place when the home directory carries volume mounts.
if [ -f /usr/local/share/docker-in-docker/daemon.json ]; then
  mkdir -p "${RHOME}/.config/docker"
  cp /usr/local/share/docker-in-docker/daemon.json "${RHOME}/.config/docker/daemon.json"
  chown -R "$RUSER":"$RUSER" "${RHOME}/.config/docker" 2>/dev/null || true
fi

# Re-privilege newuidmap/newgidmap as file-capability binaries, not setuid-root. Reason: writing a
# child's uid_map needs CAP_SYS_ADMIN over that userns, granted by the owner shortcut only when the
# caller's euid equals the userns owner (the remote user). As setuid-root the helper runs at euid 0,
# the shortcut misses, and the unprivileged cage's bounding set has no CAP_SYS_ADMIN, so the write is
# denied. Dropping setuid keeps euid at the owner uid; the file caps supply CAP_SETUID/CAP_SETGID for
# the subuid ranges. (Runtime, not build time: image unpack strips security.capability xattrs.)
for b in /usr/bin/newuidmap /usr/bin/newgidmap; do
  chmod u-s "$b" 2>/dev/null || true
  setcap cap_setuid,cap_setgid+ep "$b" 2>/dev/null || true
done

# Point interactive shells and agents at the rootless socket.
printf 'export DOCKER_HOST=unix://%s/docker.sock\n' "$RUNTIME_DIR" \
  > /etc/profile.d/99-rootless-docker.sh

# Clear pid files left by an unclean stop, which otherwise block the next start.
find /run /var/run -iname 'docker*.pid' -delete 2>/dev/null || true
find /run /var/run -iname 'container*.pid' -delete 2>/dev/null || true

# Launch dockerd rootless as the remote user. runuser (unlike su/docker-exec) does not raise
# no_new_privs, so newuidmap keeps its file caps and the uid map succeeds. --pidns makes RootlessKit
# mount a fresh writable /proc for the daemon, which shadows the cage's read-only /proc/sys mask so
# the daemon can set each container's net sysctls while the cage keeps /proc masked.
start_dockerd() {
  # Clear pid files left by an unclean stop, which otherwise block the next start.
  find /run /var/run -iname 'docker*.pid' -delete 2>/dev/null || true
  find /run /var/run -iname 'container*.pid' -delete 2>/dev/null || true

  runuser -u "$RUSER" -- env \
    HOME="$RHOME" \
    XDG_RUNTIME_DIR="$RUNTIME_DIR" \
    DOCKER_HOST="unix://${RUNTIME_DIR}/docker.sock" \
    PATH="/usr/bin:/usr/local/bin:/sbin:/usr/sbin:/bin" \
    DOCKERD_ROOTLESS_ROOTLESSKIT_NET=slirp4netns \
    DOCKERD_ROOTLESS_ROOTLESSKIT_MTU=65520 \
    DOCKERD_ROOTLESS_ROOTLESSKIT_DETACH_NETNS=false \
    DOCKERD_ROOTLESS_ROOTLESSKIT_FLAGS="--pidns" \
    DOCKERD_ROOTLESS_ROOTLESSKIT_SLIRP4NETNS_SANDBOX=auto \
    DOCKERD_ROOTLESS_ROOTLESSKIT_SLIRP4NETNS_SECCOMP=auto \
    dockerd-rootless.sh --storage-driver=overlay2 > /tmp/dockerd.log 2>&1
}

# Supervise in the background: retry once if the daemon dies, as a stale lock in the persisted data
# volume or a failed procfs mount can kill the first start. Never block here, because the devcontainer
# runs this entrypoint before it execs the cage command (start.sh), which trusts the proxy CA and
# routes egress; delaying those makes the agent's first API calls fail.
{
  if ! start_dockerd; then
    echo "docker-in-docker: rootless dockerd exited, retrying once" >&2
    sleep 2
    start_dockerd || echo "docker-in-docker: rootless dockerd failed to start, see /tmp/dockerd.log" >&2
  fi
} &

# Hand off immediately so start.sh (CA trust + routing) comes up without delay.
exec "$@"
