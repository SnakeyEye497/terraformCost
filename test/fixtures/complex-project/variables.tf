variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "production"
}

variable "project_name" {
  description = "Project/product name used for tagging"
  type        = string
  default     = "acme-platform"
}
