variable "aws_region" {
  description = "AWS region for provisioning resources"
  type        = string
  default     = "ap-south-1"
}

variable "project_name" {
  description = "Project identifier tag"
  type        = string
  default     = "aegisgate"
}

variable "retention_days" {
  description = "Number of days before clinical export bundles expire"
  type        = number
  default     = 30
}