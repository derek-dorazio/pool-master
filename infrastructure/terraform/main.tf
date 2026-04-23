# -----------------------------------------------------------------------------
# PoolMaster — AWS Infrastructure (ECS Fargate)
#
# This is scaffolding. Review and adjust all values before applying to a real
# AWS account. Secrets (db_password, JWT_SECRET) must be supplied via
# terraform.tfvars or environment variables, never committed to source control.
# -----------------------------------------------------------------------------

terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # State is isolated per environment via -backend-config:
  #   terraform init -backend-config=envs/qa.backend.hcl
  #   terraform init -backend-config=envs/staging.backend.hcl
  #   terraform init -backend-config=envs/prod.backend.hcl
  backend "s3" {
    bucket         = "poolmaster-terraform-state-614049083306-us-east-2-an"
    region         = "us-east-2"
    dynamodb_table = "poolmaster-terraform-locks"
    encrypt        = true
    # key is set per environment via backend config file
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

locals {
  name_prefix                          = "${var.project_name}-${var.environment}"
  qa_only_services                     = var.environment == "qa" ? ["mock-contest-feed-provider"] : []
  services                             = concat(["core-api"], local.qa_only_services)
  mock_provider_base_url               = "http://mock-contest-feed-provider.${var.environment}.${var.internal_service_discovery_domain}:3105"
  resolved_sport_data_default_provider = trimspace(var.sport_data_default_provider) != "" ? var.sport_data_default_provider : (var.environment == "qa" ? "mock-contest-feed" : "")
  resolved_sport_data_provider_bindings_json = trimspace(var.sport_data_provider_bindings_json) != "" ? var.sport_data_provider_bindings_json : (
    var.environment == "qa"
    ? jsonencode({
      providers = {
        "mock-contest-feed" = {
          baseUrl = local.mock_provider_base_url
        }
      }
    })
    : "{}"
  )

  # Domain: qa.domain.com, stage.domain.com, domain.com (prod has no prefix)
  env_subdomain_prefix = {
    qa      = "qa."
    staging = "stage."
    prod    = ""
  }
  app_domain = var.domain_name != "" ? "${local.env_subdomain_prefix[var.environment]}${var.domain_name}" : ""

  # Port mapping for backend services
  service_ports = {
    "core-api"                   = 3000
    "mock-contest-feed-provider" = 3105
  }
}

# =============================================================================
# Networking — VPC, Subnets, Security Groups
# =============================================================================

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = { Name = "${local.name_prefix}-vpc" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name_prefix}-igw" }
}

resource "aws_subnet" "public" {
  count                   = length(var.availability_zones)
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index)
  availability_zone       = var.availability_zones[count.index]
  map_public_ip_on_launch = true

  tags = { Name = "${local.name_prefix}-public-${count.index}" }
}

resource "aws_subnet" "private" {
  count             = length(var.availability_zones)
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 100)
  availability_zone = var.availability_zones[count.index]

  tags = { Name = "${local.name_prefix}-private-${count.index}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name_prefix}-public-rt" }
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.main.id
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# --- NAT Gateway (for private subnet internet access — ECS image pulls, etc.) ---

resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = { Name = "${local.name_prefix}-nat-eip" }
}

resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id

  tags       = { Name = "${local.name_prefix}-nat" }
  depends_on = [aws_internet_gateway.main]
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name_prefix}-private-rt" }
}

resource "aws_route" "private_nat" {
  route_table_id         = aws_route_table.private.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.main.id
}

resource "aws_route_table_association" "private" {
  count          = length(aws_subnet.private)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# --- Security Groups ---

resource "aws_security_group" "alb" {
  name_prefix = "${local.name_prefix}-alb-"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-alb-sg" }
}

resource "aws_security_group" "ecs_tasks" {
  name_prefix = "${local.name_prefix}-ecs-"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 0
    to_port         = 65535
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  ingress {
    from_port = 0
    to_port   = 65535
    protocol  = "tcp"
    self      = true
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-ecs-sg" }
}

resource "aws_security_group" "database" {
  name_prefix = "${local.name_prefix}-db-"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  dynamic "ingress" {
    for_each = toset(var.db_allowed_cidr_blocks)

    content {
      from_port   = 5432
      to_port     = 5432
      protocol    = "tcp"
      cidr_blocks = [ingress.value]
      description = "Approved direct PostgreSQL access"
    }
  }

  tags = { Name = "${local.name_prefix}-db-sg" }
}

# =============================================================================
# ECR — Container Registries
# =============================================================================

resource "aws_ecr_repository" "services" {
  for_each             = toset(local.services)
  name                 = "${local.name_prefix}/${each.key}"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = var.environment != "prod"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = { Service = each.key }
}

# Lifecycle policy — keep last 10 images, expire untagged after 7 days
resource "aws_ecr_lifecycle_policy" "cleanup" {
  for_each   = aws_ecr_repository.services
  repository = each.value.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 7 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 7
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep last 10 tagged images"
        selection = {
          tagStatus   = "tagged"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = { type = "expire" }
      }
    ]
  })
}

