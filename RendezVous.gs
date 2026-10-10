/**
 * Espace direction — Rappels « Rendez-vous parents »
 * À ajouter comme nouveau fichier dans le projet Apps Script « Espace direction — tâches ».
 *
 * Chaque matin d'école (lundi à vendredi, vers 7 h), envoie un mail
 * seulement s'il y a quelque chose à signaler :
 *   - les rendez-vous prévus aujourd'hui et demain ;
 *   - les points de suivi à faire (en retard, aujourd'hui, ou dans les 2 jours) ;
 *   - les rendez-vous passés encore marqués « Prévu » (compte rendu à compléter).
 *
 * Mise en service : renseigner RDV_PROJECT_ID, puis exécuter une fois installerRappelsRendezVous().
 */

const RDV_PROJECT_ID = '';          // même identifiant que projectId dans firebaseConfig
const RDV_COLLECTION = 'rendezvous';
const RDV_JOURS_AVANCE_SUIVI = 2;   // prévenir 2 jours avant un point de suivi
const RDV_URL_PAGE = 'https://veronique-code.github.io/Releve-absences/rendez-vous.html';

/* ---------- Déclencheur ---------- */
function installerRappelsRendezVous() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'rappelsRendezVous')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('rappelsRendezVous').timeBased().everyDays(1).atHour(7).create();
}

/* ---------- Tâche quotidienne ---------- */
function rappelsRendezVous() {
  const tz = 'Europe/Paris';
  const jour = Number(Utilities.formatDate(new Date(), tz, 'u')); // 1 = lundi … 7 = dimanche
  if (jour > 5) return;

  const iso = d => Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  const now = new Date();
  const auj = iso(now);
  const demain = iso(new Date(now.getTime() + 864e5));
  const limiteSuivi = iso(new Date(now.getTime() + RDV_JOURS_AVANCE_SUIVI * 864e5));

  const rdvs = rdvLireTous_();

  const prochains = rdvs.filter(r => r.statut === 'prevu' && (r.date === auj || r.date === demain))
                        .sort((a, b) => (a.date + (a.heure || '')).localeCompare(b.date + (b.heure || '')));
  const suivis = rdvs.filter(r => r.statut !== 'annule' && r.suivi && r.suivi.date && !r.suivi.fait
                                  && r.suivi.date <= limiteSuivi)
                     .sort((a, b) => a.suivi.date.localeCompare(b.suivi.date));
  const aCompleter = rdvs.filter(r => r.statut === 'prevu' && r.date && r.date < auj)
                         .sort((a, b) => a.date.localeCompare(b.date));

  if (!prochains.length && !suivis.length && !aCompleter.length) return;

  const html = [];
  html.push('<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2a37">');
  if (prochains.length) {
    html.push('<h3 style="color:#1d4e89">Rendez-vous à venir</h3><ul>');
    prochains.forEach(r => html.push('<li><b>' + (r.date === auj ? "Aujourd'hui" : 'Demain')
      + (r.heure ? ' à ' + r.heure : '') + '</b> — ' + rdvEleves_(r) + rdvObjet_(r) + rdvOrigine_(r) + '</li>'));
    html.push('</ul>');
  }
  if (suivis.length) {
    html.push('<h3 style="color:#b45309">Points de suivi</h3><ul>');
    suivis.forEach(r => {
      const etat = r.suivi.date < auj ? '<span style="color:#b42318">en retard depuis le ' + rdvFr_(r.suivi.date) + '</span>'
                 : r.suivi.date === auj ? "<b>aujourd'hui</b>" : 'le ' + rdvFr_(r.suivi.date);
      html.push('<li>' + rdvEleves_(r) + ' — ' + etat + rdvObjet_(r)
        + '<br><span style="color:#6b7280">Rendez-vous du ' + rdvFr_(r.date) + '</span></li>');
    });
    html.push('</ul>');
  }
  if (aCompleter.length) {
    html.push('<h3 style="color:#6b7280">Comptes rendus à compléter</h3>'
      + '<p style="margin:0 0 6px">Ces rendez-vous sont passés mais toujours marqués « Prévu » :</p><ul>');
    aCompleter.forEach(r => html.push('<li>' + rdvFr_(r.date) + ' — ' + rdvEleves_(r) + rdvObjet_(r) + '</li>'));
    html.push('</ul>');
  }
  html.push('<p><a href="' + RDV_URL_PAGE + '">Ouvrir les rendez-vous parents</a></p></div>');

  const n = prochains.length + suivis.length + aCompleter.length;
  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(),
    subject: 'Rendez-vous parents — ' + n + (n > 1 ? ' points' : ' point') + ' à voir',
    htmlBody: html.join('')
  });
}

/* ---------- Lecture Firestore (API REST) ---------- */
function rdvLireTous_() {
  if (!RDV_PROJECT_ID) throw new Error('Renseignez RDV_PROJECT_ID en haut du fichier RendezVous.gs.');
  const base = 'https://firestore.googleapis.com/v1/projects/' + RDV_PROJECT_ID
             + '/databases/(default)/documents/' + RDV_COLLECTION + '?pageSize=300';
  const out = [];
  let token = '';
  do {
    const res = UrlFetchApp.fetch(base + (token ? '&pageToken=' + encodeURIComponent(token) : ''), {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) {
      throw new Error('Lecture Firestore impossible (' + res.getResponseCode() + ') : ' + res.getContentText());
    }
    const data = JSON.parse(res.getContentText());
    (data.documents || []).forEach(d => out.push(rdvValeur_({ mapValue: { fields: d.fields || {} } })));
    token = data.nextPageToken || '';
  } while (token);
  return out;
}

function rdvValeur_(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(rdvValeur_);
  if ('mapValue' in v) {
    const o = {}, f = v.mapValue.fields || {};
    Object.keys(f).forEach(k => o[k] = rdvValeur_(f[k]));
    return o;
  }
  return null;
}

/* ---------- Mise en forme ---------- */
function rdvEsc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function rdvEleves_(r) {
  const e = (r.enfants || []).map(k => '<b>' + rdvEsc_(((k.nom || '').toUpperCase() + ' ' + (k.prenom || '')).trim()) + '</b>'
                                       + (k.classe ? ' (' + rdvEsc_(k.classe) + ')' : ''));
  return e.length ? e.join(', ') : 'Élève non renseigné';
}
function rdvObjet_(r) { return r.objet ? ' — ' + rdvEsc_(r.objet) : ''; }
function rdvOrigine_(r) {
  const o = { directrice: 'à votre initiative', parents: "à l'initiative des parents", autre: r.origineAutre || 'autre initiative' };
  return ' <span style="color:#6b7280">(' + rdvEsc_(o[r.origine] || '') + ')</span>';
}
function rdvFr_(d) {
  if (!d) return '—';
  const p = d.split('-');
  return p[2] + '/' + p[1] + '/' + p[0];
}
