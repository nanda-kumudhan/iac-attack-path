terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

# Plan only: fake credentials, no data sources, no refresh, no remote backend.
provider "aws" {
  region                      = "us-east-1"
  access_key                  = "offline-placeholder"
  secret_key                  = "offline-placeholder"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_metadata_api_check     = true
  skip_region_validation     = true
}
variable "public_ingress" {
  type    = bool
  default = false
}
resource "aws_security_group" "web" {
  name   = "offline-example-web"
  vpc_id = "vpc-00000000000000000"
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = var.public_ingress ? ["0.0.0.0/0"] : ["10.0.0.0/8"]
  }
}
resource "aws_iam_role" "web" {
  name = "offline-example-web"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "ec2.amazonaws.com" } }]
  })
}
resource "aws_iam_instance_profile" "web" {
  name = "offline-example-web"
  role = aws_iam_role.web.name
}
resource "aws_iam_role_policy" "read" {
  role = aws_iam_role.web.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "s3:GetObject", Resource = "arn:aws:s3:::offline-example-data/*" }]
  })
}
resource "aws_instance" "web" {
  ami                         = "ami-00000000000000000"
  instance_type               = "t3.micro"
  subnet_id                   = "subnet-00000000000000000"
  associate_public_ip_address = true
  vpc_security_group_ids      = [aws_security_group.web.id]
  iam_instance_profile        = aws_iam_instance_profile.web.name
}
resource "aws_s3_bucket" "data" {
  bucket = "offline-example-data"
}
