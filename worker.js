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

    // =========================
    // 🔵 GET → โหลด history จาก D1
    // =========================
    if (request.method === "GET") {
      try {
        if (!env.DB) throw new Error("DB not binding");

        const { results } = await env.DB.prepare(`
          SELECT
            id,
            created_at,
            fname,
            lname,
            dept,
            company,
            prompt_score,
            application_score,
            analysis_score,
            impact_score,
            total_score,
            level,
            levelEn,
            time_used,
            is_auto
          FROM results
          ORDER BY id DESC
          LIMIT 100
        `).all();

        return new Response(JSON.stringify({
          ok: true,
          data: results || []
        }), {
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders
          }
        });

      } catch (e) {
        return new Response(JSON.stringify({
          ok: false,
          error: e.message
        }), { status: 500, headers: corsHeaders });
      }
    }

    // =========================
    // ❌ method อื่น
    // =========================
    if (request.method !== "POST") {
      return new Response(JSON.stringify({
        ok: false,
        error: "Method Not Allowed"
      }), {
        status: 405,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      });
    }

    // =========================
    // 🔴 POST → ตรวจ + บันทึก
    // =========================
    try {
      const body = await request.json();
      const prompt = body.prompt || "";
      const answers = body.answers || {};

      let finalResult = null;

      // =========================
      // 🧠 AI (Gemini)
      // =========================
      if (env && env.GEMINI_API_KEY) {
        try {
          const resp = await fetch(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-goog-api-key": env.GEMINI_API_KEY
              },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.2 }
              })
            }
          );

          const data = await resp.json();

          if (resp.ok) {
            let aiText = "";

            if (
              data.candidates &&
              data.candidates[0]?.content?.parts
            ) {
              data.candidates[0].content.parts.forEach(p => {
                if (p.text) aiText += p.text;
              });
            }

            if (aiText.trim()) {
              try {
                finalResult = JSON.parse(aiText);
              } catch {
                finalResult = null;
              }

              if (finalResult && finalResult.totalScore !== undefined) {
                await saveToDB(env, body, finalResult);
              }

              return new Response(JSON.stringify({
                ok: true,
                source: "AI",
                text: aiText.trim()
              }), {
                headers: {
                  "Content-Type": "application/json",
                  ...corsHeaders
                }
              });
            }
          }
        } catch (e) {
          console.log("Gemini error:", e);
        }
      }

      // =========================
      // 🔥 MOCK fallback
      // =========================
      finalResult = gradeWithStrictMock(answers);

      await saveToDB(env, body, finalResult);

      return new Response(JSON.stringify({
        ok: true,
        source: "MOCK",
        text: JSON.stringify(finalResult)
      }), {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      });

    } catch (e) {
      return new Response(JSON.stringify({
        ok: false,
        error: e.message
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



// =========================
// 🔥 SAVE TO DB
// =========================
async function saveToDB(env, body, result) {
  try {
    await env.DB.prepare(`
      INSERT INTO results (
        fname,
        lname,
        dept,
        company,
        prompt_score,
        application_score,
        analysis_score,
        impact_score,
        total_score,
        level,
        levelEn,
        time_used,
        is_auto
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      body.fname || "",
      body.lname || "",
      body.dept || "",
      body.company || "",
      result.dimensions?.prompt || 0,
      result.dimensions?.application || 0,
      result.dimensions?.analysis || 0,
      result.dimensions?.impact || 0,
      result.totalScore || 0,
      result.level || "",
      result.levelEn || "",
      body.timeUsed || "",
      body.isAuto ? 1 : 0
    ).run();
  } catch (e) {
    console.log("DB ERROR:", e);
  }
}



// =========================
// 🔥 STRICT MOCK AI
// =========================
function gradeWithStrictMock(answers) {
  function rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  const prompt = rand(5, 20);
  const application = rand(5, 15);
  const analysis = rand(10, 30);
  const impact = rand(5, 10);

  const total = prompt + application + analysis + impact;

  return {
    totalScore: total,
    level: total >= 75 ? "ดี" : "ต้องพัฒนา",
    levelEn: total >= 75 ? "Good" : "Needs Improvement",
    dimensions: {
      prompt,
      application,
      analysis,
      impact
    }
  };
}
