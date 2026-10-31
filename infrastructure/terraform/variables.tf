variable "subscription_id" {
  description = "Azure subscription ID used by the AzureRM provider."
  type        = string
}

variable "location" {
  description = "Azure region for the runner resources."
  type        = string
  default     = "eastus"
}

variable "resource_group_name" {
  description = "Name of the resource group for the runner."
  type        = string
  default     = "rg-github-runner"
}

variable "virtual_network_name" {
  description = "Name of the runner virtual network."
  type        = string
  default     = "vnet-github-runner"
}

variable "runner_subnet_name" {
  description = "Name of the dedicated runner subnet."
  type        = string
  default     = "snet-github-runner"
}

variable "runner_subnet_cidr" {
  description = "Address prefix for the dedicated runner subnet."
  type        = string
  default     = "10.42.1.0/24"
}

variable "virtual_network_cidr" {
  description = "Address space for the runner virtual network."
  type        = string
  default     = "10.42.0.0/16"
}

variable "bastion_subnet_cidr" {
  description = "Address prefix reserved for AzureBastionSubnet; Azure requires at least /26."
  type        = string
  default     = "10.42.2.0/26"

  validation {
    condition     = can(cidrhost(var.bastion_subnet_cidr, 0)) && can(regex("/([0-9]|1[0-9]|2[0-6])$", var.bastion_subnet_cidr))
    error_message = "bastion_subnet_cidr must be a valid CIDR with a prefix of /26 or larger."
  }
}

variable "enable_bastion" {
  description = "Create Azure Bastion Standard for private VM administration."
  type        = bool
  default     = true
}

variable "bastion_name" {
  description = "Name of the Azure Bastion host."
  type        = string
  default     = "bas-github-runner"
}

variable "network_security_group_name" {
  description = "Name of the runner subnet network security group."
  type        = string
  default     = "nsg-github-runner"
}

variable "enable_nat_gateway" {
  description = "Create a NAT Gateway and static public IP for runner subnet outbound access."
  type        = bool
  default     = true
}

variable "nat_gateway_name" {
  description = "Name of the runner NAT Gateway."
  type        = string
  default     = "nat-github-runner"
}

variable "nat_public_ip_name" {
  description = "Name of the NAT Gateway static public IP."
  type        = string
  default     = "pip-github-runner-nat"
}

variable "network_interface_name" {
  description = "Name of the runner network interface."
  type        = string
  default     = "nic-github-runner"
}

variable "runner_private_ip" {
  description = "Static private IPv4 address assigned to the runner NIC; it must be available in the runner subnet."
  type        = string
  default     = "10.42.1.10"
}

variable "vm_name" {
  description = "Name of the Ubuntu runner virtual machine."
  type        = string
  default     = "vm-github-runner"
}

variable "vm_size" {
  description = "Azure VM size. Examples include Standard_B2ms, Standard_B2s, and Standard_D2s_v5."
  type        = string
  default     = "Standard_B2ms"
}

variable "admin_username" {
  description = "Administrative Linux account used only for SSH through Azure Bastion."
  type        = string
  default     = "azureuser"
}

variable "ssh_public_key" {
  description = "OpenSSH public key for the administrative Linux account. Never provide a private key."
  type        = string

  validation {
    condition     = can(regex("^(ssh-rsa|ssh-ed25519|ecdsa-sha2-nistp[0-9]+) ", trimspace(var.ssh_public_key)))
    error_message = "ssh_public_key must be an OpenSSH RSA, Ed25519, or ECDSA public key."
  }
}

variable "os_disk_size_gb" {
  description = "Size of the runner OS disk in GB."
  type        = number
  default     = 64

  validation {
    condition     = var.os_disk_size_gb >= 64
    error_message = "The Ubuntu OS disk must be at least 64 GB."
  }
}

variable "os_disk_storage_account_type" {
  description = "Managed disk storage type for the runner OS disk."
  type        = string
  default     = "StandardSSD_LRS"
}

variable "runner_version" {
  description = "GitHub Actions runner release version, or latest to install the latest published release."
  type        = string
  default     = "latest"

  validation {
    condition     = var.runner_version == "latest" || can(regex("^v?[0-9]+\\.[0-9]+\\.[0-9]+$", var.runner_version))
    error_message = "runner_version must be latest or a version such as 2.327.1."
  }
}

variable "enable_aks_vnet_peering" {
  description = "Create bidirectional peering when the AKS cluster is in a different virtual network."
  type        = bool
  default     = false
}

variable "aks_vnet_id" {
  description = "Resource ID of the remote AKS virtual network when peering is enabled."
  type        = string
  default     = null
  nullable    = true
}

variable "aks_vnet_name" {
  description = "Name of the remote AKS virtual network when peering is enabled."
  type        = string
  default     = null
  nullable    = true
}

variable "aks_vnet_resource_group_name" {
  description = "Resource group containing the remote AKS virtual network when peering is enabled."
  type        = string
  default     = null
  nullable    = true
}

variable "private_dns_zones" {
  description = "Map of existing private DNS zones to link to the runner VNet, keyed by an arbitrary unique label."
  type = map(object({
    name                = string
    resource_group_name = string
  }))
  default = {}
}

variable "acr_id" {
  description = "Optional resource ID of the ACR that should grant AcrPush to the runner identity."
  type        = string
  default     = null
  nullable    = true
}

variable "aks_cluster_id" {
  description = "Optional resource ID of the AKS cluster for runner role assignments."
  type        = string
  default     = null
  nullable    = true
}

variable "enable_aks_cluster_user_role" {
  description = "Assign Azure Kubernetes Service Cluster User Role when aks_cluster_id is provided."
  type        = bool
  default     = true
}

variable "aks_rbac_role_names" {
  description = "Optional AKS Azure RBAC roles to assign at the cluster scope, for example Azure Kubernetes Service RBAC Writer. Use only when AKS Azure RBAC is enabled."
  type        = set(string)
  default     = []
}

variable "key_vault_id" {
  description = "Optional resource ID of an RBAC-authorized Key Vault that should grant Key Vault Secrets User."
  type        = string
  default     = null
  nullable    = true
}

variable "enable_monitoring" {
  description = "Create Log Analytics, Azure Monitor Agent, and a syslog Data Collection Rule."
  type        = bool
  default     = false
}

variable "log_analytics_workspace_name" {
  description = "Name of the optional Log Analytics workspace."
  type        = string
  default     = "law-github-runner"
}

variable "log_analytics_retention_days" {
  description = "Retention period for runner logs in Log Analytics."
  type        = number
  default     = 30

  validation {
    condition     = var.log_analytics_retention_days >= 30 && var.log_analytics_retention_days <= 730
    error_message = "Log Analytics retention must be between 30 and 730 days."
  }
}

variable "data_collection_rule_name" {
  description = "Name of the optional syslog Data Collection Rule."
  type        = string
  default     = "dcr-github-runner-syslog"
}

variable "tags" {
  description = "Additional tags applied to resources created by this configuration."
  type        = map(string)
  default     = {}
}
