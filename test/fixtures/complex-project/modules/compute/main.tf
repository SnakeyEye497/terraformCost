# AWS compute. Note on the variable below: Matali's parser resolves var.xxx
# references from `variable` blocks declared in the SAME FILE only (it parses
# and resolves each file independently, not across a module's files) — so
# unlike a real Terraform module, this can't split variables.tf out from
# main.tf and still have costs resolve. Known limitation, documented in this
# fixture's README.

variable "web_instance_type" {
  description = "Instance type for the web tier"
  type        = string
  default     = "t3.medium"
}

resource "aws_instance" "web" {
  ami           = "ami-0c55b159cbfafe1d0"
  instance_type = var.web_instance_type

  tags = {
    Name        = "acme-web"
    Environment = "production"
  }
}

resource "aws_instance" "worker" {
  ami           = "ami-0c55b159cbfafe1d0"
  instance_type = "t3.large"

  tags = {
    Name        = "acme-worker"
    Environment = "production"
  }
}

# Deliberately oversized for a nightly batch job — good bait for the AI
# optimization/scaling suggestions to actually catch something real.
resource "aws_instance" "batch_processor" {
  ami           = "ami-0c55b159cbfafe1d0"
  instance_type = "m5.xlarge"

  tags = {
    Name        = "acme-batch-processor"
    Environment = "production"
  }
}
