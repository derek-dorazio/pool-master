#!/usr/bin/env bash
# Opens a local port to an environment's PostgreSQL through its SSM port forwarding host
# (infrastructure/terraform/db-access.tf). Leave it running and point a database client at
# localhost:<local port>. Needs the AWS CLI and the Session Manager plugin.
#
#   scripts/db-tunnel.sh [environment] [local port]     # defaults: qa 15432
set -euo pipefail

ENVIRONMENT="${1:-qa}"
LOCAL_PORT="${2:-15432}"
REGION="${AWS_REGION:-us-east-2}"
PREFIX="poolmaster-${ENVIRONMENT}"

INSTANCE_ID=$(aws ec2 describe-instances --region "$REGION" \
  --filters "Name=tag:Name,Values=${PREFIX}-db-access" "Name=instance-state-name,Values=running" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)
if [ -z "$INSTANCE_ID" ] || [ "$INSTANCE_ID" = "None" ]; then
  echo "No running ${PREFIX}-db-access instance. Apply Terraform with db_access_host_enabled = true." >&2
  exit 1
fi

DB_HOST=$(aws rds describe-db-instances --region "$REGION" \
  --db-instance-identifier "${PREFIX}-postgres" \
  --query 'DBInstances[0].Endpoint.Address' --output text)

echo "Forwarding localhost:${LOCAL_PORT} to ${PREFIX}-postgres. Press Ctrl+C to close."
aws ssm start-session --region "$REGION" --target "$INSTANCE_ID" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"${DB_HOST}\"],\"portNumber\":[\"5432\"],\"localPortNumber\":[\"${LOCAL_PORT}\"]}"
