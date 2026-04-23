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

      // 🔵 ลองเรียก Gemini ก่อน
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
              contents: [{ parts: [{ text: prompt }] }]
            })
          }
        );

        const data = await resp.json();

        if (resp.ok) {
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

          if (text && text.trim()) {
            return new Response(JSON.stringify({
              ok: true,
              text: text,
              source: "AI"
            }), {
              headers: {
                "Content-Type": "application/json",
                ...corsHeaders
              }
            });
          }
        }

      } catch (e) {
        // ignore → ไป fallback
      }

      // 🔴 Fallback Mock AI (ฟรี 100%)
      const mock = generateMockResult();

      return new Response(JSON.stringify({
        ok: true,
        text: JSON.stringify(mock),
        source: "MOCK"
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

// 🔥 Mock AI Generator
function generateMockResult() {
  function rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  const prompt = rand(15, 25);
  const application = rand(10, 20);
  const analysis = rand(20, 40);
  const impact = rand(5, 15);

  const total = prompt + application + analysis + impact;

  let level = "ต้องพัฒนา";
  let levelEn = "Needs Improvement";
  let emoji = "🔴";

  if (total >= 90) {
    level = "ดีเยี่ยม";
    levelEn = "Excellent";
    emoji = "🏆";
  } else if (total >= 75) {
    level = "ดี";
    levelEn = "Good";
    emoji = "🟢";
  } else if (total >= 60) {
    level = "พอใช้";
    levelEn = "Satisfactory";
    emoji = "🟡";
  }

  return {
    totalScore: total,
    level,
    levelEn,
    emoji,
    summary: "ระบบประเมินอัตโนมัติ (Mock AI) ใช้เมื่อ AI จริงไม่พร้อมใช้งาน",
    dimensions: {
      prompt,
      application,
      analysis,
      impact
    },
    questions: [
      { num: 1, score: prompt, maxScore: 25, feedback: "ควรพัฒนา Prompt ให้ชัดเจนขึ้น" },
      { num: 2, score: application, maxScore: 20, feedback: "มีแนวคิดที่ดีในการใช้ AI" },
      { num: 3, score: analysis, maxScore: 20, feedback: "วิเคราะห์ได้ดีในระดับหนึ่ง" },
      { num: 4, score: analysis, maxScore: 20, feedback: "มี logic แต่ยังไม่ลึกพอ" },
      { num: 5, score: impact, maxScore: 15, feedback: "เข้าใจ Business Impact เบื้องต้น" }
    ],
    strengths: "มีความเข้าใจพื้นฐานด้าน AI",
    improvements: "ควรเพิ่มความแม่นยำและความลึกของการวิเคราะห์"
  };
}
