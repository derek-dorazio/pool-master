# -----------------------------------------------------------------------------
# PoolMaster — S3 + CloudFront for Webapp and Admin SPA hosting
#
# CloudFront requires ACM certificates in us-east-1, so we create a
# separate cert via an aliased provider. S3 buckets are private;
# CloudFront uses Origin Access Control (OAC) to read from them.
# -----------------------------------------------------------------------------

# --- CloudFront Function for SPA routing ---
#
# Rewrites requests to /index.html for client-side routing, and gives a
# link-preview crawler an event page's own shell (#1010). Both distributions
# use it, applied ONLY to their S3 default behavior, so API responses (403,
# 404, etc.) pass through untouched. This replaces the custom_error_response approach which was
# global and intercepted API error responses. The code is its own file so
# scripts/cloudfront-spa-rewrite.test.mjs can run it.

resource "aws_cloudfront_function" "spa_rewrite" {
  name    = "${local.name_prefix}-spa-rewrite"
  runtime = "cloudfront-js-2.0"
  comment = "SPA routing, and event page shells for link-preview crawlers"
  publish = true
  code    = file("${path.module}/cloudfront-functions/spa-rewrite.js")
}

# --- Provider alias for us-east-1 (CloudFront cert requirement) ---

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# --- ACM Certificate for CloudFront (must be in us-east-1) ---

resource "aws_acm_certificate" "cloudfront" {
  count    = var.domain_name != "" ? 1 : 0
  provider = aws.us_east_1

  domain_name               = "*.${var.domain_name}"
  subject_alternative_names = [var.domain_name]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = { Name = "${local.name_prefix}-cloudfront-cert" }
}

