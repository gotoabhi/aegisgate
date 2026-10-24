output "s3_bucket_name" {
  description = "Name of the provisioned S3 compliance bucket"
  value       = aws_s3_bucket.egress_bucket.id
}

output "aws_region" {
  description = "AWS Region configured"
  value       = var.aws_region
}

output "iam_access_key_id" {
  description = "Access Key ID for local .env configuration"
  value       = aws_iam_access_key.app_user_key.id
}

output "iam_secret_access_key" {
  description = "Secret Access Key (Sensitive)"
  value       = aws_iam_access_key.app_user_key.secret
  sensitive   = true
}