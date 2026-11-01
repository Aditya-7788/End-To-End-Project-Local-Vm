# june-2026-End-To-End-Project

## On-prem deployment

The same workflow can deploy to this on-prem kubeadm cluster by default or to Azure when `DEPLOY_TARGET=azure`.

```text
Push to main / Run workflow
          |
          v
  CI matrix (backend, frontend): npm ci -> npm test -> Docker build -> Trivy scan
          |
          v
  Push SHA-tagged images to Docker Hub (or ACR for Azure)
          |
          v
  Self-hosted runner -> kubeconfig / AKS credentials -> kustomize overlay -> kubectl apply
          |
          v
  PostgreSQL + backend + frontend rollouts -> http://<node-ip>:30080
```

### One-time setup

1. Prepare a kubeadm cluster with worker nodes reachable from the runner. For the on-prem overlay, allow TCP NodePort `30080` to the workers and use worker VMs with at least 2 CPU and 4 GB RAM. Install the local-path provisioner on the cluster:

   ```shell
   bash scripts/setup-local-path-storage.sh
   ```

2. On a dedicated Ubuntu 22.04 or 24.04 runner host that can reach the cluster API, install Docker, Node 22, kubectl, Kustomize, and the runner. The helper uses the latest Kubernetes stable minor for kubectl by default; set `KUBERNETES_MINOR` to the cluster's minor version when needed:

   ```shell
   sudo bash scripts/setup-runner.sh
   ```

   Before running it, open the private repository's **Settings → Actions → Runners → New self-hosted runner** page to generate a short-lived registration token. The helper asks for the repository URL and accepts the token at a hidden prompt; it does not write the token to a file. The runner is installed as a systemd service with the `docker` label; `self-hosted` and `linux` are automatic.

3. Give the `github-runner` account a kubeconfig that is authorized to create the `careflow` namespace and manage its application resources. From the administrator account whose kubeconfig should be copied, run:

   ```shell
   sudo bash scripts/setup-kubeconfig-for-runner.sh "$HOME/.kube/config"
   ```

   The helper installs it as `/home/github-runner/.kube/config` with mode `0600` and verifies `kubectl get nodes` as the runner user. Keep the runner kubeconfig scoped to this cluster and protect the private repository because its workflows can use runner credentials.

4. Create two **public** Docker Hub repositories named `careflow-backend` and `careflow-frontend` in the account used by the workflow. In Docker Hub, create an access token with **Read & Write** permissions. Public images let kubelet pull without a separate registry Secret.

5. In the GitHub repository, configure the variables and secrets below, then confirm the self-hosted runner is online under **Settings → Actions → Runners**. Pushes to `main` and manual workflow runs test, build, scan, push, and deploy. Pull-request runs are intentionally disabled for self-hosted safety.

### GitHub variables and secrets

| Name | Type | Value |
|---|---|---|
| `DEPLOY_TARGET` | Variable | `onprem` (default when unset); use `azure` to select Azure |
| `DOCKERHUB_USERNAME` | Variable | Docker Hub account that owns both public image repositories |
| `LLM_MODEL` | Variable | Gemini model identifier; required when `GEMINI_API_KEY` is set |
| `TRIVY_SEVERITY` | Variable | Optional Trivy severity list; defaults to `HIGH,CRITICAL` |
| `DOCKERHUB_TOKEN` | Secret | Docker Hub access token with Read & Write permissions |
| `JWT_SECRET` | Secret | Random signing key of at least 32 characters |
| `POSTGRES_PASSWORD` | Secret | Random database password; use a strong generated value |
| `GEMINI_API_KEY` | Secret | Optional Google AI Studio API key; blank enables mock mode |

The workflow creates or updates the Kubernetes Secret from the three application secrets and constructs an encoded PostgreSQL connection URL. The username and database name are `careflow`; do not add another LLM setting. The only LLM settings are `GEMINI_API_KEY` and `LLM_MODEL`.

The base manifests in `k8s/base/` exclude both `k8s/secret.example.yaml` and `k8s/ingress.yaml`. Do not apply the example Secret. The on-prem overlay uses a NodePort Service on `30080`, a `local-path` PVC, and low resource requests. Its ConfigMap sets `BACKEND_HOST=careflow-backend`, which resolves to the `careflow-backend` Service in the same namespace; this matches the variable expanded by the existing `frontend/nginx.conf` template, so nginx does not need modification.

### Switching to Azure

