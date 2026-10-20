# AWS networking — VPC/subnets are free to declare (no direct cost), but the
# NAT gateways and load balancer they support are two of the most commonly
# forgotten line items on a real AWS bill.

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"

  tags = {
    Name = "acme-main-vpc"
  }
}

resource "aws_subnet" "public" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.1.0/24"
  availability_zone = "us-east-1a"

  tags = {
    Name = "acme-public-subnet"
  }
}

resource "aws_subnet" "private" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.2.0/24"
  availability_zone = "us-east-1b"

  tags = {
    Name = "acme-private-subnet"
  }
}

# One NAT gateway per AZ for high availability — doubles the NAT bill, a very
# common real-world cost surprise worth the dashboard actually surfacing.
resource "aws_nat_gateway" "primary" {
  allocation_id = aws_eip.nat_primary.id
  subnet_id     = aws_subnet.public.id

  tags = {
    Name = "acme-nat-primary"
  }
}

resource "aws_nat_gateway" "secondary" {
  allocation_id = aws_eip.nat_secondary.id
  subnet_id     = aws_subnet.private.id

  tags = {
    Name = "acme-nat-secondary"
  }
}

resource "aws_eip" "nat_primary" {
  domain = "vpc"
}

resource "aws_eip" "nat_secondary" {
  domain = "vpc"
}

resource "aws_lb" "main" {
  name               = "acme-main-alb"
  internal           = false
  load_balancer_type = "application"
  subnets            = [aws_subnet.public.id]

  tags = {
    Name = "acme-main-alb"
  }
}
