# AWS storage — two S3 buckets and two EBS volumes. The backup volume is
# deliberately large and on the pricier gp2 type — a "switch to gp3" upgrade
# is a real, common savings suggestion for exactly this kind of resource.

resource "aws_s3_bucket" "app_logs" {
  bucket = "acme-app-logs"

  tags = {
    Name = "acme-app-logs"
  }
}

resource "aws_s3_bucket" "static_assets" {
  bucket = "acme-static-assets"

  tags = {
    Name = "acme-static-assets"
  }
}

resource "aws_ebs_volume" "app_data" {
  availability_zone = "us-east-1a"
  size              = 200
  type              = "gp3"

  tags = {
    Name = "acme-app-data"
  }
}

resource "aws_ebs_volume" "backup_data" {
  availability_zone = "us-east-1a"
  size              = 500
  type              = "gp2"

  tags = {
    Name = "acme-backup-data"
  }
}
