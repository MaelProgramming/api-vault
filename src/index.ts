import express, { Request, Response, NextFunction } from 'express';
import { supabase } from './lib/supabase.js';
import cors from 'cors';
import multer from 'multer';
import admin from 'firebase-admin'; // Indispensable pour valider le jeton

interface AuthenticatedRequest extends Request {
  user: admin.auth.DecodedIdToken;
}
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
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 5 } });

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
    (req as AuthenticatedRequest).user = decodedToken; // On attache l'user (contient l'email, l'uid Firebase, etc.)
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
};

app.use(cors());
app.use(express.json());

app.get('/', (_req: Request, res: Response) => {
  res.status(200).json({ ok: 'Backend running' });
});

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

// Créer le profil du membre après inscription (Création Supabase)
app.post('/api/members', checkAuth, async (req: any, res: Response) => {
  const { full_name, name, gender, major, graduation_year, year } = req.body;
  const email = req.user.email; // Provenant du token vérifié

  try {
    // Vérifier si le membre existe déjà
    const { data: existing } = await supabase
      .from('members')
      .select('id')
      .eq('email', email)
      .single();

    if (existing) {
      return res.status(400).json({ error: 'El miembro ya existe' });
    }

    const { data, error } = await supabase
      .from('members')
      .insert([
        {
          email,
          full_name: full_name || name, // Fallback on name if full_name is empty
          sex: gender, // DB column is 'sex'
          major,
          graduation_year: graduation_year ? parseInt(graduation_year, 10) : (year ? parseInt(year, 10) : null),
          bio: '',
          avatar_url: '',
          is_verified: false,
          university: 'The Vault',
          random_seed: Math.floor(Math.random() * 100) // Génération de la "graine d'alchimie" pour l'Afinidad Élite
        }
      ])
      .select()
      .single();

    if (error) {
      console.error("Supabase Error:", error);
      throw error;
    }

    res.status(201).json(data);
  } catch (err: any) {
    console.error("Erreur création membre:", err);
    res.status(500).json({ error: 'Erreur lors de la création del miembro' });
  }
});

// 2. Récupérer tous les membres (Public)
// 2. Récupérer les membres non swipés (Filtrage Élite)
app.get('/api/members', checkAuth, async (req: any, res: Response) => {
  try {
    // 1. Choper mon profil via mon email (Firebase)
    const { data: me } = await supabase
      .from('members')
      .select('id, major, graduation_year, random_seed')
      .eq('email', req.user.email)
      .single();

    if (!me) return res.status(404).json({ error: 'Ton profil n’existe pas' });

    // 2. Choper la liste des IDs que j'ai déjà swipés
    const { data: swipedData } = await supabase
      .from('swipes')
      .select('swiped_id')
      .eq('swiper_id', me.id);

    const alreadySwipedIds = swipedData?.map(s => s.swiped_id) || [];

    // On s'exclut soi-même de la liste aussi, faut pas déconner
    alreadySwipedIds.push(me.id);

    // 3. Récupérer les membres qui ne sont pas dans cette liste
    const { data, error } = await supabase
      .from('members')
      .select('*')
      .not('id', 'in', `(${alreadySwipedIds.join(',')})`);

    if (error) throw error;

    // --- ALGORITHME DE MATCHING ÉLITE ---
    const usersWithScore = data?.map((candidate: any) => {
      let score = 0;

      // Affinité académique
      if (candidate.major && me.major && candidate.major === me.major) {
        score += 45;
      }

      // Affinité générationnelle
      if (candidate.graduation_year && me.graduation_year) {
        const diff = Math.abs(candidate.graduation_year - me.graduation_year);
        if (diff === 0) score += 35;
        else if (diff === 1) score += 15;
        else if (diff <= 3) score += 5;
      }

      // Facteur d'alchimie aléatoire stocké en BDD pour garantir la stabilité de l'Afinidad Élite
      // Fallback sur le code ascii du début de l'ID si le membre a été créé avant cet update DB
      const candidateSeed = candidate.random_seed || candidate.id?.charCodeAt(0) || 0;
      const mySeed = me.random_seed || me.id?.charCodeAt(0) || 0;

      score += (candidateSeed + mySeed) % 20;

      return {
        ...candidate,
        elite_score: Math.min(score, 99) // Score plafonné à 99%
      };
    }) || [];

    // Trier les membres pour envoyer la véritable "crème de la crème" (Top 20)
    const eliteMatches = usersWithScore
      .sort((a: any, b: any) => b.elite_score - a.elite_score)
      .slice(0, 20);

    res.status(200).json(eliteMatches);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Impossible de charger la pile' });
  }
});

