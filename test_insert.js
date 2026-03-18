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
    const res = await client.query(`
      INSERT INTO public.messages (conversation_id, sender_id, content) 
      VALUES ('6fee4388-8467-4d6e-bfd3-f446e805d730', '51ad9fdc-bfcb-4dc5-a172-806bc166f4c3', 'test')
    `);
    console.log("Insert success!");
  } catch (err) {
    console.error("PG ERROR:", err.message, err.detail);
  } finally {
    await client.end();
  }
}

run();
