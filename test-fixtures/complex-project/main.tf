# Root orchestration — wires the modules together the way a real multi-module
# project would. Matali's workspace scanner does NOT follow these `module`
# blocks into a dependency graph; it just finds every `resource` block in
# every .tf file under the workspace, flat. These module calls are here for
# authenticity (and so `terraform init/plan` would work if you ever pointed
# real Terraform at this), not because the extension needs them.

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
