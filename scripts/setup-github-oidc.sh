#!/usr/bin/env bash
# One-time setup of the IAM role that GitHub Actions assumes via OIDC to deploy the site (site/infra).
# Run with admin credentials and a logged-in gh:   ./scripts/setup-github-oidc.sh
# Safe to run again: it updates the trust policy and the permissions in place.
set -euo pipefail

ACCOUNT_ID="514220683169"
ROLE_NAME="github-actions-deploy-fm1-doom"
REPO="seanohollaren/fm1-doom"
# the site's stacks live in two regions: the certificate in us-east-1 (CloudFront's rule), the rest in us-west-2
REGIONS=("us-east-1" "us-west-2")

OIDC_PROVIDER_ARN="arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"

if ! aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_PROVIDER_ARN" > /dev/null 2>&1; then
  echo "Creating GitHub OIDC provider..."
  aws iam create-open-id-connect-provider \
    --url "https://token.actions.githubusercontent.com" \
    --client-id-list "sts.amazonaws.com" \
    --thumbprint-list "6938fd4d98bab03faadb97b34396831e3780aea1"
fi

# What the token's "sub" claim starts with. Older repositories say repo:owner/name; newer ones use an immutable
# form with numeric ids (repo:owner@id/name@id). Ask GitHub which this repository uses rather than guess.
SUB_PREFIX=$(gh api "repos/${REPO}/actions/oidc/customization/sub" --jq '.sub_claim_prefix // empty' 2>/dev/null || true)
if [ -z "$SUB_PREFIX" ]; then
  SUB_PREFIX="repo:${REPO}"
  echo "GitHub reports no custom subject prefix for ${REPO}; using ${SUB_PREFIX}"
fi
echo "Trusting tokens whose subject starts with: ${SUB_PREFIX}:"

TRUST_POLICY=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Federated": "${OIDC_PROVIDER_ARN}" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
        "StringLike": { "token.actions.githubusercontent.com:sub": "${SUB_PREFIX}:*" }
      }
    }
  ]
}
JSON
)

# The role itself stays small: CDK deploys everything (bucket, files, CloudFront, DNS record, certificate) through
# its bootstrap roles, so the GitHub role only needs to assume those, in both regions, and read the stack outputs.
BOOTSTRAP_ROLES=$(printf '"arn:aws:iam::%s:role/cdk-hnb659fds-*-%s-%s",' $(for r in "${REGIONS[@]}"; do echo "$ACCOUNT_ID" "$ACCOUNT_ID" "$r"; done))
PERMISSIONS_POLICY=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CdkAssumeBootstrapRoles",
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": [${BOOTSTRAP_ROLES%,}]
    },
    {
      "Sid": "ReadStackOutputs",
      "Effect": "Allow",
      "Action": "cloudformation:DescribeStacks",
      "Resource": "*"
    }
  ]
}
JSON
)

if aws iam get-role --role-name "$ROLE_NAME" > /dev/null 2>&1; then
  echo "Updating trust policy on existing role ${ROLE_NAME}..."
  aws iam update-assume-role-policy --role-name "$ROLE_NAME" --policy-document "$TRUST_POLICY"
else
  echo "Creating role ${ROLE_NAME}..."
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --description "GitHub Actions OIDC deploy role for ${REPO}" \
    --assume-role-policy-document "$TRUST_POLICY"
fi

echo "Attaching permissions policy..."
aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "deploy" \
  --policy-document "$PERMISSIONS_POLICY"

echo "Done. Role ARN: arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"
