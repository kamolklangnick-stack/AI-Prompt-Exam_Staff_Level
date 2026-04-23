export default {
  async fetch(request, env) {

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    // ✅ CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // ✅ Health check
    if (request.method !== "POST") {
      return new Response("OK", { headers: corsHeaders });
    }

    try {
      // ✅ ป้องกัน JSON body ว่าง
      let body = {};
      try {
        body = await request.json();
      } catch {}

      const prompt = body.prompt || "";

      // ✅ Primary: Gemini 1.5 Pro
      const mainAI = await callGemini(
        "gemini-1.5-pro",
        prompt,
        env.GEMINI_API_KEY
      );

      if (mainAI) {
        return jsonResponse({
          ok: true,
          source: "GEMINI-1.5-PRO",
          text: mainAI
        }, corsHeaders);
      }

      // ✅ Fallback: Gemini 1.5 Flash
      const backupAI = await callGemini(
        "gemini-1.5-flash",
        prompt,