# =============================================================================
# RDS — PostgreSQL
# =============================================================================

resource "aws_db_subnet_group" "main" {
  name       = "${local.name_prefix}-db-subnet"
  subnet_ids = aws_subnet.private[*].id

  tags = { Name = "${local.name_prefix}-db-subnet" }
}

resource "aws_db_instance" "postgres" {
  identifier     = "${local.name_prefix}-postgres"
  engine         = "postgres"
  engine_version = "16"

  instance_class    = var.db_instance_class
  allocated_storage = var.db_allocated_storage
  storage_encrypted = true

  db_name  = var.db_name
  username = var.db_username
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.database.id]
  publicly_accessible    = var.db_publicly_accessible

  multi_az            = var.environment == "prod"
  skip_final_snapshot = var.environment != "prod"
  deletion_protection = var.environment == "prod"

  backup_retention_period = var.environment == "prod" ? 7 : 1

  tags = { Name = "${local.name_prefix}-postgres" }
}

# =============================================================================
# ALB — Application Load Balancer
# =============================================================================

resource "aws_lb" "main" {
  name               = "${local.name_prefix}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  tags = { Name = "${local.name_prefix}-alb" }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  # Forward to core-api. CloudFront connects via HTTP (origin_protocol_policy = http-only).
  # All external user traffic goes through CloudFront which handles HTTPS termination.
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.core_api.arn
  }
}

# HTTPS listener — only created when ACM certificate is provided
resource "aws_lb_listener" "https" {
  count             = var.acm_certificate_arn != "" ? 1 : 0
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.core_api.arn
  }
}

# =============================================================================
# ALB Target Groups — one per ALB-facing service
# =============================================================================

resource "aws_lb_target_group" "core_api" {
  name        = "${local.name_prefix}-core-api-tg"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
  }

  tags = { Service = "core-api" }
}

## notification target group removed — notification routes now served by core-api monolith

# =============================================================================
# ALB Listener Rules — path-based routing
# =============================================================================

# Select which listener to attach rules to (HTTPS if available, else HTTP)
locals {
  active_listener_arn = var.acm_certificate_arn != "" ? aws_lb_listener.https[0].arn : aws_lb_listener.http.arn
}

resource "aws_lb_listener_rule" "api" {
  listener_arn = local.active_listener_arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.core_api.arn
  }

  condition {
    path_pattern {
      values = ["/api/*", "/health"]
    }
  }
}

## notifications listener rule removed — all /api/* routes go to core-api monolith

# =============================================================================
# ECS — Cluster + IAM Roles
# =============================================================================

resource "aws_ecs_cluster" "main" {
  name = "${local.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = { Name = "${local.name_prefix}-cluster" }
}

resource "aws_iam_role" "ecs_execution" {
  name = "${local.name_prefix}-ecs-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "ecs_task" {
  name = "${local.name_prefix}-ecs-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

# --- CloudWatch Log Groups ---

resource "aws_cloudwatch_log_group" "services" {
  for_each          = toset(local.services)
  name              = "/ecs/${local.name_prefix}/${each.key}"
  retention_in_days = var.environment == "prod" ? 30 : 7

  tags = { Service = each.key }
}

# =============================================================================
# ECS — Shared environment variables
# =============================================================================

locals {
  db_url = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.postgres.endpoint}/${var.db_name}"

  common_env = [
    { name = "NODE_ENV", value = var.environment },
    { name = "DATABASE_URL", value = local.db_url },
    { name = "SPORT_DATA_DEFAULT_PROVIDER", value = local.resolved_sport_data_default_provider },
    { name = "SPORT_DATA_PROVIDER_BINDINGS_JSON", value = local.resolved_sport_data_provider_bindings_json },
  ]
}

