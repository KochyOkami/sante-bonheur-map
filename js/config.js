/* ============================================================
   Configuration du site — À REMPLIR
   ------------------------------------------------------------
   1) Colle ton URL de projet Supabase et ta clé "anon public".
   2) Mets le hash du mot de passe d'édition (génère-le avec
      tools/hash.html, ou demande-moi).
   Si supabaseUrl / supabaseKey restent vides, le site fonctionne
   en mode LOCAL (sauvegarde dans le navigateur uniquement).
   ============================================================ */
window.MAP_CONFIG = {
  // --- Supabase (édition partagée en ligne) ---
  supabaseUrl: "https://kdqaxppspafaihsxrdsx.supabase.co",
  supabaseKey: "sb_publishable_2S0YLJcKgDSCXsg056KUUA_JL8TcUNl",

  // --- Mot de passe d'édition (hash SHA-256, PAS le mot de passe en clair) ---
  // Vide = pas de mot de passe (déconseillé en ligne). Génère le hash avec tools/hash.html
  editPasswordHash: "269d1b8755d46edb58e0a5f714dc64664f677df3aea019dfd7f48ba2c3f84410",

  // Durée pendant laquelle l'édition reste déverrouillée (minutes)
  unlockMinutes: 240,
};
