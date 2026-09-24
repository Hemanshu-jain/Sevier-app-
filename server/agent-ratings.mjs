import { randomUUID } from 'node:crypto';
import { query, queryOne } from './mysql.mjs';

// Field outcomes that make a vehicle case rateable.
const OUTCOME_ACTIONS = ['attempt.failed', 'custody.created'];

async function hasOutcome(database, { tenantId, jobType, jobId, agentId }) {
  if (jobType === 'verification') {
    return queryOne(database, "SELECT 1 FROM verification_requests WHERE id = ? AND tenant_id = ? AND assigned_agent_user_id = ? AND status = 'submitted'", [jobId, tenantId, agentId]);
  }
  return queryOne(database, 'SELECT 1 FROM audit_events WHERE tenant_id = ? AND case_id = ? AND actor_user_id = ? AND action IN (?) LIMIT 1', [tenantId, jobId, agentId, OUTCOME_ACTIONS]);
}

// A financer rates an agent's work on one of its cases once the agent has submitted an outcome.
// ponytail: financer-given stars for now; a system-computed score can replace ratingSummaries later.
export async function rateAgent({ database, tenantId, userId, jobType = 'case', jobId, agentId, stars, comment = '', now = new Date().toISOString() }) {
  if (!['case', 'verification'].includes(jobType)) throw new Error('Unknown job type.');
  const score = Number(stars);
  if (!Number.isInteger(score) || score < 1 || score > 5) throw new Error('Choose a rating from 1 to 5 stars.');
  const note = String(comment || '').trim();
  if (note.length > 1000) throw new Error('Keep the rating comment within 1,000 characters.');
  if (!(await hasOutcome(database, { tenantId, jobType, jobId, agentId }))) throw new Error('An agent can be rated after they submit a field outcome for this job.');
  await query(database,
    `INSERT INTO agent_ratings (id, tenant_id, agent_user_id, job_type, job_id, stars, comment, rated_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE stars = VALUES(stars), comment = VALUES(comment), rated_by_user_id = VALUES(rated_by_user_id), created_at = VALUES(created_at)`,
    [`rt-${randomUUID()}`, tenantId, agentId, jobType, jobId, score, note || null, userId, now]);
  return { agentId, jobType, jobId, stars: score };
}

// Public average across every financer: agentId -> { average, count }.
export async function ratingSummaries(database, agentIds) {
  if (!agentIds.length) return new Map();
  const rows = await query(database, 'SELECT agent_user_id, AVG(stars) AS average, COUNT(*) AS count FROM agent_ratings WHERE agent_user_id IN (?) GROUP BY agent_user_id', [agentIds]);
  return new Map(rows.map((row) => [row.agent_user_id, { average: Math.round(Number(row.average) * 10) / 10, count: Number(row.count) }]));
}
