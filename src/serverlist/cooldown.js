import { DEFAULT_COOLDOWN_SECONDS } from './config.js';

export async function getCooldownSeconds(db) {
  const row = await db
    .prepare('SELECT value FROM bot_settings WHERE key = ?')
    .bind('submit_cooldown_seconds')
    .first();
  return row ? parseInt(row.value, 10) : DEFAULT_COOLDOWN_SECONDS;
}

export async function setCooldownSeconds(db, seconds) {
  await db
    .prepare('INSERT INTO bot_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind('submit_cooldown_seconds', String(seconds))
    .run();
}

// Returns { onCooldown: boolean, secondsLeft: number }
export async function checkCooldown(db, userId) {
  const cooldownSeconds = await getCooldownSeconds(db);
  const row = await db
    .prepare('SELECT last_submitted_at FROM submission_cooldowns WHERE user_id = ?')
    .bind(userId)
    .first();

  if (!row) return { onCooldown: false, secondsLeft: 0 };

  const nowSeconds = Math.floor(Date.now() / 1000);
  const elapsed = nowSeconds - row.last_submitted_at;
  const secondsLeft = cooldownSeconds - elapsed;

  return secondsLeft > 0
    ? { onCooldown: true, secondsLeft }
    : { onCooldown: false, secondsLeft: 0 };
}

export async function recordSubmission(db, userId) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      'INSERT INTO submission_cooldowns (user_id, last_submitted_at) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET last_submitted_at = excluded.last_submitted_at'
    )
    .bind(userId, nowSeconds)
    .run();
}
