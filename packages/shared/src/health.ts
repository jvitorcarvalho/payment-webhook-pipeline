export interface HealthStatus {
  status: 'ok';
}

// Liveness only: the process answers. Dependency checks (database, broker) belong to
// a readiness endpoint, added with the services.
export function healthStatus(): HealthStatus {
  return { status: 'ok' };
}
