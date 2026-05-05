require("dotenv").config({ path: ".env.local" });

const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const { Readable } = require("stream");
const { neon } = require("@neondatabase/serverless");
const { put, get, del } = require("@vercel/blob");
const sharp = require("sharp");

const app = express();
const PORT = process.env.PORT || 3001;
const LOGIN_API = "https://api.ksain.net/v1/login.php";
const LOGIN_KEY = process.env.KSAIN_LOGIN_KEY || "cae214-7e0e84-5c6a4a-4e695b-c39082";
const ADMIN_ID = "admin";
const ADMIN_IDS = new Set([ADMIN_ID, "26-048"]);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "safadmin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin12345";
const DATABASE_URL = process.env.DATABASE_URL;
const defaultSettings = {
  maxVotesPerUser: 3,
  maxSubmissionsPerUser: 1,
  showRanking: true
};

const sql = DATABASE_URL ? neon(DATABASE_URL) : null;
let schemaReady = false;
let settingsCache = null;

app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: false }));

function requireDatabase() {
  if (!sql) {
    const error = new Error("DATABASE_URL 환경변수가 필요합니다.");
    error.statusCode = 500;
    throw error;
  }
}

async function ensureSchema() {
  requireDatabase();
  if (schemaReady) return;

  await sql`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      author_name TEXT NOT NULL,
      author_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      image_url TEXT NOT NULL,
      image_pathname TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ`;
  await sql`
    CREATE TABLE IF NOT EXISTS votes (
      submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
      voter_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (submission_id, voter_id)
    )
  `;
  await sql`
    INSERT INTO settings (key, value)
    VALUES
      ('maxVotesPerUser', ${String(defaultSettings.maxVotesPerUser)}),
      ('maxSubmissionsPerUser', ${String(defaultSettings.maxSubmissionsPerUser)}),
      ('showRanking', ${String(defaultSettings.showRanking)})
    ON CONFLICT (key) DO NOTHING
  `;
  schemaReady = true;
}

function isAdmin(id) {
  return ADMIN_IDS.has(id);
}

function mapSubmission(row) {
  return {
    id: row.id,
    authorName: row.author_name,
    authorId: row.author_id,
    title: row.title,
    description: row.description,
    imageUrl: row.image_url,
    imagePathname: row.image_pathname,
    createdAt: new Date(row.created_at).toISOString(),
    pinnedAt: row.pinned_at ? new Date(row.pinned_at).toISOString() : null,
    voteCount: Number(row.vote_count) || 0,
    votedByMe: Boolean(row.voted_by_me)
  };
}

async function readSettings() {
  await ensureSchema();
  if (settingsCache) return settingsCache;
  const rows = await sql`SELECT key, value FROM settings`;
  const settings = { ...defaultSettings };
  for (const row of rows) {
    if (row.key === "maxVotesPerUser") settings.maxVotesPerUser = Number(row.value) || defaultSettings.maxVotesPerUser;
    if (row.key === "maxSubmissionsPerUser") settings.maxSubmissionsPerUser = Number(row.value) || defaultSettings.maxSubmissionsPerUser;
    if (row.key === "showRanking") settings.showRanking = row.value === "true";
  }
  settingsCache = settings;
  return settingsCache;
}

async function writeSettings(settings) {
  await ensureSchema();
  await sql`
    INSERT INTO settings (key, value)
    VALUES
      ('maxVotesPerUser', ${String(settings.maxVotesPerUser)}),
      ('maxSubmissionsPerUser', ${String(settings.maxSubmissionsPerUser)}),
      ('showRanking', ${String(settings.showRanking)})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `;
  settingsCache = settings;
}

async function readSubmissions(voterId = "") {
  await ensureSchema();
  const rows = await sql`
    SELECT
      s.id,
      s.author_name,
      s.author_id,
      s.title,
      s.description,
      s.image_url,
      s.image_pathname,
      s.created_at,
      s.pinned_at,
      COUNT(v.voter_id)::int AS vote_count,
      COALESCE(BOOL_OR(v.voter_id = ${voterId}), false) AS voted_by_me
    FROM submissions s
    LEFT JOIN votes v ON v.submission_id = s.id
    GROUP BY s.id
    ORDER BY (s.pinned_at IS NOT NULL) DESC, s.pinned_at DESC NULLS LAST, s.created_at DESC
  `;
  return rows.map(mapSubmission);
}

