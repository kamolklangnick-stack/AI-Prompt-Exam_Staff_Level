export default {
  async fetch(request, env) {
    const requestHeaders = request.headers.get("Access-Control-Request-Headers") || "Content-Type";

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": requestHeaders,
      "Access-Control-Max-Age": "86400"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      if (request.method === "GET") {
        return await handleGet(env, corsHeaders);
      }

      if (request.method !== "POST") {
        return jsonResponse({ ok: false, error: "Method Not Allowed" }, 405, corsHeaders);
      }

      const body = await request.json().catch(() => ({}));
      const action = String(body.action || "").trim();

      if (action === "grade") {
        return await handleGrade(body, env, corsHeaders);
      }

      if (action === "save_result") {
        return await handleSaveResult(body, env, corsHeaders);
      }

      if (action === "dashboard_summary") {
        return await handleDashboardSummary(body, env, corsHeaders);
      }

      if (action === "clear_results") {
        return await handleClearResults(body, env, corsHeaders);
      }

      return jsonResponse({
        ok: false,
        error: "Unknown action",
        receivedAction: action || "(empty)"
      }, 400, corsHeaders);

    } catch (e) {
      return jsonResponse({
        ok: false,
        error: e && e.message ? e.message : "Unknown error"
      }, 500, corsHeaders);
    }
  }
};

async function handleGet(env, corsHeaders) {
  if (!env.DB) {
    return jsonResponse({ ok: false, error: "Missing D1 binding: DB" }, 500, corsHeaders);
  }

  const { results } = await env.DB.prepare(`
    SELECT
      id,
      created_at,
      employee_code,
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
      is_auto,
      answer1,
      answer2,
      answer3,
      answer4,
      answer5
    FROM results r
    WHERE r.id = (
      SELECT MAX(x.id)
      FROM results x
      WHERE COALESCE(NULLIF(TRIM(x.employee_code), ''), LOWER(TRIM(x.fname)) || '|' || LOWER(TRIM(x.lname)))
        = COALESCE(NULLIF(TRIM(r.employee_code), ''), LOWER(TRIM(r.fname)) || '|' || LOWER(TRIM(r.lname)))
    )
    ORDER BY id DESC
    LIMIT 500
  `).all();

  return jsonResponse({ ok: true, data: results || [] }, 200, corsHeaders);
}

async function handleGrade(body, env, corsHeaders) {
  const prompt = String(body.prompt || "").trim();
  const answers = body.answers || {};

  if (env.GEMINI_API_KEY && prompt) {
    try {
      const aiPrompt = `
คุณเป็นผู้ตรวจข้อสอบ HR AI Assessment ระดับ Staff
ให้ตรวจคำตอบและตอบกลับเป็น JSON เท่านั้น ห้ามมี markdown

JSON schema:
{
  "totalScore": number,
  "level": "ดีเยี่ยม" | "ดี" | "พอใช้" | "ต้องพัฒนา",
  "levelEn": "Excellent" | "Good" | "Satisfactory" | "Needs Improvement",
  "emoji": string,
  "summary": string,
  "dimensions": {
    "prompt": number,
    "application": number,
    "analysis": number,
    "impact": number
  },
  "questions": [
    {"num": 1, "score": number, "maxScore": 25, "feedback": string},
    {"num": 2, "score": number, "maxScore": 20, "feedback": string},
    {"num": 3, "score": number, "maxScore": 20, "feedback": string},
    {"num": 4, "score": number, "maxScore": 20, "feedback": string},
    {"num": 5, "score": number, "maxScore": 15, "feedback": string}
  ],
  "strengths": string,
  "improvements": string
}

เกณฑ์คะแนน:
- ข้อ 1 Prompt Writing 25 คะแนน
- ข้อ 2 Application 20 คะแนน
- ข้อ 3 Analysis 20 คะแนน
- ข้อ 4 Analysis 20 คะแนน
- ข้อ 5 Business Impact 15 คะแนน

ข้อมูลผู้สอบและคำตอบ:
${prompt}
`;

      const geminiResp = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-goog-api-key": env.GEMINI_API_KEY
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: aiPrompt }] }],
            generationConfig: { temperature: 0.2 }
          })
        }
      );

      const geminiData = await geminiResp.json().catch(() => ({}));
      if (geminiResp.ok) {
        let aiText = "";
        const parts = geminiData?.candidates?.[0]?.content?.parts || [];
        for (const p of parts) {
          if (typeof p.text === "string") aiText += p.text;
        }

        const parsed = parseJsonFromText(aiText);
        if (parsed && typeof parsed.totalScore === "number") {
          return jsonResponse({
            ok: true,
            source: "AI",
            result: normalizeGradeResult(parsed)
          }, 200, corsHeaders);
        }
      }
    } catch (e) {
      // fallback mock
    }
  }

  const mockResult = gradeWithStrictMock(answers);
  return jsonResponse({
    ok: true,
    source: "MOCK",
    result: mockResult,
    text: JSON.stringify(mockResult)
  }, 200, corsHeaders);
}

