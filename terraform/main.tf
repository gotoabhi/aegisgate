terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# Generate unique suffix to avoid S3 bucket naming collisions globally
resource "random_id" "bucket_suffix" {
  byte_length = 4
}

# 1. S3 Compliance Egress Bucket
resource "aws_s3_bucket" "egress_bucket" {
  bucket        = "${var.project_name}-exports-${random_id_bucket_suffix.hex}"
  force_destroy = true

  tags = {
    Name        = "${var.project_name}-exports"
    Environment = "production"
    Compliance  = "HIPAA-DPDP"
  }
}

# 2. Block All Public Access (Strict Security Baseline)
resource "aws_s3_bucket_public_access_block" "egress_bucket_block" {
  bucket = aws_s3_bucket.egress_bucket.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# 3. Server-Side Encryption (SSE-S3 AES-256: Free Tier Eligible)
resource "aws_s3_bucket_server_side_encryption_configuration" "egress_encryption" {
  bucket = aws_s3_bucket.egress_bucket.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# 4. Lifecycle Rule (Data Retention & Minimization Principle)
resource "aws_s3_bucket_lifecycle_configuration" "retention_policy" {
  bucket = aws_s3_bucket.egress_bucket.id

  rule {
    id     = "auto-delete-old-exports"
    status = "Enabled"

    filter {
      prefix = "exports/"
    }

    expiration {
      days = var.retention_days
    }
  }
}

# 5. Application Least-Privilege IAM User & Access Keys
resource "aws_iam_user" "app_user" {
  name = "${var.project_name}-api-user"

  tags = {
    Application = var.project_name
  }
}

resource "aws_iam_access_key" "app_user_key" {
  user = aws_iam_user.app_user.name
}

# 6. Scoped IAM Policy
resource "aws_iam_user_policy" "s3_access_policy" {
  name = "${var.project_name}-s3-policy"
  user = aws_iam_user.app_user.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowObjectOperations"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject"
        ]
        Resource = "${aws_s3_bucket.egress_bucket.arn}/exports/*"
      },
      {
        Sid    = "AllowBucketListing"
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = aws_s3_bucket.egress_bucket.arn
      }
    ]
  })
}