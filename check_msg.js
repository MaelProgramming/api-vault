import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkMessageInsert() {
  const { data: me } = await supabase.from('members').select('id').limit(1).single();
  const conv_id = '6fee4388-8467-4d6e-bfd3-f446e805d730';
  
  if (!me) return console.log(me);
  
  const { data, error } = await supabase
    .from('messages')
    .insert([{ conversation_id: conv_id, sender_id: me.id, content: "Hello" }])
    .select()
    .single();

  if (error) {
    console.error('Supabase Error:', error);
  } else {
    console.log('Insert Success:', data);
  }
}
checkMessageInsert();
