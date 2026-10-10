#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { CertificateStack } from '../lib/certificate-stack';
import { FrontendStack } from '../lib/frontend-stack';

const app = new cdk.App();

const account = '514220683169';
const hostedZoneName = 'deadlockinteractive.com';
const domainName = 'doom.deadlockinteractive.com';

// CloudFront only takes certificates from us-east-1; everything else lives in us-west-2 with the other sites.
const cert = new CertificateStack(app, 'DoomSiteCertStack', {
  env: { account, region: 'us-east-1' },
  crossRegionReferences: true,
  domainName,
  hostedZoneName,
});

new FrontendStack(app, 'DoomSiteFrontendStack', {
  env: { account, region: 'us-west-2' },
  crossRegionReferences: true,
  certificate: cert.certificate,
  domainName,
  hostedZoneName,
});

app.synth();
