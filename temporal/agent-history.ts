/** Derive activity attempts from Temporal's retained history, never worker logs.
 * Intermediate retries are compacted: the terminal ActivityTaskStarted event's
 * attempt is authoritative, rather than a count of ActivityTaskFailed events.
 */
export function summarizeAgentHistory(history: { events?: any[] }) {
  const events = history.events ?? [];
  const scheduled = new Map<string, { id: string; type: string }>();
  const activities: Record<
    string,
    {
      scheduled: number;
      completed: number;
      failed: number;
      attempts: number;
      retries: number;
      scheduledEventIds: string[];
      completedEventIds: string[];
      lastFailures: unknown[];
    }
  > = {};
  for (const event of events) {
    const a = event.activityTaskScheduledEventAttributes;
    if (!a) continue;
    const type = String(a.activityType?.name ?? "unknown");
    scheduled.set(String(event.eventId), { id: String(a.activityId), type });
    const value = (activities[type] ??= {
      scheduled: 0,
      completed: 0,
      failed: 0,
      attempts: 0,
      retries: 0,
      scheduledEventIds: [],
      completedEventIds: [],
      lastFailures: [],
    });
    value.scheduled++;
    value.scheduledEventIds.push(String(event.eventId));
  }
  for (const event of events) {
    const started = event.activityTaskStartedEventAttributes;
    const completed = event.activityTaskCompletedEventAttributes;
    const failed =
      event.activityTaskFailedEventAttributes ??
      event.activityTaskTimedOutEventAttributes;
    const attribute = started ?? completed ?? failed;
    if (!attribute) continue;
    const item = scheduled.get(String(attribute.scheduledEventId));
    if (!item)
      throw new Error("Activity history references an absent scheduled event.");
    const value = activities[item.type];
    if (started) {
      const attempt = Number(started.attempt ?? 1);
      if (!Number.isSafeInteger(attempt) || attempt < 1)
        throw new Error("Invalid history attempt count.");
      value.attempts += attempt;
      value.retries += attempt - 1;
      if (started.lastFailure) value.lastFailures.push(started.lastFailure);
    }
    if (completed) {
      value.completed++;
      value.completedEventIds.push(String(event.eventId));
    }
    if (failed) value.failed++;
  }
  const terminal = [...events]
    .reverse()
    .find(
      (event) =>
        event.workflowExecutionCompletedEventAttributes ||
        event.workflowExecutionFailedEventAttributes ||
        event.workflowExecutionTimedOutEventAttributes ||
        event.workflowExecutionCanceledEventAttributes ||
        event.workflowExecutionTerminatedEventAttributes,
    );
  const status = terminal?.workflowExecutionCompletedEventAttributes
    ? "completed"
    : terminal
      ? "failed"
      : "running";
  return {
    status,
    activities,
    eventCount: events.length,
    terminalEventId: terminal ? String(terminal.eventId) : null,
  };
}
