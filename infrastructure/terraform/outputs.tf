# -----------------------------------------------------------------------------
# PoolMaster Terraform Outputs
# -----------------------------------------------------------------------------

output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer (use this to access the app before DNS is configured)"
  value       = aws_lb.main.dns_name
}

output "environment" {
  description = "Current environment"
  value       = var.environment
}

output "app_domain" {
  description = "Environment-specific domain (e.g., qa-poolmaster.app, poolmaster.app)"
  value       = local.app_domain
}

output "app_url" {
  description = "Full app URL (domain if configured, otherwise ALB DNS)"
  value       = local.app_domain != "" ? "https://${local.app_domain}" : "http://${aws_lb.main.dns_name}"
}

output "rds_endpoint" {
  description = "RDS PostgreSQL endpoint (host:port)"
  value       = aws_db_instance.postgres.endpoint
}

output "redis_endpoint" {
  description = "ElastiCache Redis primary endpoint"
  value       = aws_elasticache_cluster.redis.cache_nodes[0].address
}

output "ecr_repository_urls" {
  description = "ECR repository URLs for each service"
  value = {
    core_api             = aws_ecr_repository.services["core-api"].repository_url
    draft_service        = aws_ecr_repository.services["draft-service"].repository_url
    scoring_service      = aws_ecr_repository.services["scoring-service"].repository_url
    ingestion_worker     = aws_ecr_repository.services["ingestion-worker"].repository_url
    notification_service = aws_ecr_repository.services["notification-service"].repository_url
    web                  = aws_ecr_repository.services["web"].repository_url
    admin                = aws_ecr_repository.services["admin"].repository_url
  }
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.main.name
}

output "database_url" {
  description = "Full PostgreSQL connection string (for running migrations)"
  value       = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.postgres.endpoint}/${var.db_name}"
  sensitive   = true
}

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "private_subnet_ids" {
  description = "Private subnet IDs (for running one-off tasks like migrations)"
  value       = aws_subnet.private[*].id
}

output "ecs_security_group_id" {
  description = "ECS tasks security group ID"
  value       = aws_security_group.ecs_tasks.id
}
