#!/usr/bin/env bash
set -euo pipefail

LOCAL_PATH_VERSION="${LOCAL_PATH_VERSION:-v0.0.31}"
if [[ ! "$LOCAL_PATH_VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "LOCAL_PATH_VERSION must be a version such as v0.0.31." >&2
  exit 1
fi

command -v kubectl >/dev/null || {
  echo "kubectl is required to install local-path-provisioner." >&2
  exit 1
}
command -v jq >/dev/null || {
  echo "jq is required to inspect the cluster's default StorageClass." >&2
  exit 1
}

kubectl apply -f "https://raw.githubusercontent.com/rancher/local-path-provisioner/${LOCAL_PATH_VERSION}/deploy/local-path-storage.yaml"

storage_classes="$(kubectl get storageclass --output json)"
if jq -e 'any(.items[]; .metadata.annotations["storageclass.kubernetes.io/is-default-class"] == "true" or .metadata.annotations["storageclass.beta.kubernetes.io/is-default-class"] == "true")' \
  >/dev/null <<< "$storage_classes"; then
  echo "A default StorageClass already exists; leaving it unchanged."
else
  kubectl patch storageclass local-path \
    --type merge \
    --patch '{"metadata":{"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'
  echo "local-path is now the default StorageClass."
fi
