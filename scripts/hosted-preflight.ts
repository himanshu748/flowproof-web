// A small bounded clock skew is distinct from stale funding. Both bounds apply.
export function freshFunding(checkedAt: string, now = Date.now()) {
  const age = now - Date.parse(checkedAt);
  return Number.isFinite(age) && age >= -5000 && age < 5 * 60_000;
}

// Continue only the known pre-write clock-skew failure. Never replay a write,
// missing response, model request, browser audit or external reservation.
export function readOnlyClockFailure(receipt: any, mode: string) {
  return (
    receipt?.status === "failed" &&
    receipt.mode === mode &&
    receipt.error === "Funding check is not fresh" &&
    receipt.proposedModelRequests === 0 &&
    receipt.judgeRequests === 0 &&
    receipt.calls?.length === 3 &&
    ["/health", "/api/bootstrap", "/api/judge-agent/status"].every(
      (route, i) => {
        const call = receipt.calls[i];
        return (
          call.route === route &&
          call.method === "GET" &&
          call.status === 200 &&
          call.outcome === "response" &&
          call.writeOutcome === "read_only"
        );
      },
    )
  );
}

export function storageFailureBeforeAgent(receipt: any) {
  return (
    receipt?.status === "failed" &&
    receipt.mode === "temporal" &&
    typeof receipt.error === "string" &&
    receipt.error.startsWith("Tiger did not confirm saved source evidence") &&
    receipt.proposedModelRequests === 1 &&
    receipt.judgeRequests === 0 &&
    receipt.calls?.length > 3 &&
    receipt.calls.every(
      (call: any) =>
        !call.route.endsWith("/judge-review") &&
        call.outcome === "response" &&
        [200, 201, 202].includes(call.status),
    ) &&
    receipt.calls.filter((call: any) => call.route.endsWith("/generate-gemma"))
      .length === 1
  );
}
