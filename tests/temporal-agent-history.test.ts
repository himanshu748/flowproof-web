import { describe, expect, it } from "vitest";
import { summarizeAgentHistory } from "../temporal/agent-history.js";

describe("Temporal event-history attempt accounting", () => {
  it("uses retained attempt numbers when intermediate retries are compacted", () => {
    const history = {
      events: [
        {
          eventId: "5",
          activityTaskScheduledEventAttributes: {
            activityId: "gemma-select-tools",
            activityType: { name: "selectEvidenceTools" },
          },
        },
        {
          eventId: "6",
          activityTaskStartedEventAttributes: {
            scheduledEventId: "5",
            attempt: 2,
            lastFailure: {
              applicationFailureInfo: {
                type: "EvidenceTransientProviderError",
              },
            },
          },
        },
        {
          eventId: "7",
          activityTaskCompletedEventAttributes: { scheduledEventId: "5" },
        },
        { eventId: "10", workflowExecutionCompletedEventAttributes: {} },
      ],
    };
    const summary = summarizeAgentHistory(history);
    expect(summary.status).toBe("completed");
    expect(summary.activities.selectEvidenceTools).toMatchObject({
      scheduled: 1,
      completed: 1,
      attempts: 2,
      retries: 1,
      completedEventIds: ["7"],
    });
  });
  it("counts a permanent failure without a fabricated completion", () => {
    const summary = summarizeAgentHistory({
      events: [
        {
          eventId: "1",
          activityTaskScheduledEventAttributes: {
            activityId: "gemma",
            activityType: { name: "select" },
          },
        },
        {
          eventId: "2",
          activityTaskStartedEventAttributes: {
            scheduledEventId: "1",
            attempt: 1,
          },
        },
        {
          eventId: "3",
          activityTaskFailedEventAttributes: { scheduledEventId: "1" },
        },
        { eventId: "4", workflowExecutionFailedEventAttributes: {} },
      ],
    });
    expect(summary.status).toBe("failed");
    expect(summary.activities.select).toMatchObject({
      attempts: 1,
      completed: 0,
      failed: 1,
      retries: 0,
    });
  });
  it("rejects orphaned history references and invalid attempt numbers", () => {
    expect(() =>
      summarizeAgentHistory({
        events: [
          {
            activityTaskCompletedEventAttributes: {
              scheduledEventId: "missing",
            },
          },
        ],
      }),
    ).toThrow(/absent/);
    expect(() =>
      summarizeAgentHistory({
        events: [
          {
            eventId: "1",
            activityTaskScheduledEventAttributes: {
              activityType: { name: "select" },
            },
          },
          {
            activityTaskStartedEventAttributes: {
              scheduledEventId: "1",
              attempt: 0,
            },
          },
        ],
      }),
    ).toThrow(/attempt/);
  });
});
