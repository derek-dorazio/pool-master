# -----------------------------------------------------------------------------
# PoolMaster Terraform Variables
# -----------------------------------------------------------------------------

variable "environment" {
  description = "Deployment environment (qa, staging, prod)"
  type        = string
  default     = "qa"

  validation {
    condition     = contains(["qa", "staging", "prod"], var.environment)
    error_message = "Environment must be qa, staging, or prod."
  }
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-2"
}

variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "poolmaster"
}

# --- Domain & SSL (optional — leave empty to skip DNS/HTTPS) ---

variable "domain_name" {
  description = "Root domain name (e.g., poolmaster.app). Leave empty to skip DNS/HTTPS."
  type        = string
  default     = ""
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for HTTPS. Leave empty to skip HTTPS listener."
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = "Route 53 hosted zone ID. Leave empty to skip DNS records."
  type        = string
  default     = ""
}

# --- Database ---

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.micro"
}

variable "db_allocated_storage" {
  description = "RDS allocated storage in GB"
  type        = number
  default     = 20
}

variable "db_name" {
  description = "PostgreSQL database name"
  type        = string
  default     = "poolmaster"
}

variable "db_username" {
  description = "PostgreSQL master username"
  type        = string
  default     = "poolmaster"
  sensitive   = true
}

variable "db_password" {
  description = "PostgreSQL master password — set via TF_VAR_db_password or tfvars"
  type        = string
  sensitive   = true
}

variable "db_publicly_accessible" {
  description = "Whether the RDS instance should expose a public endpoint. Keep false by default; only enable intentionally for environments that require direct operator access."
  type        = bool
  default     = false
}

variable "db_allowed_cidr_blocks" {
  description = "Additional direct-ingress CIDR blocks allowed to reach PostgreSQL. Use for explicitly approved operator IPs only."
  type        = list(string)
  default     = []
}

# --- ECS ---

variable "ecs_cpu" {
  description = "Fargate vCPU units per task (256 = 0.25 vCPU)"
  type        = number
  default     = 256
}

variable "ecs_memory" {
  description = "Fargate memory in MiB per task"
  type        = number
  default     = 512
}

variable "core_api_log_level" {
  description = "Runtime LOG_LEVEL for the core-api container."
  type        = string
  default     = "info"

  validation {
    condition     = contains(["debug", "info", "warn", "error", "fatal"], var.core_api_log_level)
    error_message = "core_api_log_level must be one of debug, info, warn, error, or fatal."
  }
}

variable "mock_contest_feed_provider_log_level" {
  description = "Runtime LOG_LEVEL for the QA-only mock contest feed provider container."
  type        = string
  default     = "info"

  validation {
    condition     = contains(["debug", "info", "warn", "error", "fatal"], var.mock_contest_feed_provider_log_level)
    error_message = "mock_contest_feed_provider_log_level must be one of debug, info, warn, error, or fatal."
  }
}

variable "core_api_bootstrap_image_tag" {
  description = "Immutable bootstrap image tag for the initial core-api and migrate task definitions. CI/CD registers later revisions from released images."
  type        = string
  default     = "bootstrap"
}

variable "mock_contest_feed_provider_bootstrap_image_tag" {
  description = "Immutable bootstrap image tag for the QA-only mock contest feed provider task definition."
  type        = string
  default     = "bootstrap"
}

variable "sport_data_default_provider" {
  description = "Default sports data provider id for the environment. Leave empty to defer binding to application configuration."
  type        = string
  default     = ""
}

variable "sport_data_provider_bindings_json" {
  description = "JSON object describing one or more sports data provider bindings. QA can point to the mock provider now while staging/prod can bind to real providers later."
  type        = string
  default     = ""
}

# --- Networking ---

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "List of availability zones"
  type        = list(string)
  default     = ["us-east-2a", "us-east-2b"]
}

variable "internal_service_discovery_domain" {
  description = "Base private DNS domain for internal ECS service discovery."
  type        = string
  default     = "poolmaster.internal"
}
