import { supabase } from './src/lib/supabase';

async function checkSchema() {
  const { data, error } = await supabase.from('members').select('*').limit(1);
  if (error) {
    console.error('Error fetching data:', error);
  } else {
    console.log('Columns in members table:', Object.keys(data[0] || {}));
  }
}
checkSchema();
