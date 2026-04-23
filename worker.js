export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return jsonResponse({ ok: true }, 204, corsHeaders);
    }

    if (request.method === "GET") {
      try {
        if (!env.DB) {
          return jsonResponse({ ok: false, error: "Missing D1 binding: DB" }, 500, corsHeaders);
        }

        const { results } = await env.DB.prepare(`
          SELECT
            id, created_at, fname, lname, dept, company,
            prompt_score, application_score, analysis_score, impact_score,
            total_score, level, levelEn, time_used, is_auto
          FROM results
          ORDER BY id DESC
          LIMIT 200
        `).all();

        return jsonResponse({ ok: true, data: results || [] }, 200, corsHeaders);
      } catch (e) {
        return jsonResponse({ ok: false, error: e.message || "Failed to load records" }, 500, corsHeaders);
      }
    }

    if (request.method !== "POST") {
      return jsonResponse({ ok: false, error: "Method Not Allowed" }, 405, corsHeaders);
    }

    try {
      const body = await request.json();
      const action = String(body.action || "grade");

      // 1) ตรวจคะแนนเท่านั้น — ห้าม save DB ที่นี่
      if (action === "grade") {
        const prompt = String(body.prompt || "");
        const answers = body.answers || {};

        let finalResult = null;
        let source = "MOCK";

        if (env && env.GEMINI_API_KEY && prompt.trim()) {
          try {
            const geminiResp = await fetch(
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

            const geminiData = await geminiResp.json();

            if (geminiResp.ok) {
              let aiText = "";
              if (
                geminiData?.candidates?.[0]?.content?.parts &&
                Array.isArray(geminiData.candidates[0].content.parts)
              ) {
                geminiData.candidates[0].content.parts.forEach((p) => {
                  if (typeof p.text === "string") aiText += p.text;
                });
              }

              if (aiText.trim()) {
                const parsed = safeParseAssessmentJSON(aiText);
                if (isValidAssessmentResult(parsed)) {
                  finalResult = parsed;
                  source = "AI";
                }
              }
            }
          } catch (e) {
            console.log("Gemini error:", e?.message || e);
          }
        }

        if (!isValidAssessmentResult(finalResult)) {
          finalResult = gradeWithStrictMock(answers);
          source = "MOCK";
        }

        return jsonResponse({
          ok: true,
          source,
          text: JSON.stringify(finalResult)
        }, 200, corsHeaders);
      }

      // 2) บันทึกผลลง DB เท่านั้น
      if (action === "save_result") {
        if (!env.DB) {
          return jsonResponse({ ok: false, error: "Missing D1 binding: DB" }, 500, corsHeaders);
        }

        const fname = String(body.fname || "").trim();
        const lname = String(body.lname || "").trim();
        const dept = String(body.dept || "").trim();
        const company = String(body.company || "").trim();

        if (!fname || !lname || !dept || !company) {
          return jsonResponse({ ok: false, error: "Missing required fields" }, 400, corsHeaders);
        }

        await env.DB.prepare(`
          INSERT INTO results (
            fname, lname, dept, company,
            prompt_score, application_score, analysis_score, impact_score,
            total_score, level, levelEn, time_used, is_auto
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          fname,
          lname,
          dept,
          company,
          Number(body.prompt || 0),
          Number(body.application || 0),
          Number(body.analysis || 0),
          Number(body.impact || 0),
          Number(body.totalScore || 0),
          String(body.level || ""),
          String(body.levelEn || ""),
          String(body.timeUsed || ""),
          body.isAuto ? 1 : 0
        ).run();

        return jsonResponse({ ok: true, saved: true }, 200, corsHeaders);
      }

      return jsonResponse({ ok: false, error: "Invalid action" }, 400, corsHeaders);
    } catch (e) {
      return jsonResponse({ ok: false, error: e.message || "Unknown error" }, 500, corsHeaders);
    }
  }
};

function jsonResponse(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders
    }
  });
}
