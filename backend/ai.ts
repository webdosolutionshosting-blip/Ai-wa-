import { GoogleGenAI, Type } from "@google/genai";
import db from './db.js';
import * as cheerio from 'cheerio';
import axios from 'axios';

export interface AIProvider {
  id: string;
  name: string;
  baseUrl?: string;
}

export async function getActiveApiKeys(userId: number) {
  return await db.prepare("SELECT * FROM settings WHERE user_id = ? AND is_active = 1 AND status = 'active' ORDER BY id ASC").all(userId) as any[];
}

export async function callAI(userId: number, prompt: string, systemInstruction?: string, mediaPart?: any) {
  const keys = await getActiveApiKeys(userId);
  
  if (keys.length === 0) {
    throw new Error('No active API keys found. Please configure them in Settings.');
  }

  let creditError = false;
  for (const key of keys) {
    try {
      console.log(`Attempting AI call with provider: ${key.provider}`);
      
      let responseText = '';
      
      if (key.provider === 'gemini') {
        responseText = await callGemini(key.api_key, prompt, systemInstruction, mediaPart);
      } else if (key.provider === 'openai' || key.provider === 'chatgpt') {
        responseText = await callOpenAI(key.api_key, prompt, systemInstruction);
      } else {
        responseText = await callGenericOpenAI(key.api_key, prompt, systemInstruction, key.baseUrl);
      }

      await db.prepare('UPDATE settings SET credits_remaining = MAX(0, credits_remaining - 0.01) WHERE id = ?').run(key.id);
      return responseText;
    } catch (error: any) {
      console.error(`AI call failed for ${key.provider}:`, error.message);
      if (error.message.includes('credit') || error.message.includes('token') || error.message.includes('limit') || error.message.includes('quota')) {
        await db.prepare("UPDATE settings SET status = 'error' WHERE id = ?").run(key.id);
        creditError = true;
      }
      continue;
    }
  }

  if (creditError) {
    throw new Error('The API token has been reached. Kindly update your API.');
  }

  throw new Error('All configured AI providers failed. Please check your API keys and credits.');
}

async function callGemini(apiKey: string, prompt: string, systemInstruction?: string, mediaPart?: any) {
  const ai = new GoogleGenAI({ apiKey });
  const contents: any[] = [];
  
  if (mediaPart) {
    contents.push(mediaPart);
  }
  
  contents.push({ text: prompt });

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: { parts: contents },
    config: {
      systemInstruction: systemInstruction || undefined,
    },
  });
  return response.text || '';
}

async function scrapeURL(url: string): Promise<string> {
  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    const $ = cheerio.load(response.data);
    
    // Remove script and style elements
    $('script, style').remove();
    
    // Get text content
    const text = $('body').text().replace(/\s+/g, ' ').trim();
    return text.substring(0, 10000); // Limit to 10k chars
  } catch (error) {
    console.error(`Failed to scrape URL ${url}:`, error);
    throw new Error(`Could not access the URL: ${url}`);
  }
}

