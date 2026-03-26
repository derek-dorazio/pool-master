#!/bin/bash
# LocalStack bootstrap — runs when LocalStack is ready.
# Creates AWS resources needed for local development.

set -euo pipefail

echo "=== Initialising LocalStack AWS resources ==="

# SES — verify sender identity
awslocal ses verify-email-identity --email-address noreply@poolmaster.local
echo "✓ SES sender verified: noreply@poolmaster.local"

# SNS — notification topic
awslocal sns create-topic --name poolmaster-notifications
echo "✓ SNS topic created: poolmaster-notifications"

# SQS — notification queue
awslocal sqs create-queue --queue-name poolmaster-notification-queue
echo "✓ SQS queue created: poolmaster-notification-queue"

# Subscribe queue to topic
awslocal sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:000000000000:poolmaster-notifications \
  --protocol sqs \
  --notification-endpoint arn:aws:sqs:us-east-1:000000000000:poolmaster-notification-queue
echo "✓ SQS subscribed to SNS topic"

echo "=== LocalStack init complete ==="
