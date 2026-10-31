output "runner_vm_name" {
  description = "Name of the GitHub Actions runner virtual machine."
  value       = azurerm_linux_virtual_machine.runner.name
}

output "runner_private_ip" {
  description = "Static private IP address of the runner virtual machine."
  value       = azurerm_network_interface.runner.private_ip_address
}

output "resource_group_name" {
  description = "Resource group containing the runner infrastructure."
  value       = azurerm_resource_group.runner.name
}

output "virtual_network_name" {
  description = "Name of the runner virtual network."
  value       = azurerm_virtual_network.runner.name
}

output "runner_subnet_name" {
  description = "Name of the runner subnet."
  value       = azurerm_subnet.runner.name
}

output "runner_vm_size" {
  description = "Configured size of the runner virtual machine."
  value       = azurerm_linux_virtual_machine.runner.size
}

output "admin_username" {
  description = "Administrative Linux account name for Bastion SSH."
  value       = azurerm_linux_virtual_machine.runner.admin_username
}

output "managed_identity_principal_id" {
  description = "Principal ID of the runner VM system-assigned managed identity."
  value       = azurerm_linux_virtual_machine.runner.identity[0].principal_id
}

output "managed_identity_tenant_id" {
  description = "Tenant ID associated with the runner VM system-assigned managed identity."
  value       = azurerm_linux_virtual_machine.runner.identity[0].tenant_id
}

output "bastion_name" {
  description = "Name of the Azure Bastion host, or null when Bastion is disabled."
  value       = var.enable_bastion ? azurerm_bastion_host.runner[0].name : null
}

output "log_analytics_workspace_id" {
  description = "Log Analytics workspace ID, or null when monitoring is disabled."
  value       = var.enable_monitoring ? azurerm_log_analytics_workspace.runner[0].workspace_id : null
}
