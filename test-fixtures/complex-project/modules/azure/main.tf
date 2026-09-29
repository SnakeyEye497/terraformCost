# Azure workloads — a right-sized worker VM, an oversized legacy VM (third
# and last piece of scale-down bait), SQL Database, Storage Account, a
# Premium managed disk, and an AKS cluster.

resource "azurerm_linux_virtual_machine" "worker" {
  name                = "acme-worker-vm"
  resource_group_name = "acme-rg"
  location            = "eastus"
  size                = "Standard_D2s_v3"
  admin_username      = "adminuser"

  network_interface_ids = []
}

# Deliberately oversized legacy VM nobody's resized since launch.
resource "azurerm_windows_virtual_machine" "legacy_app" {
  name                = "acme-legacy-app"
  resource_group_name = "acme-rg"
  location            = "eastus"
  size                = "Standard_D4s_v3"
  admin_username      = "adminuser"
  admin_password      = "ChangeMe123!"

  network_interface_ids = []
}

resource "azurerm_sql_database" "reporting_db" {
  name                = "acme-reporting-db"
  resource_group_name = "acme-rg"
  server_name         = "acme-sql-server"
  sku_name            = "Standard"
}

resource "azurerm_storage_account" "backups" {
  name                     = "acmebackups"
  resource_group_name      = "acme-rg"
  location                 = "eastus"
  account_tier             = "Standard"
  account_replication_type = "LRS"
}

resource "azurerm_managed_disk" "data_disk" {
  name                 = "acme-data-disk"
  resource_group_name  = "acme-rg"
  location             = "eastus"
  storage_account_type = "Premium_LRS"
  disk_size_gb         = 256
  create_option        = "Empty"
}

resource "azurerm_kubernetes_cluster" "aks_main" {
  name                = "acme-aks-main"
  resource_group_name = "acme-rg"
  location            = "eastus"
  dns_prefix          = "acme-aks"
}
