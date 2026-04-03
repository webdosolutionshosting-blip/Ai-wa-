import {
  makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  WASocket,
  proto,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import db, { isMySQL } from './db.js';
import { callAI } from './ai.js';
import { Server as SocketIOServer } from 'socket.io';

const logger = pino({ level: 'silent' });

interface SessionManager {
  [key: string]: WASocket;
}

const sessions: SessionManager = {};

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

export async function connectToWhatsApp(sessionId: string, io: SocketIOServer) {
  const sessionDir = path.join(process.cwd(), 'sessions', sessionId);
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version, isLatest } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
  });

  sessions[sessionId] = sock;

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    const session = await db.prepare('SELECT user_id FROM whatsapp_sessions WHERE id = ?').get(sessionId) as any;
    const userRoom = session ? `user_${session.user_id}` : null;

    if (qr && userRoom) {
      io.to(userRoom).emit('qr', { sessionId, qr });
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      
      console.log(`Connection closed for session ${sessionId}. Status: ${statusCode}. Reconnecting: ${shouldReconnect}`);
      
      if (userRoom) {
        io.to(userRoom).emit('connection_status', { sessionId, status: 'disconnected' });
      }
      
      if (shouldReconnect) {
        // Add a small delay for stream errors (like 515) to avoid rapid reconnection loops
        const delay = statusCode === 515 ? 5000 : 2000;
        setTimeout(() => connectToWhatsApp(sessionId, io), delay);
      } else {
        // Logged out, clean up
        if (fs.existsSync(sessionDir)) {
          fs.rmSync(sessionDir, { recursive: true, force: true });
        }
        await db.prepare('UPDATE whatsapp_sessions SET status = ?, number = NULL WHERE id = ?').run('disconnected', sessionId);
        if (userRoom) {
          io.to(userRoom).emit('connection_status', { sessionId, status: 'disconnected' });
        }
        delete sessions[sessionId];
      }
    } else if (connection === 'open') {
      console.log(`Opened connection for session ${sessionId}`);
      const number = sock.user?.id.split(':')[0];
      
      // Handle UNIQUE constraint: Clear this number from any other session first
      await db.prepare('UPDATE whatsapp_sessions SET number = NULL WHERE number = ? AND id != ?').run(number, sessionId);
      
      await db.prepare('UPDATE whatsapp_sessions SET status = ?, number = ? WHERE id = ?').run('connected', number, sessionId);
      if (userRoom) {
        io.to(userRoom).emit('connection_status', { sessionId, status: 'connected', number });
      }
      
      // Check for unreplied messages on connection
      setTimeout(() => checkUnrepliedMessages(sessionId, sock, io), 5000);
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messaging-history.set', async ({ chats, contacts, messages, isLatest }) => {
    console.log(`Syncing history for session ${sessionId}: ${chats.length} chats, ${contacts.length} contacts, ${messages.length} messages`);
    
    const session = await db.prepare('SELECT user_id FROM whatsapp_sessions WHERE id = ?').get(sessionId) as any;
    const userRoom = session ? `user_${session.user_id}` : null;
    
    if (userRoom) {
      io.to(userRoom).emit('sync_status', { sessionId, status: 'syncing', progress: 0, message: 'Syncing contacts...' });
    }
    
    try {
      // Sync contacts in a single transaction for speed
      await db.exec('START TRANSACTION');
      const insertContactSql = 'REPLACE INTO contacts (session_id, jid, name, number) VALUES (?, ?, ?, ?)';
      const insertContact = await db.prepare(insertContactSql);
      for (const contact of contacts) {
        const number = contact.id.split('@')[0];
        let name = contact.name || contact.verifiedName || null;
        
        if (!name) {
          const globalName = await db.prepare('SELECT name FROM contacts WHERE jid = ? AND name IS NOT NULL LIMIT 1').get(contact.id) as any;
          if (globalName) name = globalName.name;
        }
        
        await insertContact.run(sessionId, contact.id, name, number);
      }
      await db.exec('COMMIT');

      // Sync chats (conversations)
      if (userRoom) {
        io.to(userRoom).emit('sync_status', { sessionId, status: 'syncing', progress: 5, message: 'Syncing chats...' });
      }
      await db.exec('START TRANSACTION');
      const insertConvSql = 'INSERT IGNORE INTO conversations (session_id, contact_number, contact_name, last_message_at) VALUES (?, ?, ?, ?)';
      const insertConv = await db.prepare(insertConvSql);
      for (const chat of chats) {
        if (chat.id === 'status@broadcast' || !chat.id) continue;
        await insertConv.run(sessionId, chat.id, chat.name || null, new Date().toISOString());
      }
      await db.exec('COMMIT');

      // Sync messages/conversations
      if (userRoom) {
        io.to(userRoom).emit('sync_status', { sessionId, status: 'syncing', progress: 10, message: 'Syncing messages...' });
      }
      
      let processed = 0;
      const total = messages.length;
      
      // Process messages in chunks to avoid blocking too long and allow progress updates
      const chunkSize = 50;
      for (let i = 0; i < messages.length; i += chunkSize) {
        const chunk = messages.slice(i, i + chunkSize);
        await db.exec('START TRANSACTION');
        for (const msg of chunk) {
          if (msg.key?.remoteJid === 'status@broadcast' || !msg.key?.remoteJid) continue;
          if (msg.message) {
            await saveMessage(sessionId, sock, msg, io, false);
          }
          processed++;
        }
        await db.exec('COMMIT');
        
        const progress = Math.min(10 + Math.round((processed / total) * 90), 99);
        if (userRoom) {
          io.to(userRoom).emit('sync_status', { sessionId, status: 'syncing', progress, message: `Syncing messages (${processed}/${total})...` });
        }
      }
      
      if (userRoom) {
        io.to(userRoom).emit('sync_status', { sessionId, status: 'completed', progress: 100 });
      }
    } catch (error) {
      console.error(`Error during history sync for session ${sessionId}:`, error);
      await db.exec('ROLLBACK').catch(() => {});
      if (userRoom) {
        io.to(userRoom).emit('sync_status', { sessionId, status: 'error', message: 'Sync failed. Please try again.' });
      }
    }
  });

  sock.ev.on('chats.upsert', async (chats) => {
    const insertConvSql = 'INSERT IGNORE INTO conversations (session_id, contact_number, contact_name, last_message_at) VALUES (?, ?, ?, ?)';
    const insertConv = await db.prepare(insertConvSql);
    for (const chat of chats) {
      // Skip status updates
      if (!chat.id || chat.id === 'status@broadcast') continue;
      
      const number = chat.id.split('@')[0];
      await insertConv.run(sessionId, chat.id, chat.name || null, new Date().toISOString());
    }
  });

  sock.ev.on('chats.update', async (updates) => {
    const updateConv = await db.prepare('UPDATE conversations SET contact_name = COALESCE(?, contact_name) WHERE session_id = ? AND contact_number = ?');
    for (const update of updates) {
      if (update.name) {
        await updateConv.run(update.name, sessionId, update.id);
      }
    }
  });

  sock.ev.on('contacts.upsert', async (contacts) => {
    const insertContactSql = 'REPLACE INTO contacts (session_id, jid, name, number) VALUES (?, ?, ?, ?)';
    const insertContact = await db.prepare(insertContactSql);
    const updateConv = await db.prepare('UPDATE conversations SET contact_name = ? WHERE session_id = ? AND contact_number = ?');
    for (const contact of contacts) {
      const number = contact.id.split('@')[0];
      let name = contact.name || contact.verifiedName || null;
      
      // FORCEFUL GLOBAL NAME RETRIEVAL
      if (!name) {
        const globalName = await db.prepare('SELECT name FROM contacts WHERE jid = ? AND name IS NOT NULL LIMIT 1').get(contact.id) as any;
        if (globalName) name = globalName.name;
      }

      await insertContact.run(sessionId, contact.id, name, number);
      if (name) {
        await updateConv.run(name, sessionId, contact.id);
      }
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    if (m.type === 'notify') {
      for (const msg of m.messages) {
        // Skip status updates
        if (!msg.key?.remoteJid || msg.key.remoteJid === 'status@broadcast') continue;

        if (!msg.key.fromMe && msg.message) {
          await handleIncomingMessage(sessionId, sock, msg, io);
        } else if (msg.key.fromMe && msg.message) {
          // If message sent from phone, sync it and emit
          await saveMessage(sessionId, sock, msg, io, true);
        }
      }
    }
  });

  return sock;
}

