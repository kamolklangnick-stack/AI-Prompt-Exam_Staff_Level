export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    // =========================
    // GET = โหลดประวัติผลการทดสอบจาก D1
    // =========================
    if (request.method === "GET") {
      try {
        if (!env.DB) {
          return jsonResponse({
            ok: false,
            error: "Missing D1 binding: DB"
          }, 500, corsHeaders);
        }

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

        return jsonResponse({
          ok: true,
          data: results || []
        }, 200, corsHeaders);

      } catch (e) {
        return jsonResponse({
          ok: false,
          error: e.message || "Failed to load records"
        }, 500, corsHeaders);
      }
    }

    if (request.method !== "POST") {
      return jsonResponse({
        ok: false,
        error: "Method Not Allowed"
      }, 405, corsHeaders);
    }

    try {
      const body = await request.json();
      const prompt = String(body.prompt || "");
      const answers = body.answers || {};

      let finalResult = null;
      let source = "MOCK";

      // =========================
      // ลองใช้ Gemini ก่อน
      // =========================
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
                generationConfig: {
                  temperature: 0.2
                }
              })
            }
          );

          const geminiData = await geminiResp.json();

          if (geminiResp.ok) {
            let aiText = "";

            if (
              geminiData &&
              geminiData.candidates &&
              geminiData.candidates[0] &&
              geminiData.candidates[0].content &&
              Array.isArray(geminiData.candidates[0].content.parts)
            ) {
              geminiData.candidates[0].content.parts.forEach((p) => {
                if (typeof p.text === "string") aiText += p.text;
              });
            }

            if (aiText && aiText.trim()) {
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

      // =========================
      // ถ้า AI ใช้ไม่ได้ → fallback mock
      // =========================
      if (!isValidAssessmentResult(finalResult)) {
        finalResult = gradeWithStrictMock(answers);
        source = "MOCK";
      }

      // =========================
      // บันทึกลง D1
      // =========================
      await saveToDB(env, body, finalResult, source);

      // ✅ สำคัญ: ส่ง text กลับไปให้ index.html เดิมอ่านได้
      return jsonResponse({
        ok: true,
        source,
        text: JSON.stringify(finalResult)
      }, 200, corsHeaders);

    } catch (e) {
      return jsonResponse({
        ok: false,
        error: e.message || "Unknown error"
      }, 500, corsHeaders);
    }
  }
};

/* =========================
   HELPERS
========================= */

function jsonResponse(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders
    }
  });
}

function safeParseAssessmentJSON(text) {
  try {
    const clean = String(text || "")
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    const j0 = clean.indexOf("{");
    const j1 = clean.lastIndexOf("}");
    if (j0 === -1 || j1 === -1) return null;

    return JSON.parse(clean.slice(j0, j1 + 1));
  } catch {
    return null;
  }
}

function isValidAssessmentResult(obj) {
  return !!(
    obj &&
    typeof obj === "object" &&
    typeof obj.totalScore === "number" &&
    obj.level &&
    obj.levelEn &&
    obj.dimensions &&
    typeof obj.dimensions.prompt === "number" &&
    typeof obj.dimensions.application === "number" &&
    typeof obj.dimensions.analysis === "number" &&
    typeof obj.dimensions.impact === "number"
  );
}

async function saveToDB(env, body, result, source) {
  try {
    if (!env.DB) {
      console.log("DB not found, skip save");
      return;
    }

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
      Number(result?.dimensions?.prompt || 0),
      Number(result?.dimensions?.application || 0),
      Number(result?.dimensions?.analysis || 0),
      Number(result?.dimensions?.impact || 0),
      Number(result?.totalScore || 0),
      result?.level || "",
      result?.levelEn || "",
      body.timeUsed || "",
      body.isAuto ? 1 : 0
    ).run();

    console.log("Saved to DB:", source);
  } catch (e) {
    console.log("DB SAVE ERROR:", e?.message || e);
  }
}

/* =========================
   STRICT MOCK AI
========================= */

