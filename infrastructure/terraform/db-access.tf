# =============================================================================
# Operator database access — SSM port forwarding host
# =============================================================================
#
# RDS sits in the private subnets, whose only route out is the NAT gateway, so nothing outside the
# VPC can open a connection to it. This small instance is the way in: it has no inbound rules and
# no SSH key, and an operator reaches the database through it with an SSM Session Manager port
# forward (AWS-StartPortForwardingSessionToRemoteHost), authorised by their own IAM credentials.
# The SSM agent dials out through the NAT gateway. README.md, "Direct QA Database Access", has the
# commands.

data "aws_ssm_parameter" "db_access_ami" {
  count = var.db_access_host_enabled ? 1 : 0
  name  = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

resource "aws_iam_role" "db_access" {
  count = var.db_access_host_enabled ? 1 : 0
  name  = "${local.name_prefix}-db-access"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "db_access_ssm" {
  count      = var.db_access_host_enabled ? 1 : 0
  role       = aws_iam_role.db_access[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "db_access" {
  count = var.db_access_host_enabled ? 1 : 0
  name  = "${local.name_prefix}-db-access"
  role  = aws_iam_role.db_access[0].name
}

# No ingress: Session Manager traffic arrives over the agent's own outbound connection.
resource "aws_security_group" "db_access" {
  count       = var.db_access_host_enabled ? 1 : 0
  name_prefix = "${local.name_prefix}-db-access-"
  vpc_id      = aws_vpc.main.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-db-access-sg" }
}

resource "aws_instance" "db_access" {
  count                  = var.db_access_host_enabled ? 1 : 0
  ami                    = data.aws_ssm_parameter.db_access_ami[0].value
  instance_type          = "t4g.nano"
  subnet_id              = aws_subnet.private[0].id
  vpc_security_group_ids = [aws_security_group.db_access[0].id]
  iam_instance_profile   = aws_iam_instance_profile.db_access[0].name

  metadata_options {
    http_tokens = "required"
  }

  root_block_device {
    encrypted   = true
    volume_size = 8
  }

  # A newer Amazon Linux image would otherwise replace the host on every apply. The SSM agent
  # updates itself, and the host holds no state, so replacing it by hand is always safe.
  lifecycle {
    ignore_changes = [ami]
  }

  tags = { Name = "${local.name_prefix}-db-access" }
}
