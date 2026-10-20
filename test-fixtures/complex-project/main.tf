# Root orchestration — wires the modules together the way a real multi-module
# project would. The workspace scanner follows these `module` blocks
# (src/module-resolver.js): this directory is treated as the root, and each
# module's resources are resolved through its call site below, so variables
# passed in here override each module's own defaults.

module "networking" {
  source = "./modules/networking"
}

module "compute" {
  source = "./modules/compute"
}

module "database" {
  source = "./modules/database"
}

module "storage" {
  source = "./modules/storage"
}

module "kubernetes" {
  source = "./modules/kubernetes"
}

module "gcp_workloads" {
  source = "./modules/gcp"
}

module "azure_workloads" {
  source = "./modules/azure"
}
