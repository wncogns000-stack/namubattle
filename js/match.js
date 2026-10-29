// 대결 진행 규칙: 정답 도전, 결과 기록
//
// 정답 도전 기회 규칙
//   - 처음에는 두 사람 모두 언제든 '정답 도전'을 외칠 수 있어요.
//   - 도전해서 맞히면 바로 승리!
//   - 틀리면 다음 도전 기회는 상대에게 넘어가요. (틀린 사람은 상대가 한 번 도전할 때까지 기다림)
//   - 상대도 틀리면 기회가 다시 나에게 돌아와요.
//   - 선생님이 '기회 넘김 제한 시간'을 정해 두면, 그 시간이 지나면 다시 둘 다 도전할 수 있어요.
import { db } from './db.js';
import { checkBuild } from './puzzle.js';
import { eloDelta } from './tiers.js';
import { START_RATING } from './config.js';

export function opponentOf(g, me) {
  return Object.keys(g.players || {}).find((u) => u !== me) || null;
}

export function lockInfo(g, me, settings, now) {
  if (!g || g.status !== 'playing' || !g.lock) return { locked: false };
  const timeout = (settings?.passTimeoutSec || 0) * 1000;
  const expired = timeout > 0 && now - (g.lock.at || 0) >= timeout;
  if (expired) return { locked: false, expired: true };
  return {
    locked: g.lock.uid === me,          // 내가 틀려서 기다리는 중
    opponentLocked: g.lock.uid !== me,  // 상대가 틀려서 나에게 기회가 온 상태
    remainMs: timeout > 0 ? timeout - (now - g.lock.at) : null,
  };
}

// 정답 도전. 결과: { status: 'win' | 'wrong' | 'notYourTurn' | 'over', check }
export async function challenge(gid, me, heights, puzzle, settings) {
  const check = checkBuild(heights, puzzle);
  const key = db.newKey();
  let outcome = 'over';
  const res = await db.transaction(`games/${gid}`, (g) => {
    if (!g) return g; // 아직 데이터를 못 받은 경우 서버 값으로 다시 시도됨
    if (g.status !== 'playing') { outcome = 'over'; return undefined; }
    const now = db.now();
    if (lockInfo(g, me, settings, now).locked) { outcome = 'notYourTurn'; return undefined; }
    const opp = opponentOf(g, me);
    g.attempts = g.attempts || {};
    g.attempts[key] = { uid: me, ok: check.ok, at: now, n: check.ok ? null : (Object.keys(g.attempts).length + 1) };
    if (check.ok) {
      g.status = 'finished';
      g.winner = me;
      g.loser = opp;
      g.reason = 'solve';
      g.endedAt = now;
      g.lock = null;
      outcome = 'win';
    } else {
      g.lock = { uid: me, at: now };
      outcome = 'wrong';
    }
    return g;
  });
  if (!res.committed) return { status: outcome === 'win' || outcome === 'wrong' ? 'over' : outcome, check };
  if (outcome === 'win') await finalize(gid, res.value);
  return { status: outcome, check };
}

// 승패를 점수·전적에 반영 (게임을 끝낸 쪽이 한 번만 실행)
export async function finalize(gid, g) {
  if (!g || g.finalized) return;
  const { winner, loser } = g;
  const [uw, ul] = await Promise.all([db.get(`users/${winner}`), db.get(`users/${loser}`)]);
  const rw = uw?.rating ?? START_RATING;
  const rl = ul?.rating ?? START_RATING;
  const d = eloDelta(rw, rl);
  const secs = Math.round(((g.endedAt || 0) - (g.createdAt || 0)) / 1000);
  const attempts = Object.values(g.attempts || {});
  const common = { at: g.endedAt, level: g.puzzle?.level || 0, secs, reason: g.reason, gid };
  const up = {
    [`games/${gid}/finalized`]: true,
    [`games/${gid}/result`]: { delta: d, before: { [winner]: rw, [loser]: rl } },
    [`live/${gid}`]: null,
  };
  if (uw) {
    up[`users/${winner}/rating`] = rw + d;
    up[`users/${winner}/wins`] = (uw.wins || 0) + 1;
    up[`history/${winner}/${gid}`] = {
      ...common, opp: loser, oppName: g.players?.[loser] || '', win: true, delta: d, ratingAfter: rw + d,
      tries: attempts.filter((a) => a.uid === winner).length,
    };
  }
  if (ul) {
    up[`users/${loser}/rating`] = rl - d;
    up[`users/${loser}/losses`] = (ul.losses || 0) + 1;
    up[`history/${loser}/${gid}`] = {
      ...common, opp: winner, oppName: g.players?.[winner] || '', win: false, delta: -d, ratingAfter: rl - d,
      tries: attempts.filter((a) => a.uid === loser).length,
    };
  }
  await db.update('', up);
}

// 무효 처리 (선생님 또는 상대가 나가 버린 경우). 점수·전적에 반영하지 않습니다.
export async function cancelGame(gid, by) {
  const res = await db.transaction(`games/${gid}`, (g) => {
    if (!g) return g;
    if (g.status !== 'playing') return undefined;
    g.status = 'canceled';
    g.canceledBy = by || 'teacher';
    g.endedAt = db.now();
    g.lock = null;
    return g;
  });
  const g = res.value;
  const up = { [`live/${gid}`]: null };
  if (by === 'teacher' && g?.players) {
    // 선생님이 끝내면 두 학생 모두 로비로
    for (const uid of Object.keys(g.players)) up[`active/${uid}`] = null;
  }
  await db.update('', up);
  return res.committed;
}

