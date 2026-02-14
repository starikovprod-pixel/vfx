export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const { post_id, title } = req.body || {};
    if (!post_id) return res.status(400).json({ error: 'post_id required' });

    const { data: userData, error: userErr } = await req.supabase.auth.getUser(token);
    if (userErr || !userData?.user?.id) return res.status(401).json({ error: 'Unauthorized' });

    const userId = userData.user.id;
    const { data, error } = await req.supabase
      .from('feed_posts')
      .update({ title: String(title || '').trim() })
      .eq('id', post_id)
      .eq('user_id', userId)
      .select('id,title')
      .single();

    if (error) throw error;
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to update title' });
  }
}