Set `DEPLOY_TARGET` to `azure` and configure the Azure repository variables `ACR_NAME` (without `.azurecr.io`), `AKS_NAME`, and `AKS_RG`. The runner must have a managed identity authorized to push to ACR and access AKS, plus `az` and `kubelogin`; the workflow uses `az login --identity`, retrieves AKS credentials, and selects the Azure overlay. Azure uses ACR SHA-tagged images and a frontend LoadBalancer Service. The existing Terraform files are not changed by this workflow.

### Troubleshooting

| Symptom | Check |
|---|---|
| `ImagePullBackOff` | Confirm both Docker Hub repositories are public, the image names match `DOCKERHUB_USERNAME`, and the pushed SHA tag exists. |
| PVC remains `Pending` | Check `kubectl get storageclass`, confirm `local-path` is installed and the overlay requests `local-path`, then inspect the local-path provisioner pod and events. |
| nginx reports `host not found in upstream` | Confirm the `careflow-backend` Service exists in namespace `careflow`, and the frontend ConfigMap sets `BACKEND_HOST=careflow-backend`. |
| Runner is offline | Check the `actions.runner` systemd service, network access to GitHub, the runner labels, and whether the registration token was still valid during registration. |

**Security:** Self-hosted runners must only be used with **private repositories** you control. Do not enable pull-request workflows from untrusted contributors on a self-hosted runner.

## Azure GitHub Actions self-hosted runner

The Terraform configuration in `infrastructure/terraform/` creates a private Ubuntu 22.04 LTS VM with a system-assigned managed identity, a dedicated subnet and NSG, and optional Azure Bastion, NAT Gateway, Log Analytics, and AKS VNet peering. The VM has no public IP. Use Bastion for administration and a GitHub short-lived registration token only when registering the runner.

### Prerequisites

- Terraform 1.6 or later, Azure CLI, and an Azure subscription.
- Azure permissions to create the requested resources and role assignments in the selected subscription.
- An OpenSSH public key for the administrative account. Keep its private key outside this repository.
- Network Contributor on the remote AKS VNet for the identity running Terraform when bidirectional VNet peering is enabled.
- Existing private DNS zones and their resource groups when linking private AKS, ACR, or Key Vault zones. Add each zone to `private_dns_zones`; the AKS zone is the `privatelink` zone for the configured Azure region, ACR uses `privatelink.azurecr.io`, and Key Vault uses `privatelink.vaultcore.azure.net`.
- Existing ACR, AKS cluster, and Key Vault resource IDs for optional managed-identity role assignments. The Key Vault must use Azure RBAC authorization for the Key Vault Secrets User role. Only add AKS RBAC Writer to `aks_rbac_role_names` when Azure RBAC is enabled on the cluster.
- For private AKS, working VNet routes/peering and private DNS resolution to the AKS API server. ACR and Key Vault private endpoints similarly require their private DNS zones and network routes.

The default NSG allows outbound TCP 443 to Internet and VirtualNetwork, TCP 80 to Internet and AzurePlatformIMDS (for system-assigned identity token requests), and TCP/UDP 53 to VirtualNetwork and AzurePlatformDNS; all other inbound and outbound traffic is denied. Ensure required private endpoints, private AKS API addresses, and DNS resolvers are reachable through the permitted VirtualNetwork destinations. The NAT Gateway is enabled by default for outbound Internet access. If disabled, provide another supported egress path for bootstrap downloads and GitHub communication.

### Configure and provision

From `infrastructure/terraform/`, copy `terraform.tfvars.example` to `terraform.tfvars` and set your values. `subscription_id` and `ssh_public_key` are required; provide them in the ignored local tfvars file or as `TF_VAR_subscription_id` and `TF_VAR_ssh_public_key`. Configure the desired private DNS zones and optional resource IDs before planning. Do not put credentials, private keys, PATs, or runner registration tokens in Terraform files or variables.

```shell
terraform init
terraform validate
terraform plan -out=tfplan
terraform apply tfplan
terraform destroy
```

Review the plan before applying. The commands above are examples only; run `terraform apply` and `terraform destroy` manually when appropriate. Never commit `terraform.tfvars`, `tfplan`, Terraform state, SSH private keys, or GitHub runner registration tokens. The `.terraform.lock.hcl` dependency lock file should be committed after Terraform initialization.

### Connect through Azure Bastion

Use the configured Azure CLI subscription and the VM/resource group names from Terraform outputs. This command uses the default SSH key path; set `SSH_KEY_PATH` in your shell first if your key is stored elsewhere.