resource "aws_route53_record" "cloudfront_cert_validation" {
  for_each = var.domain_name != "" ? {
    for dvo in aws_acm_certificate.cloudfront[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}

  zone_id = var.route53_zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 60
  records = [each.value.record]

  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "cloudfront" {
  count    = var.domain_name != "" ? 1 : 0
  provider = aws.us_east_1

  certificate_arn         = aws_acm_certificate.cloudfront[0].arn
  validation_record_fqdns = [for record in aws_route53_record.cloudfront_cert_validation : record.fqdn]
}

# =============================================================================
# S3 Buckets — private, accessed only via CloudFront OAC
# =============================================================================

resource "aws_s3_bucket" "webapp" {
  bucket        = "${local.name_prefix}-webapp"
  force_destroy = var.environment != "prod"

  tags = { Name = "${local.name_prefix}-webapp" }
}

resource "aws_s3_bucket_public_access_block" "webapp" {
  bucket                  = aws_s3_bucket.webapp.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket" "admin" {
  bucket        = "${local.name_prefix}-admin"
  force_destroy = var.environment != "prod"

  tags = { Name = "${local.name_prefix}-admin" }
}

resource "aws_s3_bucket_public_access_block" "admin" {
  bucket                  = aws_s3_bucket.admin.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# =============================================================================
# CloudFront Origin Access Control
# =============================================================================

resource "aws_cloudfront_origin_access_control" "webapp" {
  name                              = "${local.name_prefix}-webapp-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_origin_access_control" "admin" {
  name                              = "${local.name_prefix}-admin-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# =============================================================================
# Public API reads (#1181)
#
# The public, anonymous reads (event pages, How to Play's templates and sport
# leagues, the Plans page) may be kept by CloudFront: core-api sends them with
# `public, s-maxage=3600` to a visitor with no session, and `private, no-cache`
# to everything else (packages/core-api/src/core/public-cache.ts). The cache key
# holds the query string, the Authorization header and the access cookie, so
# every visitor without a session shares one copy and a signed-in request never
# shares one. An admin save calls CreateInvalidation (core/cdn-invalidator.ts).
# =============================================================================

locals {
  # One behavior per path, ahead of /api/*. Must equal PublicReadPath in
  # core/public-cache.ts; tests/unit/core-api/public-cache.test.ts checks it.
  public_api_paths = [
    "/api/v1/event-pages*",
    "/api/v1/sport-leagues*",
    "/api/v1/contest-config-templates*",
    "/api/v1/plans*",
  ]
}

resource "aws_cloudfront_cache_policy" "public_api" {
  name    = "${local.name_prefix}-public-api"
  comment = "Public API reads: the origin's Cache-Control decides, up to an hour"

  # Nothing is kept unless the origin says so, and never past an hour.
  min_ttl     = 0
  default_ttl = 0
  max_ttl     = 3600

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true

    cookies_config {
      cookie_behavior = "whitelist"
      cookies {
        items = ["poolmaster_access"]
      }
    }

    headers_config {
      header_behavior = "whitelist"
      headers {
        items = ["Authorization"]
      }
    }

    query_strings_config {
      query_string_behavior = "all"
    }
  }
}

# What else reaches core-api on these paths, outside the cache key: the session
# and CSRF cookies and headers a root admin's write under the same paths needs.
resource "aws_cloudfront_origin_request_policy" "public_api" {
  name    = "${local.name_prefix}-public-api"
  comment = "Public API paths: every cookie and the write headers reach core-api"

  cookies_config {
    cookie_behavior = "all"
  }

  headers_config {
    header_behavior = "whitelist"
    headers {
      items = ["Content-Type", "X-CSRF-Token", "x-tenant-id", "x-user-id"]
    }
  }

  query_strings_config {
    query_string_behavior = "all"
  }
}

# =============================================================================
# CloudFront Distribution — Webapp
# =============================================================================

resource "aws_cloudfront_distribution" "webapp" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  comment             = "${local.name_prefix} webapp"
  price_class         = "PriceClass_100" # US, Canada, Europe

  aliases = local.app_domain != "" ? [local.app_domain] : []

  viewer_certificate {
    acm_certificate_arn            = var.domain_name != "" ? aws_acm_certificate.cloudfront[0].arn : null
    ssl_support_method             = var.domain_name != "" ? "sni-only" : null
    minimum_protocol_version       = var.domain_name != "" ? "TLSv1.2_2021" : null
    cloudfront_default_certificate = var.domain_name == ""
  }

  # Origin 1: S3 bucket (static files)
  origin {
    domain_name              = aws_s3_bucket.webapp.bucket_regional_domain_name
    origin_id                = "s3-webapp"
    origin_access_control_id = aws_cloudfront_origin_access_control.webapp.id
  }

  # Origin 2: ALB (API proxy)
  origin {
    domain_name = aws_lb.main.dns_name
    origin_id   = "alb-api"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # Default behavior: S3 static files with SPA rewrite
  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-webapp"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 86400
    max_ttl     = 31536000

    # SPA routing via CloudFront Function (replaces custom_error_response
    # which was global and intercepted API 403/404 responses)
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_rewrite.arn
    }
  }

  # Public API reads, ahead of /api/*: kept as long as core-api's Cache-Control
  # says, up to an hour (#1181). Writes under these paths pass straight through.
  dynamic "ordered_cache_behavior" {
    for_each = local.public_api_paths
    content {
      path_pattern             = ordered_cache_behavior.value
      allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
      cached_methods           = ["GET", "HEAD"]
      target_origin_id         = "alb-api"
      viewer_protocol_policy   = "redirect-to-https"
      compress                 = true
      cache_policy_id          = aws_cloudfront_cache_policy.public_api.id
      origin_request_policy_id = aws_cloudfront_origin_request_policy.public_api.id
    }
  }

  # /api/* behavior: proxy to ALB (no caching)
  ordered_cache_behavior {
    path_pattern           = "/api/*"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "alb-api"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = true
      headers      = ["Authorization", "x-tenant-id", "x-user-id", "Content-Type"]
      cookies {
        forward = "all"
      }
    }

    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0
  }

  # /apidoc* behavior: proxy API docs to ALB (no caching)
  ordered_cache_behavior {
    path_pattern           = "/apidoc*"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "alb-api"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = true
      headers      = ["Authorization", "Content-Type"]
      cookies {
        forward = "all"
      }
    }

    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0
  }

  # /health behavior: proxy to ALB
  ordered_cache_behavior {
    path_pattern           = "/health"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "alb-api"
    viewer_protocol_policy = "redirect-to-https"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0
  }

  # NOTE: custom_error_response blocks removed — SPA routing is now handled
  # by the CloudFront Function on the default behavior, which only affects
  # S3 requests and leaves API responses (403, 404, etc.) untouched.

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  tags = { Name = "${local.name_prefix}-webapp-cdn" }

  depends_on = [aws_acm_certificate_validation.cloudfront]
}

