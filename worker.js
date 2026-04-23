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

    if (request.method === "GET") {
      return new Response(JSON.stringify({ ok: true, message: "Worker is running" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ ok: false, error: "Method Not Allowed" }), {
        status: 405,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      });
    }

    if (!env || !env.GEMINI_API_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "Missing GEMINI_API_KEY secret" }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      });
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
            contents: [
              {
                parts: [{ text: prompt }]
              }
            ],
            generationConfig: {
              temperature: 0.2
            }
          })
        }
      );

      const data = await resp.json();

      if (!resp.ok) {
        return new Response(JSON.stringify({
          ok: false,
          error: "Gemini API error",
          raw: data
        }), {
          status: resp.status,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders
          }
        });
      }

      let text = "";
      if (
        data.candidates &&
        data.candidates[0] &&
        data.candidates[0].content &&
        Array.isArray(data.candidates[0].content.parts)
      ) {
        data.candidates[0].content.parts.forEach(function (p) {
          if (typeof p.text === "string") text += p.text;
        });
      }

      if (!text || !text.trim()) {
        return new Response(JSON.stringify({
          ok: false,
          error: "Gemini returned empty text",
          raw: data
        }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders
          }
        });
      }

      return new Response(JSON.stringify({
        ok: true,
        text: text.trim()
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      });

    } catch (e) {
      return new Response(JSON.stringify({
        ok: false,
        error: e.message || "Unknown error"
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      });
    }
  }
};