// 3. Update Avatar (Toujours protégé)
app.patch('/api/members/:id/avatar', checkAuth, upload.single('avatar'), async (req: any, res: Response) => {
  const { id } = req.params;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'Aucun fichier envoyé' });
  }

  // Vérification de sécurité : format du fichier
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedMimeTypes.includes(file.mimetype)) {
    return res.status(400).json({ error: 'Type de fichier non autorisé. Uniquement JPG, PNG, WEBP.' });
  }

  try {
    // Vérification de sécurité : l'utilisateur modifie-t-il bien son propre profil ?
    const { data: me } = await supabase.from('members').select('id').eq('email', req.user.email).single();

    if (!me || me.id !== id) {
      console.warn(`[SECURITY WARNING] User ${me?.id || req.user.email} tried to update avatar of user ${id}`);
      return res.status(403).json({ error: 'Accès refusé. Vous ne pouvez modifier que votre propre avatar.' });
    }

    // 0. Fetch the old avatar to get 'oldpath' and delete it so we don't accumulate images
    const { data: memberData } = await supabase
      .from('members')
      .select('avatar_url')
      .eq('id', id)
      .single();

    let oldpath: string | null = null;
    if (memberData?.avatar_url) {
      try {
        const urlObj = new URL(memberData.avatar_url);
        // Extract the path from the URL.
        // Signed URL looks like: .../storage/v1/object/sign/avatars/avatars/{id}-{timestamp}.{ext}
        const match = urlObj.pathname.match(/\/sign\/avatars\/(.+)/);
        if (match && match[1]) {
          oldpath = match[1];
        }
      } catch (e) { /* ignore parse error */ }
    }

    if (oldpath) {
      await supabase.storage.from('avatars').remove([oldpath]);
    }

    // 1. Définir le chemin du fichier (on utilise l'ID pour que chaque user écrase son ancien avatar)
    const fileExtension = file.originalname.split('.').pop();

    const filePath = `avatars/${id}-${Date.now()}.${fileExtension}`;
    const tenY: number = 315360000;

    // 2. Upload sur Supabase Storage (Bucket 'avatars')
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });

    if (uploadError) throw uploadError;

    // 3. Créer une URL signée pour 10 ans (en secondes)
    // 10 ans = 10 * 365 * 24 * 60 * 60 = 315 360 000 secondes
    const { data: signedData, error: signedError } = await supabase.storage
      .from('avatars')
      .createSignedUrl(filePath, tenY);

    if (signedError) throw signedError;

    const signedUrl = signedData.signedUrl;

    // 4. Update de la colonne 'avatar_url' dans la table 'members'
    const { error: dbError } = await supabase
      .from('members')
      .update({ avatar_url: signedUrl })
      .eq('id', id);

    if (dbError) throw dbError;

    console.log(`Avatar mis à jour pour l'élite ID: ${id}`);

    res.status(200).json({
      message: 'Avatar mis à jour avec classe',
      url: signedUrl
    });

  } catch (err: any) {
    console.error("Crash de l'upload :", err.message);
    res.status(500).json({ error: 'Erreur lors de l’upload de l’image' });
  }
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

