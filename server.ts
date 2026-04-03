import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import fs from 'fs';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import qrcode from 'qrcode';
import { createRequire } from 'module';
import db, { initDb, isMySQL } from './backend/db.js';
import { GoogleGenAI } from "@google/genai";

const require = createRequire(import.meta.url);
const { authenticator } = require('otplib');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
import { callAI, interpretGuidance, getActiveApiKeys } from './backend/ai.js';
import { connectToWhatsApp, getSession, syncWhatsAppHistory } from './backend/whatsapp.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Security Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for Vite dev server compatibility
  crossOriginEmbedderPolicy: false,
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: '*',
  },
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dealism-secure-secret-2026';

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));

// Multer setup
const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Auth Middleware
const authenticateToken = async (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token || token === 'null' || token === 'undefined') {
    return res.sendStatus(401);
  }

  jwt.verify(token, JWT_SECRET, async (err: any, decoded: any) => {
    if (err) {
      return res.sendStatus(403);
    }
    
    const user = await db.prepare('SELECT id, email, role, is_two_factor_enabled FROM users WHERE id = ?').get(decoded.id) as any;
    if (!user) {
      return res.sendStatus(403);
    }

    req.user = user;
    next();
  });
};

// --- Auth Routes ---
app.get('/api/auth/me', authenticateToken, (req: any, res) => {
  res.json(req.user);
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (user.is_two_factor_enabled) {
    // Return a temporary token for 2FA verification
    const tempToken = jwt.sign({ id: user.id, is2faPending: true }, JWT_SECRET, { expiresIn: '5m' });
    return res.json({ is2faRequired: true, tempToken });
  }

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET);
  res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
});

app.post('/api/auth/verify-2fa', async (req, res) => {
  const { token, code } = req.body;
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    if (!decoded.is2faPending) return res.status(401).json({ error: 'Invalid 2FA session' });

    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.id) as any;
    if (!user || !user.two_factor_secret) return res.status(401).json({ error: 'User not found or 2FA not setup' });

    const isValid = authenticator.verify({
      token: code,
      secret: user.two_factor_secret
    });

    if (!isValid) return res.status(401).json({ error: 'Invalid 2FA code' });

    const finalToken = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET);
    res.json({ token: finalToken, user: { id: user.id, email: user.email, role: user.role } });
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired 2FA session' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  res.status(403).json({ error: 'Registration is disabled' });
});

app.post('/api/auth/change-password', authenticateToken, async (req: any, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id) as any;

  if (!user || !bcrypt.compareSync(currentPassword, user.password)) {
    return res.status(401).json({ error: 'Invalid current password' });
  }

  const hashedPassword = bcrypt.hashSync(newPassword, 10);
  await db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, user.id);
  res.json({ success: true });
});

app.post('/api/auth/setup-2fa', authenticateToken, async (req: any, res) => {
  const secret = authenticator.generateSecret();
  const user = req.user;
  
  await db.prepare('UPDATE users SET two_factor_secret = ? WHERE id = ?').run(secret, user.id);
  
  const otpauth = authenticator.keyuri(user.email, 'Geeks Genics', secret);
  const qrCodeUrl = await qrcode.toDataURL(otpauth);
  
  res.json({ secret, qrCodeUrl });
});

app.post('/api/auth/enable-2fa', authenticateToken, async (req: any, res) => {
  const { code } = req.body;
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id) as any;
  
  if (!user.two_factor_secret) return res.status(400).json({ error: '2FA not setup' });
  
  const isValid = authenticator.verify({
    token: code,
    secret: user.two_factor_secret
  });
  
  if (!isValid) return res.status(400).json({ error: 'Invalid code' });
  
  await db.prepare('UPDATE users SET is_two_factor_enabled = 1 WHERE id = ?').run(user.id);
  res.json({ success: true });
});

// --- Settings Routes ---
const validateApiKey = async (provider: string, apiKey: string) => {
  if (!apiKey) return { isValid: false, credits: 0 };
  // Mock validation logic - in a real app, this would call the provider's API
  // to verify the key and get usage/credits.
  // For demonstration, we'll return a random credit amount between 5 and 50.
  return {
    isValid: apiKey.length > 10,
    credits: Math.floor(Math.random() * 45) + 5
  };
};

