export default {
  async fetch(request, env) {

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    /* ---------- CORS ---------- */
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    /* ---------- Health Check ---------- */
    if (request.method !== "POST") {
      return new Response("OK", { headers: corsHeaders });
    }

    try {
      /* ---------- Safe JSON ---------- */
      let body = {};
      try {
        body = await request.json();
      } catch {}

      const prompt = body.prompt || "";

      /* ---------- Gemini 1.5 Pro ---------- */
      const mainAI = await callGemini(
        "gemini-1.5-pro",
        prompt,
        env.GEMINI_API_KEY
      );

      if (mainAI) {
        return jsonResponse({
          ok: true,
          source: "GEMINI-1.5-PRO",
          type: "TEXT",
          text: mainAI
        }, corsHeaders);
      }

      /* ---------- Gemini 1.5 Flash ---------- */
      const fallbackAI = await callGemini(
        "gemini-1.5-flash",
        prompt,
        env.GEMINI_API_KEY
      );

      if (fallbackAI) {
        return jsonResponse({
          ok: true,
          source: "GEMINI-1.5-FLASH",
          type: "TEXT",
          text: fallbackAI
        }, corsHeaders);
      }

      /* ---------- Mock AI ---------- */
      const mock = generateMockExamEvaluation(prompt);

      return jsonResponse({
        ok: true,
        source: "MOCK-AI",
        type: "JSON",