// 5. Swipe Logic (Le moteur de The Vault)
app.post('/api/swipe', checkAuth, async (req: any, res: Response) => {
  const { swipedId, isLike } = req.body;
  const swiperEmail = req.user.email; // On récupère l'email via le token validé

  try {
    // 1. Récupérer l'ID interne de celui qui swipe
    const { data: member } = await supabase
      .from('members')
      .select('id')
      .eq('email', swiperEmail)
      .single();

    if (!member) return res.status(404).json({ error: 'Membre introuvable' });

    const swiperId = member.id;

    // 2. Enregistrer le swipe (on utilise upsert pour éviter les doublons sales)
    const { error: swipeError } = await supabase
      .from('swipes')
      .upsert({
        swiper_id: swiperId,
        swiped_id: swipedId,
        is_like: isLike
      }, { onConflict: 'swiper_id,swiped_id' });

    if (swipeError) throw swipeError;

    // 3. Si c'est un "Pass", on s'arrête là
    if (!isLike) return res.status(200).json({ match: false });

    // 4. Vérifier si c'est un match (Réciprocité)
    const { data: reciprocate } = await supabase
      .from('swipes')
      .select('id')
      .eq('swiper_id', swipedId)
      .eq('swiped_id', swiperId)
      .eq('is_like', true)
      .single();

    if (reciprocate) {
      // 5. Création de la conversation (Tri des IDs pour l'unicité du salon)
      const [u1, u2] = [swiperId, swipedId].sort();
      // test
      const { data: conv, error: convError } = await supabase
        .from('conversations')
        .upsert({ user_1: u1, user_2: u2 }, { onConflict: 'user_1,user_2' })
        .select()
        .single();

      if (convError) throw convError;

      return res.status(200).json({ match: true, conversationId: conv.id });
    }

    res.status(200).json({ match: false });

  } catch (err) {
    console.error("Erreur Swipe:", err);
    res.status(500).json({ error: 'Erreur lors du swipe' });
  }
});

// 6. Récupérer les conversations du membre
app.get('/api/conversations', checkAuth, async (req: any, res: Response) => {
  try {
    const { data: me } = await supabase.from('members').select('id').eq('email', req.user.email).single();
    if (!me) return res.status(404).json({ error: 'Introuvable' });

    const { data: convs, error } = await supabase
      .from('conversations')
      .select('id, user_1, user_2, user_1_data:members!user_1(id, full_name, avatar_url, major), user_2_data:members!user_2(id, full_name, avatar_url, major)')
      .or(`user_1.eq.${me.id},user_2.eq.${me.id}`);

    if (error) throw error;

    const mapped = convs?.map((c: any) => {
      const isUser1 = c.user_1 === me.id;
      const peer = isUser1 ? c.user_2_data : c.user_1_data;
      return {
        id: c.id,
        peer_id: peer.id,
        peer_name: peer.full_name,
        peer_avatar: peer.avatar_url,
        peer_major: peer.major,
      }
    });

    res.status(200).json(mapped || []);
  } catch (err) {
    res.status(500).json({ error: 'Impossible de charger les conversations' });
  }
});

// 7. Messages (Fetch optimisé)
app.get('/api/conversations/:id/messages', checkAuth, async (req: any, res: Response) => {
  try {
    const { lastTimestamp } = req.query; // On récupère la date du dernier message connu par le front
    const { data: me } = await supabase.from('members').select('id').eq('email', req.user.email).single();

    let query = supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', req.params.id);

    // Si le front a déjà des messages, on ne demande que les plus récents
    if (lastTimestamp) {
      query = query.gt('created_at', lastTimestamp);
    }

    const { data: msgs, error } = await query.order('created_at', { ascending: true });

    if (error) throw error;

    const mapped = msgs?.map((m: any) => ({
      ...m,
      is_mine: m.sender_id === (me?.id)
    }));

    res.status(200).json(mapped || []);
  } catch (err) {
    res.status(500).json({ error: 'Erreur messages' });
  }
});

