# Production Operations Runbook: Incident Management & Disaster Recovery

**Document Identifier:** MV-DOC-03 | **Version:** 4.0 | **Classification:** Operational Runbook

## 1. Incident Severity Definitions

Incidents are classified into four tiers: Sev-1 (Complete cluster degradation or data unavailability), Sev-2 (Major performance degradation exceeding SLA), Sev-3 (Non-blocking component failure), and Sev-4 (Inquiry). Tier-1 on-call manages Sev-1 triage and coordinates emergency operational response.

## 2. Disaster Recovery Objectives and Failover Triggers

Disaster Recovery Target: Recovery Point Objective (RPO) < 1 minute; Recovery Time Objective (RTO) < 15 minutes. Automatic primary failover engages when replica lag exceeds 5000ms. If primary database becomes unresponsive, health probes initiate automatic promotion of the hot standby replica.

## 3. Service Level Agreements (SLAs)

SLA mandates p99 retrieval latency < 150ms and initial token dispatched < 2000ms. If retrieval exceeds the 150ms boundary, alerts trigger priority auto-scaling.

## 4. Ingestion Pipeline Queues and Dead-Letter Policies

Queue timeout triggers 3 retries then DLQ. Status COMPLETED triggers NotificationService WebSocket and schedules GraphExtractionTask for background entity resolution.
