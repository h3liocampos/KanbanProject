require("dotenv").config();

const path = require("path");
const express = require("express");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const connectPgSimple = require("connect-pg-simple");
const { Pool } = require("pg");
const { rateLimit } = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 10000;
const isProduction = process.env.NODE_ENV === "production";

if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error("A variável SESSION_SECRET precisa estar configurada.");
}
if (!process.env.DATABASE_URL) {
  throw new Error("A variável DATABASE_URL precisa estar configurada.");
}

app.set("trust proxy", 1);
app.disable("x-powered-by");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

const PgSession = connectPgSimple(session);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      fontSrc: ["'self'", "data:"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: "20kb" }));
app.use(session({
  store: new PgSession({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: true,
    pruneSessionInterval: 15 * 60
  }),
  name: "flowboard.sid",
  secret: process.env.SESSION_SECRET || "development-only-change-this-secret",
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Muitas tentativas. Aguarde 15 minutos e tente novamente." }
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Muitas tentativas de cadastro. Tente novamente mais tarde." }
});

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      email VARCHAR(254) NOT NULL UNIQUE,
      username VARCHAR(24) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(90) NOT NULL,
      description VARCHAR(500) NOT NULL DEFAULT '',
      status VARCHAR(10) NOT NULL DEFAULT 'todo'
        CHECK (status IN ('todo', 'doing', 'done')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS tasks_user_id_idx ON tasks(user_id);
  `);
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Faça login para continuar." });
  }
  next();
}

function normalizeUser(row) {
  return { id: row.id, email: row.email, username: row.username };
}

function normalizeTask(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    createdAt: row.created_at
  };
}

app.get("/healthz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "unavailable" });
  }
});

app.post("/api/auth/register", registerLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const username = String(req.body.username || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return res.status(400).json({ error: "Informe um endereço de e-mail válido." });
    }
    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      return res.status(400).json({ error: "O usuário deve ter de 3 a 24 caracteres (letras, números ou _)." });
    }
    if (password.length < 10 || password.length > 128) {
      return res.status(400).json({ error: "A senha deve ter entre 10 e 128 caracteres." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (email, username, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, email, username`,
      [email, username, passwordHash]
    );
    const user = normalizeUser(result.rows[0]);
    req.session.regenerate(error => {
      if (error) return next(error);
      req.session.userId = user.id;
      req.session.save(saveError => {
        if (saveError) return next(saveError);
        res.status(201).json({ user });
      });
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Este e-mail ou nome de usuário já está cadastrado." });
    }
    next(error);
  }
});

app.post("/api/auth/login", loginLimiter, async (req, res, next) => {
  try {
    const identity = String(req.body.identity || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!identity || !password) {
      return res.status(400).json({ error: "Preencha o e-mail/usuário e a senha." });
    }

    const result = await pool.query(
      `SELECT id, email, username, password_hash
       FROM users
       WHERE LOWER(email) = $1 OR LOWER(username) = $1
       LIMIT 1`,
      [identity]
    );
    const userRow = result.rows[0];
    const valid = userRow ? await bcrypt.compare(password, userRow.password_hash) : false;
    if (!valid) {
      return res.status(401).json({ error: "E-mail/usuário ou senha inválidos." });
    }

    req.session.regenerate(error => {
      if (error) return next(error);
      req.session.userId = userRow.id;
      req.session.save(saveError => {
        if (saveError) return next(saveError);
        res.json({ user: normalizeUser(userRow) });
      });
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/me", async (req, res, next) => {
  try {
    if (!req.session.userId) return res.json({ user: null });
    const result = await pool.query(
      "SELECT id, email, username FROM users WHERE id = $1",
      [req.session.userId]
    );
    if (!result.rows[0]) {
      return req.session.destroy(() => res.json({ user: null }));
    }
    res.json({ user: normalizeUser(result.rows[0]) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", (req, res, next) => {
  req.session.destroy(error => {
    if (error) return next(error);
    res.clearCookie("flowboard.sid", {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax"
    });
    res.status(204).end();
  });
});

app.get("/api/tasks", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, title, description, status, created_at
       FROM tasks WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.session.userId]
    );
    res.json({ tasks: result.rows.map(normalizeTask) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/tasks", requireAuth, async (req, res, next) => {
  try {
    const title = String(req.body.title || "").trim();
    const description = String(req.body.description || "").trim();
    if (!title || title.length > 90) {
      return res.status(400).json({ error: "O título é obrigatório e deve ter até 90 caracteres." });
    }
    if (description.length > 500) {
      return res.status(400).json({ error: "A descrição deve ter até 500 caracteres." });
    }
    const result = await pool.query(
      `INSERT INTO tasks (user_id, title, description)
       VALUES ($1, $2, $3)
       RETURNING id, title, description, status, created_at`,
      [req.session.userId, title, description]
    );
    res.status(201).json({ task: normalizeTask(result.rows[0]) });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/tasks/:id", requireAuth, async (req, res, next) => {
  try {
    const status = String(req.body.status || "");
    if (!["todo", "doing", "done"].includes(status)) {
      return res.status(400).json({ error: "Status de tarefa inválido." });
    }
    const result = await pool.query(
      `UPDATE tasks SET status = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3
       RETURNING id, title, description, status, created_at`,
      [status, req.params.id, req.session.userId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Tarefa não encontrada." });
    res.json({ task: normalizeTask(result.rows[0]) });
  } catch (error) {
    if (error.code === "22P02") return res.status(400).json({ error: "Identificador de tarefa inválido." });
    next(error);
  }
});

app.delete("/api/tasks/:id", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      "DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING id",
      [req.params.id, req.session.userId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Tarefa não encontrada." });
    res.status(204).end();
  } catch (error) {
    if (error.code === "22P02") return res.status(400).json({ error: "Identificador de tarefa inválido." });
    next(error);
  }
});

app.use(express.static(path.join(__dirname, "public"), {
  extensions: ["html"],
  maxAge: isProduction ? "1h" : 0
}));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.use((error, _req, res, _next) => {
  console.error(error);
  if (res.headersSent) return;
  res.status(500).json({ error: "Ocorreu um erro interno. Tente novamente." });
});

initializeDatabase()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`FlowBoard disponível na porta ${PORT}`);
    });
  })
  .catch(error => {
    console.error("Falha ao inicializar o banco de dados:", error);
    process.exit(1);
  });

process.on("SIGTERM", async () => {
  await pool.end();
  process.exit(0);
});
