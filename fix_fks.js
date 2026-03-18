import pkg from 'pg';
const { Client } = pkg;
import dotenv from 'dotenv';
dotenv.config();

const client = new Client({
  connectionString: process.env.POSTGRES_URL_NON_POOLING,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  try {
    console.log("Dropping old fk and creating new one for conversations and messages...");
    await client.query(`
      ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_user_1_fkey;
      ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_user_2_fkey;
      
      ALTER TABLE public.conversations
      ADD CONSTRAINT conversations_user_1_fkey
      FOREIGN KEY (user_1) REFERENCES public.members(id) ON DELETE CASCADE;
      
      ALTER TABLE public.conversations
      ADD CONSTRAINT conversations_user_2_fkey
      FOREIGN KEY (user_2) REFERENCES public.members(id) ON DELETE CASCADE;

      ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_sender_id_fkey;
      ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_conversation_id_fkey;

      ALTER TABLE public.messages
      ADD CONSTRAINT messages_sender_id_fkey
      FOREIGN KEY (sender_id) REFERENCES public.members(id) ON DELETE CASCADE;

      ALTER TABLE public.messages
      ADD CONSTRAINT messages_conversation_id_fkey
      FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;
    `);
    console.log("Success! Constraints updated to point to members table.");
  } catch (err) {
    console.error("Error updating constraints:", err);
  } finally {
    await client.end();
  }
}

run();
