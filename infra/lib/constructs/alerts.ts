import { Construct } from "constructs";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as ce from "aws-cdk-lib/aws-ce";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";

/**
 * Operational + cost alerting fan-in for the stack.
 *
 * Three responsibilities:
 *
 *  1. **SNS alert topic** (`topic`) — the single destination for the stack's
 *     CloudWatch alarm actions (Lambda errors, DLQ depth, AI failures,
 *     prompt-fallback, invocation flooding). One email subscription per
 *     `operationalEmails` entry delivers to the operators. Each construct takes
 *     the topic via an optional `alarmTopic` prop, so omitting it leaves the
 *     alarm console-only (the behavior in unit tests that don't pass a topic).
 *     NOTE: SNS email subscriptions require the recipient to click a one-time
 *     confirmation link before delivery starts.
 *
 *  2. **AWS Budget** (§4.1) — AWS-level cost visibility the app-level brakes
 *     (`AI_KILL_SWITCH` / `AI_GLOBAL_DAILY_CAP`) can't provide: they can't stop
 *     a runaway Lambda loop, an S3 misconfig, or invocation flooding of the
 *     open Function URL. A monthly cost budget emails at 80% / 100% actual and
 *     100% forecasted.
 *
 *  3. **Cost Anomaly Detection** — ML-based detection of sudden cost spikes the
 *     fixed budget thresholds miss (a stuck generation job, a leaked key). A
 *     SERVICE-dimension monitor watches every AWS service and a DAILY
 *     subscription emails when an anomaly's total cost impact crosses a USD
 *     floor.
 *
 *     Both the budget and the anomaly monitor are **account-global**, not
 *     region- or stack-scoped (unlike a `AWS/Billing EstimatedCharges`
 *     CloudWatch alarm, which only exists in us-east-1 — these stacks deploy to
 *     eu-central-1). So both are gated to a single stack via
 *     `createCostMonitoring` (prod only) to avoid two copies double-counting the
 *     same account spend. Budgets / Cost Explorer deliver email directly, so —
 *     unlike SNS — the `billingEmails` recipients need no confirmation step.
 */
export interface AlertsConstructProps {
  envName: "prod" | "dev";
  /**
   * Emails subscribed to the SNS alarm topic (operational CloudWatch alarms).
   * Each recipient must accept a one-time SNS confirmation email before
   * delivery starts.
   */
  operationalEmails: string[];
  /**
   * Emails for account-wide cost alerts (monthly budget + anomaly detection).
   * Delivered directly by AWS Budgets / Cost Explorer — no confirmation step.
   * Only used when `createCostMonitoring` is true.
   */
  billingEmails: string[];
  /**
   * Create the account-wide cost monitoring (budget + anomaly detection) on
   * this stack. Set true on exactly ONE stack (prod) — these track total
   * account cost, so a second copy would double-count.
   */
  createCostMonitoring: boolean;
  /** Monthly cost budget ceiling in USD. Defaults to 50. */
  monthlyBudgetUsd?: number;
  /**
   * Minimum anomaly total cost impact (USD) that triggers an anomaly alert.
   * Defaults to 10 — above the normal ~$8/mo noise floor, low enough to catch a
   * runaway loop within a day.
   */
  anomalyImpactThresholdUsd?: number;
}

export class AlertsConstruct extends Construct {
  public readonly topic: sns.Topic;

  constructor(scope: Construct, id: string, props: AlertsConstructProps) {
    super(scope, id);

    this.topic = new sns.Topic(this, "AlertsTopic", {
      displayName: `language-drill ${props.envName} alerts`,
    });
    for (const email of props.operationalEmails) {
      this.topic.addSubscription(new subscriptions.EmailSubscription(email));
    }

    if (props.createCostMonitoring) {
      this.createBudget(props);
      this.createAnomalyDetection(props);
    }
  }

  /** Account-wide monthly cost budget: emails at 80%/100% actual, 100% forecast. */
  private createBudget(props: AlertsConstructProps): void {
    const amount = props.monthlyBudgetUsd ?? 50;
    const subscribers = props.billingEmails.map((address) => ({
      subscriptionType: "EMAIL",
      address,
    }));
    new budgets.CfnBudget(this, "MonthlyCostBudget", {
      budget: {
        budgetName: `language-drill-${props.envName}-monthly`,
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount, unit: "USD" },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            notificationType: "ACTUAL",
            comparisonOperator: "GREATER_THAN",
            threshold: 80,
            thresholdType: "PERCENTAGE",
          },
          subscribers,
        },
        {
          notification: {
            notificationType: "ACTUAL",
            comparisonOperator: "GREATER_THAN",
            threshold: 100,
            thresholdType: "PERCENTAGE",
          },
          subscribers,
        },
        {
          notification: {
            notificationType: "FORECASTED",
            comparisonOperator: "GREATER_THAN",
            threshold: 100,
            thresholdType: "PERCENTAGE",
          },
          subscribers,
        },
      ],
    });
  }

  /** ML-based cost-spike detection across all AWS services. */
  private createAnomalyDetection(props: AlertsConstructProps): void {
    const monitor = new ce.CfnAnomalyMonitor(this, "CostAnomalyMonitor", {
      monitorName: `language-drill-${props.envName}-services`,
      monitorType: "DIMENSIONAL",
      monitorDimension: "SERVICE",
    });

    const threshold = props.anomalyImpactThresholdUsd ?? 10;
    // EMAIL subscribers require DAILY/WEEKLY frequency (IMMEDIATE is SNS-only).
    // Alert when an anomaly's absolute total cost impact crosses the USD floor.
    new ce.CfnAnomalySubscription(this, "CostAnomalySubscription", {
      subscriptionName: `language-drill-${props.envName}-anomaly`,
      frequency: "DAILY",
      monitorArnList: [monitor.attrMonitorArn],
      thresholdExpression: JSON.stringify({
        Dimensions: {
          Key: "ANOMALY_TOTAL_IMPACT_ABSOLUTE",
          Values: [String(threshold)],
          MatchOptions: ["GREATER_THAN_OR_EQUAL"],
        },
      }),
      subscribers: props.billingEmails.map((address) => ({
        type: "EMAIL",
        address,
      })),
    });
  }
}
