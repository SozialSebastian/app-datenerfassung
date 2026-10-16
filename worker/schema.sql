-- Tabellen des Mosaik-Dienstes (wird bei jeder Veröffentlichung ausgeführt, ändert Bestehendes nicht)
CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS subs (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  time TEXT NOT NULL DEFAULT '23:00',
  tz TEXT NOT NULL DEFAULT 'Europe/Berlin',
  last_sent TEXT DEFAULT '',
  status_date TEXT DEFAULT '',
  status_open INTEGER DEFAULT -1,
  created TEXT
);
CREATE TABLE IF NOT EXISTS inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created TEXT NOT NULL,
  date TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS weekly (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  day INTEGER NOT NULL DEFAULT 0,
  time TEXT NOT NULL DEFAULT '19:00',
  tz TEXT NOT NULL DEFAULT 'Europe/Berlin',
  last_sent TEXT DEFAULT '',
  teaser TEXT DEFAULT '',
  teaser_week TEXT DEFAULT '',
  created TEXT
);
CREATE TABLE IF NOT EXISTS goals (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  day INTEGER NOT NULL DEFAULT 5,
  time TEXT NOT NULL DEFAULT '18:00',
  tz TEXT NOT NULL DEFAULT 'Europe/Berlin',
  last_sent TEXT DEFAULT '',
  teaser TEXT DEFAULT '',
  teaser_week TEXT DEFAULT '',
  created TEXT
);
