import { Construct } from "constructs";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";

/**
 * Operational alerting fan-in for the stack.
 *
 * Two responsibilities:
 *
 *  1. **SNS alert topic** (`topic`) — the single destination for the stack's
 *     CloudWatch alarm actions. An email subscription delivers to the
 *     operator. The streaming-Lambda invocation flood (§1.2) and
 *     prompt-fallback emergency (§3.2) alarms route here, and so do the
 *     background-pipeline alarms once console-only: the generation,
 *     dictation-audio, and theory-generation queue DLQ-depth alarms plus the
 *     generation / dictation-audio / theory-generation Lambda error alarms
 *     (and the theory cell-failures alarm). Each construct takes the topic via
 *     an optional `alarmTopic` prop, so omitting it leaves the alarm
 *     console-only (the behavior in unit tests that don't pass a topic).
 *
 *  2. **AWS Budget** (§4.1) — AWS-level cost visibility the app-level brakes
 *     (`AI_KILL_SWITCH` / `AI_GLOBAL_DAILY_CAP`) can't provide: they can't stop
 *     a runaway Lambda loop, an S3 misconfig, or invocation flooding of the
 *     open Function URL. A monthly cost budget emails at 80% / 100% actual and
 *     100% forecasted.
 *
 *     Budgets are **account-global**, not region- or stack-scoped (unlike a
 *     `AWS/Billing EstimatedCharges` CloudWatch alarm, which only exists in
 *     us-east-1 — these stacks deploy to eu-central-1). So the budget is gated
 *     to a single stack via `createBudget` (prod only) to avoid two budgets
 *     double-counting the same account spend.
 */
export interface AlertsConstructProps {
  envName: "prod" | "dev";
  /** Email address that receives alarm notifications + budget alerts. */
  alertEmail: string;
  /**
   * Create the account-wide monthly cost budget. Set true on exactly ONE stack
   * (prod) — budgets track total account cost, so a second one would
   * double-count.
   */
  createBudget: boolean;
  /** Monthly cost budget ceiling in USD. Defaults to 50. */
  monthlyBudgetUsd?: number;
}

export class AlertsConstruct extends Construct {
  public readonly topic: sns.Topic;

  constructor(scope: Construct, id: string, props: AlertsConstructProps) {
    super(scope, id);

    this.topic = new sns.Topic(this, "AlertsTopic", {
      displayName: `language-drill ${props.envName} alerts`,
    });
    this.topic.addSubscription(
      new subscriptions.EmailSubscription(props.alertEmail),
    );

    if (props.createBudget) {
      const amount = props.monthlyBudgetUsd ?? 50;
      const subscriber = [
        { subscriptionType: "EMAIL", address: props.alertEmail },
      ];
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
            subscribers: subscriber,
          },
          {
            notification: {
              notificationType: "ACTUAL",
              comparisonOperator: "GREATER_THAN",
              threshold: 100,
              thresholdType: "PERCENTAGE",
            },
            subscribers: subscriber,
          },
          {
            notification: {
              notificationType: "FORECASTED",
              comparisonOperator: "GREATER_THAN",
              threshold: 100,
              thresholdType: "PERCENTAGE",
            },
            subscribers: subscriber,
          },
        ],
      });
    }
  }
}
