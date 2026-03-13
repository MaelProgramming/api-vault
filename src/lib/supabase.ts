import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string; 
// Note : Service Role Key uniquement côté Backend pour bypasser les RLS si besoin.

export const supabase = createClient(supabaseUrl, supabaseKey);