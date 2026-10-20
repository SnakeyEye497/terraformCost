# Google Cloud workloads — a right-sized app server, a deliberately oversized
# batch VM (more scale-down bait), an SSD disk, Cloud SQL, Cloud Storage, and
# a GKE cluster.

resource "google_compute_instance" "app_server" {
  name         = "acme-app-server"
  machine_type = "n1-standard-1"
  zone         = "us-central1-a"

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
    }
  }
}

resource "google_compute_instance" "legacy_batch" {
  name         = "acme-legacy-batch"
  machine_type = "n1-standard-4"
  zone         = "us-central1-a"

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
    }
  }
}

resource "google_compute_disk" "app_disk" {
  name = "acme-app-disk"
  size = 150
  type = "pd-ssd"
  zone = "us-central1-a"
}

resource "google_sql_database_instance" "analytics_db" {
  name             = "acme-analytics-db"
  database_version = "POSTGRES_15"
  tier             = "db-n1-standard-1"
}

resource "google_storage_bucket" "backups" {
  name     = "acme-backups"
  location = "US"
}

resource "google_container_cluster" "gke_main" {
  name     = "acme-gke-main"
  location = "us-central1"
}
