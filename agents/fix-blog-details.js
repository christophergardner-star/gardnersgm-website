// Quick fix script: patches existing blog posts with wrong contact details
const WEBHOOK = 'https://script.google.com/macros/s/AKfycbx-q2qSeCorIEeXPE9d2MgAZLKEFwFNW9lARLE1yYciH9wJWwvktUTuDVLz_rSCbUhkMg/exec';

(async () => {
  const resp = await fetch(WEBHOOK + '?action=get_all_blog_posts');
  const data = await resp.json();
  const posts = data.posts || [];
  console.log('Found ' + posts.length + ' posts');

  for (const p of posts) {
    const content = p.content || '';
    const hasBad = content.includes('01234') || content.includes('groundmaintenance') || content.match(/\[.*\]\(mailto:/) || content.match(/\[.*\]\(tel:/);
    
    console.log(p.id + ' | ' + (p.title || '').substring(0, 50) + ' | Needs fix: ' + !!hasBad);
    
    if (hasBad) {
      let c = content;
      // Fix phone numbers
      c = c.replace(/\b0\d{3,4}\s?\d{3}\s?\d{3,4}\b/g, '01726 432051');
      // Fix emails
      c = c.replace(/info@gardners?ground(maintenance|maint)\.co\.uk/gi, 'info@gardnersgm.co.uk');
      c = c.replace(/contact@gardners?ground(maintenance|maint)\.co\.uk/gi, 'info@gardnersgm.co.uk');
      c = c.replace(/hello@gardners?ground(maintenance|maint)\.co\.uk/gi, 'info@gardnersgm.co.uk');
      // Fix website
      c = c.replace(/gardnersgroundmaintenance\.co\.uk/gi, 'gardnersgm.co.uk');
      // Strip broken markdown mailto/tel links
      c = c.replace(/\[([^\]]+)\]\(mailto:[^)]+\)/g, '$1');
      c = c.replace(/\[([^\]]+)\]\(tel:[^)]+\)/g, '$1');

      const save = await fetch(WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_blog_post',
          id: p.id,
          title: p.title,
          category: p.category,
          author: p.author || 'Gardners GM',
          excerpt: p.excerpt,
          content: c,
          tags: p.tags,
          imageUrl: p.imageUrl || '',
          status: p.status,
          socialFb: p.socialFb || '',
          socialIg: p.socialIg || '',
          socialX: p.socialX || ''
        })
      });
      const r = await save.json();
      console.log('  -> Fixed: ' + JSON.stringify(r));
    }
  }

  console.log('Done!');
})();