async function handleSaveResult(body, env, corsHeaders) {
  if (!env.DB) {
    return jsonResponse({ ok: false, error: "Missing D1 binding: DB" }, 500, corsHeaders);
  }

  const employee_code = String(body.employee_code || body.employeeCode || "").trim();
  const fname = String(body.fname || "").trim();
  const lname = String(body.lname || "").trim();
  const dept = String(body.dept || "").trim();
  const company = String(body.company || "").trim();
  const answers = body.answers || {};

  if (!employee_code || !fname || !lname || !dept || !company) {
    return jsonResponse({
      ok: false,
      error: "Missing required fields: employee_code, fname, lname, dept, company"
    }, 400, corsHeaders);
  }

  await env.DB.prepare(`
    INSERT INTO results (
      employee_code,
      fname, lname, dept, company,
      prompt_score, application_score, analysis_score, impact_score,
      total_score, level, levelEn, time_used, is_auto,
      answer1, answer2, answer3, answer4, answer5
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    employee_code,
    fname,
    lname,
    dept,
    company,
    Number(body.prompt || body.prompt_score || 0),
    Number(body.application || body.application_score || 0),
    Number(body.analysis || body.analysis_score || 0),
    Number(body.impact || body.impact_score || 0),
    Number(body.totalScore || body.total_score || 0),
    String(body.level || ""),
    String(body.levelEn || ""),
    String(body.timeUsed || body.time_used || ""),
    body.isAuto ? 1 : 0,
    String(answers["1"] || body.answer1 || ""),
    String(answers["2"] || body.answer2 || ""),
    String(answers["3"] || body.answer3 || ""),
    String(answers["4"] || body.answer4 || ""),
    String(answers["5"] || body.answer5 || "")
  ).run();

  return jsonResponse({ ok: true, saved: true }, 200, corsHeaders);
}

async function handleDashboardSummary(body, env, corsHeaders) {
  if (!env.DB) {
    return jsonResponse({ ok: false, error: "Missing D1 binding: DB" }, 500, corsHeaders);
  }

  const pin = String(body.pin || "").trim();
  const adminPin = String(env.ADMIN_DASHBOARD_PIN || "134300").trim();

  if (!pin || pin !== adminPin) {
    return jsonResponse({ ok: false, error: "Invalid dashboard PIN" }, 401, corsHeaders);
  }

  const { results } = await env.DB.prepare(`
    SELECT
      id,
      created_at,
      employee_code,
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
      is_auto,
      answer1,
      answer2,
      answer3,
      answer4,
      answer5
    FROM results
    ORDER BY id DESC
    LIMIT 2000
  `).all();

  const rows = dedupeLatestByPerson(results || []);
  const totalParticipants = rows.length;
  const avgScore = totalParticipants
    ? round1(rows.reduce((s, r) => s + Number(r.total_score || 0), 0) / totalParticipants)
    : 0;

  const levelCounts = {
    excellent: rows.filter(r => r.level === "ดีเยี่ยม").length,
    good: rows.filter(r => r.level === "ดี").length,
    satisfactory: rows.filter(r => r.level === "พอใช้").length,
    needImprove: rows.filter(r => r.level === "ต้องพัฒนา").length
  };

  const companyBreakdown = breakdown(rows, "company", "company");
  const deptBreakdown = breakdown(rows, "dept", "dept");

  const ranking = [...rows].map((r) => ({
    employee_code: r.employee_code || "",
    fname: r.fname || "",
    lname: r.lname || "",
    dept: r.dept || "",
    company: r.company || "",
    totalScore: Number(r.total_score || 0),
    level: r.level || "",
    created_at: r.created_at || "",
    answer1: r.answer1 || "",
    answer2: r.answer2 || "",
    answer3: r.answer3 || "",
    answer4: r.answer4 || "",
    answer5: r.answer5 || ""
  })).sort((a, b) => b.totalScore - a.totalScore).slice(0, 500);

  return jsonResponse({
    ok: true,
    summary: {
      totalParticipants,
      avgScore,
      levelCounts,
      companyBreakdown,
      deptBreakdown,
      ranking
    }
  }, 200, corsHeaders);
}

async function handleClearResults(body, env, corsHeaders) {
  if (!env.DB) {
    return jsonResponse({ ok: false, error: "Missing D1 binding: DB" }, 500, corsHeaders);
  }

  const pin = String(body.pin || "").trim();
  const adminPin = String(env.ADMIN_DASHBOARD_PIN || "134300").trim();

  if (!pin || pin !== adminPin) {
    return jsonResponse({ ok: false, error: "Invalid PIN" }, 401, corsHeaders);
  }

  await env.DB.prepare(`DELETE FROM results`).run();
  return jsonResponse({ ok: true, cleared: true }, 200, corsHeaders);
}

function dedupeLatestByPerson(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const emp = String(r.employee_code || "").trim().toLowerCase();
    const key = emp || `${String(r.fname || "").trim().toLowerCase()}|${String(r.lname || "").trim().toLowerCase()}`;
    if (!key || key === "|") continue;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(r);
    }
  }
  return out;
}

function breakdown(rows, key, outputKey) {
  const m = {};
  for (const r of rows) {
    const name = String(r[key] || "-").trim() || "-";
    const score = Number(r.total_score || 0);
    if (!m[name]) m[name] = { count: 0, total: 0 };
    m[name].count += 1;
    m[name].total += score;
  }

  return Object.entries(m)
    .map(([name, v]) => ({
      [outputKey]: name,
      count: v.count,
      avgScore: round1(v.total / v.count)
    }))
    .sort((a, b) => b.avgScore - a.avgScore);
}

function normalizeGradeResult(result) {
  const totalScore = clamp(Number(result.totalScore || 0), 0, 100);
  const levelInfo = levelFromScore(totalScore);
  const dimensions = result.dimensions || {};

  return {
    totalScore,
    level: result.level || levelInfo.level,
    levelEn: result.levelEn || levelInfo.levelEn,
    emoji: result.emoji || levelInfo.emoji,
    summary: String(result.summary || "ระบบประเมินผลจากคุณภาพและความครบถ้วนของคำตอบ"),
    dimensions: {
      prompt: clamp(Number(dimensions.prompt || 0), 0, 25),
      application: clamp(Number(dimensions.application || 0), 0, 20),
      analysis: clamp(Number(dimensions.analysis || 0), 0, 40),
      impact: clamp(Number(dimensions.impact || 0), 0, 15)
    },
    questions: Array.isArray(result.questions) ? result.questions : [],
    strengths: String(result.strengths || "มีความพยายามตอบครบทุกข้อ"),
    improvements: String(result.improvements || "ควรเพิ่มรายละเอียดและเชื่อมโยงกับบริบทงาน HR ให้ชัดเจนขึ้น")
  };
}

function gradeWithStrictMock(answers) {
  const q1 = gradeQuestion(answers["1"] || "", 25, ["บริบท", "context", "เป้าหมาย", "objective", "รูปแบบ", "format", "คะแนน", "เกณฑ์", "performance", "appraisal", "hr"]);
  const q2 = gradeQuestion(answers["2"] || "", 20, ["jd", "ประกาศงาน", "screening", "cv", "สัมภาษณ์", "interview", "recruitment", "candidate", "ประหยัดเวลา"]);
  const q3 = gradeQuestion(answers["3"] || "", 20, ["ข้อมูล", "dataset", "บริบท", "context", "เป้าหมาย", "รูปแบบ", "วิเคราะห์", "พนักงาน"]);
  const q4 = gradeQuestion(answers["4"] || "", 20, ["turnover", "ลาออก", "สาเหตุ", "exit interview", "แผนก", "เงินเดือน", "action plan", "แก้ปัญหา"]);
  const q5 = gradeQuestion(answers["5"] || "", 15, ["ประสิทธิภาพ", "ความเสี่ยง", "risk", "pdpa", "privacy", "ข้อมูลส่วนบุคคล", "จริยธรรม", "bias"]);

  const promptScore = q1.score;
  const applicationScore = q2.score;
  const analysisScore = q3.score + q4.score;
  const impactScore = q5.score;
  const totalScore = promptScore + applicationScore + analysisScore + impactScore;
  const levelInfo = levelFromScore(totalScore);

  return {
    totalScore,
    level: levelInfo.level,
    levelEn: levelInfo.levelEn,
    emoji: levelInfo.emoji,
    summary: "ระบบประเมินสำรองถูกใช้ โดยตรวจจากความครบถ้วน ความยาว และคำสำคัญของแต่ละคำตอบ",
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
    strengths: totalScore >= 60 ? "มีการตอบเชื่อมโยงกับงาน HR และมีรายละเอียดในระดับหนึ่ง" : "มีความพยายามตอบครบทุกข้อในระดับพื้นฐาน",
    improvements: "ควรเพิ่มรายละเอียด ตัวอย่างการนำไปใช้จริง และเชื่อมโยงกับผลลัพธ์ทางธุรกิจให้ชัดเจนขึ้น"
  };
}

function gradeQuestion(answer, max, keywords) {
  const text = String(answer || "").trim().toLowerCase();
  const chars = text.length;

  if (chars <= 3) {
    return { score: Math.min(max, 1), feedback: "คำตอบสั้นเกินไปมาก ควรอธิบายให้ครบตามโจทย์" };
  }
  if (chars <= 15) {
    return { score: Math.min(max, 3), feedback: "คำตอบยังสั้นมาก ควรเพิ่มรายละเอียดและตัวอย่าง" };
  }

  let score = 0;
  if (chars >= 40) score += Math.round(max * 0.18);
  if (chars >= 90) score += Math.round(max * 0.18);
  if (chars >= 150) score += Math.round(max * 0.14);

  let hits = 0;
  for (const k of keywords) {
    if (text.includes(k.toLowerCase())) hits += 1;
  }
  score += Math.min(Math.round(max * 0.4), hits * Math.max(1, Math.round(max * 0.06)));

  if (/[1-3๑-๓]|ขั้นตอน|ข้อ|step/.test(text)) score += Math.round(max * 0.1);
  if (/ผลลัพธ์|ประโยชน์|ลดเวลา|เร็วขึ้น|decision|action|impact/.test(text)) score += Math.round(max * 0.1);

  score = clamp(score, 0, max);

  return {
    score,
    feedback: score >= Math.round(max * 0.75)
      ? "ตอบได้ค่อนข้างครบและตรงประเด็น"
      : "ควรเพิ่มรายละเอียดให้ครบขึ้น เช่น บริบท เป้าหมาย ขั้นตอน ตัวอย่าง และผลลัพธ์ที่คาดหวัง"
  };
}

function levelFromScore(score) {
  if (score >= 90) return { level: "ดีเยี่ยม", levelEn: "Excellent", emoji: "🏆" };
  if (score >= 75) return { level: "ดี", levelEn: "Good", emoji: "🟢" };
  if (score >= 60) return { level: "พอใช้", levelEn: "Satisfactory", emoji: "🟡" };
  return { level: "ต้องพัฒนา", levelEn: "Needs Improvement", emoji: "🔴" };
}

function parseJsonFromText(text) {
  try {
    const raw = String(text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end < 0 || end <= start) return null;
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function jsonResponse(obj, status, corsHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders
    }
  });
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, Math.round(Number(n) || 0)));
}

function round1(n) {
  return Math.round(Number(n || 0) * 10) / 10;
}
