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
  app_url    = local.app_domain != "" ? "https://${local.app_domain}" : "https://${aws_cloudfront_distribution.webapp.domain_name}"
  # System email: each environment sends from its own subdomain identity (#844), like the app.
  mail_domain        = local.app_domain
  mail_from_domain   = local.mail_domain != "" ? "bounce.${local.mail_domain}" : ""
  manage_mail_dns    = local.mail_domain != "" && var.route53_zone_id != ""
  ses_sending_domain = local.mail_domain != "" ? local.mail_domain : "poolmaster.dev"
  ses_from_email     = "noreply@${local.ses_sending_domain}"

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

# CloudFront's origin-facing addresses, the only ones the ALB accepts (#856).
data "aws_ec2_managed_prefix_list" "cloudfront_origin_facing" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "alb" {
  name_prefix = "${local.name_prefix}-alb-"
  vpc_id      = aws_vpc.main.id

  # Only CloudFront may reach the ALB, on the port it uses (origin_protocol_policy = http-only).
  # core-api believes the X-Forwarded-For entry the ALB adds for its peer (TRUSTED_PROXY_HOPS = 2),
  # so a caller who could reach the ALB directly could choose the address the per-address rate
  # limits key on. The prefix list
  # counts as about 55 rules against the security group's quota of 60, so there is one rule, not
  # one per port.
  ingress {
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    prefix_list_ids = [data.aws_ec2_managed_prefix_list.cloudfront_origin_facing.id]
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

# Lifecycle policy — keep last 100 tagged images, expire untagged after 7 days.
#
# #281 — task definitions pin images by digest, so an expired image makes every task
# definition that references it unlaunchable, and rollback to it impossible. At "keep last
# 10" with roughly nine main pushes a day (core-api went from revision 332 to 359 in about
# three days), that window was about a day: a service left on an older revision lost its
# image and could not even restart. 100 keeps roughly ten days of rollback. Count-based,
# not age-based, so the newest images are never expired however quiet the repo gets.
# Unpinning (referencing by tag) would not help: the repositories are IMMUTABLE, so a tag
# is already as fixed as a digest, and expiry deletes the image whichever way it is named.
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
        description  = "Keep last 100 tagged images"
        selection = {
          tagStatus      = "tagged"
          tagPatternList = ["*"]
          countType      = "imageCountMoreThan"
          countNumber    = 100
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
    value = "disabled"
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

# pool-master-rop.76.1 — JWT signing key in AWS Secrets Manager.
# The previous deterministic dev fallback in source code was removed;
# the core-api throws at startup if JWT_SECRET is unset. The ECS
# task definition's `secrets` block (below) maps this secret's
# value into the container's environment as JWT_SECRET.
resource "aws_secretsmanager_secret" "jwt_secret" {
  name        = "${local.name_prefix}-jwt-secret"
  description = "JWT signing key for ${local.name_prefix} core-api (pool-master-rop.76.1)."

  tags = {
    Service = "core-api"
    Purpose = "jwt-signing-key"
  }
}

resource "aws_secretsmanager_secret_version" "jwt_secret" {
  secret_id     = aws_secretsmanager_secret.jwt_secret.id
  secret_string = var.jwt_secret
}

# Allow the ECS execution role to read this specific secret at task
# startup. Scoped to a single ARN; AmazonECSTaskExecutionRolePolicy
# (attached above) does not grant secretsmanager:GetSecretValue.
resource "aws_iam_role_policy" "ecs_execution_jwt_secret" {
  name = "${local.name_prefix}-ecs-execution-jwt-secret"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [aws_secretsmanager_secret.jwt_secret.arn]
    }]
  })
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

resource "aws_iam_role_policy" "ecs_task_ses_send" {
  name = "${local.name_prefix}-ses-send"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ses:SendEmail",
          "ses:SendRawEmail",
        ]
        Resource = concat(
          aws_ses_domain_identity.mail[*].arn,
          aws_ses_email_identity.sender[*].arn,
          [aws_sesv2_configuration_set.mail.arn],
        )
      },
      # In the SES sandbox, AWS also checks the send against the recipient's verified identity
      # (e.g. identity/tester@gmail.com), so without this every send is AccessDenied. It still
      # only allows mail from this environment's sending domain.
      # core-api calls only the SESv2 SendEmail API.
      {
        Effect   = "Allow"
        Action   = "ses:SendEmail"
        Resource = "arn:aws:ses:${var.region}:${data.aws_caller_identity.current.account_id}:identity/*"
        Condition = {
          StringLike = { "ses:FromAddress" = "*@${local.ses_sending_domain}" }
        }
      },
    ]
  })
}

data "aws_caller_identity" "current" {}