export async function interpretGuidance(userId: number, agentId: number, message: string, contacts: any[], getSession: (id: string) => any, io: any) {
  const systemInstruction = `
    You are an AI Agent Trainer for "Geeks Genics". Your job is to listen to the user's instructions for a WhatsApp AI Agent and extract "Rules", "Knowledge", or "Direct Actions" in JSON format.
    
    The available contacts/groups are:
    ${JSON.stringify(contacts.map(c => ({ jid: c.jid, name: c.name })))}
    
    A Rule consists of:
    - trigger_type: 'url_shared', 'keyword_match', 'sender_match'
    - trigger_value: the specific URL pattern (e.g. "http"), keyword, or sender JID
    - action_type: 'forward_to_group', 'reply_with_template', 'send_message'
    - action_value: the target group JID or template text
    - description: a human-readable description of the rule
    
    Knowledge consists of:
    - action: 'scrape_url'
    - url: the URL to learn from
    
    Direct Actions (for immediate execution):
    - action: 'send_whatsapp_message'
    - target: the contact/group JID
    - text: the message to send
    - action: 'sync_all'
    
    If the user gives an instruction like "When a client shares a website URL, add it to the Audits group", you should return a rule.
    If the user gives a URL and says "learn from this" or just provides a URL to memorize, you should return a knowledge action.
    If the user says something like "Send a message to the Sales group saying we are ready" or "Sync all my chats", you should return a direct action.
    
    Respond STRICTLY in this JSON format:
    {
      "message": "A friendly confirmation message to the user",
      "rule": { ... the rule object ... } or null,
      "knowledge": { "action": "scrape_url", "url": "..." } or null,
      "action": { "action": "send_whatsapp_message", "target": "...", "text": "..." } or { "action": "sync_all" } or null
    }
  `;

  try {
    const responseText = await callAI(userId, message, systemInstruction);
    
    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      
      // Handle Knowledge (Scrape URL)
      if (data.knowledge && data.knowledge.action === 'scrape_url') {
        const url = data.knowledge.url;
        try {
          const content = await scrapeURL(url);
          await db.prepare('INSERT INTO training_files (agent_id, filename, original_name, content) VALUES (?, ?, ?, ?)')
            .run(agentId, `url_${Date.now()}.txt`, `Scraped: ${url}`, content);
          return `I've successfully memorized the content from ${url}. I'll use this information to answer customer queries.`;
        } catch (scrapeErr: any) {
          return `I tried to learn from ${url}, but I couldn't access it: ${scrapeErr.message}`;
        }
      }

      // Handle Direct Action (Send Message or Sync All)
      if (data.action) {
        if (data.action.action === 'send_whatsapp_message') {
          const { target, text } = data.action;
          
          // Find ANY active session for this user that has this contact or just use the first available active session
          const sessions = await db.prepare('SELECT id FROM whatsapp_sessions WHERE user_id = ? AND status = ?').all(userId, 'connected') as any[];
          
          if (sessions.length === 0) return "I couldn't find any active WhatsApp sessions to send the message.";
          
          // Try to find a session that already has a conversation with this target
          let bestSessionId = sessions[0].id;
          for (const s of sessions) {
            const conv = await db.prepare('SELECT id FROM conversations WHERE session_id = ? AND contact_number = ?').get(s.id, target);
            if (conv) {
              bestSessionId = s.id;
              break;
            }
          }

          const sock = getSession(bestSessionId.toString());
          if (sock) {
            try {
              await sock.sendMessage(target, { text });
              
              // Save to DB
              let conversation = await db.prepare('SELECT * FROM conversations WHERE session_id = ? AND contact_number = ?').get(bestSessionId, target) as any;
              if (!conversation) {
                const convResult = await db.prepare('INSERT INTO conversations (session_id, contact_number) VALUES (?, ?)').run(bestSessionId, target);
                conversation = { id: convResult.lastInsertRowid };
              }
              
              await db.prepare('INSERT INTO messages (conversation_id, sender, content, type) VALUES (?, ?, ?, ?)')
                .run(conversation.id, 'agent', text, 'text');
              await db.prepare('UPDATE conversations SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?').run(conversation.id);

              // Emit to UI
              const userRoom = `user_${userId}`;
              io.to(userRoom).emit('new_message', {
                conversation_id: conversation.id,
                sender: 'agent',
                content: text,
                type: 'text',
                created_at: new Date().toISOString()
              });

              return `Action executed: I've sent that message to ${target} via session ${bestSessionId}.`;
            } catch (sendErr: any) {
              return `I tried to send the message, but failed: ${sendErr.message}`;
            }
          }
          return "I found an active session but couldn't access its connection to send the message.";
        } else if (data.action.action === 'sync_all') {
          const sessions = await db.prepare('SELECT id FROM whatsapp_sessions WHERE user_id = ? AND status = ?').all(userId, 'connected') as any[];
          if (sessions.length === 0) return "No active WhatsApp sessions found to sync.";
          
          const { syncWhatsAppHistory } = await import('./whatsapp.js');
          for (const session of sessions) {
            syncWhatsAppHistory(session.id.toString(), io).catch(err => console.error(`Sync failed for session ${session.id}:`, err));
          }
          return `I've started a full re-sync for all ${sessions.length} active sessions. You'll see the progress in the inbox.`;
        }
      }

      // Handle Rule Creation
      if (data.rule) {
        // Validate rule fields before insertion
        const { trigger_type, trigger_value, action_type, action_value, description } = data.rule;
        if (trigger_type && action_type) {
          await db.prepare(`
            INSERT INTO agent_rules (agent_id, trigger_type, trigger_value, action_type, action_value, description)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            agentId,
            trigger_type,
            trigger_value || '',
            action_type,
            action_value || '',
            description || 'Automated rule'
          );
        }
      }
      return data.message || "I've processed your instruction.";
    }
    return responseText;
  } catch (e: any) {
    console.error('Failed to interpret guidance:', e);
    return `I'm sorry, I couldn't process that training instruction right now. Error: ${e.message}`;
  }
}

async function callOpenAI(apiKey: string, prompt: string, systemInstruction?: string) {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
          { role: 'user', content: prompt }
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || `OpenAI error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || '';
  } catch (error: any) {
    console.error('OpenAI call failed:', error.message);
    throw error;
  }
}

async function callGenericOpenAI(apiKey: string, prompt: string, systemInstruction?: string, baseUrl?: string) {
  const url = baseUrl || 'https://api.openai.com/v1/chat/completions';
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo', // Default model for generic providers
        messages: [
          ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
          { role: 'user', content: prompt }
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || `Generic AI error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || '';
  } catch (error: any) {
    console.error('Generic AI call failed:', error.message);
    throw error;
  }
}
