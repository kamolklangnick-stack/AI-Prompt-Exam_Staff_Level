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

      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0.3
        })
      });

      const data = await resp.json();

      let text = "";
      if (data.choices && data.choices[0]) {
        text = data.choices[0].message.content;
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
