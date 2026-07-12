const { DEFAULT_SEC_USER_AGENT, SEC_RATE_LIMIT_MESSAGE, SecClient } = require('../../secClient');

describe('SecClient', () => {
  it('blocks SEC requests when the placeholder user agent is still configured', async () => {
    const http = { get: vi.fn() };
    const cache = { getOrSet: async (_cacheKey, _ttlSeconds, fetcher) => fetcher() };
    const client = new SecClient({
      cache,
      http,
      userAgent: DEFAULT_SEC_USER_AGENT,
    });

    await expect(client.resolveTicker('AAPL')).rejects.toThrow(
      'Set SEC_USER_AGENT to a real application name and contact email before making SEC requests.',
    );
    expect(http.get).not.toHaveBeenCalled();
  });

  it('allows SEC requests when a real user agent is configured', async () => {
    const http = {
      get: vi.fn().mockResolvedValue({
        data: {
          0: {
            ticker: 'AAPL',
            title: 'Apple Inc.',
            cik_str: 320193,
          },
        },
      }),
    };
    const cache = { getOrSet: async (_cacheKey, _ttlSeconds, fetcher) => fetcher() };
    const client = new SecClient({
      cache,
      http,
      userAgent: 'EarningChart/1.0 maintainer@example.com',
    });

    const company = await client.resolveTicker('AAPL');

    expect(company.companyName).toBe('Apple Inc.');
    expect(company.cik).toBe('0000320193');
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it('surfaces SEC rate-threshold responses with a clear retry message', async () => {
    const http = {
      get: vi.fn().mockRejectedValue({
        response: {
          status: 403,
          data: '<title>SEC.gov | Request Rate Threshold Exceeded</title>',
        },
      }),
    };
    const cache = { getOrSet: async (_cacheKey, _ttlSeconds, fetcher) => fetcher() };
    const client = new SecClient({
      cache,
      http,
      userAgent: 'EarningChart/1.0 maintainer@example.com',
    });

    await expect(client.resolveTicker('AAPL')).rejects.toMatchObject({
      message: SEC_RATE_LIMIT_MESSAGE,
      statusCode: 503,
    });
  });
});