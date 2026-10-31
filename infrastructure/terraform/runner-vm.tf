resource "azurerm_network_interface" "runner" {
  name                = var.network_interface_name
  location            = azurerm_resource_group.runner.location
  resource_group_name = azurerm_resource_group.runner.name
  tags                = local.common_tags

  ip_configuration {
    name                          = "runner-ip-configuration"
    subnet_id                     = azurerm_subnet.runner.id
    private_ip_address_allocation = "Static"
    private_ip_address            = var.runner_private_ip
  }
}

resource "azurerm_linux_virtual_machine" "runner" {
  name                            = var.vm_name
  computer_name                   = var.vm_name
  location                        = azurerm_resource_group.runner.location
  resource_group_name             = azurerm_resource_group.runner.name
  size                            = var.vm_size
  admin_username                  = var.admin_username
  disable_password_authentication = true
  network_interface_ids           = [azurerm_network_interface.runner.id]
  custom_data = base64encode(templatefile("${path.module}/cloud-init.yaml", {
    runner_version = var.runner_version
  }))
  tags = local.common_tags

  admin_ssh_key {
    username   = var.admin_username
    public_key = var.ssh_public_key
  }

  identity {
    type = "SystemAssigned"
  }

  os_disk {
    name                 = "${var.vm_name}-os"
    caching              = "ReadWrite"
    storage_account_type = var.os_disk_storage_account_type
    disk_size_gb         = var.os_disk_size_gb
  }

  source_image_reference {
    publisher = local.runner_image.publisher
    offer     = local.runner_image.offer
    sku       = local.runner_image.sku
    version   = local.runner_image.version
  }

  boot_diagnostics {}
}