# =============================================================================
# CloudFront Distribution — Admin
# =============================================================================

resource "aws_cloudfront_distribution" "admin" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  comment             = "${local.name_prefix} admin"
  price_class         = "PriceClass_100"

  # Use qa-admin.domain.com (not admin.qa.domain.com) because wildcard cert
  # *.domain.com only covers single-level subdomains
  aliases = local.app_domain != "" ? ["${var.environment}-admin.${var.domain_name}"] : []

  viewer_certificate {
    acm_certificate_arn            = var.domain_name != "" ? aws_acm_certificate.cloudfront[0].arn : null
    ssl_support_method             = var.domain_name != "" ? "sni-only" : null
    minimum_protocol_version       = var.domain_name != "" ? "TLSv1.2_2021" : null
    cloudfront_default_certificate = var.domain_name == ""
  }

  origin {
    domain_name              = aws_s3_bucket.admin.bucket_regional_domain_name
    origin_id                = "s3-admin"
    origin_access_control_id = aws_cloudfront_origin_access_control.admin.id
  }

  origin {
    domain_name = aws_lb.main.dns_name
    origin_id   = "alb-api"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-admin"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 86400
    max_ttl     = 31536000

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_rewrite.arn
    }
  }

  ordered_cache_behavior {
    path_pattern           = "/api/*"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "alb-api"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = true
      headers      = ["Authorization", "x-tenant-id", "x-user-id", "Content-Type"]
      cookies {
        forward = "all"
      }
    }

    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  tags = { Name = "${local.name_prefix}-admin-cdn" }

  depends_on = [aws_acm_certificate_validation.cloudfront]
}

# =============================================================================
# S3 Bucket Policies — allow CloudFront OAC to read
# =============================================================================

resource "aws_s3_bucket_policy" "webapp" {
  bucket = aws_s3_bucket.webapp.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontOAC"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.webapp.arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = aws_cloudfront_distribution.webapp.arn
        }
      }
    }]
  })
}

resource "aws_s3_bucket_policy" "admin" {
  bucket = aws_s3_bucket.admin.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontOAC"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.admin.arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = aws_cloudfront_distribution.admin.arn
        }
      }
    }]
  })
}

# =============================================================================
# Route 53 DNS — point domains to CloudFront (replaces ALB record for webapp)
# =============================================================================

resource "aws_route53_record" "webapp_cdn" {
  count   = var.route53_zone_id != "" && local.app_domain != "" ? 1 : 0
  zone_id = var.route53_zone_id
  name    = local.app_domain
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.webapp.domain_name
    zone_id                = aws_cloudfront_distribution.webapp.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "admin_cdn" {
  count   = var.route53_zone_id != "" && local.app_domain != "" ? 1 : 0
  zone_id = var.route53_zone_id
  name    = "${var.environment}-admin.${var.domain_name}"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.admin.domain_name
    zone_id                = aws_cloudfront_distribution.admin.hosted_zone_id
    evaluate_target_health = false
  }
}
