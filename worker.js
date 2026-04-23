export default {
  async fetch(request, env) {

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("OK", { headers: corsHeaders });
    }

    try {
      const body = await request.json();
      const prompt = body.prompt || "";

      const resp = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-goog-api-key": env.GEMINI_API_KEY
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
          })
        }
      );

      const data = await resp.json();

      let text = "";

      if (
        data.candidates &&
        data.candidates[0] &&
        data.candidates[0].content &&
        data.candidates[0].content.parts
      ) {
        data.candidates[0].content.parts.forEach(p => {
          if (p.text) text += p.text;
        });
      }

      // 🔥 FIX สำคัญ
      if (!text || !text.trim()) {
        text = JSON.stringify(data); // fallback
      }

      return new Response(JSON.stringify({
        ok: true,
        text: text
      }), {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      });

    } catch (e) {
      return new Response(JSON.stringify({
        ok: false,
        text: "ERROR: " + e.message
      }), {
        status: 500,
        headers: corsHeaders
      });
    }
  }
};
