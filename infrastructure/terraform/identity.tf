resource "azurerm_role_assignment" "acr_push" {
  for_each = var.acr_id == null ? {} : { acr = var.acr_id }

  scope                            = each.value
  role_definition_name             = "AcrPush"
  principal_id                     = azurerm_linux_virtual_machine.runner.identity[0].principal_id
  principal_type                   = "ServicePrincipal"
  skip_service_principal_aad_check = true
}

resource "azurerm_role_assignment" "aks_cluster_user" {
  for_each = var.aks_cluster_id != null && var.enable_aks_cluster_user_role ? { aks = var.aks_cluster_id } : {}

  scope                            = each.value
  role_definition_name             = "Azure Kubernetes Service Cluster User Role"
  principal_id                     = azurerm_linux_virtual_machine.runner.identity[0].principal_id
  principal_type                   = "ServicePrincipal"
  skip_service_principal_aad_check = true
}

resource "azurerm_role_assignment" "aks_rbac" {
  for_each = var.aks_cluster_id == null ? toset([]) : var.aks_rbac_role_names

  scope                            = var.aks_cluster_id
  role_definition_name             = each.value
  principal_id                     = azurerm_linux_virtual_machine.runner.identity[0].principal_id
  principal_type                   = "ServicePrincipal"
  skip_service_principal_aad_check = true
}

resource "azurerm_role_assignment" "key_vault_secrets_user" {
  for_each = var.key_vault_id == null ? {} : { key_vault = var.key_vault_id }

  scope                            = each.value
  role_definition_name             = "Key Vault Secrets User"
  principal_id                     = azurerm_linux_virtual_machine.runner.identity[0].principal_id
  principal_type                   = "ServicePrincipal"
  skip_service_principal_aad_check = true
}
