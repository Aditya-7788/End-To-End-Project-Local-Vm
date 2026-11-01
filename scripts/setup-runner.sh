#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo or as root." >&2
  exit 1
fi

. /etc/os-release
if [[ "${ID:-}" != "ubuntu" || ( "${VERSION_ID:-}" != "22.04" && "${VERSION_ID:-}" != "24.04" ) ]]; then
  echo "This script supports Ubuntu 22.04 and 24.04 only." >&2
  exit 1
fi

KUBERNETES_MINOR="${KUBERNETES_MINOR:-}"
KUSTOMIZE_VERSION="${KUSTOMIZE_VERSION:-v5.6.0}"

architecture="$(dpkg --print-architecture)"
case "$architecture" in
  amd64) runner_arch="x64"; kustomize_arch="amd64" ;;
  arm64) runner_arch="arm64"; kustomize_arch="arm64" ;;
  *)
    echo "Unsupported system architecture: $architecture" >&2
    exit 1
    ;;
esac

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl cron git gnupg jq sudo

if [[ -z "$KUBERNETES_MINOR" ]]; then
  stable_release="$(curl -fsSL https://dl.k8s.io/release/stable.txt)"
  KUBERNETES_MINOR="${stable_release%.*}"
fi
if [[ ! "$KUBERNETES_MINOR" =~ ^v[0-9]+\.[0-9]+$ ]]; then
  echo "KUBERNETES_MINOR must look like v1.35." >&2
  exit 1
fi

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu %s stable\n' \
  "$architecture" "$VERSION_CODENAME" > /etc/apt/sources.list.d/docker.list

curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
chmod a+r /etc/apt/keyrings/nodesource.gpg
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main\n' \
  "$architecture" > /etc/apt/sources.list.d/nodesource.list

curl -fsSL "https://pkgs.k8s.io/core:/stable:/${KUBERNETES_MINOR}/deb/Release.key" \
  | gpg --dearmor --yes -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
chmod a+r /etc/apt/keyrings/kubernetes-apt-keyring.gpg
printf 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/%s/deb/ /\n' \
  "$KUBERNETES_MINOR" > /etc/apt/sources.list.d/kubernetes.list

apt-get update
apt-get install -y containerd.io docker-buildx-plugin docker-ce docker-ce-cli docker-compose-plugin nodejs kubectl

if ! getent group docker >/dev/null; then
  groupadd --system docker
fi
if ! id github-runner >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash --groups docker github-runner
else
  usermod --append --groups docker github-runner
fi
if getent group sudo | cut -d: -f4 | tr ',' '\n' | grep -Fxq github-runner; then
  echo "github-runner is in the sudo group; remove that membership before continuing." >&2
  exit 1
fi

systemctl enable --now docker
systemctl enable --now cron

runner_directory=/opt/actions-runner
if [[ -e "$runner_directory/.runner" ]]; then
  echo "An Actions runner is already configured in $runner_directory." >&2
  exit 1
fi
install -d -o github-runner -g github-runner "$runner_directory"
runner_version="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | jq -er '.tag_name | ltrimstr("v")')"
runner_archive="$(mktemp /tmp/actions-runner.XXXXXX.tar.gz)"
curl -fsSL "https://github.com/actions/runner/releases/download/v${runner_version}/actions-runner-linux-${runner_arch}-${runner_version}.tar.gz" \
  -o "$runner_archive"
tar -xzf "$runner_archive" -C "$runner_directory"
rm -f "$runner_archive"
chown -R github-runner:github-runner "$runner_directory"
"$runner_directory/bin/installdependencies.sh"

kustomize_archive="$(mktemp /tmp/kustomize.XXXXXX.tar.gz)"
curl -fsSL "https://github.com/kubernetes-sigs/kustomize/releases/download/kustomize%2F${KUSTOMIZE_VERSION}/kustomize_${KUSTOMIZE_VERSION}_linux_${kustomize_arch}.tar.gz" \
  -o "$kustomize_archive"
tar -xzf "$kustomize_archive" -C /usr/local/bin kustomize
rm -f "$kustomize_archive"
chmod 0755 /usr/local/bin/kustomize

cat > /etc/cron.weekly/docker-system-prune <<'CRON'
#!/bin/sh
/usr/bin/docker system prune -af --filter "until=168h"
CRON
chmod 0755 /etc/cron.weekly/docker-system-prune

if [[ -f "$runner_directory/.runner" ]]; then
  echo "The runner is already registered. Re-run setup only on a fresh runner directory." >&2
  exit 1
fi
read -r -p "Private GitHub repository URL: " repository_url
if [[ ! "$repository_url" =~ ^https://github\.com/[^/]+/[^/]+/?$ ]]; then
  echo "Enter a repository URL such as https://github.com/owner/repository." >&2
  exit 1
fi
printf '%s\n' "Registration command: sudo -u github-runner $runner_directory/config.sh --url $repository_url --token <hidden prompt> --labels docker --unattended"
read -r -s -p "GitHub short-lived registration token: " registration_token
printf '\n'
if [[ -z "$registration_token" ]]; then
  echo "A registration token is required." >&2
  exit 1
fi
sudo -u github-runner "$runner_directory/config.sh" \
  --url "$repository_url" \
  --token "$registration_token" \
  --labels docker \
  --unattended \
  --name "$(hostname)-github-runner"
unset registration_token

"$runner_directory/svc.sh" install github-runner
"$runner_directory/svc.sh" start

echo "Runner installed and started as a systemd service."
echo "Self-hosted and linux labels are automatic; the additional label is docker."
