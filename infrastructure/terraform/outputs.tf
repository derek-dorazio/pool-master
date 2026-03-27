# -----------------------------------------------------------------------------
# PoolMaster Terraform Outputs
# -----------------------------------------------------------------------------

output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer"
  value       = aws_lb.main.dns_name
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
  description = "Full PostgreSQL connection string (sensitive)"
  value       = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.postgres.endpoint}/${var.db_name}"
  sensitive   = true
}
