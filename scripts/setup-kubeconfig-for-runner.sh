#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo or as root." >&2
  exit 1
fi
if ! id github-runner >/dev/null 2>&1; then
  echo "The github-runner user does not exist. Run setup-runner.sh first." >&2
  exit 1
fi

if [[ -n "${1:-}" ]]; then
  source_kubeconfig="$1"
elif [[ -n "${KUBECONFIG:-}" ]]; then
  source_kubeconfig="$KUBECONFIG"
elif [[ -n "${SUDO_USER:-}" ]]; then
  source_home="$(getent passwd "$SUDO_USER" | cut -d: -f6)"
  source_kubeconfig="${source_home}/.kube/config"
else
  source_kubeconfig="$HOME/.kube/config"
fi

if [[ ! -f "$source_kubeconfig" ]]; then
  echo "Kubeconfig file not found: $source_kubeconfig" >&2
  exit 1
fi

runner_home="$(getent passwd github-runner | cut -d: -f6)"
runner_kube_directory="${runner_home}/.kube"
runner_kubeconfig="${runner_kube_directory}/config"
install -d -m 0700 -o github-runner -g github-runner "$runner_kube_directory"
install -m 0600 -o github-runner -g github-runner "$source_kubeconfig" "$runner_kubeconfig"
sudo -u github-runner env KUBECONFIG="$runner_kubeconfig" kubectl get nodes
