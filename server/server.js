import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { connectDB, ChatStore, UserStore } from './db.js';
import { seedInitialDataIfNeeded, streamDebate } from './services/debateService.js';
import { hashPassword, verifyPassword, generateToken, verifyToken } from './utils/auth.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Middleware to extract authenticated user from token if present
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = decoded;
    }
  }
  next();
}

app.use(authMiddleware);

/* ==========================================================================
   AUTHENTICATION ROUTES
   ========================================================================== */

// Sign Up
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, and password are required' });
    }

    const existing = await UserStore.findByEmail(email);
    if (existing) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists' });
    }

    const { salt, hash } = hashPassword(password);
    const userId = 'user-' + Date.now();
    const avatarInitial = name.trim().charAt(0).toUpperCase();

    const newUser = await UserStore.create({
      id: userId,
      name: name.trim(),
      email: email.toLowerCase().trim(),
      passwordHash: hash,
      salt,
      avatarInitial
    });

    const token = generateToken(newUser);
    res.status(201).json({
      success: true,
      token,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        avatarInitial: newUser.avatarInitial
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const user = await UserStore.findByEmail(email);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const isValid = verifyPassword(password, user.passwordHash, user.salt);
    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const token = generateToken(user);
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarInitial: user.avatarInitial || user.name.charAt(0).toUpperCase()
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Current User Profile
app.get('/api/auth/me', (req, res) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  res.json({ success: true, user: req.user });
});

/* ==========================================================================
   CHAT & DEBATE ROUTES
   ========================================================================== */

// Get all chats for the authenticated user
app.get('/api/chats', async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    if (!userId) {
      return res.json({ success: true, chats: [] });
    }
    const chats = await ChatStore.getAll(userId);
    res.json({ success: true, chats });
  } catch (error) {
    console.error('Error fetching chats:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get single chat by ID (private to the user)
app.get('/api/chats/:id', async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const chat = await ChatStore.getById(req.params.id, userId);
    if (!chat) {
      return res.status(404).json({ success: false, message: 'Chat not found' });
    }
    res.json({ success: true, chat });
  } catch (error) {
    console.error('Error fetching chat:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Real-Time Server-Sent Events (SSE) Stream: Live Debate Flow!
app.get('/api/debate/stream', async (req, res) => {
  const question = req.query.question;
  const chatId = req.query.chatId || null;
  if (!question || !question.trim()) {
    return res.status(400).send('Question is required');
  }

  let token = req.query.token;
  if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.substring(7);
  }

  let user = null;
  if (token) {
    user = verifyToken(token);
  }
  if (!user && req.user) {
    user = req.user;
  }

  // Set SSE Headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*'
  });
  res.flushHeaders?.();

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    await streamDebate(question.trim(), user, sendEvent, chatId);
    res.end();
  } catch (err) {
    console.error('Stream debate error:', err);
    sendEvent('error', { message: err.message });
    res.end();
  }
});

// Delete chat
app.delete('/api/chats/:id', async (req, res) => {
  try {
    await ChatStore.delete(req.params.id);
    res.json({ success: true, message: 'Chat deleted' });
  } catch (error) {
    console.error('Error deleting chat:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'SecondOpinion Multi-Agent System' });
});

// Serve frontend build if available
const clientDistPath = path.join(__dirname, '../client/dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

async function startServer() {
  await connectDB();
  await UserStore.seedDefaultUser();
  await seedInitialDataIfNeeded();

  app.listen(PORT, () => {
    console.log(`[SecondOpinion] Backend running on http://localhost:${PORT}`);
  });
}

startServer();
