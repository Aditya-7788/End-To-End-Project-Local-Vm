# june-2026-End-To-End-Project

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

## GitHub Actions CI/CD

`.github/workflows/ci-cd.yml` runs CI and CD on `[self-hosted, linux, azure, docker]`. Configure these GitHub repository variables: `ACR_NAME`, `AKS_NAME`, `AKS_RG`, `K8S_NAMESPACE`, `DEPLOYMENT`, and `CONTAINER`. The repository must also contain the Node.js project, Dockerfile, and tests expected by `npm ci`, `npm test`, and `docker build`.

The CI job logs in with the VM's managed identity, builds and scans the image with Trivy (failing on HIGH or CRITICAL findings), and pushes it to ACR. The CD job retrieves AKS credentials, converts kubeconfig for Azure CLI authentication, updates the configured Kubernetes container image, and waits for rollout completion. The runner remains outside AKS and reaches its private API through VNet connectivity.

## CareFlow AI appointment app

CareFlow is a demo full-stack appointment scheduling app. The React/Vite SPA calls an Express API, which validates requests and uses PostgreSQL for accounts, fictional doctors, appointment slots, confirmed appointments, and per-user chat sessions. The optional Anthropic integration uses constrained function tools; without an API key the backend uses its built-in rule-based mock assistant. The assistant suggests specialties only, does not diagnose or provide treatment advice, and checks emergency keywords before calling an LLM. A booking is persisted only after an explicit confirmation on a separate chat turn. Never use this demo with real patient information.

### Medical disclaimer

**This assistant suggests specialists only. It does not provide medical advice or diagnosis. In an emergency, call your local emergency number or go to the nearest emergency room immediately.** CareFlow's doctor records and appointment availability are fictional demonstration data.

### Run locally with Docker Compose

1. Install Docker Desktop or Docker Engine with the Compose plugin.
2. Copy `.env.example` to `.env`, replace the database password and JWT secret placeholders with local random values, and use the same database password in `DATABASE_URL` and `POSTGRES_PASSWORD`. Leave `ANTHROPIC_API_KEY` blank to use mock mode. Never commit `.env`.
3. From the repository root, start the services:

   ```shell
   docker compose up --build
   ```

4. Open `http://localhost:8080`, create a demo account with a password of at least 10 characters, then use the assistant. Compose waits for Postgres and backend health checks and stores database data in the named `careflow-postgres` volume. Stop the services with `docker compose down`; remove the local database volume separately only if you intentionally want to erase demo data.

The backend creates its schema and inserts ten fictional doctors across five specialties plus sample slots for the next seven days at startup. No real patient or doctor data is included. To run the app with Anthropic, set `ANTHROPIC_API_KEY` and `LLM_MODEL` in the local environment; the API key is never stored in source code or sent to the browser.

### Application environment variables

| Variable | Purpose | Default |
|---|---|---|
| `NODE_ENV` | Backend runtime mode | `development` |
| `PORT` | Backend HTTP port | `3000` |
| `DATABASE_URL` | PostgreSQL connection string; its password must match `POSTGRES_PASSWORD` | Replace the placeholder in `.env.example` |
| `JWT_SECRET` | Signing key for auth tokens; use a random value of at least 32 characters | Replace the placeholder in `.env.example` |
| `CORS_ORIGIN` | Comma-separated allowed browser origins | `http://localhost:5173` |
| `ANTHROPIC_API_KEY` | Optional server-side Anthropic API key; blank enables mock mode | blank |
| `LLM_MODEL` | Anthropic model identifier | `claude-3-5-haiku-latest` |
| `VITE_API_URL` | Frontend API prefix, baked into the Vite build | `/api` |
| `POSTGRES_DB` | Compose PostgreSQL database name | `careflow` |
| `POSTGRES_USER` | Compose PostgreSQL username | `careflow` |
| `POSTGRES_PASSWORD` | Compose PostgreSQL password; keep it synchronized with `DATABASE_URL` | Replace the placeholder in `.env.example` |
| `BACKEND_HOST` | Backend DNS name used by the Nginx API proxy | `backend` in Compose; `careflow-backend` in Kubernetes |
| `NGINX_ENVSUBST_FILTER` | Limits Nginx template substitution to the backend host variable | `^BACKEND_HOST$` |

For Kubernetes, create the real `careflow-secrets` Secret out of band from a secure secret manager. `k8s/secret.example.yaml` contains deliberately unusable example values only; never apply it as production credentials. The backend expects `DATABASE_URL` and `JWT_SECRET` in that Secret; `ANTHROPIC_API_KEY` is optional. Configure the actual browser origin in `k8s/configmap.yaml`.

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

The database enforces a unique constraint on appointment `slot_id`, and booking uses a transaction and row lock. Chat sessions are scoped to the authenticated user, retain only the last twelve messages, and never trust user IDs or booking IDs supplied by an LLM as the patient's identity. Emergency keyword checks run before the optional model call.

### Tests and build

From the repository root, install the locked workspace dependencies with `npm ci`, then run `npm test`. The backend Jest/Supertest tests use an in-memory PostgreSQL-compatible database, and the frontend uses Vitest and React Testing Library; tests do not require Docker, a network database, or an Anthropic key. Build the frontend with `npm run build --workspace frontend`.

### Kubernetes

The `k8s/` manifests define namespace `careflow`, a PostgreSQL StatefulSet with a persistent volume claim, backend and frontend Deployments/ClusterIP Services, an internal-ingress-class Ingress, ConfigMap, and a backend HPA (70% CPU target, 2–5 replicas). The image names in the manifests are intentionally `<ACR_NAME>.azurecr.io/careflow-backend:latest` and `<ACR_NAME>.azurecr.io/careflow-frontend:latest`; replace those with your registry when preparing your own deployment. Configure the actual private ingress class and DNS host to match your AKS ingress controller. The ingress routes to the frontend, whose Nginx server proxies `/api` to the backend Service.

PostgreSQL in this demo uses an in-cluster PVC. For production, Azure Database for PostgreSQL is a better choice for managed backups, patching, and high availability. Use a private database endpoint and restrict network access. The Kubernetes deployment runs the API and frontend as non-root with resource limits and probes; store all real credentials in a Secret populated from a secure secret manager, not in Git.

### CI/CD repository variables and two-image workflow

The existing single-image workflow reads these GitHub repository variables:

| Repository variable | Value |
|---|---|
| `ACR_NAME` | Azure Container Registry name (without `.azurecr.io`) |
| `AKS_NAME` | Target AKS cluster name |
| `AKS_RG` | Resource group containing AKS |
| `K8S_NAMESPACE` | `careflow` |
| `DEPLOYMENT` | `careflow-backend` for the backend image |
| `CONTAINER` | `careflow-backend` for the backend container |

The existing workflow is single-image; the root `Dockerfile` builds the backend image for that workflow. The app requires **two** images and deployments: `careflow-backend` / container `careflow-backend`, and `careflow-frontend` / container `careflow-frontend`. To adapt the CI job without changing its runner authentication, use a `strategy.matrix.include` with one entry per image, each specifying its Dockerfile (`backend/Dockerfile` or `frontend/Dockerfile`), image name, deployment name, and matching container name. Build, tag with the commit SHA, scan, and push each matrix image. For CD, obtain AKS credentials once and update both deployment/container pairs (or matrix the CD job as well), then wait for both rollouts. The workflow currently exposes singular `DEPLOYMENT` and `CONTAINER` variables, so use the corresponding pair for each image or replace those inputs with a two-entry matrix; do not deploy the frontend image to the backend deployment.