async function saveMessage(sessionId: string, sock: WASocket, msg: proto.IWebMessageInfo, io: SocketIOServer, shouldEmit: boolean = true) {
  const from = msg.key?.remoteJid;
  if (!from || from === 'status@broadcast') return null;

  let text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
  let type = 'text';

  if (msg.message?.imageMessage) {
    type = 'image';
    try {
      let buffer: Buffer | null = null;
      let retries = 3;
      while (retries > 0 && !buffer) {
        try {
          buffer = await downloadMediaMessage(msg as any, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage }) as Buffer;
        } catch (e) {
          retries--;
          if (retries === 0) throw e;
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      const filename = `media_${Date.now()}.jpg`;
      const filePath = path.join(uploadsDir, filename);
      fs.writeFileSync(filePath, buffer!);
      text = `/uploads/${filename}`;
    } catch (e: any) {
      if (e.message?.includes('Forbidden') || e.message?.includes('fetch stream')) {
        console.warn(`Could not download image (likely expired): ${e.message}`);
      } else {
        console.error('Failed to download image:', e);
      }
      text = '[Image Message]';
    }
  } else if (msg.message?.videoMessage) {
    type = 'video';
    try {
      let buffer: Buffer | null = null;
      let retries = 3;
      while (retries > 0 && !buffer) {
        try {
          buffer = await downloadMediaMessage(msg as any, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage }) as Buffer;
        } catch (e) {
          retries--;
          if (retries === 0) throw e;
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      const filename = `media_${Date.now()}.mp4`;
      const filePath = path.join(uploadsDir, filename);
      fs.writeFileSync(filePath, buffer!);
      text = `/uploads/${filename}`;
    } catch (e: any) {
      if (e.message?.includes('Forbidden') || e.message?.includes('fetch stream')) {
        console.warn(`Could not download video (likely expired): ${e.message}`);
      } else {
        console.error('Failed to download video:', e);
      }
      text = '[Video Message]';
    }
  } else if (msg.message?.audioMessage) {
    type = 'audio';
    try {
      let buffer: Buffer | null = null;
      let retries = 3;
      while (retries > 0 && !buffer) {
        try {
          buffer = await downloadMediaMessage(msg as any, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage }) as Buffer;
        } catch (e) {
          retries--;
          if (retries === 0) throw e;
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      const filename = `media_${Date.now()}.mp3`;
      const filePath = path.join(uploadsDir, filename);
      fs.writeFileSync(filePath, buffer!);
      text = `/uploads/${filename}`;
      
      // Auto-transcribe audio
      try {
        const session = await db.prepare('SELECT user_id FROM whatsapp_sessions WHERE id = ?').get(sessionId) as any;
        if (session) {
          const base64Audio = buffer!.toString('base64');
          const transcription = await callAI(session.user_id, "Transcribe this audio message. Return only the transcription text. If it's empty or noise, return an empty string.", "", {
            inlineData: {
              mimeType: "audio/mpeg",
              data: base64Audio
            }
          });
          if (transcription) {
            (msg as any).transcription = transcription;
          }
        }
      } catch (err) {
        console.error('Auto-transcription failed:', err);
      }
    } catch (e: any) {
      if (e.message?.includes('Forbidden') || e.message?.includes('fetch stream')) {
        console.warn(`Could not download audio (likely expired): ${e.message}`);
      } else {
        console.error('Failed to download audio:', e);
      }
      text = '[Audio Message]';
    }
  } else if (msg.message?.documentMessage) {
    type = 'document';
    try {
      let buffer: Buffer | null = null;
      let retries = 3;
      while (retries > 0 && !buffer) {
        try {
          buffer = await downloadMediaMessage(msg as any, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage }) as Buffer;
        } catch (e) {
          retries--;
          if (retries === 0) throw e;
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      const filename = msg.message.documentMessage.fileName || `doc_${Date.now()}`;
      const filePath = path.join(uploadsDir, filename);
      fs.writeFileSync(filePath, buffer!);
      text = `/uploads/${filename}`;
    } catch (e: any) {
      if (e.message?.includes('Forbidden') || e.message?.includes('fetch stream')) {
        console.warn(`Could not download document (likely expired): ${e.message}`);
      } else {
        console.error('Failed to download document:', e);
      }
      text = `[Document: ${msg.message.documentMessage.fileName}]`;
    }
  }

  if (!text) return null;

  // Get or create conversation
  let conversation = await db.prepare('SELECT * FROM conversations WHERE session_id = ? AND contact_number = ?').get(sessionId, from) as any;
  
  // FORCEFUL GLOBAL RETRIEVAL: Check if this number was saved or named in ANY other session or contact list
  const globalContact = await db.prepare(`
    SELECT 
      (SELECT name FROM contacts WHERE jid = ? AND name IS NOT NULL LIMIT 1) as contact_name_from_contacts,
      (SELECT contact_name FROM conversations WHERE contact_number = ? AND contact_name IS NOT NULL LIMIT 1) as contact_name_from_convs,
      (SELECT MAX(is_saved) FROM conversations WHERE contact_number = ?) as is_saved,
      (SELECT MAX(is_ordered) FROM conversations WHERE contact_number = ?) as is_ordered,
      (SELECT MAX(is_rated) FROM conversations WHERE contact_number = ?) as is_rated,
      (SELECT MAX(is_audited) FROM conversations WHERE contact_number = ?) as is_audited,
      (SELECT MIN(is_autopilot) FROM conversations WHERE contact_number = ?) as is_autopilot
  `).get(from, from, from, from, from, from, from) as any;

  const contactName = globalContact?.contact_name_from_contacts || globalContact?.contact_name_from_convs || msg.pushName || null;

  if (!conversation) {
    const result = await db.prepare(`
      INSERT INTO conversations (
        session_id, contact_number, unread_count, contact_name, 
        is_saved, is_ordered, is_rated, is_audited, is_autopilot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId, 
      from, 
      msg.key?.fromMe ? 0 : 1,
      contactName,
      globalContact?.is_saved || 0,
      globalContact?.is_ordered || 0,
      globalContact?.is_rated || 0,
      globalContact?.is_audited || 0,
      globalContact?.is_autopilot !== undefined && globalContact.is_autopilot !== null ? globalContact.is_autopilot : 1
    );
    conversation = { id: result.lastInsertRowid };
  } else {
    // Update existing conversation with global data if it's missing or outdated
    if (!conversation.contact_name && contactName) {
      await db.prepare('UPDATE conversations SET contact_name = ? WHERE id = ?').run(contactName, conversation.id);
    }
    // Forcefully sync flags from global state if they are more "advanced"
    if (globalContact) {
      await db.prepare(`
        UPDATE conversations SET 
          is_saved = MAX(is_saved, ?),
          is_ordered = MAX(is_ordered, ?),
          is_rated = MAX(is_rated, ?),
          is_audited = MAX(is_audited, ?)
        WHERE id = ?
      `).run(
        globalContact.is_saved || 0,
        globalContact.is_ordered || 0,
        globalContact.is_rated || 0,
        globalContact.is_audited || 0,
        conversation.id
      );
    }
    
    if (!msg.key?.fromMe && shouldEmit) {
      await db.prepare('UPDATE conversations SET unread_count = unread_count + 1 WHERE id = ?').run(conversation.id);
    }
  }

  // Update contact name if available in pushName
  if (!msg.key?.fromMe && msg.pushName) {
    await db.prepare('UPDATE conversations SET contact_name = ? WHERE id = ?').run(msg.pushName, conversation.id);
  } else if (conversation && !conversation.contact_name && !msg.key?.fromMe) {
    // Try to fetch from contacts table if we synced it before
    const contact = await db.prepare('SELECT name FROM contacts WHERE session_id = ? AND jid = ?').get(sessionId, from) as any;
    if (contact && contact.name) {
      await db.prepare('UPDATE conversations SET contact_name = ? WHERE id = ?').run(contact.name, conversation.id);
    }
  }

  // Check if message already exists to avoid duplicates
  const timestamp = new Date(Number(msg.messageTimestamp) * 1000).toISOString();
  const existing = await db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND content = ? AND created_at = ?').get(
    conversation.id, 
    text, 
    timestamp
  );

  if (!existing) {
    const msgResult = await db.prepare('INSERT INTO messages (conversation_id, sender, content, type, created_at, transcription) VALUES (?, ?, ?, ?, ?, ?)')
      .run(conversation.id, msg.key?.fromMe ? 'agent' : 'contact', text, type, timestamp, (msg as any).transcription || null);
    const messageId = msgResult.lastInsertRowid;
    
    await db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?')
      .run(timestamp, conversation.id);

    // Emit event for real-time updates
    if (shouldEmit) {
      const session = await db.prepare('SELECT user_id FROM whatsapp_sessions WHERE id = ?').get(sessionId) as any;
      const userRoom = session ? `user_${session.user_id}` : null;
      
      const updatedConv = await db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversation.id) as any;
      const emitData = {
        id: messageId,
        conversation_id: conversation.id,
        session_id: sessionId,
        sender: msg.key?.fromMe ? 'agent' : 'contact',
        content: text,
        type,
        created_at: timestamp,
        transcription: (msg as any).transcription || null,
        unread_count: updatedConv.unread_count,
        contact_name: updatedConv.contact_name,
        contact_number: updatedConv.contact_number,
        is_saved: updatedConv.is_saved,
        is_ordered: updatedConv.is_ordered,
        is_rated: updatedConv.is_rated,
        is_audited: updatedConv.is_audited,
        is_autopilot: updatedConv.is_autopilot
      };

      if (userRoom) {
        io.to(userRoom).emit('new_message', emitData);
      }
    }
    return { id: messageId, conversationId: conversation.id, text, type, timestamp };
  }
  return null;
}

async function handleIncomingMessage(sessionId: string, sock: WASocket, msg: proto.IWebMessageInfo, io: SocketIOServer) {
  const from = msg.key?.remoteJid;
  if (!from) return;

  console.log(`Received message from ${from} in session ${sessionId}`);
  
  // Save the incoming message
  const savedMsg = await saveMessage(sessionId, sock, msg, io, true);
  if (!savedMsg) return;

  // --- Rule-based Logic ---
  try {
    const session = await db.prepare('SELECT agent_id FROM whatsapp_sessions WHERE id = ?').get(sessionId) as any;
    if (session && session.agent_id) {
      const rules = await db.prepare('SELECT * FROM agent_rules WHERE agent_id = ? AND is_active = 1').all(session.agent_id) as any[];
      
      for (const rule of rules) {
        let triggered = false;
        if (rule.trigger_type === 'url_shared') {
          const urlRegex = /(https?:\/\/[^\s]+)/g;
          triggered = urlRegex.test(savedMsg.text);
        } else if (rule.trigger_type === 'keyword_match') {
          triggered = savedMsg.text.toLowerCase().includes(rule.trigger_value.toLowerCase());
        } else if (rule.trigger_type === 'sender_match') {
          triggered = from === rule.trigger_value;
        }

        if (triggered) {
          console.log(`Rule triggered: ${rule.description}`);
          if (rule.action_type === 'forward_to_group') {
            const targetJid = rule.action_value;
            await sock.sendMessage(targetJid, { text: `[Forwarded by Agent]\nFrom: ${from}\n\n${savedMsg.text}` });
          } else if (rule.action_type === 'reply_with_template') {
            await sock.sendMessage(from, { text: rule.action_value });
          }
        }
      }
    }
  } catch (err) {
    console.error('Error processing rules:', err);
  }

  // Check if autopilot is enabled for this conversation
  const conversation = await db.prepare('SELECT * FROM conversations WHERE id = ?').get(savedMsg.conversationId) as any;
  if (conversation && conversation.is_autopilot) {
    await processAIResponse(sessionId, sock, conversation, savedMsg.text, io);
  }
}

async function checkUnrepliedMessages(sessionId: string, sock: WASocket, io: SocketIOServer) {
  console.log(`Checking for unreplied messages in session ${sessionId}`);
  try {
    // Find conversations where the last message is from the contact and autopilot is on
    const unrepliedConvs = await db.prepare(`
      SELECT c.* 
      FROM conversations c
      JOIN messages m ON m.conversation_id = c.id
      WHERE c.session_id = ? 
        AND c.is_autopilot = 1
        AND m.id = (SELECT id FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1)
        AND m.sender = 'contact'
    `).all(sessionId) as any[];

    console.log(`Found ${unrepliedConvs.length} unreplied conversations for session ${sessionId}`);

    for (const conv of unrepliedConvs) {
      const lastMessage = await db.prepare('SELECT content FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1').get(conv.id) as any;
      if (lastMessage) {
        await processAIResponse(sessionId, sock, conv, lastMessage.content, io);
        // Small delay between replies
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  } catch (error) {
    console.error(`Error checking unreplied messages for session ${sessionId}:`, error);
  }
}

async function processAIResponse(sessionId: string, sock: WASocket, conversation: any, userMessage: string, io: SocketIOServer) {
  try {
    const session = await db.prepare('SELECT user_id, agent_id FROM whatsapp_sessions WHERE id = ?').get(sessionId) as any;
    if (!session || !session.user_id) return;

    const agent = await db.prepare('SELECT * FROM agents WHERE id = ?').get(session.agent_id) as any;
    if (!agent) return;

    const trainingFiles = await db.prepare('SELECT content FROM training_files WHERE agent_id = ?').all(agent.id) as any[];
    const trainingData = trainingFiles.map(f => f.content).join('\n\n');

    const contactName = conversation.contact_name;
    let nameInstruction = "";
    if (!contactName || contactName === conversation.contact_number) {
      nameInstruction = "IMPORTANT: You do not know the user's name yet. Your first priority in this response is to politely ask for their name so you can address them properly in the future. Do not assume any name. If they already provided it in this message, acknowledge it and use it.";
    } else {
      nameInstruction = `The user's name is ${contactName}. Address them by their name naturally in your response to make the conversation feel personal.`;
    }

    const systemInstruction = `
      You are ${agent.name}, an AI agent with the following personality: ${agent.personality}.
      Your role is: ${agent.role}.
      Objective: ${agent.objective}.
      Tone: ${agent.tone}.
      Strategy: ${agent.strategy}.
      
      ${nameInstruction}
      
      Knowledge Base:
      ${agent.knowledge_base}
      
      Additional Training Data:
      ${trainingData}
      
      Reply to the user in a helpful and natural way. 
      CRITICAL: 
      1. DO NOT repeat the user's message back to them. Start your reply directly.
      2. There should be nothing mentioned in the message that makes it seem like an auto-bot is replying. 
      3. Do not use phrases like "I am an AI", "As a bot", or "Automated response". 
      4. Keep the conversation human-like, organized, and address the user by name if known.
    `;

    const aiResponse = await callAI(session.user_id, userMessage, systemInstruction);
    
    // Send message via WhatsApp
    await sock.sendMessage(conversation.contact_number, { text: aiResponse });

    // Save to DB
    const timestamp = new Date().toISOString();
    const msgResult = await db.prepare('INSERT INTO messages (conversation_id, sender, content, type, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(conversation.id, 'agent', aiResponse, 'text', timestamp);
    
    await db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?').run(timestamp, conversation.id);

    // Emit to UI
    if (session) {
      const userRoom = `user_${session.user_id}`;
      io.to(userRoom).emit('new_message', {
        id: msgResult.lastInsertRowid,
        conversation_id: conversation.id,
        session_id: sessionId,
        sender: 'agent',
        content: aiResponse,
        type: 'text',
        created_at: timestamp,
        unread_count: 0,
        contact_name: conversation.contact_name,
        contact_number: conversation.contact_number,
        is_saved: conversation.is_saved,
        is_ordered: conversation.is_ordered,
        is_rated: conversation.is_rated,
        is_audited: conversation.is_audited,
        is_autopilot: conversation.is_autopilot
      });
    }

    console.log(`AI replied to ${conversation.contact_number} in session ${sessionId}`);
  } catch (error: any) {
    console.error(`Error processing AI response for session ${sessionId}:`, error.message);
  }
}

export function getSession(sessionId: string) {
  return sessions[sessionId];
}

export async function syncWhatsAppHistory(sessionId: string, io: SocketIOServer) {
  const sock = sessions[sessionId];
  if (!sock) throw new Error('Session not connected');

  const session = await db.prepare('SELECT user_id FROM whatsapp_sessions WHERE id = ?').get(sessionId) as any;
  const userRoom = session ? `user_${session.user_id}` : null;

  console.log(`Manual sync requested for session ${sessionId}`);
  if (userRoom) {
    io.to(userRoom).emit('sync_status', { sessionId, status: 'syncing', progress: 0, message: 'Refreshing data...' });
  }

  try {
    // Since Baileys is event-driven and doesn't have a simple "fetch all chats" method,
    // we'll emit a completion status to refresh the UI.
    // Real sync happens automatically via events.
    
    // We can try to fetch some recent messages for active conversations to "force" an update
    const conversations = await db.prepare('SELECT contact_number FROM conversations WHERE session_id = ? ORDER BY last_message_at DESC LIMIT 10').all(sessionId) as any[];
    
    let processed = 0;
    const total = conversations.length || 1;

    for (const conv of conversations) {
      processed++;
      const progress = Math.round((processed / total) * 100);
      if (userRoom) {
        io.to(userRoom).emit('sync_status', { sessionId, status: 'syncing', progress, message: `Refreshing chat ${processed}/${total}...` });
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (userRoom) {
      io.to(userRoom).emit('sync_status', { sessionId, status: 'completed', progress: 100 });
    }
  } catch (error) {
    console.error(`Manual sync failed for session ${sessionId}:`, error);
    if (userRoom) {
      io.to(userRoom).emit('sync_status', { sessionId, status: 'error', message: 'Manual sync failed. Please try again.' });
    }
  }
}
