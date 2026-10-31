resource "azurerm_network_security_group" "runner" {
  name                = var.network_security_group_name
  location            = azurerm_resource_group.runner.location
  resource_group_name = azurerm_resource_group.runner.name
  tags                = local.common_tags

  dynamic "security_rule" {
    for_each = var.enable_bastion ? [1] : []

    content {
      name                       = "Allow-SSH-From-Bastion"
      priority                   = 100
      direction                  = "Inbound"
      access                     = "Allow"
      protocol                   = "Tcp"
      source_port_range          = "*"
      destination_port_range     = "22"
      source_address_prefix      = var.bastion_subnet_cidr
      destination_address_prefix = "*"
      description                = "Allow SSH only from the dedicated Azure Bastion subnet."
    }
  }

  security_rule {
    name                       = "Deny-All-Other-Inbound"
    priority                   = 4096
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
    description                = "Deny all inbound traffic not explicitly permitted above."
  }

  security_rule {
    name                       = "Allow-HTTPS-To-Internet"
    priority                   = 100
    direction                  = "Outbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "*"
    destination_address_prefix = "Internet"
    description                = "Allow HTTPS egress to GitHub and public Azure endpoints."
  }

  security_rule {
    name                       = "Allow-HTTPS-To-VirtualNetwork"
    priority                   = 110
    direction                  = "Outbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "*"
    destination_address_prefix = "VirtualNetwork"
    description                = "Allow HTTPS to private endpoints and peered VNet services."
  }

  security_rule {
    name                       = "Allow-HTTP-To-Internet"
    priority                   = 120
    direction                  = "Outbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "80"
    source_address_prefix      = "*"
    destination_address_prefix = "Internet"
    description                = "Allow HTTP for package and repository setup where required."
  }

  security_rule {
    name                       = "Allow-Managed-Identity-IMDS"
    priority                   = 125
    direction                  = "Outbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "80"
    source_address_prefix      = "*"
    destination_address_prefix = "AzurePlatformIMDS"
    description                = "Allow the VM to obtain tokens from the Azure Instance Metadata Service."
  }

  security_rule {
    name                       = "Allow-DNS-To-VirtualNetwork"
    priority                   = 130
    direction                  = "Outbound"
    access                     = "Allow"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "53"
    source_address_prefix      = "*"
    destination_address_prefix = "VirtualNetwork"
    description                = "Allow TCP and UDP DNS queries to Azure and VNet DNS resolvers."
  }

  security_rule {
    name                       = "Allow-Azure-Platform-DNS"
    priority                   = 135
    direction                  = "Outbound"
    access                     = "Allow"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "53"
    source_address_prefix      = "*"
    destination_address_prefix = "AzurePlatformDNS"
    description                = "Allow DNS queries to Azure's platform DNS service."
  }

  security_rule {
    name                       = "Deny-All-Other-Outbound"
    priority                   = 4096
    direction                  = "Outbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
    description                = "Deny all outbound traffic not explicitly permitted above."
  }
}

resource "azurerm_subnet_network_security_group_association" "runner" {
  subnet_id                 = azurerm_subnet.runner.id
  network_security_group_id = azurerm_network_security_group.runner.id
}
