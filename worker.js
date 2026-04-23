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
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    try {
      if (request.method === "GET") {
        if (!env.DB) {
          return jsonResponse({ ok: false, error: "Missing D1 binding: DB" }, 500, corsHeaders);
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
          LIMIT 500
        `).all();

        return jsonResponse({ ok: true, data: results || [] }, 200, corsHeaders);
      }

      if (request.method !== "POST") {
        return jsonResponse({ ok: false, error: "Method Not Allowed" }, 405, corsHeaders);
      }

      const body = await request.json();
      const action = String(body.action || "grade");

      if (action === "grade") {
        const prompt = String(body.prompt || "");
        const answers = body.answers || {};

        let finalResult = gradeWithStrictMock(answers);
        let source = "MOCK";

        return jsonResponse({
          ok: true,
          source,
          text: JSON.stringify(finalResult)
        }, 200, corsHeaders);
      }

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

      if (action === "dashboard_summary") {
        if (!env.DB) {
          return jsonResponse({ ok: false, error: "Missing D1 binding: DB" }, 500, corsHeaders);
        }

        const expectedPin = String(env.ADMIN_DASHBOARD_PIN || "").trim();
        const actualPin = String(body.pin || "").trim();

        if (!expectedPin) {
          return jsonResponse({ ok: false, error: "Missing ADMIN_DASHBOARD_PIN secret" }, 500, corsHeaders);
        }

        if (actualPin !== expectedPin) {
          return jsonResponse({ ok: false, error: "Invalid admin PIN" }, 401, corsHeaders);
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
          LIMIT 2000
        `).all();

        const latestOnly = dedupeLatestByPerson(results || []);
        const summary = buildDashboardSummary(latestOnly);

        return jsonResponse({
          ok: true,
          latestCount: latestOnly.length,
          summary
        }, 200, corsHeaders);
      }

      if (action === "clear_results") {
        if (!env.DB) {
          return jsonResponse({ ok: false, error: "Missing D1 binding: DB" }, 500, corsHeaders);
        }

        const expectedPin = String(env.ADMIN_DASHBOARD_PIN || "").trim();
        const actualPin = String(body.pin || "").trim();

        if (!expectedPin) {
          return jsonResponse({ ok: false, error: "Missing ADMIN_DASHBOARD_PIN secret" }, 500, corsHeaders);
        }

        if (actualPin !== expectedPin) {
          return jsonResponse({ ok: false, error: "Invalid admin PIN" }, 401, corsHeaders);
        }

        await env.DB.prepare(`DELETE FROM results`).run();
        return jsonResponse({ ok: true, cleared: true }, 200, corsHeaders);
      }

      return jsonResponse({ ok: false, error: "Invalid action" }, 400, corsHeaders);
    } catch (e) {
      return jsonResponse({
        ok: false,
        error: e && e.message ? e.message : "Unknown error"
      }, 500, corsHeaders);
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

function dedupeLatestByPerson(rows) {
  const seen = new Set();
  const out = [];

  for (const r of rows) {
    const key = `${String(r.fname || "").trim().toLowerCase()}|${String(r.lname || "").trim().toLowerCase()}`;
    if (!key || key === "|") continue;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(r);
    }
  }

  return out;
}