async function readSubmissionById(id, voterId = "") {
  await ensureSchema();
  const rows = await sql`
    SELECT
      s.id,
      s.author_name,
      s.author_id,
      s.title,
      s.description,
      s.image_url,
      s.image_pathname,
      s.created_at,
      s.pinned_at,
      COUNT(v.voter_id)::int AS vote_count,
      COALESCE(BOOL_OR(v.voter_id = ${voterId}), false) AS voted_by_me
    FROM submissions s
    LEFT JOIN votes v ON v.submission_id = s.id
    WHERE s.id = ${id}
    GROUP BY s.id
  `;
  return rows[0] ? mapSubmission(rows[0]) : null;
}

async function countUserVotes(voterId) {
  await ensureSchema();
  const rows = await sql`SELECT COUNT(*)::int AS count FROM votes WHERE voter_id = ${voterId}`;
  return rows[0]?.count ?? 0;
}

function parseDataUrl(dataUrl) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl || "");
  if (!match) {
    const error = new Error("이미지 형식이 올바르지 않습니다.");
    error.statusCode = 400;
    throw error;
  }
  return {
    contentType: match[1],
    buffer: Buffer.from(match[2], "base64")
  };
}

async function storeImage({ imageDataUrl, imageName }) {
  const { contentType, buffer } = parseDataUrl(imageDataUrl);
  if (buffer.length > 5 * 1024 * 1024) {
    const error = new Error("이미지 용량은 5MB 이하만 가능합니다.");
    error.statusCode = 400;
    throw error;
  }

  const optimizedBuffer = await sharp(buffer, { animated: false })
    .rotate()
    .resize({
      width: 1600,
      height: 1600,
      fit: "inside",
      withoutEnlargement: true
    })
    .webp({ quality: 78, effort: 4 })
    .toBuffer();

  const baseName = path.basename(imageName || "submission", path.extname(imageName || "submission")).replace(/[^a-zA-Z0-9_-]/g, "-");
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}-${baseName}.webp`;
  const optimizedContentType = "image/webp";

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`submissions/${filename}`, optimizedBuffer, {
      access: "private",
      contentType: optimizedContentType
    });
    return {
      imageUrl: `/api/blob/view?pathname=${encodeURIComponent(blob.pathname)}`,
      imagePathname: blob.pathname
    };
  }

  if (process.env.VERCEL) {
    const error = new Error("Vercel Blob 토큰이 설정되지 않아 이미지를 저장할 수 없습니다. BLOB_READ_WRITE_TOKEN 환경변수를 확인해주세요.");
    error.statusCode = 500;
    throw error;
  }

  const uploadDir = path.join(__dirname, "..", "public", "uploads");
  await fs.mkdir(uploadDir, { recursive: true });
  await fs.writeFile(path.join(uploadDir, filename), optimizedBuffer);
  return {
    imageUrl: `/uploads/${filename}`,
    imagePathname: null
  };
}

app.get("/api/blob/view", async (req, res, next) => {
  try {
    const pathname = req.query.pathname;
    if (!pathname || typeof pathname !== "string") {
      return res.status(400).json({ message: "이미지 경로가 필요합니다." });
    }
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return res.status(404).json({ message: "Blob 저장소가 설정되지 않았습니다." });
    }

    const result = await get(pathname, { access: "private" });
    if (!result || result.statusCode !== 200) {
      return res.status(404).send("Not found");
    }

    res.setHeader("Content-Type", result.blob.contentType || "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    Readable.fromWeb(result.stream).pipe(res);
  } catch (error) {
    next(error);
  }
});

async function deleteStoredImage(submission) {
  if (submission.image_pathname && process.env.BLOB_READ_WRITE_TOKEN) {
    await del(submission.image_pathname).catch(() => {});
    return;
  }
  if (submission.image_url?.startsWith("/uploads/")) {
    const imagePath = path.join(__dirname, "..", "public", "uploads", path.basename(submission.image_url));
    await fs.unlink(imagePath).catch(() => {});
  }
}

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ code: 400, status: "error", message: "아이디와 비밀번호를 입력해주세요." });
  }

  if (username === "demo" && password === "demo") {
    return res.json({
      code: 200,
      status: "success",
      message: "Logged in with local demo account.",
      data: {
        name: "테스트 사용자",
        batch: "demo",
        studentID: "001",
        role: "user"
      }
    });
  }

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    return res.json({
      code: 200,
      status: "success",
      message: "Logged in with local admin account.",
      data: {
        name: "관리자",
        batch: "admin",
        studentID: "admin",
        role: "admin"
      }
    });
  }

  const form = new URLSearchParams();
  form.set("key", LOGIN_KEY);
  form.set("username", username);
  form.set("password", password);

  try {
    const apiRes = await fetch(LOGIN_API, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form
    });
    const payload = await apiRes.json();
    if (payload.data) payload.data.role = "user";
    if (payload.code === 401 || apiRes.status === 401) {
      payload.message = "로그인 API Key가 승인되지 않았거나 유효하지 않습니다.";
    }
    return res.status(apiRes.status).json(payload);
  } catch (error) {
    return res.status(502).json({ code: 502, status: "error", message: "로그인 서버에 연결하지 못했습니다." });
  }
});

app.get("/api/settings", async (_req, res, next) => {
  try {
    res.json(await readSettings());
  } catch (error) {
    next(error);
  }
});

app.get("/api/bootstrap", async (req, res, next) => {
  try {
    const voterId = typeof req.query.voterId === "string" ? req.query.voterId : "";
    const [settings, submissions, usedVotes] = await Promise.all([
      readSettings(),
      readSubmissions(voterId),
      voterId ? countUserVotes(voterId) : Promise.resolve(0)
    ]);
    res.json({ settings, submissions, usedVotes });
  } catch (error) {
    next(error);
  }
});

app.put("/api/settings", async (req, res, next) => {
  try {
    const { requesterId, maxVotesPerUser, maxSubmissionsPerUser, showRanking } = req.body;
    if (!isAdmin(requesterId)) return res.status(403).json({ message: "관리자만 설정을 변경할 수 있습니다." });

    const nextSettings = {
      maxVotesPerUser: Math.max(1, Math.min(99, Number(maxVotesPerUser) || defaultSettings.maxVotesPerUser)),
      maxSubmissionsPerUser: Math.max(1, Math.min(99, Number(maxSubmissionsPerUser) || defaultSettings.maxSubmissionsPerUser)),
      showRanking: Boolean(showRanking)
    };
    await writeSettings(nextSettings);
    res.json(nextSettings);
  } catch (error) {
    next(error);
  }
});

app.get("/api/submissions", async (_req, res, next) => {
  try {
    res.json(await readSubmissions(""));
  } catch (error) {
    next(error);
  }
});

app.post("/api/submissions", async (req, res, next) => {
  try {
    const { authorName, authorId, title, description, imageDataUrl, imageName } = req.body;
    if (!authorName || !authorId || !title || !description || !imageDataUrl) {
      return res.status(400).json({ message: "제목, 설명, 이미지가 모두 필요합니다." });
    }

    await ensureSchema();
    const settings = await readSettings();
    const submittedRows = await sql`SELECT COUNT(*)::int AS count FROM submissions WHERE author_id = ${authorId}`;
    const submittedCount = submittedRows[0]?.count ?? 0;
    if (!isAdmin(authorId) && submittedCount >= settings.maxSubmissionsPerUser) {
      return res.status(403).json({ message: `한 사람당 최대 ${settings.maxSubmissionsPerUser}개의 작품만 올릴 수 있습니다.` });
    }

    const { imageUrl, imagePathname } = await storeImage({ imageDataUrl, imageName });
    const id = `${Date.now()}`;
    const rows = await sql`
      INSERT INTO submissions (id, author_name, author_id, title, description, image_url, image_pathname)
      VALUES (${id}, ${authorName}, ${authorId}, ${title}, ${description}, ${imageUrl}, ${imagePathname})
      RETURNING id, author_name, author_id, title, description, image_url, image_pathname, created_at
    `;
    res.status(201).json({ ...mapSubmission({ ...rows[0], vote_count: 0, voted_by_me: false }) });
  } catch (error) {
    next(error);
  }
});

app.put("/api/submissions/:id/pin", async (req, res, next) => {
  try {
    const { requesterId, pinned } = req.body;
    if (!isAdmin(requesterId)) return res.status(403).json({ message: "관리자만 게시물을 고정할 수 있습니다." });

    await ensureSchema();
    const rows = await sql`SELECT id FROM submissions WHERE id = ${req.params.id}`;
    if (rows.length === 0) return res.status(404).json({ message: "작품을 찾을 수 없습니다." });

    if (pinned) {
      await sql`UPDATE submissions SET pinned_at = NULL WHERE pinned_at IS NOT NULL`;
      await sql`UPDATE submissions SET pinned_at = NOW() WHERE id = ${req.params.id}`;
    } else {
      await sql`UPDATE submissions SET pinned_at = NULL WHERE id = ${req.params.id}`;
    }

    const updatedSubmission = await readSubmissionById(req.params.id, requesterId);
    res.json({ submission: updatedSubmission });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/submissions/:id", async (req, res, next) => {
  try {
    const { requesterId } = req.body;
    await ensureSchema();
    const rows = await sql`SELECT * FROM submissions WHERE id = ${req.params.id}`;
    const submission = rows[0];
    if (!submission) return res.status(404).json({ message: "작품을 찾을 수 없습니다." });
    if (!requesterId) return res.status(400).json({ message: "삭제 요청자 정보가 필요합니다." });
    if (!isAdmin(requesterId) && submission.author_id !== requesterId) {
      return res.status(403).json({ message: "삭제 권한이 없습니다." });
    }

    await sql`DELETE FROM submissions WHERE id = ${req.params.id}`;
    await deleteStoredImage(submission);
    res.json({ ok: true, id: req.params.id });
  } catch (error) {
    next(error);
  }
});

app.post("/api/submissions/:id/vote", async (req, res, next) => {
  try {
    const { voterId } = req.body;
    if (!voterId) return res.status(400).json({ message: "투표자 정보가 필요합니다." });

    await ensureSchema();
    const settings = await readSettings();
    const rows = await sql`SELECT * FROM submissions WHERE id = ${req.params.id}`;
    const submission = rows[0];
    if (!submission) return res.status(404).json({ message: "작품을 찾을 수 없습니다." });
    if (submission.author_id === voterId) return res.status(403).json({ message: "본인은 추천할 수 없습니다." });

    const existing = await sql`SELECT submission_id FROM votes WHERE submission_id = ${req.params.id} AND voter_id = ${voterId}`;
    if (existing.length > 0) {
      await sql`DELETE FROM votes WHERE submission_id = ${req.params.id} AND voter_id = ${voterId}`;
    } else {
      const usedVotes = await countUserVotes(voterId);
      if (usedVotes >= settings.maxVotesPerUser) {
        return res.status(403).json({ message: `투표권은 최대 ${settings.maxVotesPerUser}개까지 사용할 수 있습니다.` });
      }
      await sql`INSERT INTO votes (submission_id, voter_id) VALUES (${req.params.id}, ${voterId})`;
    }

    const updatedSubmission = await readSubmissionById(req.params.id, voterId);
    res.json({
      submission: updatedSubmission,
      remainingVotes: settings.maxVotesPerUser - (await countUserVotes(voterId)),
      maxVotes: settings.maxVotesPerUser
    });
  } catch (error) {
    next(error);
  }
});

app.use(express.static(path.join(__dirname, "..", "dist")));
app.get(/^\/(?!api).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "dist", "index.html"));
});

app.use((error, _req, res, _next) => {
  const status = error.statusCode || 500;
  res.status(status).json({ message: error.message || "서버 오류가 발생했습니다." });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`SAF peer-review API listening on http://localhost:${PORT}`);
  });
}

module.exports = app;
