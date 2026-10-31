resource "azurerm_virtual_network" "runner" {
  name                = var.virtual_network_name
  address_space       = [var.virtual_network_cidr]
  location            = azurerm_resource_group.runner.location
  resource_group_name = azurerm_resource_group.runner.name
  tags                = local.common_tags
}

resource "azurerm_subnet" "runner" {
  name                 = var.runner_subnet_name
  resource_group_name  = azurerm_resource_group.runner.name
  virtual_network_name = azurerm_virtual_network.runner.name
  address_prefixes     = [var.runner_subnet_cidr]
}

resource "azurerm_subnet" "bastion" {
  count = var.enable_bastion ? 1 : 0

  name                 = "AzureBastionSubnet"
  resource_group_name  = azurerm_resource_group.runner.name
  virtual_network_name = azurerm_virtual_network.runner.name
  address_prefixes     = [var.bastion_subnet_cidr]
}

resource "azurerm_public_ip" "bastion" {
  count = var.enable_bastion ? 1 : 0

  name                = "${var.bastion_name}-pip"
  location            = azurerm_resource_group.runner.location
  resource_group_name = azurerm_resource_group.runner.name
  allocation_method   = "Static"
  sku                 = "Standard"
  tags                = local.common_tags
}

resource "azurerm_bastion_host" "runner" {
  count = var.enable_bastion ? 1 : 0

  name                = var.bastion_name
  location            = azurerm_resource_group.runner.location
  resource_group_name = azurerm_resource_group.runner.name
  sku                 = "Standard"
  tunneling_enabled   = true
  ip_connect_enabled  = true
  tags                = local.common_tags

  ip_configuration {
    name                 = "bastion-ip-configuration"
    subnet_id            = azurerm_subnet.bastion[0].id
    public_ip_address_id = azurerm_public_ip.bastion[0].id
  }
}

resource "azurerm_public_ip" "nat" {
  count = var.enable_nat_gateway ? 1 : 0

  name                = var.nat_public_ip_name
  location            = azurerm_resource_group.runner.location
  resource_group_name = azurerm_resource_group.runner.name
  allocation_method   = "Static"
  sku                 = "Standard"
  tags                = local.common_tags
}

resource "azurerm_nat_gateway" "runner" {
  count = var.enable_nat_gateway ? 1 : 0

  name                    = var.nat_gateway_name
  location                = azurerm_resource_group.runner.location
  resource_group_name     = azurerm_resource_group.runner.name
  sku_name                = "Standard"
  idle_timeout_in_minutes = 10
  tags                    = local.common_tags
}

resource "azurerm_nat_gateway_public_ip_association" "runner" {
  count = var.enable_nat_gateway ? 1 : 0

  nat_gateway_id       = azurerm_nat_gateway.runner[0].id
  public_ip_address_id = azurerm_public_ip.nat[0].id
}

resource "azurerm_subnet_nat_gateway_association" "runner" {
  count = var.enable_nat_gateway ? 1 : 0

  subnet_id      = azurerm_subnet.runner.id
  nat_gateway_id = azurerm_nat_gateway.runner[0].id
}

resource "azurerm_virtual_network_peering" "runner_to_aks" {
  count = var.enable_aks_vnet_peering ? 1 : 0

  name                         = "${var.virtual_network_name}-to-aks"
  resource_group_name          = azurerm_resource_group.runner.name
  virtual_network_name         = azurerm_virtual_network.runner.name
  remote_virtual_network_id    = var.aks_vnet_id
  allow_virtual_network_access = true
  allow_forwarded_traffic      = false
  allow_gateway_transit        = false
  use_remote_gateways          = false
}

resource "azurerm_virtual_network_peering" "aks_to_runner" {
  count = var.enable_aks_vnet_peering ? 1 : 0

  name                         = "${var.aks_vnet_name}-to-runner"
  resource_group_name          = var.aks_vnet_resource_group_name
  virtual_network_name         = var.aks_vnet_name
  remote_virtual_network_id    = azurerm_virtual_network.runner.id
  allow_virtual_network_access = true
  allow_forwarded_traffic      = false
  allow_gateway_transit        = false
  use_remote_gateways          = false
}

resource "azurerm_private_dns_zone_virtual_network_link" "runner" {
  for_each = var.private_dns_zones

  name                  = "link-${var.virtual_network_name}-${each.key}"
  resource_group_name   = each.value.resource_group_name
  private_dns_zone_name = each.value.name
  virtual_network_id    = azurerm_virtual_network.runner.id
  registration_enabled  = false
  tags                  = local.common_tags
}
