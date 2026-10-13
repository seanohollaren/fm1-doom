import * as cdk from 'aws-cdk-lib/core';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';
// the counter's name and its events, shared with the function (functions/count.js) and the page (a test checks both)
import count from '../../install-count.json';

/** what each event is called as a metric, and on the dashboard, in the order a visitor meets them */
const METRICS: Record<string, { metric: string; label: string }> = {
  visit: { metric: 'PageVisits', label: 'Opened the page' },
  file: { metric: 'GameFileReady', label: 'Game file ready' },
  connect: { metric: 'DeviceFound', label: 'FM-1 found' },
  start: { metric: 'InstallsStarted', label: 'Install started' },
  done: { metric: 'InstallsFinished', label: 'Install finished' },
  fail: { metric: 'InstallsFailed', label: 'Install failed' },
};
const NAMESPACE = 'DoomSite/Installer';
const DASHBOARD = 'doom-site-installs';

/**
 * Counts how far visitors get through the installer. The page reports each step to a CloudFront Function
 * (frontend-stack.ts), which only writes a log line; CloudFront keeps function logs in us-east-1 whatever region
 * the rest is in, so the log group, the metrics made from it and the dashboard live here.
 */
export class TelemetryStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    // CloudFront writes to exactly this name, and would make the group itself (kept for ever) if it were missing:
    // this stack is deployed before the function exists (bin/infra.ts)
    const logGroup = new logs.LogGroup(this, 'CountLog', {
      logGroupName: `/aws/cloudfront/function/${count.functionName}`,
      retention: logs.RetentionDays.THIRTEEN_MONTHS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const day = cdk.Duration.days(1);
    const metric: Record<string, cloudwatch.Metric> = {};
    for (const event of count.events) {
      const { metric: metricName, label } = METRICS[event];
      new logs.MetricFilter(this, `Count${metricName}`, {
        logGroup,
        filterPattern: logs.FilterPattern.allTerms(count.marker + event),
        metricNamespace: NAMESPACE,
        metricName,
        metricValue: '1',
        defaultValue: 0,
      });
      metric[event] = new cloudwatch.Metric({ namespace: NAMESPACE, metricName, statistic: cloudwatch.Stats.SUM, period: day, label });
    }
    const finishedShare = new cloudwatch.MathExpression({
      expression: '100 * finished / started',
      usingMetrics: { finished: metric.done, started: metric.start },
      label: 'Finished, % of started',
      period: day,
    });

    // every line the function writes, taken apart (the same shape functions/count.js writes; a test checks)
    const parse = String.raw`parse @message /${count.marker}(?<evt>[a-z]+) fw=(?<fw>\S+) had=(?<had>\S+) stage=(?<stage>\S+) sid=(?<sid>\S+)/`;
    const query = (title: string, lines: string[], width: number) =>
      new cloudwatch.LogQueryWidget({
        title,
        logGroupNames: [logGroup.logGroupName],
        view: cloudwatch.LogQueryVisualizationType.TABLE,
        queryLines: [`filter @message like /${count.marker}/`, parse, ...lines],
        width,
        height: 7,
      });

    const dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: DASHBOARD,
      defaultInterval: cdk.Duration.days(30),
    });
    dashboard.addWidgets(
      new cloudwatch.SingleValueWidget({
        title: 'How far visitors got, over the whole time range',
        metrics: [...count.events.map((e) => metric[e]), finishedShare],
        setPeriodToTimeRange: true,
        width: 24,
        height: 4,
      }),
    );
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Installs per day',
        left: [metric.start, metric.done, metric.fail],
        leftYAxis: { min: 0, showUnits: false },
        width: 12,
        height: 7,
      }),
      new cloudwatch.GraphWidget({
        title: 'Every step, per day',
        left: count.events.map((e) => metric[e]),
        leftYAxis: { min: 0, showUnits: false },
        width: 12,
        height: 7,
      }),
    );
    dashboard.addWidgets(
      // a visit is one load of the page (its random number, sid): someone who retries is counted once here
      query('How far visits got (one visit = one load of the page)', ['stats count_distinct(sid) as visits, count(*) as events by evt', 'sort visits desc'], 12),
      query('Finished installs, by what the FM-1 ran before', ["filter evt = 'done'", 'stats count(*) as installs by had, fw', 'sort installs desc'], 12),
    );
    dashboard.addWidgets(
      // stage: 1 find the FM-1, 2 write the firmware, 3 send the game data, 4 start the game (web/install.js)
      query('Failed installs, by step and by what the FM-1 ran', ["filter evt = 'fail'", 'stats count(*) as failures by stage, had', 'sort failures desc'], 12),
      query('The last 50 events', ['fields @timestamp, evt, fw, had, stage, sid', 'sort @timestamp desc', 'limit 50'], 12),
    );

    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards/dashboard/${DASHBOARD}`,
    });
  }
}