app.get('/api/settings', authenticateToken, async (req: any, res) => {
  try {
    const settings = await db.prepare('SELECT * FROM settings WHERE user_id = ?').all(req.user.id);
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

app.post('/api/settings', authenticateToken, async (req: any, res) => {
  const { provider, api_key } = req.body;
  
  if (!provider || !api_key) {
    return res.status(400).json({ error: 'Provider and API key are required' });
  }

  try {
    const validation = await validateApiKey(provider, api_key);
    
    if (!validation.isValid) {
      return res.status(400).json({ error: 'Invalid API key format' });
    }

    const existing = await db.prepare('SELECT id FROM settings WHERE user_id = ? AND provider = ?').get(req.user.id, provider) as any;
    if (existing) {
      await db.prepare("UPDATE settings SET api_key = ?, is_active = 1, status = 'active', credits_remaining = ? WHERE id = ?")
        .run(api_key, validation.credits, existing.id);
    } else {
      await db.prepare('INSERT INTO settings (user_id, provider, api_key, credits_remaining) VALUES (?, ?, ?, ?)')
        .run(req.user.id, provider, api_key, validation.credits);
    }
    
    res.json({ 
      success: true, 
      message: 'API connected successfully',
      credits: validation.credits
    });
  } catch (error: any) {
    console.error('Failed to save settings:', error);
    res.status(500).json({ error: `Failed to save settings: ${error.message}` });
  }
});

app.post('/api/settings/refresh', authenticateToken, async (req: any, res) => {
  try {
    const settings = await db.prepare('SELECT * FROM settings WHERE user_id = ?').all(req.user.id) as any[];
    
    for (const setting of settings) {
      const validation = await validateApiKey(setting.provider, setting.api_key);
      await db.prepare('UPDATE settings SET credits_remaining = ?, status = ? WHERE id = ?')
        .run(validation.credits, validation.isValid ? 'active' : 'error', setting.id);
    }
    
    const updatedSettings = await db.prepare('SELECT * FROM settings WHERE user_id = ?').all(req.user.id);
    res.json(updatedSettings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to refresh settings' });
  }
});

app.delete('/api/settings/:provider', authenticateToken, async (req: any, res) => {
  try {
    await db.prepare('DELETE FROM settings WHERE user_id = ? AND provider = ?').run(req.user.id, req.params.provider);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete setting' });
  }
});

// --- Agent Routes ---
// --- AI & Transcription Routes ---
app.post('/api/transcribe', authenticateToken, upload.single('audio'), async (req: any, res) => {
  let base64Audio = '';
  let mimeType = '';

  try {
    if (req.file) {
      const audioData = fs.readFileSync(req.file.path);
      base64Audio = audioData.toString('base64');
      mimeType = req.file.mimetype;
      fs.unlinkSync(req.file.path);
    } else if (req.body.audio) {
      base64Audio = req.body.audio;
      mimeType = req.body.mimeType || "audio/mpeg";
    } else {
      return res.status(400).json({ error: 'No audio provided' });
    }

    const transcription = await callAI(req.user.id, "Transcribe this audio message. Return only the transcription text. If it's empty or noise, return an empty string.", "", {
      inlineData: {
        mimeType: mimeType || "audio/webm",
        data: base64Audio,
      },
    });

    res.json({ text: transcription?.trim() || '' });
  } catch (error: any) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error('Transcription Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/agents/:id/guide', authenticateToken, async (req: any, res) => {
  const agentId = req.params.id;
  const { message } = req.body;
  
  try {
    // Fetch contacts for context
    const contacts = await db.prepare('SELECT jid, name FROM contacts WHERE session_id IN (SELECT id FROM whatsapp_sessions WHERE user_id = ?)').all(req.user.id) as any[];
    
    const response = await interpretGuidance(req.user.id, parseInt(agentId), message, contacts, getSession, io);
    res.json({ response });
  } catch (error: any) {
    console.error('Guidance failed:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/agents/:id/rules', authenticateToken, async (req, res) => {
  const rules = await db.prepare('SELECT * FROM agent_rules WHERE agent_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(rules);
});

app.delete('/api/agents/:agentId/rules/:ruleId', authenticateToken, async (req, res) => {
  await db.prepare('DELETE FROM agent_rules WHERE id = ? AND agent_id = ?').run(req.params.ruleId, req.params.agentId);
  res.json({ success: true });
});

app.get('/api/agents', authenticateToken, async (req: any, res) => {
  const agents = await db.prepare('SELECT * FROM agents WHERE user_id = ?').all(req.user.id);
  res.json(agents);
});

app.post('/api/agents', authenticateToken, async (req: any, res) => {
  const { name, personality, role, knowledge_base, brand_company, product_service, objective, tone, playbook, others, avatar, strategy } = req.body;
  const result = await db.prepare('INSERT INTO agents (user_id, name, personality, role, knowledge_base, brand_company, product_service, objective, tone, playbook, others, avatar, strategy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(req.user.id, name, personality, role, knowledge_base, brand_company, product_service, objective, tone, playbook, others, avatar, strategy);
  res.json({ id: result.lastInsertRowid });
});

app.put('/api/agents/:id', authenticateToken, async (req, res) => {
  const { name, personality, role, knowledge_base, brand_company, product_service, objective, tone, playbook, others, avatar, is_active, strategy } = req.body;
  await db.prepare('UPDATE agents SET name = ?, personality = ?, role = ?, knowledge_base = ?, brand_company = ?, product_service = ?, objective = ?, tone = ?, playbook = ?, others = ?, avatar = ?, is_active = ?, strategy = ? WHERE id = ?')
    .run(name, personality, role, knowledge_base, brand_company, product_service, objective, tone, playbook, others, avatar, is_active ? 1 : 0, strategy, req.params.id);
  res.json({ success: true });
});

app.post('/api/agents/bulk-delete', authenticateToken, async (req, res) => {
  const { ids } = req.body;
  console.log('Bulk delete request received for agents:', ids);
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'No IDs provided' });

  try {
    for (const agentId of ids) {
      console.log(`Processing deletion for agent ${agentId}`);
      // Find associated sessions to clean up active connections and files
      const sessions = await db.prepare('SELECT id FROM whatsapp_sessions WHERE agent_id = ?').all(agentId) as any[];
      console.log(`Found ${sessions.length} sessions for agent ${agentId}`);
      
      for (const session of sessions) {
        const sessionId = session.id.toString();
        const sock = getSession(sessionId);
        
        if (sock) {
          console.log(`Logging out active session ${sessionId}`);
          try {
            await sock.logout();
          } catch (e) {
            console.warn(`Logout failed for session ${sessionId} during bulk agent deletion:`, e);
            try { sock.end(undefined); } catch (e2) {}
          }
        }

        const sessionDir = path.join(process.cwd(), 'sessions', sessionId);
        if (fs.existsSync(sessionDir)) {
          console.log(`Removing session directory: ${sessionDir}`);
          try {
            fs.rmSync(sessionDir, { recursive: true, force: true });
          } catch (e) {
            console.error(`Failed to remove directory for session ${sessionId} during bulk agent deletion:`, e);
          }
        }
      }

      // The DB records will be deleted automatically due to ON DELETE CASCADE
      const result = await db.prepare('DELETE FROM agents WHERE id = ?').run(agentId);
      console.log(`Agent ${agentId} deleted from DB.`);
    }
    res.json({ success: true });
  } catch (error) {
    console.error(`Failed to bulk delete agents:`, error);
    res.status(500).json({ error: 'Failed to bulk delete agents' });
  }
});

app.delete('/api/agents/:id', authenticateToken, async (req, res) => {
  const agentId = req.params.id;
  
  try {
    // Find associated sessions to clean up active connections and files
    const sessions = await db.prepare('SELECT id FROM whatsapp_sessions WHERE agent_id = ?').all(agentId) as any[];
    
    for (const session of sessions) {
      const sessionId = session.id.toString();
      const sock = getSession(sessionId);
      
      if (sock) {
        try {
          await sock.logout();
        } catch (e) {
          console.warn(`Logout failed for session ${sessionId} during agent deletion:`, e);
          try { sock.end(undefined); } catch (e2) {}
        }
      }

      const sessionDir = path.join(process.cwd(), 'sessions', sessionId);
      if (fs.existsSync(sessionDir)) {
        try {
          fs.rmSync(sessionDir, { recursive: true, force: true });
        } catch (e) {
          console.error(`Failed to remove directory for session ${sessionId} during agent deletion:`, e);
        }
      }
    }

    // The DB records will be deleted automatically due to ON DELETE CASCADE
    await db.prepare('DELETE FROM agents WHERE id = ?').run(agentId);
    res.json({ success: true });
  } catch (error) {
    console.error(`Failed to delete agent ${agentId}:`, error);
    res.status(500).json({ error: 'Failed to delete agent' });
  }
});

app.post('/api/agents/:id/avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  
  const avatarUrl = `/uploads/${req.file.filename}`;
  await db.prepare('UPDATE agents SET avatar = ? WHERE id = ?').run(avatarUrl, req.params.id);
  res.json({ avatarUrl });
});

app.post('/api/messages/:id/transcription', authenticateToken, async (req, res) => {
  const { transcription } = req.body;
  await db.prepare('UPDATE messages SET transcription = ? WHERE id = ?').run(transcription, req.params.id);
  res.json({ success: true });
});

// Serve uploads statically
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// --- Agent Training Routes ---
app.get('/api/agents/:id/training-files', authenticateToken, async (req, res) => {
  const files = await db.prepare('SELECT id, original_name, created_at FROM training_files WHERE agent_id = ?').all(req.params.id);
  res.json(files);
});

app.post('/api/agents/:id/train-file', authenticateToken, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let content = '';
  const fileExtension = path.extname(req.file.originalname).toLowerCase();

  try {
    if (fileExtension === '.pdf') {
      const dataBuffer = fs.readFileSync(req.file.path);
      const data = await pdf(dataBuffer);
      content = data.text;
    } else if (fileExtension === '.docx') {
      const result = await mammoth.extractRawText({ path: req.file.path });
      content = result.value;
    } else {
      content = fs.readFileSync(req.file.path, 'utf-8');
    }

    await db.prepare('INSERT INTO training_files (agent_id, filename, original_name, content) VALUES (?, ?, ?, ?)')
      .run(req.params.id, req.file.filename, req.file.originalname, content);

    res.json({ success: true });
  } catch (error) {
    console.error('Training file processing error:', error);
    res.status(500).json({ error: 'Failed to process file' });
  }
});

app.post('/api/agents/:id/train-history', authenticateToken, async (req, res) => {
  // Extract knowledge from past conversations for this agent's sessions
  const sessions = await db.prepare('SELECT id FROM whatsapp_sessions WHERE agent_id = ?').all(req.params.id) as any[];
  const sessionIds = sessions.map(s => s.id);

  if (sessionIds.length === 0) return res.json({ success: true, message: 'No sessions found' });

  const placeholders = sessionIds.map(() => '?').join(',');
  const messages = await db.prepare(`
    SELECT m.content 
    FROM messages m
    JOIN conversations c ON m.conversation_id = c.id
    WHERE c.session_id IN (${placeholders})
    ORDER BY m.created_at DESC
    LIMIT 100
  `).all(...sessionIds) as any[];

  const historyContent = messages.map(m => m.content).join('\n');
  
  // Save as a special training file or append to knowledge base
  await db.prepare('INSERT INTO training_files (agent_id, filename, original_name, content) VALUES (?, ?, ?, ?)')
    .run(req.params.id, `history_${Date.now()}.txt`, 'Chat History Training', historyContent);

  res.json({ success: true });
});

app.delete('/api/agents/:agentId/training-files/:fileId', authenticateToken, async (req, res) => {
  const file = await db.prepare('SELECT filename FROM training_files WHERE id = ? AND agent_id = ?').get(req.params.fileId, req.params.agentId) as any;
  if (file) {
    const filePath = path.join(process.cwd(), 'uploads', file.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await db.prepare('DELETE FROM training_files WHERE id = ?').run(req.params.fileId);
  }
  res.json({ success: true });
});

app.post('/api/ai/suggestion', authenticateToken, async (req: any, res) => {
  const { sessionId, lastMessage } = req.body;
  try {
    const agentData = await db.prepare('SELECT * FROM agents WHERE id = (SELECT agent_id FROM whatsapp_sessions WHERE id = ?)').get(sessionId) as any;
    if (!agentData) return res.status(404).json({ error: 'Agent not found' });

    const prompt = `
      You are ${agentData.name}. 
      Your role: ${agentData.role}.
      Your personality: ${agentData.personality}.
      Company: ${agentData.brand_company}.
      Product/Service: ${agentData.product_service}.
      Objective: ${agentData.objective}.
      Tone: ${agentData.tone}.
      Playbook: ${agentData.playbook}.
      
      Knowledge Base:
      ${agentData.knowledge_base}
      ${agentData.trainingData}
      
      Last Customer Message: "${lastMessage}"
      
      Generate a helpful response for the agent to send. Keep it concise for WhatsApp.
      IMPORTANT: Use Google Search if you need real-time information to answer accurately.
    `;

    const response = await callAI(req.user.id, prompt);
    res.json({ suggestion: response });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- WhatsApp Routes ---
app.get('/api/whatsapp/sessions', authenticateToken, async (req: any, res) => {
  const sessions = await db.prepare('SELECT * FROM whatsapp_sessions WHERE user_id = ?').all(req.user.id);
  res.json(sessions);
});

app.post('/api/whatsapp/sessions', authenticateToken, async (req: any, res) => {
  const { agent_id, name } = req.body;
  const result = await db.prepare('INSERT INTO whatsapp_sessions (user_id, agent_id, name) VALUES (?, ?, ?)').run(req.user.id, agent_id, name);
  res.json({ id: result.lastInsertRowid });
});

app.post('/api/whatsapp/sessions/bulk-delete', authenticateToken, async (req: any, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'No IDs provided' });

  try {
    for (const sessionId of ids) {
      const sid = sessionId.toString();
      // Verify ownership
      const session = await db.prepare('SELECT * FROM whatsapp_sessions WHERE id = ? AND user_id = ?').get(sid, req.user.id);
      if (!session) continue;

      const sock = getSession(sid);
      
      if (sock) {
        try {
          await sock.logout();
        } catch (e) {
          console.warn(`Logout failed for session ${sid} during bulk deletion:`, e);
          try { sock.end(undefined); } catch (e2) {}
        }
      }

      const sessionDir = path.join(process.cwd(), 'sessions', sid);
      if (fs.existsSync(sessionDir)) {
        try {
          fs.rmSync(sessionDir, { recursive: true, force: true });
        } catch (e) {
          console.error(`Failed to remove directory for session ${sid}:`, e);
        }
      }

      await db.prepare('DELETE FROM whatsapp_sessions WHERE id = ? AND user_id = ?').run(sessionId, req.user.id);
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to bulk delete sessions:', error);
    res.status(500).json({ error: 'Failed to bulk delete sessions' });
  }
});

app.delete('/api/whatsapp/sessions/:id', authenticateToken, async (req: any, res) => {
  const sessionId = req.params.id;
  const sessionDir = path.join(process.cwd(), 'sessions', sessionId);
  
  try {
    // Verify ownership
    const session = await db.prepare('SELECT * FROM whatsapp_sessions WHERE id = ? AND user_id = ?').get(sessionId, req.user.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const sock = getSession(sessionId);
    if (sock) {
      try {
        await sock.logout();
      } catch (e) {
        console.warn(`Logout failed for session ${sessionId}, forcing close:`, e);
        try { sock.end(undefined); } catch (e2) {}
      }
    }
    
    if (fs.existsSync(sessionDir)) {
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      } catch (e) {
        console.error(`Failed to remove directory for session ${sessionId}:`, e);
      }
    }
    
    await db.prepare('DELETE FROM whatsapp_sessions WHERE id = ? AND user_id = ?').run(sessionId, req.user.id);
    res.json({ success: true });
  } catch (error) {
    console.error(`Failed to delete session ${sessionId}:`, error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

app.post('/api/whatsapp/sessions/:id/sync', authenticateToken, async (req: any, res) => {
  const sessionId = req.params.id;
  try {
    // Verify ownership
    const session = await db.prepare('SELECT * FROM whatsapp_sessions WHERE id = ? AND user_id = ?').get(sessionId, req.user.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // This is an async operation that emits progress via socket
    syncWhatsAppHistory(sessionId, io).catch(err => console.error('Background sync failed:', err));
    res.json({ success: true, message: 'Sync started' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/whatsapp/sessions/:id/connect', authenticateToken, async (req: any, res) => {
  const sessionId = req.params.id;
  try {
    // Verify ownership
    const session = await db.prepare('SELECT * FROM whatsapp_sessions WHERE id = ? AND user_id = ?').get(sessionId, req.user.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    await connectToWhatsApp(sessionId, io);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to connect' });
  }
});

app.post('/api/whatsapp/sessions/:id/disconnect', authenticateToken, async (req: any, res) => {
  const sessionId = req.params.id;
  
  try {
    // Verify ownership
    const session = await db.prepare('SELECT * FROM whatsapp_sessions WHERE id = ? AND user_id = ?').get(sessionId, req.user.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const sock = getSession(sessionId);
    const sessionDir = path.join(process.cwd(), 'sessions', sessionId);

    if (sock) {
      try {
        await sock.logout();
      } catch (e) {
        console.warn(`Logout failed for session ${sessionId}, forcing close:`, e);
        try { sock.end(undefined); } catch (e2) {}
      }
    }
    
    // Even if sock is not found or logout fails, we clean up locally
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    
    // Remove all conversations and messages for this session
    await db.prepare('DELETE FROM conversations WHERE session_id = ?').run(sessionId);
    await db.prepare('DELETE FROM contacts WHERE session_id = ?').run(sessionId);
    
    await db.prepare('UPDATE whatsapp_sessions SET status = ?, number = NULL WHERE id = ?').run('disconnected', sessionId);
    const userRoom = `user_${req.user.id}`;
    io.to(userRoom).emit('connection_status', { sessionId, status: 'disconnected' });
    io.to(userRoom).emit('session_disconnected', { sessionId }); // New event for UI to clear chats
    
    res.json({ success: true });
  } catch (error) {
    console.error(`Failed to disconnect session ${sessionId}:`, error);
    // Force cleanup on error
    const sessionDir = path.join(process.cwd(), 'sessions', sessionId);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    await db.prepare('DELETE FROM conversations WHERE session_id = ?').run(sessionId);
    await db.prepare('UPDATE whatsapp_sessions SET status = ?, number = NULL WHERE id = ?').run('disconnected', sessionId);
    res.json({ success: true, message: 'Disconnected with forced cleanup' });
  }
});

app.get('/api/agents/session/:sessionId', authenticateToken, async (req, res) => {
  const session = await db.prepare('SELECT agent_id FROM whatsapp_sessions WHERE id = ?').get(req.params.sessionId) as any;
  if (!session || !session.agent_id) return res.status(404).json({ error: 'Session or agent not found' });

  const agent = await db.prepare('SELECT * FROM agents WHERE id = ?').get(session.agent_id) as any;
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  // Also fetch training files
  const trainingFiles = await db.prepare('SELECT content FROM training_files WHERE agent_id = ?').all(agent.id) as any[];
  const trainingData = trainingFiles.map(f => f.content).join('\n\n');

  res.json({ ...agent, trainingData });
});

// --- WhatsApp Contact Routes ---
app.get('/api/whatsapp/contacts', authenticateToken, async (req, res) => {
  const contacts = await db.prepare(`
    SELECT c.*, ws.number as session_number 
    FROM contacts c
    JOIN whatsapp_sessions ws ON c.session_id = ws.id
    ORDER BY c.name ASC
  `).all();
  res.json(contacts);
});

// --- Conversation Routes ---
app.get('/api/conversations', authenticateToken, async (req: any, res) => {
  const conversations = await db.prepare(`
    SELECT 
      c.*, 
      COALESCE(c.contact_name, (SELECT name FROM contacts WHERE jid = c.contact_number AND name IS NOT NULL LIMIT 1)) as contact_name,
      ws.number as session_number, 
      a.name as agent_name,
      (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_content,
      (SELECT type FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_type
    FROM conversations c
    JOIN whatsapp_sessions ws ON c.session_id = ws.id
    JOIN agents a ON ws.agent_id = a.id
    WHERE ws.user_id = ?
    ORDER BY c.last_message_at DESC
  `).all(req.user.id);
  res.json(conversations);
});

app.get('/api/conversations/:id/messages', authenticateToken, async (req: any, res) => {
  const messages = await db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC').all(req.params.id);
  
  // Reset unread count when messages are fetched
  await db.prepare('UPDATE conversations SET unread_count = 0 WHERE id = ?').run(req.params.id);
  const userRoom = `user_${req.user.id}`;
  io.to(userRoom).emit('unread_reset', { conversationId: req.params.id });
  
  res.json(messages);
});

app.put('/api/conversations/:id/flags', authenticateToken, async (req, res) => {
  const { is_saved, is_ordered, is_rated, is_audited, is_autopilot } = req.body;
  const updates: string[] = [];
  const params: any[] = [];

  if (is_saved !== undefined) {
    updates.push('is_saved = ?');
    params.push(is_saved ? 1 : 0);
  }
  if (is_ordered !== undefined) {
    updates.push('is_ordered = ?');
    params.push(is_ordered ? 1 : 0);
  }
  if (is_rated !== undefined) {
    updates.push('is_rated = ?');
    params.push(is_rated ? 1 : 0);
  }
  if (is_audited !== undefined) {
    updates.push('is_audited = ?');
    params.push(is_audited ? 1 : 0);
  }
  if (is_autopilot !== undefined) {
    updates.push('is_autopilot = ?');
    params.push(is_autopilot ? 1 : 0);
  }

  if (updates.length === 0) return res.status(400).json({ error: 'No flags provided' });

  params.push(req.params.id);
  await db.prepare(`UPDATE conversations SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});

// --- Background Reminder Job ---
async function checkReminders() {
  console.log('Running background reminder check...');
  try {
    // Query conversations that need a reminder
    const threeDaysAgo = isMySQL 
      ? "DATE_SUB(NOW(), INTERVAL 3 DAY)" 
      : "datetime('now', '-3 days')";
      
    const conversations = await db.prepare(`
      SELECT c.*, ws.id as session_id_val
      FROM conversations c
      JOIN whatsapp_sessions ws ON c.session_id = ws.id
      WHERE c.is_saved = 0 
        AND (c.is_ordered = 1 OR c.is_audited = 1)
        AND c.is_rated = 1
        AND (c.contact_name IS NULL OR LOWER(c.contact_name) NOT LIKE '%client%')
        AND ws.status = 'connected'
        AND c.is_autopilot = 1 -- STRICTLY Autopilot only
        AND c.last_message_at < ${threeDaysAgo}
        AND (c.last_reminder_sent_at IS NULL OR c.last_reminder_sent_at < ${threeDaysAgo})
    `).all() as any[];

    console.log(`Found ${conversations.length} conversations needing reminders`);

    for (const conv of conversations) {
      const sock = getSession(conv.session_id_val.toString());
      if (!sock) continue;

      const reminderText = "Hi! We noticed it's been a few days since our last chat. What are your thoughts on our website? Also, which service are you interested in and when do you plan to avail it? We'd love to help you further!";
      
      try {
        await sock.sendMessage(conv.contact_number, { text: reminderText });
        
        // Save reminder to DB
        await db.prepare('INSERT INTO messages (conversation_id, sender, content, type) VALUES (?, ?, ?, ?)')
          .run(conv.id, 'agent', reminderText, 'text');
        
        await db.prepare('UPDATE conversations SET last_message_at = CURRENT_TIMESTAMP, last_reminder_sent_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(conv.id);

        console.log(`Sent reminder to ${conv.contact_number}`);
        
        // Emit to UI
        const session = await db.prepare('SELECT user_id FROM whatsapp_sessions WHERE id = ?').get(conv.session_id_val) as any;
        if (session) {
          const userRoom = `user_${session.user_id}`;
          io.to(userRoom).emit('new_message', {
            conversation_id: conv.id,
            sender: 'agent',
            content: reminderText,
            type: 'text',
            created_at: new Date().toISOString(),
            is_saved: conv.is_saved,
            is_ordered: conv.is_ordered,
            is_rated: conv.is_rated,
            is_audited: conv.is_audited
          });
        }

        // Small delay between reminders to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 5000));
      } catch (error) {
        console.error(`Failed to send reminder to ${conv.contact_number}:`, error);
      }
    }
  } catch (error) {
    console.error('Error in checkReminders job:', error);
  }
}

// Run every hour
setInterval(checkReminders, 60 * 60 * 1000);
// Also run once on startup after a short delay
setTimeout(checkReminders, 30000);

app.post('/api/whatsapp/send', authenticateToken, upload.single('file'), async (req: any, res) => {
  const { sessionId, jid, text, type } = req.body;
  const sock = getSession(sessionId);

  if (!sock) {
    return res.status(404).json({ error: 'Session not found or not connected' });
  }

  try {
    let messageOptions: any = {};
    if (type === 'text') {
      messageOptions = { text };
    } else if (req.file) {
      const buffer = fs.readFileSync(req.file.path);
      if (type === 'image') {
        messageOptions = { image: buffer, caption: text };
      } else if (type === 'video') {
        messageOptions = { video: buffer, caption: text };
      } else if (type === 'audio') {
        messageOptions = { audio: buffer, mimetype: req.file.mimetype };
      } else if (type === 'document') {
        messageOptions = { document: buffer, mimetype: req.file.mimetype, fileName: req.file.originalname };
      }
      // Clean up uploaded file
      fs.unlinkSync(req.file.path);
    }

    const result = await sock.sendMessage(jid, messageOptions);
    
    // Save to DB
    let conversation = await db.prepare('SELECT * FROM conversations WHERE session_id = ? AND contact_number = ?').get(sessionId, jid) as any;
    if (!conversation) {
      const convResult = await db.prepare('INSERT INTO conversations (session_id, contact_number) VALUES (?, ?)').run(sessionId, jid);
      conversation = { id: convResult.lastInsertRowid };
    }
    
    const msgResult = await db.prepare('INSERT INTO messages (conversation_id, sender, content, type) VALUES (?, ?, ?, ?)')
      .run(conversation.id, 'agent', text || `[${type}]`, type);
    const messageId = msgResult.lastInsertRowid;
    
    await db.prepare('UPDATE conversations SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?').run(conversation.id);

    // Emit event for real-time updates
    const userRoom = `user_${req.user.id}`;
    io.to(userRoom).emit('new_message', {
      id: messageId,
      conversation_id: conversation.id,
      sender: 'agent',
      content: text || `[${type}]`,
      type,
      created_at: new Date().toISOString(),
      is_saved: conversation.is_saved,
      is_ordered: conversation.is_ordered,
      is_rated: conversation.is_rated,
      is_audited: conversation.is_audited
    });

    res.json({ success: true, result });
  } catch (error) {
    console.error('Failed to send message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// --- Bulk Messaging Routes ---
app.post('/api/bulk/campaigns', authenticateToken, async (req, res) => {
  const { name, message, recipients } = req.body;
  const result = await db.prepare('INSERT INTO bulk_campaigns (name, message) VALUES (?, ?)').run(name, message);
  const campaignId = result.lastInsertRowid;

  const insertRecipient = await db.prepare('INSERT INTO bulk_recipients (campaign_id, number) VALUES (?, ?)');
  for (const number of recipients) {
    await insertRecipient.run(campaignId, number);
  }

  // Start background processing
  processBulkCampaign(campaignId as number);

  res.json({ id: campaignId });
});

async function processBulkCampaign(campaignId: number) {
  const campaign = await db.prepare('SELECT * FROM bulk_campaigns WHERE id = ?').get(campaignId) as any;
  const recipients = await db.prepare('SELECT * FROM bulk_recipients WHERE campaign_id = ? AND status = ?').all(campaignId, 'pending') as any[];
  
  // Get first available connected session
  const session = await db.prepare('SELECT * FROM whatsapp_sessions WHERE status = ? LIMIT 1').get('connected') as any;
  if (!session) {
    console.error('No connected WhatsApp session for bulk campaign');
    await db.prepare('UPDATE bulk_campaigns SET status = ? WHERE id = ?').run('failed', campaignId);
    return;
  }

  const sock = getSession(session.id.toString());
  if (!sock) return;

  await db.prepare('UPDATE bulk_campaigns SET status = ? WHERE id = ?').run('processing', campaignId);

  for (const recipient of recipients) {
    try {
      const jid = `${recipient.number}@s.whatsapp.net`;
      await sock.sendMessage(jid, { text: campaign.message });
      await db.prepare('UPDATE bulk_recipients SET status = ? WHERE id = ?').run('sent', recipient.id);
      
      // Random delay between 10-30 seconds to mimic human behavior
      const delay = Math.floor(Math.random() * 20000) + 10000;
      await new Promise(resolve => setTimeout(resolve, delay));
    } catch (error) {
      console.error(`Failed to send bulk message to ${recipient.number}:`, error);
      await db.prepare('UPDATE bulk_recipients SET status = ? WHERE id = ?').run('failed', recipient.id);
    }
  }

  await db.prepare('UPDATE bulk_campaigns SET status = ? WHERE id = ?').run('completed', campaignId);
}

// --- Vite Middleware ---
if (process.env.NODE_ENV !== 'production') {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Initialize Database
await initDb();

httpServer.listen(Number(PORT), '0.0.0.0', async () => {
  console.log(`Server is listening on 0.0.0.0:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
  
  // Reconnect previously connected sessions on startup
  try {
    const connectedSessions = await db.prepare("SELECT id FROM whatsapp_sessions WHERE status = 'connected'").all() as any[];
    console.log(`Found ${connectedSessions.length} sessions to reconnect on startup`);
    for (const session of connectedSessions) {
      console.log(`Attempting to reconnect session ${session.id}...`);
      connectToWhatsApp(session.id.toString(), io).catch(err => {
        console.error(`Failed to reconnect session ${session.id}:`, err);
      });
    }
  } catch (error) {
    console.error('Error during session reconnection startup:', error);
  }
});
