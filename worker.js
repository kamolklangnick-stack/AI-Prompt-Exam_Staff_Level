export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // =========================
    // GET → ดึงข้อมูลล่าสุด (latest per employee)
    // =========================
    if (request.method === "GET") {
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

      return json({ ok: true, data: results }, corsHeaders);
    }

    // =========================
    // POST
    // =========================
    const body = await request.json().catch(() => ({}));
    const action = body.action;

    // =========================
    // SAVE RESULT
    // =========================
    if (action === "save_result") {

      const employee_code = String(body.employee_code || "").trim();
      const fname = String(body.fname || "").trim();
      const lname = String(body.lname || "").trim();
      const dept = String(body.dept || "").trim();
      const company = String(body.company || "").trim();
      const answers = body.answers || {};

      if (!employee_code || !fname || !lname || !dept || !company) {
        return json({ ok: false, error: "Missing required fields" }, corsHeaders);
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
        Number(body.prompt || 0),
        Number(body.application || 0),
        Number(body.analysis || 0),
        Number(body.impact || 0),
        Number(body.totalScore || 0),
        String(body.level || ""),
        String(body.levelEn || ""),
        String(body.timeUsed || ""),
        body.isAuto ? 1 : 0,
        String(answers["1"] || ""),
        String(answers["2"] || ""),
        String(answers["3"] || ""),
        String(answers["4"] || ""),
        String(answers["5"] || "")
      ).run();

      return json({ ok: true }, corsHeaders);
    }

    // =========================
    // DASHBOARD SUMMARY
    // =========================
    if (action === "dashboard_summary") {

      const { results } = await env.DB.prepare(`
        SELECT
          id,
          created_at,
          employee_code,
          fname,
          lname,
          dept,
          company,
          total_score,
          level,
          answer1,answer2,answer3,answer4,answer5
        FROM results
        ORDER BY id DESC
        LIMIT 2000
      `).all();

      const latest = dedupeLatest(results);

      const ranking = latest
        .map(r => ({
          employee_code: r.employee_code,
          fname: r.fname,
          lname: r.lname,
          dept: r.dept,
          company: r.company,
          totalScore: Number(r.total_score),
          level: r.level,
          created_at: r.created_at,
          answer1: r.answer1,
          answer2: r.answer2,
          answer3: r.answer3,
          answer4: r.answer4,
          answer5: r.answer5
        }))
        .sort((a,b)=>b.totalScore-a.totalScore)
        .slice(0,10);

      return json({ ok:true, summary:{ ranking } }, corsHeaders);
    }

    return json({ ok:false, error:"Unknown action" }, corsHeaders);
  }
};

// =========================
// Helper
// =========================

function json(data, headers) {
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      ...headers
    }
  });
}

// เอา latest ต่อ employee_code
function dedupeLatest(rows) {
  const map = {};

  for (const r of rows) {
    const key = (r.employee_code || "").toLowerCase();
    if (!key) continue;

    if (!map[key] || r.id > map[key].id) {
      map[key] = r;
    }
  }

  return Object.values(map);
}
