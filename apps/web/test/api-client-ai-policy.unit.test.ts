import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchAIPolicyApi,
  updateAIPolicyApi,
} from '../src/lib/catalog-api-client-analysis-actions.js';

const workspaceId = '0192b012-3456-789a-8bcd-ef0123456703';
const policy = {
  workspaceId,
  aiEnabled: true,
  monthlyBudgetMicrounits: 1_000_000,
  currentSpendMicrounits: 10_000,
  reservedSpendMicrounits: 5_000,
  rateLimitPerMinute: 10,
  budgetPeriodStart: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-07T00:00:00Z',
  version: 2,
};

describe('AI policy API client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('loads and validates the current policy', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(policy), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAIPolicyApi(workspaceId)).resolves.toEqual(policy);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/workspaces/${workspaceId}/ai-policy`,
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('updates with the current version in If-Match', async () => {
    const updated = { ...policy, monthlyBudgetMicrounits: 2_000_000, version: 3 };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(updated), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      updateAIPolicyApi(
        workspaceId,
        { aiEnabled: true, monthlyBudgetMicrounits: 2_000_000, rateLimitPerMinute: 10 },
        2,
      ),
    ).resolves.toEqual(updated);

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.method).toBe('PUT');
    expect(request.headers).toMatchObject({ 'If-Match': '"2"' });
    expect(JSON.parse(String(request.body))).toEqual({
      aiEnabled: true,
      monthlyBudgetMicrounits: 2_000_000,
      rateLimitPerMinute: 10,
    });
  });
});
