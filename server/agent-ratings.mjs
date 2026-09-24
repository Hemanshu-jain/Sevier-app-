import { randomUUID } from 'node:crypto';
import { query, queryOne } from './mysql.mjs';

// Field outcomes that make a job rateable. Verification outcomes join this list with that feature.
const OUTCOME_ACTIONS = ['attempt.failed', 'custody.created'];

// A financer rates an agent's work on one of its cases once the agent has submitted an outcome.
// ponytail: financer-given stars for now; a system-computed score can replace ratingSummaries later.
export async function rateAgent({ database, tenantId, userId, caseId, agentId, stars, comment = '', now = new Date().toISOString() }) {
  const score = Number(stars);
  if (!Number.isInteger(score) || score < 1 || score > 5) throw new Error('Choose a rating from 1 to 5 stars.');
  const note = String(comment || '').trim();
  if (note.length > 1000) throw new Error('Keep the rating comment within 1,000 characters.');
  const outcome = await queryOne(database, 'SELECT 1 FROM audit_events WHERE tenant_id = ? AND case_id = ? AND actor_user_id = ? AND action IN (?) LIMIT 1', [tenantId, caseId, agentId, OUTCOME_ACTIONS]);
  if (!outcome) throw new Error('An agent can be rated after they submit a field outcome for this case.');
  await query(database,
    `INSERT INTO agent_ratings (id, tenant_id, agent_user_id, job_type, job_id, stars, comment, rated_by_user_id, created_at)
     VALUES (?, ?, ?, 'case', ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE stars = VALUES(stars), comment = VALUES(comment), rated_by_user_id = VALUES(rated_by_user_id), created_at = VALUES(created_at)`,
    [`rt-${randomUUID()}`, tenantId, agentId, caseId, score, note || null, userId, now]);
  return { agentId, caseId, stars: score };
}

// Public average across every financer: agentId -> { average, count }.
export async function ratingSummaries(database, agentIds) {
  if (!agentIds.length) return new Map();
  const rows = await query(database, 'SELECT agent_user_id, AVG(stars) AS average, COUNT(*) AS count FROM agent_ratings WHERE agent_user_id IN (?) GROUP BY agent_user_id', [agentIds]);
  return new Map(rows.map((row) => [row.agent_user_id, { average: Math.round(Number(row.average) * 10) / 10, count: Number(row.count) }]));
}