function gradeWithStrictMock(answers) {
  const q1 = gradeQ1(answers["1"] || "");
  const q2 = gradeQ2(answers["2"] || "");
  const q3 = gradeQ3(answers["3"] || "");
  const q4 = gradeQ4(answers["4"] || "");
  const q5 = gradeQ5(answers["5"] || "");

  const promptScore = q1.score;
  const applicationScore = q2.score;
  const analysisScore = q3.score + q4.score;
  const impactScore = q5.score;

  const totalScore = promptScore + applicationScore + analysisScore + impactScore;

  let level = "ต้องพัฒนา";
  let levelEn = "Needs Improvement";
  let emoji = "🔴";

  if (totalScore >= 90) {
    level = "ดีเยี่ยม";
    levelEn = "Excellent";
    emoji = "🏆";
  } else if (totalScore >= 75) {
    level = "ดี";
    levelEn = "Good";
    emoji = "🟢";
  } else if (totalScore >= 60) {
    level = "พอใช้";
    levelEn = "Satisfactory";
    emoji = "🟡";
  }

  const strengths = summarizeStrengths([
    { ...q1, maxScore: 25 },
    { ...q2, maxScore: 20 },
    { ...q3, maxScore: 20 },
    { ...q4, maxScore: 20 },
    { ...q5, maxScore: 15 }
  ]);

  const improvements = summarizeImprovements([q1, q2, q3, q4, q5]);

  return {
    totalScore,
    level,
    levelEn,
    emoji,
    summary:
      "ระบบประเมินสำรอง (Mock AI แบบเข้มข้น) ถูกใช้เนื่องจาก AI จริงไม่พร้อมใช้งาน โดยตรวจจากความครบถ้วน ความยาว และคำสำคัญของแต่ละคำตอบ",
    dimensions: {
      prompt: promptScore,
      application: applicationScore,
      analysis: analysisScore,
      impact: impactScore
    },
    questions: [
      { num: 1, score: q1.score, maxScore: 25, feedback: q1.feedback },
      { num: 2, score: q2.score, maxScore: 20, feedback: q2.feedback },
      { num: 3, score: q3.score, maxScore: 20, feedback: q3.feedback },
      { num: 4, score: q4.score, maxScore: 20, feedback: q4.feedback },
      { num: 5, score: q5.score, maxScore: 15, feedback: q5.feedback }
    ],
    strengths,
    improvements
  };
}

function normalize(text) {
  return String(text || "").trim().toLowerCase();
}

