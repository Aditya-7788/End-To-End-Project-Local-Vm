locals {
  common_tags = merge(
    {
      managed_by = "terraform"
      workload   = "github-self-hosted-runner"
    },
    var.tags
  )

  runner_image = {
    publisher = "Canonical"
    offer     = "0001-com-ubuntu-server-jammy"
    sku       = "22_04-lts-gen2"
    version   = "latest"
  }
}

resource "azurerm_resource_group" "runner" {
  name     = var.resource_group_name
  location = var.location
  tags     = local.common_tags
}

resource "azurerm_log_analytics_workspace" "runner" {
  count = var.enable_monitoring ? 1 : 0

  name                = var.log_analytics_workspace_name
  location            = azurerm_resource_group.runner.location
  resource_group_name = azurerm_resource_group.runner.name
  sku                 = "PerGB2018"
  retention_in_days   = var.log_analytics_retention_days
  tags                = local.common_tags
}

resource "azurerm_monitor_data_collection_rule" "runner" {
  count = var.enable_monitoring ? 1 : 0

  name                = var.data_collection_rule_name
  resource_group_name = azurerm_resource_group.runner.name
  location            = azurerm_resource_group.runner.location
  description         = "Collect Linux syslog from the GitHub Actions runner VM."
  tags                = local.common_tags

  destinations {
    log_analytics {
      workspace_resource_id = azurerm_log_analytics_workspace.runner[0].id
      name                  = "runner-log-analytics"
    }
  }

  data_sources {
    syslog {
      name           = "runner-syslog"
      facility_names = ["auth", "authpriv", "cron", "daemon", "kern", "syslog", "user"]
      log_levels     = ["Critical", "Error", "Warning", "Info"]
      streams        = ["Microsoft-Syslog"]
    }
  }

  data_flow {
    streams      = ["Microsoft-Syslog"]
    destinations = ["runner-log-analytics"]
  }
}

resource "azurerm_virtual_machine_extension" "azure_monitor_linux_agent" {
  count = var.enable_monitoring ? 1 : 0

  name                       = "AzureMonitorLinuxAgent"
  virtual_machine_id         = azurerm_linux_virtual_machine.runner.id
  publisher                  = "Microsoft.Azure.Monitor"
  type                       = "AzureMonitorLinuxAgent"
  type_handler_version       = "1.33"
  auto_upgrade_minor_version = true
  tags                       = local.common_tags
}

resource "azurerm_monitor_data_collection_rule_association" "runner" {
  count = var.enable_monitoring ? 1 : 0

  name                    = "runner-syslog-association"
  target_resource_id      = azurerm_linux_virtual_machine.runner.id
  data_collection_rule_id = azurerm_monitor_data_collection_rule.runner[0].id
  description             = "Associate the runner VM with its syslog collection rule."

  depends_on = [azurerm_virtual_machine_extension.azure_monitor_linux_agent]
}
