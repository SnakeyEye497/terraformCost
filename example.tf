# Example Terraform configuration for testing the cost calculator
terraform {
  required_version = ">= 0.12"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

# EC2 Instance
resource "aws_instance" "web_server" {
  ami           = "ami-0c55b159cbfafe1d0"
  instance_type = "t3.medium"
  
  tags = {
    Name = "Web Server"
    Environment = "Production"
  }
}

# RDS Database
resource "aws_db_instance" "database" {
  identifier     = "my-database"
  engine         = "mysql"
  engine_version = "8.0"
  instance_class = "db.t3.small"
  allocated_storage = 20
  storage_type   = "gp2"
  
  db_name  = "myapp"
  username = "admin"
  password = "changeme123"
  
  skip_final_snapshot = true
  
  tags = {
    Name = "Main Database"
  }
}

# S3 Bucket
resource "aws_s3_bucket" "static_assets" {
  bucket = "my-app-static-assets-bucket"
  
  tags = {
    Name = "Static Assets"
  }
}

# EBS Volume
resource "aws_ebs_volume" "data_volume" {
  availability_zone = "us-east-1a"
  size              = 100
  type              = "gp3"
  
  tags = {
    Name = "Data Volume"
  }
}

# NAT Gateway
resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public.id
  
  tags = {
    Name = "Main NAT Gateway"
  }
}

# Elastic IP for NAT Gateway
resource "aws_eip" "nat" {
  domain = "vpc"
  
  tags = {
    Name = "NAT Gateway EIP"
  }
}

# VPC and Subnets (these typically don't have direct costs)
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
  
  tags = {
    Name = "Main VPC"
  }
}

resource "aws_subnet" "public" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
  availability_zone = "us-east-1a"
  
  tags = {
    Name = "Public Subnet"
  }
}

# Application Load Balancer
resource "aws_lb" "main" {
  name               = "main-alb"
  internal           = false
  load_balancer_type = "application"
  subnets            = [aws_subnet.public.id]
  
  tags = {
    Name = "Main ALB"
  }
}