function countWords(text) {
  const t = String(text || "").trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

function countChars(text) {
  return String(text || "").trim().length;
}

function includesAny(text, keywords) {
  return keywords.some(k => text.includes(k));
}

function keywordCount(text, keywords) {
  return keywords.filter(k => text.includes(k)).length;
}

function ultraShortPenalty(text, maxCap) {
  const chars = countChars(text);
  if (chars <= 3) return { cap: Math.min(maxCap, 1), reason: "คำตอบสั้นเกินไปมาก" };
  if (chars <= 10) return { cap: Math.min(maxCap, 3), reason: "คำตอบสั้นมาก" };
  if (chars <= 20) return { cap: Math.min(maxCap, 5), reason: "คำตอบสั้นเกินไป" };
  return null;
}

function gradeQ1(answer) {
  const text = normalize(answer);
  const chars = countChars(answer);
  const words = countWords(answer);

  const keywords = [
    "บริบท", "context", "เป้าหมาย", "objective", "รูปแบบ", "format",
    "ประเมิน", "performance", "appraisal", "hr", "staff",
    "เกณฑ์", "คะแนน", "หัวข้อ", "competency", "kpi"
  ];

  let score = 0;
  let notes = [];

  const penalty = ultraShortPenalty(answer, 5);
  if (penalty) {
    return {
      score: penalty.cap,
      feedback: penalty.reason + " ควรเขียน Prompt ให้ครบทั้งบริบท เป้าหมาย รูปแบบผลลัพธ์ และเกณฑ์การประเมิน"
    };
  }

  if (chars >= 40) score += 4; else notes.push("ความยาวยังน้อย");
  if (chars >= 80) score += 4;
  if (words >= 12) score += 3;

  const hit = keywordCount(text, keywords);
  score += Math.min(hit, 8);

  if (includesAny(text, ["บริบท", "context"])) score += 2; else notes.push("ยังไม่ระบุบริบท");
  if (includesAny(text, ["เป้าหมาย", "objective"])) score += 2; else notes.push("ยังไม่ระบุเป้าหมาย");
  if (includesAny(text, ["รูปแบบ", "format", "ตาราง", "table"])) score += 1; else notes.push("ยังไม่ระบุรูปแบบผลลัพธ์");
  if (includesAny(text, ["คะแนน", "เกณฑ์", "kpi", "competency"])) score += 1; else notes.push("ยังไม่ระบุเกณฑ์ประเมิน");

  score = Math.min(score, 25);

  return {
    score,
    feedback: score >= 20
      ? "Prompt ค่อนข้างครบถ้วน มีองค์ประกอบสำคัญของการสั่งงาน AI ชัดเจน"
      : "Prompt ยังไม่ครบถ้วนพอ " + notes.join(" / ")
  };
}

function gradeQ2(answer) {
  const text = normalize(answer);
  const chars = countChars(answer);

  const keywords = [
    "ประกาศงาน", "jd", "job description", "คัดกรอง", "screening", "cv",
    "สัมภาษณ์", "interview", "candidate", "สรรหา", "recruitment",
    "วิเคราะห์", "จับคู่", "matching", "เวลา", "ประหยัด"
  ];

  const penalty = ultraShortPenalty(answer, 5);
  if (penalty) {
    return {
      score: penalty.cap,
      feedback: penalty.reason + " ควรอธิบายอย่างน้อย 3 ขั้นตอนในการใช้ AI ช่วย Recruitment"
    };
  }

  let score = 0;
  let notes = [];

  if (chars >= 50) score += 4; else notes.push("คำตอบสั้น");
  if (chars >= 100) score += 4;
  if (includesAny(text, ["1", "ขั้นตอน", "step", "ข้อ"])) score += 3; else notes.push("ยังไม่เห็นการแบ่งเป็นขั้นตอน");
  const hit = keywordCount(text, keywords);
  score += Math.min(hit, 6);

  if (includesAny(text, ["ประหยัดเวลา", "เวลา", "เร็วขึ้น"])) score += 2; else notes.push("ยังไม่อธิบายผลลัพธ์ด้านเวลา");
  if (includesAny(text, ["คัดกรอง", "cv", "screening"])) score += 1;
  if (includesAny(text, ["jd", "ประกาศงาน"])) score += 1;
  if (includesAny(text, ["สัมภาษณ์", "interview"])) score += 1;

  score = Math.min(score, 20);

  return {
    score,
    feedback: score >= 16
      ? "อธิบายการประยุกต์ใช้ AI ใน Recruitment ได้ค่อนข้างครบ"
      : "คำตอบยังไม่ชัดพอเรื่อง 3 ขั้นตอน และผลลัพธ์ของการใช้ AI " + notes.join(" / ")
  };
}

function gradeQ3(answer) {
  const text = normalize(answer);
  const chars = countChars(answer);

  const keywords = [
    "ข้อมูล", "dataset", "context", "บริบท", "เป้าหมาย", "ต้องการ",
    "รูปแบบ", "format", "สรุป", "วิเคราะห์", "พนักงาน",
    "turnover", "headcount", "แผนก", "ช่วงเวลา"
  ];

  const penalty = ultraShortPenalty(answer, 5);
  if (penalty) {
    return {
      score: penalty.cap,
      feedback: penalty.reason + " ควรปรับ Prompt โดยเพิ่มบริบท ข้อมูล เป้าหมาย และรูปแบบผลลัพธ์"
    };
  }

  let score = 0;
  let notes = [];

  if (chars >= 40) score += 4; else notes.push("คำตอบสั้น");
  if (chars >= 90) score += 4;
  score += Math.min(keywordCount(text, keywords), 6);

  if (includesAny(text, ["บริบท", "context"])) score += 2; else notes.push("ยังขาดบริบท");
  if (includesAny(text, ["เป้าหมาย", "ต้องการ"])) score += 2; else notes.push("ยังขาดเป้าหมาย");
  if (includesAny(text, ["รูปแบบ", "format", "ตาราง", "bullet"])) score += 1; else notes.push("ยังขาดรูปแบบผลลัพธ์");
  if (includesAny(text, ["ข้อมูล", "dataset", "ไฟล์"])) score += 1; else notes.push("ยังขาดรายละเอียดข้อมูลนำเข้า");

  score = Math.min(score, 20);

  return {
    score,
    feedback: score >= 16
      ? "ปรับ Prompt ได้ดีขึ้นและมีองค์ประกอบสำคัญมากขึ้น"
      : "Prompt ที่ปรับปรุงแล้วยังไม่ครบถ้วน " + notes.join(" / ")
  };
}

function gradeQ4(answer) {
  const text = normalize(answer);
  const chars = countChars(answer);

  const keywords = [
    "turnover", "ลาออก", "สาเหตุ", "ข้อมูล", "exit interview",
    "แผนก", "เงินเดือน", "หัวหน้างาน", "สวัสดิการ", "อายุงาน",
    "เขียน prompt", "วิเคราะห์", "action plan", "แก้ปัญหา"
  ];

  const penalty = ultraShortPenalty(answer, 5);
  if (penalty) {
    return {
      score: penalty.cap,
      feedback: penalty.reason + " ควรอธิบายตั้งแต่รวบรวมข้อมูล เขียน Prompt และนำผลไปใช้"
    };
  }

  let score = 0;
  let notes = [];

  if (chars >= 60) score += 4; else notes.push("คำตอบสั้น");
  if (chars >= 120) score += 4;
  score += Math.min(keywordCount(text, keywords), 6);

  if (includesAny(text, ["รวบรวมข้อมูล", "ข้อมูล"])) score += 2; else notes.push("ยังไม่พูดถึงการรวบรวมข้อมูล");
  if (includesAny(text, ["prompt", "เขียน prompt"])) score += 2; else notes.push("ยังไม่พูดถึงการเขียน Prompt");
  if (includesAny(text, ["นำไปใช้", "action plan", "แก้ปัญหา"])) score += 2; else notes.push("ยังไม่เชื่อมผลลัพธ์ไปสู่การแก้ปัญหา");

  score = Math.min(score, 20);

  return {
    score,
    feedback: score >= 16
      ? "อธิบายกระบวนการวิเคราะห์ Turnover ได้ค่อนข้างครบ"
      : "คำตอบยังไม่ครอบคลุมกระบวนการตั้งแต่ข้อมูลจนถึงการนำผลไปใช้ " + notes.join(" / ")
  };
}

function gradeQ5(answer) {
  const text = normalize(answer);
  const chars = countChars(answer);

  const keywords = [
    "ประสิทธิภาพ", "productivity", "ความเสี่ยง", "risk",
    "ข้อมูลส่วนบุคคล", "pdpa", "privacy", "bias", "ethic", "จริยธรรม",
    "ความแม่นยำ", "ตรวจสอบ", "องค์กร", "ผลกระทบ"
  ];

  const penalty = ultraShortPenalty(answer, 4);
  if (penalty) {
    return {
      score: penalty.cap,
      feedback: penalty.reason + " ควรวิเคราะห์ทั้งด้านบวก ด้านลบ ความเสี่ยง และจริยธรรม"
    };
  }

  let score = 0;
  let notes = [];

  if (chars >= 40) score += 3; else notes.push("คำตอบสั้น");
  if (chars >= 90) score += 3;
  score += Math.min(keywordCount(text, keywords), 5);

  if (includesAny(text, ["เชิงบวก", "ประสิทธิภาพ", "productivity"])) score += 2; else notes.push("ยังขาดผลกระทบเชิงบวก");
  if (includesAny(text, ["เชิงลบ", "ความเสี่ยง", "risk"])) score += 1; else notes.push("ยังขาดผลกระทบเชิงลบ");
  if (includesAny(text, ["pdpa", "privacy", "ข้อมูลส่วนบุคคล"])) score += 1; else notes.push("ยังไม่กล่าวถึงข้อมูลส่วนบุคคล");
  if (includesAny(text, ["จริยธรรม", "ethic", "bias"])) score += 1; else notes.push("ยังไม่กล่าวถึงจริยธรรม/อคติ");

  score = Math.min(score, 15);

  return {
    score,
    feedback: score >= 12
      ? "วิเคราะห์ผลกระทบของ AI ใน HR ได้ค่อนข้างสมดุล"
      : "การวิเคราะห์ยังไม่ครอบคลุมทั้งข้อดี ข้อเสีย และความเสี่ยง " + notes.join(" / ")
  };
}

function summarizeStrengths(results) {
  const strong = results.filter(r => r.score >= Math.ceil(r.maxScore ? r.maxScore * 0.7 : 14));
  if (!strong.length) return "มีความพยายามตอบครบทุกข้อในระดับพื้นฐาน";
  return "จุดเด่นคือมีบางข้อที่ตอบได้ค่อนข้างครบถ้วนและตรงประเด็น";
}

function summarizeImprovements(results) {
  return "ควรเพิ่มรายละเอียด ความยาวของคำตอบ และใช้คำสำคัญที่เกี่ยวข้องกับโจทย์ให้ครบมากขึ้น";
}
