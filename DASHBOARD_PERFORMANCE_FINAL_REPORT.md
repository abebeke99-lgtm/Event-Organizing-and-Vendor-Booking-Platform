# Dashboard Performance Final Report

## Isolated-Neon single-run measurements

| Dashboard bundle | Sample time | Existing integration bound |
|---|---:|---:|
| Organizer: overview, events, vendors, bookings | 4.12s | Under 15s |
| Customer: overview, vendors, services, bookings, events, messages, notifications | 2.68s | Under 15s |
| Vendor overview: overview, booking requests, services, notifications | 0.81s | Under 15s |

All three bundles passed the existing integration assertion. Thirteen additional vendor pages were tested separately; their concurrent request timings are not included in the vendor overview measurement.

## Decision

The target of p95 below 2 seconds is **not established**. The organizer and customer samples exceed 2 seconds, and the sample size is insufficient to calculate p95. Do not infer production performance from this isolated test.

## Follow-up

Collect repeated measurements using representative isolated test data and record request, pool-wait, and query timings separately. Do not increase pool limits or add indexes without measured evidence and Neon capacity review. The previous 18.2-second outlier remains unexplained.