```shell
SSH_KEY_PATH="$HOME/.ssh/id_ed25519"
az network bastion ssh \
  --name "$(terraform output -raw bastion_name)" \
  --resource-group "$(terraform output -raw resource_group_name)" \
  --target-resource-id "$(az vm show --resource-group "$(terraform output -raw resource_group_name)" --name "$(terraform output -raw runner_vm_name)" --query id --output tsv)" \
  --auth-type SSH \
  --username "$(terraform output -raw admin_username)" \
  --ssh-key "$SSH_KEY_PATH"
```

The VM has no public IP or public SSH access. After connecting, wait for bootstrap to complete:

```shell
cloud-init status --wait
sudo tail -n 100 /var/log/runner-bootstrap.log
```

### Register the runner

1. In the target **private** GitHub repository, open **Settings → Actions → Runners → New self-hosted runner** and generate a short-lived registration token.
2. Connect to the VM through Bastion and provide the repository URL to the helper:

   ```shell
   read -r -p "Private GitHub repository URL: " REPO_URL
   sudo register-runner.sh "$REPO_URL"
   ```

3. Enter the short-lived token at the hidden prompt. The helper configures the runner with the `azure,docker` labels and installs and starts its systemd service.
4. Confirm the runner is online in the GitHub repository's Runners page and on the VM:

   ```shell
   systemctl status 'actions.runner.*'
   ```

The runner's system-assigned managed identity is used by Azure CLI and the pipeline. Assign only the required Azure roles: AcrPush at the ACR scope, Azure Kubernetes Service Cluster User Role at the AKS scope, optional AKS RBAC roles at the cluster scope when Azure RBAC is enabled, and Key Vault Secrets User at the Key Vault scope when the vault uses RBAC authorization.

**Security:** Use self-hosted runners only with private repositories you control. A workflow executed on a self-hosted runner can access the VM's network and managed identity. Do not run untrusted pull-request code or public-repository workflows on this runner.

## Azure GitHub Actions runner

The Azure deployment target uses the same CI/CD workflow and `[self-hosted, linux, docker]` labels as the on-prem target. For Azure, configure `DEPLOY_TARGET=azure`, `ACR_NAME`, `AKS_NAME`, and `AKS_RG`; the runner's managed identity logs in to ACR and AKS. Keep the existing private-network, identity, and least-privilege requirements described above.

## CareFlow AI appointment app

CareFlow is a demo full-stack appointment scheduling app. The React/Vite SPA calls an Express API, which validates requests and uses PostgreSQL for accounts, fictional doctors, appointment slots, confirmed appointments, and per-user chat sessions. Scheduling is enforced by the backend: symptoms map to one supported specialty, availability is searched for the next seven days (or the requested date), and the chat shows upcoming slots for up to two doctors. A requested day or time selects a matching slot, but a booking is persisted only after explicit confirmation in the latest user message. The optional Google Gemini integration handles open-ended chat only; it does not diagnose or provide treatment advice. Emergency keywords are checked before any model call. Never use this demo with real patient information.

### Medical disclaimer

**This assistant suggests specialists only. It does not provide medical advice or diagnosis. In an emergency, call your local emergency number or go to the nearest emergency room immediately.** CareFlow's doctor records and appointment availability are fictional demonstration data.

### Run locally with Docker Compose

1. Install Docker Desktop or Docker Engine with the Compose plugin.
2. Copy `.env.example` to `.env`, replace the database password and JWT secret placeholders with local random values, and use the same database password in `DATABASE_URL` and `POSTGRES_PASSWORD`. Leave `GEMINI_API_KEY` blank to use mock mode. To use Gemini, set `GEMINI_API_KEY` and `LLM_MODEL` to a model available to your Google AI Studio account. Never commit `.env`.
3. From the repository root, start the services:

   ```shell
   docker compose up --build
   ```

4. Open `http://localhost:8080`, create a demo account with a password of at least 10 characters, then use the assistant. Compose waits for Postgres and backend health checks and stores database data in the named `careflow-postgres` volume. Stop the services with `docker compose down`; remove the local database volume separately only if you intentionally want to erase demo data.

The backend creates its schema and inserts ten fictional doctors across five specialties plus sample slots for the next seven days in India Standard Time at startup. No real patient or doctor data is included. Google AI Studio model availability, free-tier quotas, and pricing can change; check your account's current limits. The Gemini API key is used only by the backend and is never sent to the browser.

### Application environment variables

