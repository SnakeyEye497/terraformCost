# Small AWS project for demoing Matali against a real account.
# It's meant for `terraform plan` (no apply needed): plan authenticates,
# looks up a real AMI, and produces the JSON that
# "Terraform Cost: Calculate Costs from Terraform Plan" reads.
#
#   terraform init
#   terraform plan -var aws_profile=<your-profile> -out=plan.tfplan
#   terraform show -json plan.tfplan > plan.json

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "aws_profile" {
  description = "AWS CLI profile to plan with"
  default     = "default"
}

variable "aws_region" {
  default = "ap-south-1"
}

variable "web_instance_type" {
  default = "t3.micro"
}

provider "aws" {
  profile = var.aws_profile
  region  = var.aws_region
}

data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }
}

# Free networking: shows $0 inline
resource "aws_vpc" "main" {
  cidr_block = "10.42.0.0/16"
}

resource "aws_security_group" "web" {
  name   = "matali-demo-web"
  vpc_id = aws_vpc.main.id
}

# Two web servers: count = 2 doubles the cost
resource "aws_instance" "web" {
  count         = 2
  ami           = data.aws_ami.al2023.id
  instance_type = var.web_instance_type

  tags = {
    Name = "matali-demo-web"
  }
}

# Managed PostgreSQL with 20 GB storage
resource "aws_db_instance" "db" {
  identifier                  = "matali-demo-db"
  engine                      = "postgres"
  instance_class              = "db.t3.micro"
  allocated_storage           = 20
  username                    = "demo"
  manage_master_user_password = true
  skip_final_snapshot         = true
}

resource "aws_ebs_volume" "data" {
  availability_zone = "ap-south-1a"
  size              = 50
  type              = "gp3"
}

resource "aws_s3_bucket" "assets" {
  bucket_prefix = "matali-demo-"
}

resource "aws_dynamodb_table" "sessions" {
  name           = "matali-demo-sessions"
  billing_mode   = "PROVISIONED"
  read_capacity  = 5
  write_capacity = 5
  hash_key       = "id"

  attribute {
    name = "id"
    type = "S"
  }
}

resource "aws_eip" "public" {
  domain = "vpc"
}
