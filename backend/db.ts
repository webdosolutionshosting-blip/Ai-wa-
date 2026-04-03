import knex from 'knex';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export let isMySQL = !!(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

const mysqlConfig = {
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT || '3306'),
  },
  pool: { min: 0, max: 10 }
};

// Hostinger optimization: Use MySQL exclusively
if (!isMySQL) {
  console.warn('MySQL configuration missing. Please check your .env file. The application requires MySQL for Hostinger deployment.');
}

let currentDb = knex(mysqlConfig);

// Proxy to allow dynamic switching of the knex instance (kept for compatibility)
const dbProxy = new Proxy({} as any, {
  get(_, prop) {
    return (currentDb as any)[prop];
  }
});

// Initialize tables
async function initDb() {
  if (!isMySQL) {
    console.error('Database initialization failed: MySQL configuration missing.');
    return;
  }

  try {
    console.log('Attempting to connect to MySQL...');
    // Try a simple query with a short timeout to check connection
    await Promise.race([
      currentDb.raw('SELECT 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('MySQL connection timeout')), 5000))
    ]);
    console.log('Connected to MySQL successfully');
  } catch (error: any) {
    console.error('MySQL connection failed:', error.message);
    throw error; // Fail fast on Hostinger if MySQL is not available
  }

  const hasUsers = await dbProxy.schema.hasTable('users');
  if (!hasUsers) {
    await dbProxy.schema.createTable('users', (table: any) => {
      table.increments('id').primary();
      table.string('email').unique().notNullable();
      table.string('username');
      table.string('password').notNullable();
      table.string('role').defaultTo('user');
      table.string('two_factor_secret');
      table.boolean('is_two_factor_enabled').defaultTo(false);
      table.timestamp('created_at').defaultTo(dbProxy.fn.now());
    });
  } else {
    // Check for missing columns and add them if necessary
    const columns = await dbProxy('users').columnInfo();
    if (!columns.email) {
      await dbProxy.schema.alterTable('users', (table: any) => {
        table.string('email').unique();
      });
      // Migrate username to email if email is null
      await dbProxy('users').update({ email: dbProxy.ref('username') }).whereNull('email');
    }
    if (!columns.role) {
      await dbProxy.schema.alterTable('users', (table: any) => {
        table.string('role').defaultTo('user');
      });
    }
    if (!columns.two_factor_secret) {
      await dbProxy.schema.alterTable('users', (table: any) => {
        table.string('two_factor_secret');
        table.boolean('is_two_factor_enabled').defaultTo(false);
      });
    }
  }

  // Initialize admin user
  const adminEmail = 'webdosolutions@gmail.com';
  const admin = await dbProxy('users').where({ email: adminEmail }).first();
  if (!admin) {
    const bcrypt = await import('bcryptjs');
    const hashedPassword = await bcrypt.default.hash("Vn!s;0hovsDgR'%.Hk1lRuUkp_zF3n@2lS9r", 10);
    await dbProxy('users').insert({
      email: adminEmail,
      username: 'admin',
      password: hashedPassword,
      role: 'admin'
    });
    console.log(`Admin user ${adminEmail} created with default password provided.`);
  } else if (admin.role !== 'admin') {
    await dbProxy('users').where({ email: adminEmail }).update({ role: 'admin' });
  }

  const hasAgents = await dbProxy.schema.hasTable('agents');
  if (!hasAgents) {
    await dbProxy.schema.createTable('agents', (table: any) => {
      table.increments('id').primary();
      table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE');
      table.string('name').notNullable();
      table.text('personality');
      table.text('role');
      table.text('knowledge_base');
      table.text('brand_company');
      table.text('product_service');
      table.text('objective');
      table.text('tone');
      table.text('playbook');
      table.text('others');
      table.text('avatar');
      table.text('strategy');
      table.integer('is_active').defaultTo(1);
      table.timestamp('created_at').defaultTo(dbProxy.fn.now());
    });
  }

  const hasSessions = await dbProxy.schema.hasTable('whatsapp_sessions');
  if (!hasSessions) {
    await dbProxy.schema.createTable('whatsapp_sessions', (table: any) => {
      table.increments('id').primary();
      table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE');
      table.integer('agent_id').unsigned().references('id').inTable('agents').onDelete('CASCADE');
      table.string('name');
      table.string('number').unique();
      table.string('status').defaultTo('disconnected');
      table.text('session_data');
      table.timestamp('created_at').defaultTo(dbProxy.fn.now());
    });
  }

  const hasConversations = await dbProxy.schema.hasTable('conversations');
  if (!hasConversations) {
    await dbProxy.schema.createTable('conversations', (table: any) => {
      table.increments('id').primary();
      table.integer('session_id').unsigned().references('id').inTable('whatsapp_sessions').onDelete('CASCADE');
      table.string('contact_number').notNullable();
      table.string('contact_name');
      table.integer('unread_count').defaultTo(0);
      table.integer('is_saved').defaultTo(0);
      table.integer('is_ordered').defaultTo(0);
      table.integer('is_rated').defaultTo(0);
      table.integer('is_audited').defaultTo(0);
      table.integer('is_autopilot').defaultTo(1);
      table.timestamp('last_reminder_sent_at');
      table.timestamp('last_message_at').defaultTo(dbProxy.fn.now());
    });
  }

  const hasMessages = await dbProxy.schema.hasTable('messages');
  if (!hasMessages) {
    await dbProxy.schema.createTable('messages', (table: any) => {
      table.increments('id').primary();
      table.integer('conversation_id').unsigned().references('id').inTable('conversations').onDelete('CASCADE');
      table.string('sender').notNullable();
      table.text('content');
      table.string('type').defaultTo('text');
      table.text('transcription');
      table.timestamp('created_at').defaultTo(dbProxy.fn.now());
    });
  }

  const hasCampaigns = await dbProxy.schema.hasTable('bulk_campaigns');
  if (!hasCampaigns) {
    await dbProxy.schema.createTable('bulk_campaigns', (table: any) => {
      table.increments('id').primary();
      table.string('name').notNullable();
      table.text('message').notNullable();
      table.string('status').defaultTo('pending');
      table.timestamp('scheduled_at');
      table.timestamp('created_at').defaultTo(dbProxy.fn.now());
    });
  }

  const hasRecipients = await dbProxy.schema.hasTable('bulk_recipients');
  if (!hasRecipients) {
    await dbProxy.schema.createTable('bulk_recipients', (table: any) => {
      table.increments('id').primary();
      table.integer('campaign_id').unsigned().references('id').inTable('bulk_campaigns').onDelete('CASCADE');
      table.string('number').notNullable();
      table.string('status').defaultTo('pending');
    });
  }

  const hasContacts = await dbProxy.schema.hasTable('contacts');
  if (!hasContacts) {
    await dbProxy.schema.createTable('contacts', (table: any) => {
      table.increments('id').primary();
      table.integer('session_id').unsigned().references('id').inTable('whatsapp_sessions').onDelete('CASCADE');
      table.string('jid').notNullable();
      table.string('name');
      table.string('number');
      table.timestamp('created_at').defaultTo(dbProxy.fn.now());
      table.unique(['session_id', 'jid']);
    });
  }

  const hasAgentRules = await dbProxy.schema.hasTable('agent_rules');
  if (!hasAgentRules) {
    await dbProxy.schema.createTable('agent_rules', (table: any) => {
      table.increments('id').primary();
      table.integer('agent_id').unsigned().references('id').inTable('agents').onDelete('CASCADE');
      table.string('trigger_type').notNullable(); // 'url_shared', 'keyword_match', 'sender_match'
      table.text('trigger_value');
      table.string('action_type').notNullable(); // 'forward_to_group', 'reply_with_template', 'notify_admin'
      table.text('action_value');
      table.text('description');
      table.integer('is_active').defaultTo(1);
      table.timestamp('created_at').defaultTo(dbProxy.fn.now());
    });
  }

  const hasTrainingFiles = await dbProxy.schema.hasTable('training_files');
  if (!hasTrainingFiles) {
    await dbProxy.schema.createTable('training_files', (table: any) => {
      table.increments('id').primary();
      table.integer('agent_id').unsigned().references('id').inTable('agents').onDelete('CASCADE');
      table.string('filename').notNullable();
      table.string('original_name').notNullable();
      table.text('content');
      table.timestamp('created_at').defaultTo(dbProxy.fn.now());
    });
  }

  const hasSettings = await dbProxy.schema.hasTable('settings');
  if (!hasSettings) {
    await dbProxy.schema.createTable('settings', (table: any) => {
      table.increments('id').primary();
      table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE');
      table.string('provider').notNullable();
      table.string('api_key').notNullable();
      table.integer('is_active').defaultTo(1);
      table.string('status').defaultTo('active');
      table.float('credits_remaining').defaultTo(0);
      table.timestamp('created_at').defaultTo(dbProxy.fn.now());
    });
  }

  console.log('Database initialized successfully using MySQL');
}

// Helper to bridge better-sqlite3 style calls to knex (for minimal refactoring)
const dbWrapper = {
  prepare: (sql: string) => {
    return {
      all: async (...args: any[]) => {
        const bindings = Array.isArray(args[0]) ? args[0] : args;
        const result = await dbProxy.raw(sql, bindings);
        return result[0];
      },
      get: async (...args: any[]) => {
        const bindings = Array.isArray(args[0]) ? args[0] : args;
        const result = await dbProxy.raw(sql, bindings);
        const rows = result[0];
        return rows[0];
      },
      run: async (...args: any[]) => {
        const bindings = Array.isArray(args[0]) ? args[0] : args;
        const result = await dbProxy.raw(sql, bindings);
        return { lastInsertRowid: result[0].insertId };
      }
    };
  },
  exec: async (sql: string) => {
    return await dbProxy.raw(sql);
  }
};

export { initDb, dbProxy as knex };
export default dbWrapper;
