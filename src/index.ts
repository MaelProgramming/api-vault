import express, { Request, Response, NextFunction } from 'express';
import { supabase } from './lib/supabase.js';
import cors from 'cors';
import multer from 'multer';
import admin from 'firebase-admin'; // Indispensable pour valider le jeton

// Initialisation Firebase Admin (utilise tes variables d'environnement Vercel)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// --- MIDDLEWARE D'AUTHENTIFICATION FIREBASE ---
const checkAuth = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Identificación requerida' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // On vérifie le token auprès de Firebase
    const decodedToken = await admin.auth().verifyIdToken(token);
    (req as any).user = decodedToken; // On attache l'user (contient l'email, l'uid Firebase, etc.)
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
};

app.use(cors());
app.use(express.json());

// 1. Récupérer MON profil (Le fameux endpoint /me)
app.get('/api/members/me', checkAuth, async (req: any, res: Response) => {
  try {
    // On cherche dans la table 'members' via l'email du token Firebase
    const { data, error } = await supabase
      .from('members')
      .select('*')
      .eq('email', req.user.email)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Perfil no encontrado' });

    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Error de servidor' });
  }
});

// 2. Récupérer tous les membres (Public)
app.get('/api/members', async (req, res) => {
  const { data, error } = await supabase.from('members').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Acceso denegado' });
  res.status(200).json(data);
});

// 3. Update Avatar (Toujours protégé)
app.patch('/api/members/:id/avatar', checkAuth, upload.single('avatar'), async (req: any, res: Response) => {
  // ... garde ta logique d'upload actuelle, elle est nickel avec l'URL signée sur 10 ans
});

// 4. Update Semblanza (Bio)
app.patch('/api/members/:id/bio', checkAuth, async (req: any, res: Response) => {
  const { id } = req.params;
  const { bio } = req.body;

  console.log("Tentative d'update pour ID:", id, "avec bio:", bio);

  const { data, error } = await supabase
    .from('members')
    .update({ bio })
    .eq('id', id)
    .select(); // Le .select() permet de voir ce qui a été modifié

  if (error) {
    console.error("Erreur Supabase:", error);
    return res.status(500).json(error);
  }

  console.log("Data après update:", data);
  res.status(200).json({ message: 'Semblanza actualizada', data });
});

export default app;