// ───────── 끝난 대결 무효 처리 (기본 학교 선생님) ─────────
// 제재: 이긴 학생에게서만 그 대결로 얻은 점수와 승을 빼요. 진 학생의 점수·패와 전적은 그대로예요. (mode: 'winner')
// (처음 만든 방식 mode 없음 = 두 학생 모두 되돌림. 그렇게 무효로 한 기록도 그대로 되돌릴 수 있어요)
// 원래 기록은 voided/대결 에 보관해서 되돌릴 수 있어요:
//   voided/대결 = { at, mode, winner, loser, players, delta, createdAt, endedAt, level, history: { 학생: 원래 전적 한 줄 } }
// seasonStart: 지금 시즌이 시작한 시각 (지난 시즌 대결은 점수가 이미 새로 시작했으니 건드리지 않음)

// 학생 점수·승패를 더하거나 빼기 (동시에 끝난 다른 대결과 겹쳐도 안전하게 트랜잭션으로)
function addToUser(uid, a) {
  return db.transaction(`users/${uid}`, (u) => (u ? {
    ...u,
    rating: (u.rating ?? START_RATING) + a.rating,
    wins: Math.max(0, (u.wins || 0) + a.wins),
    losses: Math.max(0, (u.losses || 0) + a.losses),
  } : u));
}

function sumByUser(recs, sign) {
  const adj = {};
  const add = (uid, rating, wins, losses) => {
    const x = (adj[uid] ||= { rating: 0, wins: 0, losses: 0 });
    x.rating += rating * sign; x.wins += wins * sign; x.losses += losses * sign;
  };
  for (const rec of recs) {
    add(rec.winner, -rec.delta, -1, 0);
    if (rec.mode !== 'winner') add(rec.loser, rec.delta, 0, -1);
  }
  return adj;
}

// 무효 처리. 결과: 무효로 한 대결 수
export async function voidFinishedGames(gids, seasonStart = 0) {
  const now = db.now();
  const items = (await Promise.all(gids.map(async (gid) => {
    const g = await db.get(`games/${gid}`);
    if (!g || g.status !== 'finished' || !g.finalized || !g.winner || !g.loser) return null;
    if ((g.endedAt || g.createdAt || 0) < seasonStart) return null;
    const [hw, hl] = await Promise.all([db.get(`history/${g.winner}/${gid}`), db.get(`history/${g.loser}/${gid}`)]);
    const delta = Math.abs(g.result?.delta ?? hw?.delta ?? hl?.delta ?? 0);
    return { gid, rec: {
      at: now, mode: 'winner', winner: g.winner, loser: g.loser, players: g.players || {}, delta,
      createdAt: g.createdAt || 0, endedAt: g.endedAt || 0, level: g.puzzle?.level || 0,
      history: { [g.winner]: hw || null, [g.loser]: hl || null },
    } };
  }))).filter(Boolean);
  // 같은 대결을 두 번 무효로 하지 않도록 먼저 보관 자리를 차지
  const claimed = (await Promise.all(items.map(async (it) => {
    const res = await db.transaction(`voided/${it.gid}`, (v) => (v ? undefined : it.rec));
    return res.committed && res.value?.at === now ? it : null;
  }))).filter(Boolean);
  if (!claimed.length) return 0;
  await Promise.all(Object.entries(sumByUser(claimed.map((x) => x.rec), 1)).map(([uid, a]) => addToUser(uid, a)));
  const up = {};
  for (const { gid, rec } of claimed) {
    up[`history/${rec.winner}/${gid}`] = null; // 진 학생 전적은 그대로 (졌던 기록은 남음)
    up[`games/${gid}/voided`] = now;
  }
  await db.update('', up);
  return claimed.length;
}

// 무효 처리 되돌리기. 결과: 되돌린 대결 수
export async function restoreVoidedGames(gids, seasonStart = 0) {
  const recs = (await Promise.all(gids.map(async (gid) => ({ gid, rec: await db.get(`voided/${gid}`) }))))
    .filter((x) => x.rec && !x.rec.restoring && (x.rec.endedAt || 0) >= seasonStart);
  // 두 번 되돌리지 않도록 표시를 먼저 남김
  const claimed = (await Promise.all(recs.map(async (it) => {
    const res = await db.transaction(`voided/${it.gid}`, (v) => (v == null ? null : (v.at === it.rec.at && !v.restoring ? { ...v, restoring: true } : undefined)));
    return res.committed && res.value?.restoring ? it : null;
  }))).filter(Boolean);
  if (!claimed.length) return 0;
  await Promise.all(Object.entries(sumByUser(claimed.map((x) => x.rec), -1)).map(([uid, a]) => addToUser(uid, a)));
  const up = {};
  for (const { gid, rec } of claimed) {
    const back = rec.mode === 'winner' ? [rec.winner] : [rec.winner, rec.loser];
    for (const uid of back) if (rec.history?.[uid]) up[`history/${uid}/${gid}`] = rec.history[uid];
    up[`games/${gid}/voided`] = null;
    up[`voided/${gid}`] = null;
  }
  await db.update('', up);
  return claimed.length;
}