| Variable | Purpose | Default |
|---|---|---|
| `NODE_ENV` | Backend runtime mode | `development` |
| `PORT` | Backend HTTP port | `3000` |
| `DATABASE_URL` | PostgreSQL connection string; its password must match `POSTGRES_PASSWORD` | Replace the placeholder in `.env.example` |
| `JWT_SECRET` | Signing key for auth tokens; use a random value of at least 32 characters | Replace the placeholder in `.env.example` |
| `CORS_ORIGIN` | Comma-separated allowed browser origins | `http://localhost:5173` |
| `GEMINI_API_KEY` | Optional server-side Google Gemini API key; blank enables mock mode | blank |
| `LLM_MODEL` | Gemini model identifier; required when `GEMINI_API_KEY` is set | blank |
| `VITE_API_URL` | Frontend API prefix, baked into the Vite build | `/api` |
| `POSTGRES_DB` | Compose PostgreSQL database name | `careflow` |
| `POSTGRES_USER` | Compose PostgreSQL username | `careflow` |
| `POSTGRES_PASSWORD` | Compose PostgreSQL password; keep it synchronized with `DATABASE_URL` | Replace the placeholder in `.env.example` |
| `BACKEND_HOST` | Backend DNS name used by the Nginx API proxy | `backend` in Compose; `careflow-backend` in Kubernetes |
| `NGINX_ENVSUBST_FILTER` | Limits Nginx template substitution to the backend host variable | `^BACKEND_HOST$` |

For Kubernetes, the workflow creates the `careflow-secrets` Secret from GitHub Actions secrets. `k8s/secret.example.yaml` contains deliberately unusable example values only; never apply it as production credentials. The backend reads `DATABASE_URL`, `JWT_SECRET`, and optional `GEMINI_API_KEY`; PostgreSQL reads `POSTGRES_PASSWORD`. The workflow applies the `LLM_MODEL` repository variable to the ConfigMap.

### API

All API paths except health, readiness, metrics, and public doctor browsing require a bearer JWT as noted.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/auth/register` | Register with email and a password of 10–128 characters |
| `POST` | `/api/auth/login` | Authenticate and receive a JWT |
| `GET` | `/api/doctors?specialty=Neurology` | Browse fictional doctors; specialty is optional |
| `GET` | `/api/doctors/:id/slots?date=YYYY-MM-DD` | List a doctor's available slots for a date |
| `POST` | `/api/appointments` | Book a slot with `doctorId`, `slotId`, and `confirmed: true` |
| `GET` | `/api/appointments/me` | List appointments belonging to the authenticated user |
| `DELETE` | `/api/appointments/:id` | Cancel the authenticated user's appointment |
| `POST` | `/api/chat` | Send `{ "sessionId": "...", "message": "..." }` to the authenticated assistant |
| `GET` | `/health` | Liveness probe |
| `GET` | `/ready` | Readiness probe; checks PostgreSQL |
| `GET` | `/metrics` | Prometheus request, latency, and booking metrics |

The database enforces a unique constraint on appointment `slot_id`, and booking uses a transaction and row lock. Chat sessions are scoped to the authenticated user, retain only the last twelve messages, and never trust user IDs or booking IDs supplied by an LLM as the patient's identity. Emergency keyword checks run before the optional model call; specialty search, slot matching, and confirmation-gated booking are handled by backend rules.

### Tests and build

From the repository root, install the locked workspace dependencies with `npm ci`, then run `npm test`. The backend Jest/Supertest tests use an in-memory PostgreSQL-compatible database, and the frontend uses Vitest and React Testing Library; tests do not require Docker, a network database, or a Gemini API key. Build the frontend with `npm run build --workspace frontend`.

The backend and frontend images are built from their respective directories. The obsolete root `Dockerfile` is retained at `docs/legacy/Dockerfile`; the root `package.json` and `package-lock.json` remain active for workspace-level npm commands.

### Kubernetes

The `k8s/base/` resources and overlays define namespace `careflow`, a PostgreSQL StatefulSet with a PVC, backend and frontend Deployments and Services, a ConfigMap, and a backend HPA. `kubectl apply -k k8s/overlays/onprem` selects the NodePort/local-path overlay; `kubectl apply -k k8s/overlays/azure` selects the LoadBalancer overlay. Neither includes `k8s/ingress.yaml` or `k8s/secret.example.yaml`. The workflow updates both images to their commit SHA before applying the selected overlay.

PostgreSQL in this demo uses an in-cluster PVC. For production, Azure Database for PostgreSQL is a better choice for managed backups, patching, and high availability. Use a private database endpoint and restrict network access. The Kubernetes deployment runs the API and frontend as non-root with resource limits and probes; never store real credentials in Git.
