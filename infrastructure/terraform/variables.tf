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

variable "core_api_bootstrap_image_tag" {
  description = "Immutable bootstrap image tag for the initial core-api and migrate task definitions. CI/CD registers later revisions from released images."
  type        = string
  default     = "bootstrap"
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
