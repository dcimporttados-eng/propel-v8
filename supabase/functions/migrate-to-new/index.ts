// Função TEMPORÁRIA de migração. APAGAR após uso.
// Aplica o dump SQL no novo Supabase usando os secrets NEW_*.
import { Client } from "https://deno.land/x/postgres@v0.19.3/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const adminToken = req.headers.get("x-admin-token");
    const expected = Deno.env.get("MIGRATION_ADMIN_TOKEN");
    if (!adminToken || adminToken !== expected) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const action = new URL(req.url).searchParams.get("action") ?? "info";
    const newUrl = Deno.env.get("NEW_SUPABASE_URL")!;
    const newPwd = Deno.env.get("NEW_SUPABASE_DB_PASSWORD")!;
    // Extract project ref from URL: https://<ref>.supabase.co
    const ref = new URL(newUrl).hostname.split(".")[0];

    // Try direct connection first (port 5432), then pooler (6543)
    const targets = [
      { name: "direct", host: `db.${ref}.supabase.co`, port: 5432, user: "postgres" },
      { name: "pooler-tx", host: `aws-0-us-east-1.pooler.supabase.com`, port: 6543, user: `postgres.${ref}` },
      { name: "pooler-session", host: `aws-0-us-east-1.pooler.supabase.com`, port: 5432, user: `postgres.${ref}` },
    ];

    if (action === "ping") {
      const results: Array<Record<string, unknown>> = [];
      for (const t of targets) {
        try {
          const c = new Client({
            user: t.user, password: newPwd, database: "postgres",
            hostname: t.host, port: t.port, tls: { enabled: true, enforce: false },
          });
          await c.connect();
          const r = await c.queryObject<{ v: string }>("select version() as v");
          await c.end();
          results.push({ target: t.name, ok: true, version: r.rows[0]?.v });
        } catch (e) {
          results.push({ target: t.name, ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      }
      return new Response(JSON.stringify({ ref, results }, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "exec") {
      const { sql, target = "direct" } = await req.json();
      const t = targets.find((x) => x.name === target)!;
      const c = new Client({
        user: t.user, password: newPwd, database: "postgres",
        hostname: t.host, port: t.port, tls: { enabled: true, enforce: false },
      });
      await c.connect();
      try {
        await c.queryArray(sql);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } finally {
        await c.end();
      }
    }

    return new Response(JSON.stringify({ ref, hint: "use ?action=ping or ?action=exec" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});