function buildDashboardSummary(rows) {
  const total = rows.length;
  const avgScore = total
    ? Math.round((rows.reduce((sum, r) => sum + Number(r.total_score || 0), 0) / total) * 10) / 10
    : 0;

  const levelCounts = {
    excellent: 0,
    good: 0,
    satisfactory: 0,
    needImprove: 0
  };

  const companyMap = {};
  const deptMap = {};

  for (const r of rows) {
    const score = Number(r.total_score || 0);
    const company = String(r.company || "-").trim() || "-";
    const dept = String(r.dept || "-").trim() || "-";
    const level = String(r.level || "").trim();

    if (level === "ดีเยี่ยม") levelCounts.excellent++;
    else if (level === "ดี") levelCounts.good++;
    else if (level === "พอใช้") levelCounts.satisfactory++;
    else levelCounts.needImprove++;

    if (!companyMap[company]) companyMap[company] = { company, count: 0, totalScore: 0 };
    companyMap[company].count++;
    companyMap[company].totalScore += score;

    if (!deptMap[dept]) deptMap[dept] = { dept, count: 0, totalScore: 0 };
    deptMap[dept].count++;
    deptMap[dept].totalScore += score;
  }

  const companyBreakdown = Object.values(companyMap).map(x => ({
    company: x.company,
    count: x.count,
    avgScore: Math.round((x.totalScore / x.count) * 10) / 10
  })).sort((a,b) => b.avgScore - a.avgScore);

  const deptBreakdown = Object.values(deptMap).map(x => ({
    dept: x.dept,
    count: x.count,
    avgScore: Math.round((x.totalScore / x.count) * 10) / 10
  })).sort((a,b) => b.avgScore - a.avgScore);

  const ranking = [...rows].map(r => ({
    fname: r.fname || "",
    lname: r.lname || "",
    dept: r.dept || "",
    company: r.company || "",
    totalScore: Number(r.total_score || 0),
    level: r.level || "",
    created_at: r.created_at || ""
  })).sort((a,b) => b.totalScore - a.totalScore).slice(0, 10);

  return {
    totalParticipants: total,
    avgScore,
    levelCounts,
    companyBreakdown,
    deptBreakdown,
    ranking
  };
}

function gradeWithStrictMock(answers) {
  const q1 = (answers["1"] || "").trim();
  const q2 = (answers["2"] || "").trim();
  const q3 = (answers["3"] || "").trim();
  const q4 = (answers["4"] || "").trim();
  const q5 = (answers["5"] || "").trim();

  const prompt = Math.min(25, q1.length >= 20 ? 10 + Math.min(15, Math.floor(q1.length / 20)) : 1);
  const application = Math.min(20, q2.length >= 20 ? 8 + Math.min(12, Math.floor(q2.length / 25)) : 1);
  const analysis = Math.min(40,
    (q3.length >= 20 ? 8 + Math.min(12, Math.floor(q3.length / 25)) : 1) +
    (q4.length >= 20 ? 8 + Math.min(12, Math.floor(q4.length / 25)) : 1)
  );
  const impact = Math.min(15, q5.length >= 20 ? 6 + Math.min(9, Math.floor(q5.length / 25)) : 1);

  const totalScore = prompt + application + analysis + impact;

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

  return {
    totalScore,
    level,
    levelEn,
    emoji,
    summary: "ระบบประเมินสำรองตรวจจากความครบถ้วนและความยาวของคำตอบ",
    dimensions: { prompt, application, analysis, impact },
    questions: [
      { num: 1, score: prompt, maxScore: 25, feedback: "ควรเพิ่มบริบทและรูปแบบผลลัพธ์ให้ชัดเจน" },
      { num: 2, score: application, maxScore: 20, feedback: "ควรอธิบายขั้นตอนการใช้งาน AI ให้ครบขึ้น" },
      { num: 3, score: Math.min(20, Math.max(1, Math.floor(analysis / 2))), maxScore: 20, feedback: "Prompt ที่ปรับปรุงควรเพิ่ม context และเป้าหมาย" },
      { num: 4, score: Math.min(20, Math.max(1, Math.ceil(analysis / 2))), maxScore: 20, feedback: "ควรเชื่อมการวิเคราะห์ไปสู่ action plan ให้ชัด" },
      { num: 5, score: impact, maxScore: 15, feedback: "ควรกล่าวถึงความเสี่ยง PDPA และจริยธรรมให้สมดุล" }
    ],
    strengths: "มีความพยายามตอบครบถ้วนในระดับพื้นฐาน",
    improvements: "ควรเพิ่มรายละเอียดและคำสำคัญที่เกี่ยวข้องกับโจทย์"
  };
}
