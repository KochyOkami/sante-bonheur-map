/* ============================================================
   db.js — Couche données cloud (Supabase) avec repli LOCAL
   Expose window.MapDB : une API simple utilisée par app.js.
   ============================================================ */
(function () {
  const cfg = window.MAP_CONFIG || {};
  const cloudEnabled = !!(cfg.supabaseUrl && cfg.supabaseKey && window.supabase);

  let client = null;
  if (cloudEnabled) {
    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      realtime: { params: { eventsPerSecond: 5 } },
    });
  }

  const LOCAL_KEY = 'worldmap.data.v1';

  // ---------- Repli local ----------
  function localLoad() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  }
  function localSave(data) {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(data)); } catch (e) {}
  }

  // ---------- Conversion ligne DB <-> objet ----------
  function rowToItem(row) { return Object.assign({ id: row.id }, row.data); }
  function itemToRow(type, item) {
    const { id } = item;
    const data = Object.assign({}, item); delete data.id;
    return { id, type, data };
  }

  const MapDB = {
    cloud: cloudEnabled,

    // Charge tout (cloud si dispo, sinon cache local, sinon fichier d'exemple)
    async loadAll() {
      if (cloudEnabled) {
        const { data, error } = await client.from('features').select('*');
        if (error) { console.error('Supabase load:', error); return localLoad() || fetchSeed(); }
        const out = { kingdoms: [], places: [] };
        (data || []).forEach(r => {
          const item = rowToItem(r);
          if (r.type === 'kingdom') out.kingdoms.push(item);
          else out.places.push(item);
        });
        localSave(out);           // garde un cache local hors-ligne
        return out;
      }
      return localLoad() || await fetchSeed();
    },

    // Ajoute ou met à jour un élément
    async upsert(type, item, fullData) {
      if (fullData) localSave(fullData);
      if (!cloudEnabled) return;
      const { error } = await client.from('features')
        .upsert(Object.assign(itemToRow(type, item), { updated_at: new Date().toISOString() }));
      if (error) console.error('Supabase upsert:', error);
    },

    // Supprime un élément
    async remove(id, fullData) {
      if (fullData) localSave(fullData);
      if (!cloudEnabled) return;
      const { error } = await client.from('features').delete().eq('id', id);
      if (error) console.error('Supabase delete:', error);
    },

    // Import en masse (remplace tout)
    async replaceAll(data) {
      localSave(data);
      if (!cloudEnabled) return;
      await client.from('features').delete().neq('id', '___none___');
      const rows = [
        ...data.kingdoms.map(k => itemToRow('kingdom', k)),
        ...data.places.map(p => itemToRow('place', p)),
      ];
      if (rows.length) {
        const { error } = await client.from('features').insert(rows);
        if (error) console.error('Supabase import:', error);
      }
    },

    // Abonnement temps réel : callback() appelé à chaque changement distant
    subscribe(callback) {
      if (!cloudEnabled) return () => {};
      const ch = client.channel('features-live')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'features' }, callback)
        .subscribe();
      return () => client.removeChannel(ch);
    },
  };

  async function fetchSeed() {
    try { return await fetch('data/kingdoms.json').then(r => r.json()); }
    catch (e) { return { kingdoms: [], places: [] }; }
  }

  window.MapDB = MapDB;
})();
