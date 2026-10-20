# AWS EKS — the control plane alone is a flat $73/mo regardless of node
# count, a frequently-surprising line item on real bills.

resource "aws_eks_cluster" "main" {
  name     = "acme-eks-main"
  role_arn = "arn:aws:iam::123456789012:role/eks-cluster-role"

  tags = {
    Name = "acme-eks-main"
  }
}
