import express, { Request, Response, NextFunction } from 'express';
import { supabase } from './lib/supabase.js';
import cors from 'cors'
import multer from 'multer'

interface MulterRequest extends Request {
  file?: Express.Multer.File;
}
const upload = multer({ storage: multer.memoryStorage() });
const app = express()

const checkAuth = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Acceso no autorizado' });
  }

  const token = authHeader.split(' ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }

  // On attache l'user à la requête pour l'utiliser dans le controller
  (req as any).user = user;
  next();
};
// --- MIDDLEWARES (L'ordre est vital) ---
app.use(cors())
app.use(express.json()) // <--- C'EST ÇA QUI TE MANQUAIT POUR FIX L'ERREUR 500

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Backend working properly'})
})

// Récupérer les membres
app.get('/api/members', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { data, error } = await supabase
      .from('members')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      res.status(500).json({ error: 'Acceso al registro denegado.' });
      return;
    }

    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
});

// Update Avatar
app.patch('/api/members/:id/avatar', checkAuth, upload.single('avatar'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const file = req.file;

    if (!file) return res.status(400).json({ error: 'No se ha seleccionado ninguna imagen' });

    const fileExtension = file.originalname.split('.').pop();
    const fileName = `${id}-${Date.now()}.${fileExtension}`;
    
    // 1. Upload vers le bucket 'avatars'
    const { data: storageData, error: storageError } = await supabase.storage
      .from('avatars')
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: true
      });

    if (storageError) throw storageError;

    // 2. Générer une URL SIGNÉE valable 10 ans
    // 10 ans en secondes = 10 * 365 * 24 * 60 * 60 = 315,360,000
    const TEN_YEARS_IN_SECONDS = 315360000;
    
    const { data: signedData, error: signedError } = await supabase.storage
      .from('avatars')
      .createSignedUrl(fileName, TEN_YEARS_IN_SECONDS);

    if (signedError || !signedData) throw signedError;

    const longTermUrl = signedData.signedUrl;

    // 3. Mise à jour de la Base de Données avec cette URL spéciale
    const { error: dbError } = await supabase
      .from('members')
      .update({ 
        avatar_url: longTermUrl 
      })
      .eq('id', id);

    if (dbError) throw dbError;

    res.status(200).json({ 
      url: longTermUrl,
      message: 'Imagen actualizada con éxito (Válida por 10 años)' 
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al generar el enlace de larga duración' });
  }
});

// Login Magic Link
app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'El correo electrónico es obligatorio.' });
    }

    const { data, error } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: email,
      options: { 
        redirectTo: 'http://localhost:5173/auth/callback' 
      }
    });

    if (error) {
      return res.status(401).json({ error: 'Acceso denegado. Credenciales no reconocidas.' });
    }

    // --- LE TRUC DE GÉNIE EST ICI ---
    // Ce lien va apparaître dans tes "Runtime Logs" sur Vercel
    console.log("-----------------------------------------");
    console.log("ACCESO VIP PARA MAEL:", data.properties.action_link);
    console.log("-----------------------------------------");

    res.status(200).json({ 
      message: 'Enlace de acceso generado. Revisa los logs del servidor.' 
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno en el sistema de autenticación.' });
  }
});

export default app;
