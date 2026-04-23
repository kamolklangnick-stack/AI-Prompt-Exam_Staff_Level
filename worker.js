/************************************************************
 * Cloudflare Worker – AI Exam Grader (Gemini + Mock)
 * ✅ Safe JSON handling
 * ✅ Stable Gemini calling
 * ✅ Real fallback Mock AI
 * ✅ No undefined function
 ************************************************************/

export default {
  async fetch(request, env) {

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    /* -------------------- CORS -------------------- */
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    /* ---------------- Health Check ---------------- */
    if (request.method !== "POST") {
      return new Response("OK", { headers: corsHeaders });
    }

    try {
      /* -------- Safe JSON Parsing (สำคัญมาก) ------- */
      let body = {};
      try {
        body = await request.json();
      } catch {
        body = {};
      }

      const prompt = body.prompt || "";

      /* -------- Primary AI : Gemini 1.5 Pro -------- */
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

      /* -------- Fallback AI : Gemini 1.5 Flash ----- */
      const backupAI = await callGemini(
        "gemini-1.5-flash",
        prompt,
        env.GEMINI_API_KEY
      );

      if (backupAI) {
        return jsonResponse({
          ok: true,
          source: "GEMINI-1.5-FLASH",
          text: backupAI
        }, corsHeaders);
      }

      /* -------- Final Fallback : Mock AI ----------- */
      const mockResult = generateMockExamEvaluation(prompt);

      return jsonResponse({
        ok: true,
        source: "MOCK-AI",
        text: mockResult
      }, corsHeaders);

    } catch (err) {
      return jsonResponse({
        ok: false,
        error: err.message
      }, corsHeaders, 500);
    }
  }
};

/* ======================================================
 * Gemini API Caller
 * ====================================================== */
async function callGemini(model, prompt, apiKey) {
  try {
    if (!apiKey) return null;

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      }
    );

    if (!resp.ok) return null;

    const data = await resp.json();

    return data?.candidates?.[0]?.content?.parts
      ?.map(p => p.text)
      ?.join("") || null;

  } catch {
    return null;
  }
}

/* ======================================================
 * Mock AI – HR + AI Literacy Exam (5 Questions)
 * ====================================================== */
function generateMockExamEvaluation(answer = "") {

  const criteria = [
    {
      name: "Prompt Writing (Performance Appraisal)",
      max: 25,
      keywords: ["context", "performance", "evaluation", "format", "hr"],
      good: "Prompt มีโครงสร้างดี ระบุบริบท เป้าหมาย และรูปแบบผลลัพธ์",
      improve: "ควรเพิ่มเงื่อนไขพิเศษ เช่น KPI หรือระดับพนักงาน"
    },
    {
      name: "Application (Recruitment)",
      max: 20,
      keywords: ["recruitment", "screening", "sourcing", "interview"],
      good: "อธิบายการใช้ AI ในกระบวนการสรรหาได้ครบหลายขั้นตอน",
      improve: "ควรอธิบายการประหยัดเวลาและประสิทธิภาพให้ชัดขึ้น"
    },
    {
      name: "Analysis (Prompt Improvement)",
      max: 20,
      keywords: ["analyze", "data", "goal", "output"],
      good: "มีการเพิ่ม Context เป้าหมาย และข้อมูลที่ชัดเจน",
      improve: "ควรกำหนดรูปแบบ Output เช่น ตาราง หรือ Insight"
    },
    {
      name: "Analysis (Turnover)",
      max: 20,
      keywords: ["turnover", "cause", "trend", "retention"],
      good: "วิเคราะห์ปัญหาเป็นขั้นตอนตั้งแต่ข้อมูลถึงแนวทางแก้ไข",
      improve: "ควรเชื่อมโยงข้อมูลเชิงตัวเลขมากขึ้น"
    },
    {
      name: "Business Impact & Ethics",
      max: 15,
      keywords: ["risk", "ethics", "privacy", "bias"],
      good: "พิจารณาความเสี่ยง จริยธรรม และข้อมูลส่วนบุคคลได้ดี",
      improve: "ควรยกตัวอย่างผลกระทบในองค์กรจริง"
    }
  ];

  let totalScore = 0;
  const breakdown = [];
  const text = answer.toLowerCase();

  for (const c of criteria) {
    const hits = c.keywords.filter(k => text.includes(k)).length;
    const score = Math.min(
      c.max,
      Math.round((hits / c.keywords.length) * c.max)
    );

    totalScore += score;

    breakdown.push({
      question: c.name,
      score,
      maxScore: c.max,
      feedback: score >= c.max * 0.6 ? c.good : c.improve
    });
  }

  return {
    totalScore,
    grade:
      totalScore >= 80 ? "A" :
      totalScore >= 70 ? "B" :
      totalScore >= 60 ? "C" : "D",
    breakdown,
    overallFeedback:
      totalScore >= 80
        ? "ผู้สอบมีความพร้อมในการใช้ AI ในงาน HR ระดับมืออาชีพ"
        : "ควรพัฒนาทักษะการเขียน Prompt และการวิเคราะห์เชิงกลยุทธ์เพิ่มเติม"
  };
}

/* ======================================================
 * JSON Response Helper
 * ====================================================== */
function jsonResponse(data, headers, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers
    }
  });
}
``