# --- SES identity for system email (#844) ---
# Each environment sends from its own subdomain (QA: qa.<domain>, prod: the bare domain), so QA
# bounces and test complaints never touch prod's sending reputation. The steps that need the
# AWS console (production access) are in README.md, "System email (SES)".

resource "aws_ses_domain_identity" "mail" {
  count  = local.mail_domain != "" ? 1 : 0
  domain = local.mail_domain
}

resource "aws_ses_domain_dkim" "mail" {
  count  = local.mail_domain != "" ? 1 : 0
  domain = aws_ses_domain_identity.mail[0].domain
}

# Easy DKIM always issues three tokens. A count of three (not a for_each over the tokens, which
# are unknown until the identity exists) lets one apply create the identity and its records (#120).
resource "aws_route53_record" "ses_dkim" {
  count = local.manage_mail_dns ? 3 : 0

  zone_id = var.route53_zone_id
  name    = "${aws_ses_domain_dkim.mail[0].dkim_tokens[count.index]}._domainkey.${local.mail_domain}"
  type    = "CNAME"
  ttl     = 600
  records = ["${aws_ses_domain_dkim.mail[0].dkim_tokens[count.index]}.dkim.amazonses.com"]
}

# Custom MAIL FROM, so SPF passes for our own domain and counts toward DMARC.
resource "aws_ses_domain_mail_from" "mail" {
  count            = local.mail_domain != "" ? 1 : 0
  domain           = aws_ses_domain_identity.mail[0].domain
  mail_from_domain = local.mail_from_domain
}

resource "aws_route53_record" "ses_mail_from_mx" {
  count = local.manage_mail_dns ? 1 : 0

  zone_id = var.route53_zone_id
  name    = local.mail_from_domain
  type    = "MX"
  ttl     = 600
  records = ["10 feedback-smtp.${var.region}.amazonses.com"]
}

resource "aws_route53_record" "ses_mail_from_spf" {
  count = local.manage_mail_dns ? 1 : 0

  zone_id = var.route53_zone_id
  name    = local.mail_from_domain
  type    = "TXT"
  ttl     = 600
  records = ["v=spf1 include:amazonses.com ~all"]
}

# DMARC starts at p=none; move to p=quarantine after a few weeks of clean aggregate reports.
resource "aws_route53_record" "ses_dmarc" {
  count = local.manage_mail_dns ? 1 : 0

  zone_id = var.route53_zone_id
  name    = "_dmarc.${local.mail_domain}"
  type    = "TXT"
  ttl     = 600
  records = [
    var.dmarc_report_email != ""
    ? "v=DMARC1; p=none; rua=mailto:${var.dmarc_report_email}"
    : "v=DMARC1; p=none",
  ]
}

resource "aws_ses_email_identity" "sender" {
  count = local.mail_domain == "" ? 1 : 0
  email = local.ses_from_email
}

# Every send names this configuration set. Its suppression options make SES refuse addresses on
# the account suppression list that bounced or complained, without managing the account-wide
# setting from one environment's state. Its event destination below reports what happened to each
# email to core-api.
resource "aws_sesv2_configuration_set" "mail" {
  configuration_set_name = local.name_prefix

  reputation_options {
    reputation_metrics_enabled = true
  }

  sending_options {
    sending_enabled = true
  }

  suppression_options {
    suppressed_reasons = ["BOUNCE", "COMPLAINT"]
  }
}

# SES delivery events (#844 slice 4): the configuration set publishes delivery, bounce, complaint
# and reject events to this topic, and the topic posts them to core-api, which checks the SNS
# signature and that they came from this topic.
resource "aws_sns_topic" "ses_events" {
  name = "${local.name_prefix}-ses-events"
}

data "aws_iam_policy_document" "ses_events_topic" {
  statement {
    sid       = "SesPublishesThisEnvironmentsEvents"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.ses_events.arn]

    principals {
      type        = "Service"
      identifiers = ["ses.amazonaws.com"]
    }

    condition {
      test     = "ArnLike"
      variable = "AWS:SourceArn"
      values   = [aws_sesv2_configuration_set.mail.arn]
    }
  }
}

resource "aws_sns_topic_policy" "ses_events" {
  arn    = aws_sns_topic.ses_events.arn
  policy = data.aws_iam_policy_document.ses_events_topic.json
}

resource "aws_sesv2_configuration_set_event_destination" "ses_events" {
  configuration_set_name = aws_sesv2_configuration_set.mail.configuration_set_name
  event_destination_name = "core-api"

  event_destination {
    enabled              = true
    matching_event_types = ["DELIVERY", "BOUNCE", "COMPLAINT", "REJECT"]

    sns_destination {
      topic_arn = aws_sns_topic.ses_events.arn
    }
  }

  depends_on = [aws_sns_topic_policy.ses_events]
}

