#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo: sudo bash bootstrap-host.sh" >&2
  exit 1
fi

if [[ ! -f /etc/os-release ]]; then
  echo "Cannot identify the operating system." >&2
  exit 1
fi

source /etc/os-release
if [[ "${ID}" != "ubuntu" || "${VERSION_ID}" != "24.04" ]]; then
  echo "Expected Ubuntu 24.04; found ${PRETTY_NAME:-unknown}." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git jq openssl rsync unattended-upgrades

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

if ! getent group srvapps >/dev/null; then
  groupadd --system srvapps
fi
usermod -aG docker,srvapps lucaj

for path in platform cartdotcom media codex-lab backups docs; do
  install -d -o lucaj -g srvapps -m 2770 "/srv/${path}"
done
install -d -o root -g srvapps -m 0750 /etc/cartdotcom

cat >/etc/sysctl.d/99-cartdotcom-server.conf <<'EOF'
vm.swappiness=10
fs.inotify.max_user_watches=524288
EOF
sysctl --system >/dev/null

echo "Host bootstrap complete. Sign out and reconnect before using Docker without sudo."
