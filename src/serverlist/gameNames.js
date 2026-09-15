// Suggests game names for autocomplete, combining the curated known_games
// list (see schema.sql) with whatever's already been approved — so common
// games show up immediately, and anything actually submitted shows up too,
// without restricting people to only the seeded list.
export async function searchGameNames(db, typed, limit = 25) {
  const pattern = `%${typed}%`;

  const [known, submitted] = await Promise.all([
    db.prepare('SELECT name FROM known_games WHERE name LIKE ? COLLATE NOCASE').bind(pattern).all(),
    db
      .prepare("SELECT DISTINCT game_name AS name FROM servers WHERE status = 'approved' AND game_name LIKE ? COLLATE NOCASE")
      .bind(pattern)
      .all(),
  ]);

  const seen = new Set();
  const results = [];
  for (const row of [...known.results, ...submitted.results]) {
    const key = row.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(row.name);
    if (results.length >= limit) break;
  }

  return results.sort((a, b) => a.localeCompare(b));
}