# SNS confirms an https subscription once, when it is created, by posting to the endpoint. core-api
# answers only once its running task has SES_EVENTS_TOPIC_ARN, which CI deploys after this apply,
# so the subscription is a second step: see infrastructure/terraform/README.md, System email (SES).
# core-api confirms it itself, so the apply waits for that and fails loudly if it never comes.
resource "aws_sns_topic_subscription" "ses_events" {
  count = var.ses_events_subscribed ? 1 : 0

  topic_arn              = aws_sns_topic.ses_events.arn
  protocol               = "https"
  endpoint               = "${local.app_url}/api/v1/email/ses-events"
  endpoint_auto_confirms = true
  raw_message_delivery   = false
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

  # #184: NODE_ENV is the Node ecosystem's variable and is always "production" when deployed.
  # Which environment this is (qa, staging, prod) is POOLMASTER_ENVIRONMENT, and only that.
  common_env = [
    { name = "NODE_ENV", value = "production" },
    { name = "POOLMASTER_ENVIRONMENT", value = var.environment },
    { name = "LOG_LEVEL", value = var.core_api_log_level },
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
      # Whether email is sent, and to whom on QA, is the EMAIL_CONFIG app setting, not env (#450, #844).
      { name = "EMAIL_PROVIDER", value = "ses" },
      { name = "APP_BASE_URL", value = local.app_url },
      # CloudFront, then the ALB, each add an X-Forwarded-For entry; the ALB connects from inside
      # the VPC (#856). Safe only while the ALB security group admits CloudFront alone.
      { name = "TRUSTED_PROXY_HOPS", value = "2" },
      { name = "TRUSTED_PROXY_NETWORK", value = var.vpc_cidr },
      { name = "AWS_REGION", value = var.region },
      { name = "SES_FROM_EMAIL", value = local.ses_from_email },
      { name = "SES_CONFIGURATION_SET", value = aws_sesv2_configuration_set.mail.configuration_set_name },
      { name = "SES_EVENTS_TOPIC_ARN", value = aws_sns_topic.ses_events.arn },
      { name = "AUTO_START_SCHEDULER", value = "true" },
    ])
    # pool-master-rop.76.1 — JWT_SECRET injected from Secrets Manager.
    # ECS resolves the ARN at task start and exposes the value in the
    # container's process.env. The core-api bootstrap throws if unset.
    secrets = [
      { name = "JWT_SECRET", valueFrom = aws_secretsmanager_secret.jwt_secret.arn },
    ]
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
      { name = "NODE_ENV", value = "production" },
      { name = "POOLMASTER_ENVIRONMENT", value = var.environment },
      { name = "LOG_LEVEL", value = var.mock_contest_feed_provider_log_level },
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

  # #281 — core-api needs tens of seconds to boot Node, connect Prisma and build the
  # route tree. With the default of 0 the ALB can fail the target before it ever answers,
  # which crash-loops like an application bug. 120 is the value set live on QA by hand
  # during recovery; declaring it here keeps the next apply from reverting it to 0.
  health_check_grace_period_seconds = 120

  # #281 — without the circuit breaker, a deployment that never reaches steady state sits
  # IN_PROGRESS indefinitely and nothing escalates. With it, ECS fails the deployment and
  # rolls back to the last working revision. deploy-qa asserts after its wait that the
  # rollout completed on the new revision, so a rollback still fails the pipeline.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

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

  # #281 — CI owns task_definition: deploy-qa moves the service to the revision each main
  # push registers. Terraform owns everything else on this service, desired_count included.
  # Without this, every terraform apply would reconcile the service back onto Terraform's
  # own bootstrap task definition, off the revision CI deployed.
  lifecycle {
    ignore_changes = [task_definition]
  }
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

  # #281 — CI owns task_definition here for the same reason it does on core-api:
  # deploy-qa's "Deploy QA services" step calls update-service for both services,
  # so both are moved by each main push and neither should be reconciled by an
  # apply. #282 added this to core_api and missed this service. Without it, a
  # terraform apply rolls the service back to Terraform's own revision — 104
  # against CI's 216 on 2026-10-02 — whose image ECR expired long ago, so the
  # service cannot place a task at all.
  lifecycle {
    ignore_changes = [task_definition]
  }
}

# Draft, scoring, ingestion, and notification services removed — merged into core-api monolith

# =============================================================================
# Web App + Admin App — hosted via S3 + CloudFront (see cloudfront.tf)
# No ECS services needed for static SPAs.
# =============================================================================
