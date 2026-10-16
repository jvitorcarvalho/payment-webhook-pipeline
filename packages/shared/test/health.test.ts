import { describe, expect, it } from 'vitest';
import { healthStatus } from '../src/health.js';

describe('healthStatus', () => {
  it('reports ok so a load balancer or compose healthcheck can call it', () => {
    expect(healthStatus()).toEqual({ status: 'ok' });
  });
});