app.post('/api/conversations/:id/messages', checkAuth, async (req: any, res: Response) => {
  const { id: convId } = req.params;
  const { content } = req.body;

  try {
    // 1. Choper ton ID interne via l'email du token
    const { data: me } = await supabase.from('members').select('id').eq('email', req.user.email).single();
    if (!me) return res.status(404).json({ error: 'Membre non trouvé' });

    // 2. LA VÉRIF : Est-ce que cette conv t'appartient ?
    const { data: isParticipant, error: authError } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', convId)
      .or(`user_1.eq.${me.id},user_2.eq.${me.id}`)
      .single();

    if (authError || !isParticipant) {
      console.warn(`Tentative d'intrusion : User ${me.id} sur Conv ${convId}`);
      return res.status(403).json({ error: 'Accès au coffre refusé. Cette conversation ne vous appartient pas.' });
    }

    // 3. Insertion sécurisée
    const { data, error } = await supabase
      .from('messages')
      .insert([{ conversation_id: convId, sender_id: me.id, content }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ ...data, is_mine: true });

  } catch (err) {
    res.status(500).json({ error: 'Erreur système lors de l’envoi' });
  }
});

// 8. Marquer les messages d'une conversation comme lus
app.patch('/api/conversations/:id/read', checkAuth, async (req: any, res: Response) => {
  const { id: convId } = req.params;

  try {
    // 1. Qui suis-je ?
    const { data: me } = await supabase.from('members').select('id').eq('email', req.user.email).single();
    if (!me) return res.status(404).json({ error: 'Membre non trouvé' });

    // 2. On update tous les messages de cette conv où JE suis le destinataire (sender_id != me.id)
    const { error } = await supabase
      .from('messages')
      .update({ is_read: true })
      .eq('conversation_id', convId)
      .neq('sender_id', me.id) // Important : on ne marque pas ses propres messages comme "lus par soi-même"
      .eq('is_read', false);

    if (error) throw error;

    res.status(200).json({ message: 'Correspondencia marcada como leída' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la mise à jour' });
  }
});

// --- INVITATIONS SYSTEM ---

// 9. Verificar Código (Public)
app.post('/api/invitations/verify', async (req: Request, res: Response) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Código no proporcionado' });

  try {
    const { data, error } = await supabase
      .from('invitations')
      .select('*')
      .eq('code', code)
      .eq('status', 'active')
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Llave inválida o ya utilizada' });
    }

    res.status(200).json({ valid: true, id: data.id });
  } catch (err) {
    console.error("Erreur vérification code:", err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// 10. Forjar un Sello de Invitación (Protected)
app.post('/api/invitations', checkAuth, async (req: any, res: Response) => {
  try {
    const { data: me } = await supabase.from('members').select('id').eq('email', req.user.email).single();
    if (!me) return res.status(404).json({ error: 'Miembro no reconocido' });

    // Limit to 3 active or total invitations per user? Let's check total for now.
    const { count, error: countError } = await supabase
      .from('invitations')
      .select('id', { count: 'exact' })
      .eq('created_by', me.id);

    if (countError) throw countError;
    if (count && count >= 3) {
      return res.status(400).json({ error: 'Límite de sellos (3/3) alcanzado' });
    }

    const newCode = `VLT-${Math.random().toString(36).substring(2, 8).toUpperCase()}-${new Date().getFullYear()}`;

    const { data, error } = await supabase
      .from('invitations')
      .insert([{ code: newCode, created_by: me.id, status: 'active' }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error("Erreur génération invitation:", err);
    res.status(500).json({ error: 'Error al forjar la invitación' });
  }
});

// 11. Cargar Sellos (Protected)
app.get('/api/invitations', checkAuth, async (req: any, res: Response) => {
  try {
    const { data: me } = await supabase.from('members').select('id').eq('email', req.user.email).single();
    if (!me) return res.status(404).json({ error: 'Miembro no reconocido' });

    const { data, error } = await supabase
      .from('invitations')
      .select('*')
      .eq('created_by', me.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.status(200).json(data || []);
  } catch (err) {
    console.error("Erreur chargement invitations:", err);
    res.status(500).json({ error: 'Error al consultar el cofre' });
  }
});

// Export l'app (Doit être en dernier !!)
export default app;