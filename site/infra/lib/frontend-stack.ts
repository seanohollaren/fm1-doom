import * as cdk from 'aws-cdk-lib/core';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as path from 'path';
import { Construct } from 'constructs';
// the same headers `vite preview` serves locally (site/frontend/vite.config.ts), so they can be tried before a deploy
import securityHeaders from '../../security-headers.json';

export interface FrontendStackProps extends cdk.StackProps {
  certificate: acm.ICertificate;
  domainName: string;
  hostedZoneName: string;
}

export class FrontendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // The page talks to a device over MIDI and writes its firmware: nothing but its own files may run on it.
    const headers = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      securityHeadersBehavior: {
        contentSecurityPolicy: { contentSecurityPolicy: securityHeaders['Content-Security-Policy'], override: true },
        strictTransportSecurity: { accessControlMaxAge: cdk.Duration.days(365), includeSubdomains: false, override: true },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
      },
      customHeadersBehavior: {
        customHeaders: [{ header: 'Permissions-Policy', value: securityHeaders['Permissions-Policy'], override: true }],
      },
    });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: headers,
        compress: true,
      },
      domainNames: [props.domainName],
      certificate: props.certificate,
      defaultRootObject: 'index.html',
      // No single-page fallback: a missing file (a firmware or converter that failed to upload) must be a 404,
      // not the page's HTML with a 200.
    });

    new s3deploy.BucketDeployment(this, 'DeployFrontend', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../frontend/dist'))],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
      // short: built files carry a hash in their names, and the firmware and converter are fetched by version
      cacheControl: [s3deploy.CacheControl.fromString('public, max-age=300')],
    });

    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: props.hostedZoneName,
    });

    const target = route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution));
    new route53.ARecord(this, 'AliasRecord', { zone: hostedZone, recordName: props.domainName, target });
    new route53.AaaaRecord(this, 'AliasRecordV6', { zone: hostedZone, recordName: props.domainName, target });

    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: distribution.distributionDomainName,
    });
    new cdk.CfnOutput(this, 'SiteUrl', {
      value: `https://${props.domainName}`,
    });
  }
}