# =============================================================================
# ECS — Backend Services (task definitions + services)
# =============================================================================

# --- Core API ---

resource "aws_ecs_task_definition" "core_api" {
  family                   = "${local.name_prefix}-core-api"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.ecs_cpu
  memory                   = var.ecs_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name         = "core-api"
    image        = "${aws_ecr_repository.services["core-api"].repository_url}:${var.core_api_bootstrap_image_tag}"
    essential    = true
    portMappings = [{ containerPort = 3000, protocol = "tcp" }]
    environment = concat(local.common_env, [
      { name = "PORT", value = "3000" },
      { name = "EMAIL_PROVIDER", value = "ses" },
      { name = "AWS_REGION", value = var.region },
      { name = "SES_FROM_EMAIL", value = "noreply@${var.domain_name != "" ? var.domain_name : "poolmaster.dev"}" },
      { name = "ENVIRONMENT", value = var.environment },
      { name = "AUTO_START_SCHEDULER", value = "true" },
    ])
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.services["core-api"].name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])
}

resource "aws_service_discovery_private_dns_namespace" "qa_internal" {
  count = var.environment == "qa" ? 1 : 0

  name = "${var.environment}.${var.internal_service_discovery_domain}"
  vpc  = aws_vpc.main.id

  tags = { Name = "${local.name_prefix}-internal" }
}

resource "aws_service_discovery_service" "mock_contest_feed_provider" {
  count = var.environment == "qa" ? 1 : 0

  name = "mock-contest-feed-provider"

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.qa_internal[0].id

    dns_records {
      ttl  = 10
      type = "A"
    }

    routing_policy = "MULTIVALUE"
  }

  health_check_custom_config {
    failure_threshold = 1
  }
}

resource "aws_ecs_task_definition" "mock_contest_feed_provider" {
  count = var.environment == "qa" ? 1 : 0

  family                   = "${local.name_prefix}-mock-contest-feed-provider"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name         = "mock-contest-feed-provider"
    image        = "${aws_ecr_repository.services["mock-contest-feed-provider"].repository_url}:${var.mock_contest_feed_provider_bootstrap_image_tag}"
    essential    = true
    portMappings = [{ containerPort = 3105, protocol = "tcp" }]
    environment = [
      { name = "NODE_ENV", value = var.environment },
      { name = "PORT", value = "3105" },
      { name = "PROVIDER_ID", value = "mock-contest-feed" },
      { name = "SERVICE_NAME", value = "mock-contest-feed-provider" },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.services["mock-contest-feed-provider"].name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])
}

# --- Migration Task (one-shot, runs prisma migrate deploy) ---

resource "aws_cloudwatch_log_group" "migrate" {
  name              = "/ecs/${local.name_prefix}/migrate"
  retention_in_days = var.environment == "prod" ? 30 : 7

  tags = { Service = "migrate" }
}

resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.name_prefix}-migrate"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "migrate"
    image     = "${aws_ecr_repository.services["core-api"].repository_url}:${var.core_api_bootstrap_image_tag}"
    essential = true
    command   = ["node", "scripts/run-migrations.mjs"]
    environment = [
      { name = "DATABASE_URL", value = local.db_url },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.migrate.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])
}

resource "aws_ecs_service" "core_api" {
  name            = "${local.name_prefix}-core-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.core_api.arn
  desired_count   = var.environment == "prod" ? 2 : 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.core_api.arn
    container_name   = "core-api"
    container_port   = 3000
  }

  depends_on = [aws_lb_listener.http]
}

resource "aws_ecs_service" "mock_contest_feed_provider" {
  count = var.environment == "qa" ? 1 : 0

  name            = "${local.name_prefix}-mock-contest-feed-provider"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.mock_contest_feed_provider[0].arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  service_registries {
    registry_arn = aws_service_discovery_service.mock_contest_feed_provider[0].arn
  }

  depends_on = [aws_service_discovery_service.mock_contest_feed_provider]
}

# Draft, scoring, ingestion, and notification services removed — merged into core-api monolith

# =============================================================================
# Web App + Admin App — hosted via S3 + CloudFront (see cloudfront.tf)
# No ECS services needed for static SPAs.
# =============================================================================
