# -----------------------------------------------------------------------------
# PoolMaster Terraform Variables
# -----------------------------------------------------------------------------

variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "poolmaster"
}

# --- Database ---

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.medium"
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

# --- Redis ---

variable "redis_node_type" {
  description = "ElastiCache Redis node type"
  type        = string
  default     = "cache.t3.micro"
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

# --- Networking ---

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "List of availability zones"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}
