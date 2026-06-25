type Env = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
};

type PingResult = {
  ok: boolean;
  status: number;
  checkedAt: string;
};

const RESERVAS_PING_PATH = '/rest/v1/reservas?select=id&limit=1';

async function pingSupabase(env: Env): Promise<PingResult> {
  const response = await fetch(`${env.SUPABASE_URL}${RESERVAS_PING_PATH}`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      apikey: env.SUPABASE_ANON_KEY,
      'Cache-Control': 'no-store',
    },
  });

  return {
    ok: response.ok,
    status: response.status,
    checkedAt: new Date().toISOString(),
  };
}

export default {
  async fetch(_request, env) {
    const result = await pingSupabase(env);

    return Response.json(result, {
      status: result.ok ? 200 : 502,
    });
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      pingSupabase(env).then((result) => {
        if (!result.ok) {
          console.error('Supabase keepalive failed', result);
        }
      }),
    );
  },
} satisfies ExportedHandler<Env>;
