export default {
  async fetch(request, env) {

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    // ✅ Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // ✅ Health check
    if (request.method !== "POST") {
      return new Response("OK", { headers: corsHeaders });
    }

    try {
      const body = await request.json();
      const prompt = body.prompt || "";

      // ✅ Primary: Gemini 1.5 Pro (เสถียร)
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
        env.GEMINI_API_KEY
      );

      if (backupAI) {
        return jsonResponse({
          ok: true,
          source: "GEMINI-1.5-FLASH",
          text: backupAI
        }, corsHeaders);
      }

      // 🔴 Final fallback: Mock AI ตรวจข้อสอบ
      const mockResult = generateMockExamEvaluation(prompt);

      return jsonResponse({
        ok: true,
        source: "MOCK-AI",
        text: mockResult
      }, corsHeaders);

    } catch (e) {
      return jsonResponse({
        ok: false,
        error: e.message
      }, corsHeaders, 500);
    }
  }
};

/* -------------------------------------------------- */
/* ✅ Gemini Caller                                   */
/* -------------------------------------------------- */
async function callGemini(model, prompt, apiKey) {
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [
            { parts: [{ text: prompt }] }
          ]
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

/* -------------------------------------------------- */
/* ✅ Mock AI: ตรวจข้อสอบ HR + AI Literacy (5 ข้อ)     */
/* -------------------------------------------------- */
function generateMockExamEvaluation(answer) {

  const criteria = [
    {
      name: "Prompt Writing (Performance Appraisal)",
      max: 25,
      keywords: ["context", "performance", "evaluation", "format", "hr"],
      good: "Prompt มีโครงสร้างดี ระบุบริบท เป้าหมาย และรูปแบบผลลัพธ์",
