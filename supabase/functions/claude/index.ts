// Press Start · fonction « claude » : appelle l'API Anthropic côté serveur.
// La clé reste secrète : elle est lue dans les secrets Supabase (ANTHROPIC_API_KEY).
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { prompt, json, tier } = await req.json();
    if (!prompt || typeof prompt !== "string") {
      return new Response(JSON.stringify({ error: "prompt manquant" }), { status: 400, headers: { ...CORS, "content-type": "application/json" } });
    }
    const model = tier === "fast"
      ? (Deno.env.get("ANTHROPIC_MODEL_FAST") ?? "claude-haiku-5-5")
      : (Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5-5");
    const content = json ? prompt + "\n\nRéponds uniquement avec un JSON valide, sans aucun texte autour." : prompt;
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model, max_tokens: 2000, messages: [{ role: "user", content }] }),
    });
    const d = await r.json();
    if (!r.ok) {
      return new Response(JSON.stringify({ error: d?.error?.message ?? "erreur API" }), { status: 502, headers: { ...CORS, "content-type": "application/json" } });
    }
    const text = (d.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
    return new Response(JSON.stringify({ text }), { headers: { ...CORS, "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...CORS, "content-type": "application/json" } });
  }
});
