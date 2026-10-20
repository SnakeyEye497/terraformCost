# AWS data tier — a Multi-AZ primary, an RDS cluster for analytics, and an
# ElastiCache cluster for session storage.

resource "aws_db_instance" "primary" {
  identifier        = "acme-primary-db"
  engine            = "postgres"
  engine_version    = "15"
  instance_class    = "db.t3.small"
  allocated_storage = 50
  multi_az          = true

  db_name  = "acme"
  username = "admin"
  password = "changeme123"

  skip_final_snapshot = true

  tags = {
    Name = "acme-primary-db"
  }
}

resource "aws_rds_cluster" "analytics" {
  cluster_identifier  = "acme-analytics-cluster"
  engine              = "aurora-postgresql"
  instance_class      = "db.t3.medium"
  cluster_instances   = 2
  database_name       = "analytics"
  master_username     = "admin"
  master_password     = "changeme123"
  skip_final_snapshot = true

  tags = {
    Name = "acme-analytics-cluster"
  }
}

resource "aws_elasticache_cluster" "session_cache" {
  cluster_id      = "acme-session-cache"
  engine          = "redis"
  node_type       = "cache.t3.micro"
  num_cache_nodes = 2

  tags = {
    Name = "acme-session-cache"
  }
}
