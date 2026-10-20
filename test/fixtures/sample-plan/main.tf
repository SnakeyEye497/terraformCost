terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region                      = "us-east-1"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_metadata_api_check     = true
  access_key                  = "test"
  secret_key                  = "test"
}

variable "web_instance_type" {
  default = "t3.large"
}

resource "aws_instance" "web" {
  ami           = "ami-0c55b159cbfafe1d0"
  instance_type = var.web_instance_type
}

resource "aws_db_instance" "primary" {
  identifier          = "primary-db"
  engine              = "postgres"
  instance_class      = "db.t3.small"
  allocated_storage   = 20
  username            = "admin"
  password            = "changeme123"
  skip_final_snapshot = true
}

resource "aws_s3_bucket" "logs" {
  bucket = "matali-plan-test-logs"
}

resource "aws_ebs_volume" "data" {
  availability_zone = "us-east-1a"
  size              = 100
  type              = "gp3"
}
