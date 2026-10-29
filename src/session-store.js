const session = require('express-session');
const { run, get } = require('./db');

// Persists sessions in the same SQLite file so logins survive restarts.
class SQLiteStore extends session.Store {
  constructor() {
    super();
    setInterval(() => run('DELETE FROM sessions WHERE expires < ?', Date.now()), 60 * 60 * 1000).unref();
  }
  get(sid, cb) {
    try {
      const row = get('SELECT sess, expires FROM sessions WHERE sid = ?', sid);
      if (!row || row.expires < Date.now()) return cb(null, null);
      cb(null, JSON.parse(row.sess));
    } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    try {
      const exp = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 86400000;
      run('INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires', sid, JSON.stringify(sess), exp);
      cb && cb(null);
    } catch (e) { cb && cb(e); }
  }
  destroy(sid, cb) {
    try { run('DELETE FROM sessions WHERE sid = ?', sid); cb && cb(null); } catch (e) { cb && cb(e); }
  }
  touch(sid, sess, cb) { this.set(sid, sess, cb); }
}

module.exports = SQLiteStore;
